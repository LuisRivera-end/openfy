using System.Collections.Concurrent;
using System.Diagnostics;
using System.IO.Pipes;
using System.Text;
using System.Text.Json;
using Openfy.Core;

namespace Openfy.Windows.Services;

public record BackendOptions(string Workspace, string DataDirectory, int Port);
public sealed class BackendHost(BackendClient api, BackendOptions? options = null) : IAsyncDisposable
{
    private NamedPipeServerStream? pipe;
    private StreamWriter? writer;
    private Process? child;
    private ProcessJob? job;
    private CancellationTokenSource? lifetime;
    private readonly SemaphoreSlim writes = new(1, 1);
    private readonly SemaphoreSlim lifecycle = new(1, 1);
    private readonly ConcurrentDictionary<string, TaskCompletionSource<JsonElement>> requests = new();
    private TaskCompletionSource<JsonElement>? ready;
    private bool stopping;
    private bool starting;
    public bool Connected { get; private set; }
    public int? ProcessId => child is { HasExited: false } ? child.Id : null;
    public event Action<string, JsonElement>? Event;
    public event Action<string>? Status;
    public event Action? Reconnected;
    public string Root { get; private set; } = "";
    public int Port { get; private set; } = 3000;
    public string LogDirectory { get; } = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Openfy", "logs");

