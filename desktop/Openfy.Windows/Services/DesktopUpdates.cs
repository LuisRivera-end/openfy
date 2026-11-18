using System.Diagnostics;
using System.Net.NetworkInformation;
using System.Text.Json;
using Microsoft.UI.Dispatching;
using Openfy.Core;
using Openfy.Windows.ViewModels;

namespace Openfy.Windows.Services;

public sealed class DesktopUpdates : IDisposable
{
    private readonly MainViewModel model;
    private readonly string root;
    private readonly HttpClient http = new() { Timeout = TimeSpan.FromMinutes(10) };
    private readonly UpdateFeed feed;
    private readonly FileSystemWatcher watcher;
    private readonly DispatcherQueue dispatcher;
    private readonly DispatcherQueueTimer timer;
    private readonly CancellationTokenSource lifetime = new();
    private readonly Func<Task> shutdown;
    private DateTimeOffset nextLocal, nextRemote, idleSince = DateTimeOffset.UtcNow;
    private bool checking, ticking, applying;
    private long postponed;
    private string? failed;
    private UpdatePackage? package;
    public event Action? Changed;
    public string Status { get; private set; } = "Buscando actualizaciones…";
    public string? Available => package?.Manifest.Id;
    public Func<bool> Editing { get; set; } = () => false;
    public DesktopUpdates(MainViewModel model, Func<Task> shutdown)
    {
        this.model = model; this.shutdown = shutdown; dispatcher = DispatcherQueue.GetForCurrentThread();
        string? testRoot = Environment.GetEnvironmentVariable("OPENFY_INSTALL_TEST_ROOT");
        if (testRoot != null && !File.Exists(Path.Combine(testRoot, ".openfy-qa"))) throw new IOException("Perfil de pruebas no válido.");
        root = Path.Combine(testRoot ?? Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Openfy", "updates");
        string local = Path.Combine(root, "feed"); Directory.CreateDirectory(local);
        http.DefaultRequestHeaders.UserAgent.ParseAdd("Openfy/" + ReleaseInfo.Current.Version);
        feed = new(root, http); watcher = new(local, "latest.json") { NotifyFilter = NotifyFilters.LastWrite | NotifyFilters.FileName };
        watcher.Created += LocalChanged; watcher.Renamed += LocalChanged; watcher.Changed += LocalChanged; watcher.EnableRaisingEvents = true;
        NetworkChange.NetworkAvailabilityChanged += NetworkChanged;
        timer = dispatcher.CreateTimer(); timer.Interval = TimeSpan.FromSeconds(1); timer.Tick += Tick;
    }
    public async Task StartAsync() {
        var saved = await model.Store.ReadAsync<UpdatePreference>("updates"); postponed = saved?.Postponed ?? 0; failed = saved?.Failed;
        timer.Start(); await CheckAsync(true);
    }
    private record UpdatePreference(long Postponed, string? Failed);
    private Task SaveAsync() => model.Store.WriteAsync("updates", new UpdatePreference(postponed, failed));
    private void Set(string status) { if (Status != status) { Status = status; Changed?.Invoke(); } }
    private void LocalChanged(object sender, FileSystemEventArgs args) => dispatcher.TryEnqueue(() => nextLocal = DateTimeOffset.MinValue);
    private void NetworkChanged(object? sender, NetworkAvailabilityEventArgs args) { if (args.IsAvailable) dispatcher.TryEnqueue(() => nextRemote = DateTimeOffset.MinValue); }
    public void Interacted() { idleSince = DateTimeOffset.UtcNow; }
    public async Task PostponeAsync() { postponed = DateTimeOffset.UtcNow.AddHours(2).ToUnixTimeSeconds(); Interacted(); await SaveAsync(); Set("Actualización pospuesta durante dos horas."); }
    public async Task CheckAsync(bool remote = true) {
        if (checking || applying) return;
        checking = true; nextLocal = DateTimeOffset.UtcNow.AddSeconds(30); if (remote) nextRemote = DateTimeOffset.UtcNow.AddHours(4);
        try {
            var found = await feed.FindAsync(remote, lifetime.Token);
            bool changed = found?.Manifest.Id != package?.Manifest.Id;
            package = found;
            if (changed) { Interacted(); Changed?.Invoke(); }
            if (package == null) Set("Tienes la versión más reciente.");
            else if (changed) Set($"Openfy {package.Manifest.Id} disponible ({package.Origin}).");
        } catch (OperationCanceledException) when (lifetime.IsCancellationRequested) {} catch (Exception error) { Set("No se pudo verificar la actualización. " + error.Message); }
        finally { checking = false; }
    }
    private async void Tick(DispatcherQueueTimer sender, object args) {
        if (ticking || applying) return; ticking = true;
        try {
            var now = DateTimeOffset.UtcNow;
            if (now >= nextLocal || now >= nextRemote) await CheckAsync(now >= nextRemote);
            if (package == null || lifetime.IsCancellationRequested) return;
            if (failed == package.Manifest.Id || File.Exists(Path.Combine(root, "failed", package.Manifest.Id + ".json"))) { Set("La actualización anterior falló. Puedes reintentar con el botón."); return; }
            if (now.ToUnixTimeSeconds() < postponed) return;
            if (model.Playing || model.Busy || model.Operations > 0 || Editing()) { Interacted(); Set("La actualización espera a que termines."); return; }
            var readiness = await model.Host.CallAsync<UpdateReadiness>("updateReadiness", new { owner = model.ActivityId });
            if (!readiness.Ready) { Interacted(); Set(readiness.Reason); return; }
            int elapsed = (int)(now - idleSince).TotalSeconds;
            if (elapsed >= 90) await ApplyAsync(false);
            else Set(elapsed >= 60 ? $"Openfy se reiniciará en {90 - elapsed} segundos." : $"Openfy {package.Manifest.Id} se instalará en reposo.");
        } catch (Exception error) { Interacted(); Set(error.Message); } finally { ticking = false; }
    }
    public async Task ApplyAsync(bool manual) {
        if (applying || package == null) return; applying = true;
        bool frozen = false;
        try {
            if (model.Busy || model.Operations > 0 || Editing()) { Interacted(); Set("Termina la operación actual antes de actualizar."); return; }
            if (!File.Exists(Path.Combine(AppContext.BaseDirectory, ".openfy-installation"))) { Set("Abre la instalación de Openfy para aplicar este paquete."); return; }
            await package.Manifest.VerifyAsync(package.Path, lifetime.Token);
            if (Editing() || model.Busy || model.Operations > 0) { Interacted(); Set("La aplicación está en uso."); return; }
            if (manual && model.Playing) await model.ToggleAsync();
            if (model.Playing) { Interacted(); return; }
            if (manual) {
                var confirmationDeadline = DateTime.UtcNow.AddSeconds(15);
                while (true) {
                    var ready = await model.Host.CallAsync<UpdateReadiness>("updateReadiness", new { owner = model.ActivityId });
                    if (ready.Ready) break;
                    Set(ready.Reason);
                    if (!ready.Reason.StartsWith("Esperando confirmación") || DateTime.UtcNow >= confirmationDeadline) { Interacted(); return; }
                    await Task.Delay(500, lifetime.Token);
                }
            }
            if (model.Playing || Editing() || model.Operations > 0) { Interacted(); return; }
            await model.PersistAsync();
            if (manual) { var failure = Path.Combine(root, "failed", package.Manifest.Id + ".json"); if (File.Exists(failure)) File.Delete(failure); failed = null; await SaveAsync(); }
            var maintenance = await model.Host.CallAsync<MaintenanceReceipt>("beginMaintenance", new { owner = model.ActivityId, minSchema = package.Manifest.MinLibrarySchema, maxSchema = package.Manifest.MaxLibrarySchema }); frozen = true;
            var request = new UpdateRequest(package.Manifest, maintenance.DataRoot, model.Store.Root, model.Host.Port, maintenance.Transaction, Environment.ProcessId);
            var requests = Path.Combine(root, "requests"); Directory.CreateDirectory(requests);
            var path = Path.Combine(requests, maintenance.Transaction + ".json"); await File.WriteAllTextAsync(path, JsonSerializer.Serialize(request, Contracts.Json));
            var info = new ProcessStartInfo(package.Path) { WorkingDirectory = root, UseShellExecute = false, CreateNoWindow = true };
            info.ArgumentList.Add("--update-request"); info.ArgumentList.Add(path); info.ArgumentList.Add("--silent");
            using var helper = Process.Start(info) ?? throw new IOException("No se pudo iniciar el actualizador.");
            Set("Comprobando espacio y preparando el paquete…");
            string preparedFile = Path.Combine(requests, maintenance.Transaction + ".ready");
            var deadline = DateTime.UtcNow.AddMinutes(4);
            while (!File.Exists(preparedFile)) {
                if (helper.HasExited) throw new IOException("El instalador no pudo preparar el paquete. Revisa el registro de instalación.");
                if (DateTime.UtcNow >= deadline) { helper.Kill(); throw new IOException("El paquete no se preparó a tiempo."); }
                await Task.Delay(250, lifetime.Token);
            }
            Set("Guardando la sesión y reiniciando…"); await shutdown();
        } catch (Exception error) {
            if (frozen) { try { await model.Host.CallAsync<JsonElement>("cancelMaintenance"); } catch {} }
            Set(error.Message); Interacted();
        } finally { applying = false; }
    }
    public void Dispose() { timer.Stop(); timer.Tick -= Tick; lifetime.Cancel(); watcher.Dispose(); NetworkChange.NetworkAvailabilityChanged -= NetworkChanged; http.Dispose(); lifetime.Dispose(); }
}