    public async Task StartAsync(CancellationToken cancellation = default)
    {
        await lifecycle.WaitAsync(cancellation);
        try { if (Connected) return; cancellation.ThrowIfCancellationRequested(); stopping = false; await CleanupAsync(); await StartCoreAsync(cancellation); }
        finally { lifecycle.Release(); }
    }
    private async Task StartCoreAsync(CancellationToken cancellation = default)
    {
        starting = true;
        Connected = false;
        lifetime = new CancellationTokenSource();
        Directory.CreateDirectory(LogDirectory);
        string? workspace = options?.Workspace ?? Argument("--workspace");
        Root = workspace ?? Path.Combine(AppContext.BaseDirectory, "backend");
        string configuration = Path.Combine(Environment.GetEnvironmentVariable("OPENFY_INSTALL_TEST_ROOT") ?? Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Openfy", "configuration.env");
        if (workspace != null && File.Exists(Path.Combine(workspace, ".env"))) configuration = Path.Combine(workspace, ".env");
        var environment = File.Exists(configuration) ? ParseEnvironment(await File.ReadAllLinesAsync(configuration)) : new Dictionary<string, string>();
        if ((options?.DataDirectory ?? Argument("--data-dir")) is { } dataOverride) environment["OPENFY_DATA_DIR"] = dataOverride;
        if (Argument("--port") is { } portOverride) environment["NITRO_PORT"] = portOverride;
        Port = environment.TryGetValue("NITRO_PORT", out var text) && int.TryParse(text, out int parsed) ? parsed : 3000;
        if (options != null) Port = options.Port;
        string node = Path.Combine(AppContext.BaseDirectory, "runtime", "node.exe");
        if (workspace != null)
        {
            var runtime = JsonSerializer.Deserialize<JsonElement>(await File.ReadAllTextAsync(Path.Combine(workspace, ".openfy-runtime.json")));
            node = runtime.GetProperty("nodePath").GetString()!;
        }
        if (!File.Exists(node) || !File.Exists(Path.Combine(Root, ".output", "server", "index.mjs")))
            throw new FileNotFoundException("Falta el backend incluido con Openfy. Reinstala o ejecuta la preparación de escritorio.");
        string instance = Guid.NewGuid().ToString("D"), name = "openfy-" + instance;
        pipe = new NamedPipeServerStream(name, PipeDirection.InOut, 1, PipeTransmissionMode.Byte, PipeOptions.Asynchronous | PipeOptions.CurrentUserOnly);
        ready = new(TaskCreationOptions.RunContinuationsAsynchronously);
        var info = new ProcessStartInfo(node) { WorkingDirectory = Root, UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true };
        info.ArgumentList.Add(Path.Combine(Root, "scripts", "serve.mjs"));
        foreach (var value in environment) info.Environment[value.Key] = value.Value;
        info.Environment["NITRO_PORT"] = Port.ToString();
        info.Environment["OPENFY_STATE_DIR"] = Argument("--state-dir") ?? Environment.GetEnvironmentVariable("OPENFY_STATE_DIR") ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Openfy", "desktop");
        if (Environment.GetCommandLineArgs().Contains("--verify-update")) info.Environment["OPENFY_VERIFY_UPDATE"] = "1";
        // Self-exiting checks never contact the animated-cover provider; videos already stored are still served.
        if (App.CheckRun) info.Environment["OPENFY_MOTION_ART"] = "off";
        info.Environment["NITRO_HOST"] = "127.0.0.1";
        info.Environment["OPENFY_DESKTOP_PIPE"] = @"\\.\pipe\" + name;
        info.Environment["OPENFY_DESKTOP_INSTANCE"] = instance;
        info.Environment["NITRO_SHUTDOWN_TIMEOUT"] = "4000";
        if (SessionLog.DirectoryPath is { } diagnostics) {
            info.Environment["OPENFY_SESSION_LOG_DIR"] = diagnostics;
            info.Environment["OPENFY_SESSION_ID"] = SessionLog.SessionId;
        }
        Status?.Invoke("Iniciando biblioteca…");
        child = Process.Start(info) ?? throw new IOException("No se pudo iniciar Node.");
        job = new ProcessJob(child);
        _ = CaptureAsync(child.StandardOutput, "server.log");
        _ = CaptureAsync(child.StandardError, "error.log");
        _ = ObserveExitAsync(child);
        using var startup = CancellationTokenSource.CreateLinkedTokenSource(lifetime.Token, cancellation);
        startup.CancelAfter(TimeSpan.FromSeconds(30));
        try
        {
            await pipe.WaitForConnectionAsync(startup.Token);
            writer = new StreamWriter(pipe, new UTF8Encoding(false), leaveOpen: true) { AutoFlush = true };
            var incoming = pipe; var token = lifetime.Token;
            // Starting this loop on WinUI captured its context: every progress
            // message and JSON parse then competed with input and rendering.
            _ = Task.Run(() => ReadAsync(incoming, token));
            var greeting = await ready.Task.WaitAsync(startup.Token);
            if (greeting.GetProperty("protocol").GetInt32() != Contracts.Protocol) throw new IOException("El backend requiere una versión compatible de Openfy.");
            api.SetPort(Port);
            for (;;)
            {
                startup.Token.ThrowIfCancellationRequested();
                try { if ((await api.GetAsync<BackendStatus>("api/status", startup.Token)).DesktopInstance == instance) break; }
                catch (HttpRequestException) { }
                await Task.Delay(100, startup.Token);
            }
            await CallAsync<JsonElement>("subscribe").WaitAsync(startup.Token);
            Connected = true;
            Status?.Invoke("Biblioteca conectada");
            Reconnected?.Invoke();
        }
        catch (OperationCanceledException) when (cancellation.IsCancellationRequested) { await CleanupAsync(); throw; }
        catch (OperationCanceledException) { bool exited = child?.HasExited == true; await CleanupAsync(); throw new IOException(exited ? $"El backend terminó al iniciar. Comprueba que el puerto {Port} y la biblioteca estén libres. Registros: {LogDirectory}" : $"La biblioteca no inició en 30 segundos. Comprueba el puerto {Port} y los registros en {LogDirectory}."); }
        catch { await CleanupAsync(); throw; }
        finally { starting = false; }
    }
    private async Task ReadAsync(Stream stream, CancellationToken cancellation)
    {
        try
        {
            using var reader = new StreamReader(stream, Encoding.UTF8, leaveOpen: true);
            while (await reader.ReadLineAsync(cancellation) is { } line)
            {
                if (line.Length > 1024 * 1024) throw new IOException("Mensaje local demasiado grande.");
                var message = JsonSerializer.Deserialize<JsonElement>(line);
                if (message.TryGetProperty("event", out var change))
                {
                    string type = change.GetProperty("type").GetString()!;
                    var payload = change.GetProperty("payload").Clone();
                    if (type == "ready") ready?.TrySetResult(payload);
                    else Event?.Invoke(type, payload);
                }
                else if (message.TryGetProperty("id", out var id) && requests.TryRemove(id.GetString()!, out var pending))
                {
                    if (message.TryGetProperty("error", out var error)) pending.TrySetException(new IOException(error.GetString()));
                    else pending.TrySetResult(message.GetProperty("result").Clone());
                }
            }
        }
        catch (Exception error) when (error is IOException or OperationCanceledException or ObjectDisposedException) { }
        finally { foreach (var request in requests.Values) request.TrySetException(new IOException("Se perdió la conexión con la biblioteca.")); requests.Clear(); }
    }
    public async Task<T> CallAsync<T>(string method, object? parameters = null)
    {
        var elapsed = Stopwatch.StartNew();
        if (writer == null) throw new IOException("La biblioteca todavía no está disponible.");
        string id = Guid.NewGuid().ToString("N");
        var completion = new TaskCompletionSource<JsonElement>(TaskCreationOptions.RunContinuationsAsynchronously);
        requests[id] = completion;
        try
        {
            await writes.WaitAsync();
            try { await writer.WriteLineAsync(JsonSerializer.Serialize(new { id, method, @params = parameters }, Contracts.Json)); }
            finally { writes.Release(); }
            var value = await completion.Task.WaitAsync(TimeSpan.FromMinutes(method == "importPaths" ? 60 : 1));
            SessionLog.Write("bridge." + method, "completed", id, elapsed.Elapsed.TotalMilliseconds);
            return value.Deserialize<T>(Contracts.Json)!;
        }
        catch (Exception error) { SessionLog.Write("bridge." + method, "failed", id, elapsed.Elapsed.TotalMilliseconds, error: error); throw; }
        finally { requests.TryRemove(id, out _); }
    }
    private async Task ObserveExitAsync(Process observed)
    {
        await observed.WaitForExitAsync();
        if (stopping || child != observed) return;
        if (starting) { ready?.TrySetException(new IOException($"El backend no pudo iniciarse. Comprueba que el puerto {Port} y la biblioteca estén libres. Registros: {LogDirectory}")); lifetime?.Cancel(); return; }
        Connected = false;
        Status?.Invoke("Se perdió la conexión. Recuperando biblioteca…");
        await lifecycle.WaitAsync();
        try
        {
            if (stopping || child != observed) return;
            await CleanupAsync();
            foreach (int delay in new[] { 1, 2, 5 })
            {
                if (stopping) return;
                await Task.Delay(TimeSpan.FromSeconds(delay));
                try { await StartCoreAsync(); return; }
                catch (Exception error) { Status?.Invoke(error.Message); }
            }
            Status?.Invoke("La biblioteca no pudo recuperarse. Usa Reintentar en Ajustes.");
        }
        finally { lifecycle.Release(); }
    }
    private async Task CaptureAsync(StreamReader reader, string filename)
    {
        try { while (await reader.ReadLineAsync() is { } line) await File.AppendAllTextAsync(Path.Combine(LogDirectory, filename), line + Environment.NewLine); }
        catch (Exception error) when (error is IOException or ObjectDisposedException) { }
    }
    private async Task CleanupAsync()
    {
        Connected = false;
        lifetime?.Cancel();
        writer = null;
        pipe?.Dispose(); pipe = null;
        job?.Dispose(); job = null;
        if (child is { HasExited: false }) { try { child.Kill(true); await child.WaitForExitAsync(); } catch (InvalidOperationException) { } }
        child?.Dispose(); child = null;
        lifetime?.Dispose(); lifetime = null;
    }
    public async ValueTask DisposeAsync()
    {
        stopping = true;
        if (!Connected) { try { lifetime?.Cancel(); } catch (ObjectDisposedException) { } }
        await lifecycle.WaitAsync();
        try
        {
            if (Connected) { using var grace = new CancellationTokenSource(TimeSpan.FromSeconds(5)); try { await CallAsync<JsonElement>("shutdown").WaitAsync(grace.Token); if (child != null) await child.WaitForExitAsync(grace.Token); } catch { } }
            await CleanupAsync();
        }
        finally { lifecycle.Release(); }
    }
    private static string? Argument(string key) { var args = Environment.GetCommandLineArgs(); int i = Array.IndexOf(args, key); return i >= 0 && i + 1 < args.Length ? args[i + 1] : null; }
    private static Dictionary<string, string> ParseEnvironment(string[] lines) => lines.Where(line => !line.TrimStart().StartsWith('#') && line.Contains('='))
        .Select(line => line.Split('=', 2)).ToDictionary(pair => pair[0].Trim(), pair => pair[1].Trim().Trim('"', '\''));
}
