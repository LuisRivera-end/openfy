using System.Diagnostics;
using System.IO.Compression;
using System.Reflection;
using System.Text.Json;
using Openfy.Core;

namespace Openfy.Setup;

internal static partial class Program
{
    private static string Control => Path.Combine(Local, "Openfy", "updates");
    private static string Config => Path.Combine(Local, "Openfy", "configuration.env");
    private static string Journal => Path.Combine(Control, "transaction.json");
    private static string Backups => Path.Combine(Local, "Openfy", "backups", "updates");
    private sealed record Profile(string DataRoot, string StateRoot, int Port);
    private sealed record Transaction(Guid Id, Profile Profile, ReleaseInfo Release, bool ExistingInstall, bool ExistingLibrary, string Phase)
    {
        public string Backup => Path.Combine(Backups, Id.ToString());
        public string Stage => Path.Combine(Programs, "Openfy.installing-" + Id);
        public string Previous => Path.Combine(Programs, "Openfy.previous-" + Id);
    }

    private static Profile ReadProfile()
    {
        var saved = Path.Combine(Control, "profile.json");
        var previous = File.Exists(saved) ? Read<Profile>(saved) : null;
        var config = new Dictionary<string, string>(StringComparer.OrdinalIgnoreCase);
        if (File.Exists(Config))
            foreach (var line in File.ReadLines(Config)) {
                var pair = line.Split('=', 2);
                if (pair.Length == 2 && !line.TrimStart().StartsWith('#')) config[pair[0].Trim()] = pair[1].Trim().Trim('"', '\'');
            }
        string? Setting(string name) => config.GetValueOrDefault(name) ?? Environment.GetEnvironmentVariable(name);
        string data = Setting("OPENFY_DATA_DIR") ?? previous?.DataRoot ?? Path.Combine(Local, "Openfy", "data");
        string state = Environment.GetEnvironmentVariable("OPENFY_STATE_DIR") ?? previous?.StateRoot ?? Path.Combine(Local, "Openfy", "desktop");
        return new(Path.GetFullPath(data, Path.Combine(Destination, "backend")), Path.GetFullPath(state),
            int.TryParse(Setting("NITRO_PORT"), out int port) ? port : previous?.Port ?? 3000);
    }

    private static void ValidateProfile(Profile profile)
    {
        bool Within(string path, string root) => (Path.TrimEndingDirectorySeparator(Path.GetFullPath(path)) + Path.DirectorySeparatorChar)
            .StartsWith(Path.TrimEndingDirectorySeparator(Path.GetFullPath(root)) + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase);
        if (profile.Port is < 1 or > 65535 || !Path.IsPathFullyQualified(profile.DataRoot) || !Path.IsPathFullyQualified(profile.StateRoot)
            || Within(profile.DataRoot, Destination) || Within(profile.StateRoot, Destination) || Within(Destination, profile.DataRoot) || Within(Destination, profile.StateRoot)
            || Within(Backups, profile.StateRoot) || Within(profile.StateRoot, Backups)
            || Isolated && (!Within(profile.DataRoot, Local) || !Within(profile.StateRoot, Local)))
            throw new IOException("Las rutas configuradas no permiten una actualización aislada de los datos.");
    }

    private static T Read<T>(string path) => JsonSerializer.Deserialize<T>(File.ReadAllBytes(path), Contracts.Json) ?? throw new IOException("Archivo de estado incompleto.");
    private static void Durable<T>(string path, T value) {
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        string temp = path + ".new";
        using (var file = new FileStream(temp, FileMode.Create, FileAccess.Write, FileShare.None)) { JsonSerializer.Serialize(file, value, Contracts.Json); file.Flush(true); }
        File.Move(temp, path, true);
    }

    private static ProcessStartInfo StartInfo(string executable, params string[] arguments) {
        var info = new ProcessStartInfo(executable) { UseShellExecute = false, CreateNoWindow = true, WorkingDirectory = Path.GetDirectoryName(executable)! };
        foreach (string arg in arguments) info.ArgumentList.Add(arg);
        return info;
    }
    private static void Launch(Profile? chosen = null) {
        if (!Owned()) throw new IOException("No se encontró la instalación de Openfy.");
        var profile = chosen ?? ReadProfile(); ValidateProfile(profile);
        using var app = Process.Start(StartInfo(Path.Combine(Destination, "Openfy.exe"), "--state-dir", profile.StateRoot, "--data-dir", profile.DataRoot, "--port", profile.Port.ToString()));
    }

    private static void BootstrapReady(Profile profile) {
        string executable = Path.Combine(Destination, "Openfy.exe");
        bool open = false;
        foreach (var process in Process.GetProcessesByName("Openfy")) using (process) {
            try { open |= string.Equals(process.MainModule?.FileName, executable, StringComparison.OrdinalIgnoreCase); }
            catch (InvalidOperationException) { }
        }
        if (!open) return;
        // The previous desktop release cannot acknowledge readiness for every connected client.
        // Keep a running pre-updater session available until its owner exits from the tray.
        throw new IOException("Para la primera instalación del actualizador, termina la reproducción y las operaciones de tus dispositivos, sal de Openfy desde la bandeja y abre este instalador.");
    }
    private static void CheckClosed(Profile profile) {
        if (File.Exists(Path.Combine(profile.DataRoot, ".openfy-library.lock"))) throw new IOException("El servidor no confirmó el cierre de la biblioteca.");
        string node = Path.Combine(Destination, "runtime", "node.exe");
        foreach (var process in Process.GetProcessesByName("node")) using (process) {
            try { if (string.Equals(process.MainModule?.FileName, node, StringComparison.OrdinalIgnoreCase) && !process.WaitForExit(5000)) throw new IOException("Node sigue usando la instalación."); }
            catch (InvalidOperationException) when (process.HasExited) { }
            catch (System.ComponentModel.Win32Exception) { /* Other users' processes are inaccessible. The library lock remains authoritative. */ }
        }
    }

    private static void CopyState(string source, string target) {
        if (!Directory.Exists(source)) return;
        Directory.CreateDirectory(target);
        foreach (var file in Directory.EnumerateFiles(source, "*.json")) File.Copy(file, Path.Combine(target, Path.GetFileName(file)), true);
        string logs = Path.Combine(source, "session-logs");
        if (Directory.Exists(logs)) {
            var saved = Directory.CreateDirectory(Path.Combine(target, "session-logs"));
            foreach (var file in Directory.EnumerateFiles(logs)) File.Copy(file, Path.Combine(saved.FullName, Path.GetFileName(file)), true);
        }
    }

    private static void InspectLibrary(Transaction tx, string appRoot, string mode) {
        var backend = Path.Combine(appRoot, "backend");
        var info = StartInfo(Path.Combine(appRoot, "runtime", "node.exe"), Path.Combine(backend, "scripts", "update-library.mjs"), mode, tx.Profile.DataRoot, tx.Backup, backend);
        info.RedirectStandardError = true;
        using var node = Process.Start(info) ?? throw new IOException("No se pudo verificar SQLite.");
        var errors = node.StandardError.ReadToEndAsync();
        if (!node.WaitForExit(120000)) { node.Kill(); node.WaitForExit(); throw new IOException("SQLite no terminó la verificación."); }
        if (node.ExitCode != 0) throw new IOException("Falló la comprobación de la biblioteca. " + errors.GetAwaiter().GetResult());
    }

    private static void RecordFailure(Transaction tx, string message) {
        Directory.CreateDirectory(tx.Backup);
        var failure = new { tx.Id, tx.Release, error = message, at = DateTimeOffset.UtcNow };
        Durable(Path.Combine(tx.Backup, "failure.json"), failure);
        Durable(Path.Combine(Control, "failed", tx.Release.Version + "+" + tx.Release.Build + ".json"), failure);
    }

    private static void Extract(Transaction tx) {
        if (Isolated && Environment.GetEnvironmentVariable("OPENFY_QA_UPDATE_FAULT") == "space") throw new IOException("Espacio insuficiente simulado.");
        using var stream = Assembly.GetExecutingAssembly().GetManifestResourceStream("Openfy.Payload.zip") ?? throw new IOException("Falta el contenido del instalador.");
        using var zip = new ZipArchive(stream);
        long databaseBytes = tx.ExistingLibrary ? new FileInfo(Path.Combine(tx.Profile.DataRoot, "openfy.sqlite")).Length : 0;
        if (new DriveInfo(Path.GetPathRoot(Programs)!).AvailableFreeSpace < zip.Entries.Sum(entry => entry.Length) + new FileInfo(Environment.ProcessPath!).Length + databaseBytes * 2 + 64L * 1024 * 1024)
            throw new IOException("No hay espacio para el paquete y el respaldo.");
        Directory.CreateDirectory(tx.Stage);
        zip.ExtractToDirectory(tx.Stage);
        foreach (string file in new[] { "Openfy.exe", "Openfy.pri", "runtime/node.exe", "backend/scripts/update-library.mjs", "backend/.output/server/index.mjs" })
            if (!File.Exists(Path.Combine(tx.Stage, file))) throw new IOException("Falta " + file);
        File.WriteAllText(Path.Combine(tx.Stage, ".openfy-installation"), Identity);
    }

    private static void InstallTransaction(string[] args)
    {
        Directory.CreateDirectory(Programs);
        if (Directory.Exists(Destination) && !Owned()) throw new IOException("La carpeta de destino no pertenece a Openfy.");
        var release = ReleaseInfo.Current;
        if (File.Exists(Path.Combine(Destination, "release.json")) && release.CompareTo(Read<ReleaseInfo>(Path.Combine(Destination, "release.json"))) <= 0)
            throw new IOException("Esta compilación ya está instalada o es anterior.");
        int arg = Array.IndexOf(args, "--update-request");
        UpdateRequest? request = null;
        var profile = ReadProfile();
        Guid id = Guid.NewGuid();
        if (arg >= 0) {
            var path = Path.GetFullPath(args[arg + 1]); request = Read<UpdateRequest>(path);
            id = Guid.ParseExact(request.Transaction, "D");
            if (!string.Equals(path, Path.Combine(Control, "requests", id + ".json"), StringComparison.OrdinalIgnoreCase)) throw new IOException("Solicitud no reconocida.");
            var manifest = UpdateManifest.Parse(JsonSerializer.Serialize(request.Manifest, Contracts.Json));
            if (manifest.Release != release) throw new IOException("El paquete difiere del solicitado.");
            manifest.VerifyAsync(Environment.ProcessPath!).GetAwaiter().GetResult();
            profile = new(request.DataRoot, request.StateRoot, request.Port);
        }
        ValidateProfile(profile);
        var existing = File.Exists(Path.Combine(profile.DataRoot, "openfy.sqlite"));
        if (!existing && (Owned() || request != null || File.Exists(Config))) throw new IOException("No se encontró la biblioteca configurada. Comprueba su ruta.");
        if (request == null && Owned()) BootstrapReady(profile);
        var tx = new Transaction(id, profile, release, Owned(), existing, "preparing");
        Directory.CreateDirectory(tx.Backup);
        bool stopped = false;
        try {
            Extract(tx);
            if (request != null) {
                using (var owner = Process.GetProcessById(request.ParentPid)) {
                    if (!string.Equals(owner.MainModule?.FileName, Path.Combine(Destination, "Openfy.exe"), StringComparison.OrdinalIgnoreCase))
                        throw new IOException("No se reconoce el proceso que solicita la actualización.");
                }
                var readyFile = Path.Combine(Control, "requests", id + ".ready");
                Durable(readyFile, new { ready = true });
                try { using var parent = Process.GetProcessById(request.ParentPid); if (!parent.WaitForExit(30000)) throw new IOException("Openfy sigue en uso."); }
                catch (ArgumentException) { /* Already closed. */ }
                stopped = true;
                var receipt = Read<JsonElement>(Path.Combine(profile.StateRoot, "update-receipts", id + ".json"));
                if (!receipt.GetProperty("closed").GetBoolean() || receipt.GetProperty("transaction").GetString() != request.Transaction) throw new IOException("El cierre de SQLite no se confirmó.");
            }
            stopped = tx.ExistingInstall;
            CheckClosed(profile);
            if (existing) {
                InspectLibrary(tx, tx.Stage, "snapshot");
                int schema = Read<JsonElement>(Path.Combine(tx.Backup, "collection.json")).GetProperty("schema").GetInt32();
                if (schema < (request?.Manifest.MinLibrarySchema ?? 1) || schema > (request?.Manifest.MaxLibrarySchema ?? 6)) throw new IOException("La versión de la biblioteca no es compatible.");
            }
            CopyState(profile.StateRoot, Path.Combine(tx.Backup, "desktop"));
            if (File.Exists(Config)) File.Copy(Config, Path.Combine(tx.Backup, "configuration.env"));
            Durable(Path.Combine(tx.Stage, "release.json"), release);
            // The launcher must already be recoverable before the first directory rename.
            Directory.CreateDirectory(Path.GetDirectoryName(Maintenance)!);
            if (!string.Equals(Environment.ProcessPath, Maintenance, StringComparison.OrdinalIgnoreCase)) {
                File.Copy(Environment.ProcessPath!, Maintenance + ".new", true);
                File.Move(Maintenance + ".new", Maintenance, true);
            }
            Register(args.Contains("--desktop-icon"));
            Durable(Journal, tx = tx with { Phase = "replacing" });
            if (tx.ExistingInstall) Directory.Move(Destination, tx.Previous);
            Directory.Move(tx.Stage, Destination);
            Durable(Journal, tx = tx with { Phase = "validating" });
            if (Isolated && Environment.GetEnvironmentVariable("OPENFY_QA_UPDATE_FAULT") == "first-start") throw new IOException("Primer arranque fallido simulado.");
            if (Isolated && Environment.GetEnvironmentVariable("OPENFY_QA_UPDATE_FAULT") == "interrupted") Environment.Exit(79);
            CheckStartup(tx);
            if (Isolated && Environment.GetEnvironmentVariable("OPENFY_QA_UPDATE_FAULT") == "validation") throw new IOException("Fallo de validación simulado.");
            if (existing) InspectLibrary(tx, Destination, "verify");
            Durable(Path.Combine(Control, "profile.json"), profile);
            Durable(Journal, tx with { Phase = "committed" });
            Finish(tx);
        } catch (Exception failure) {
            RecordFailure(tx, failure.Message);
            if (File.Exists(Journal)) Recover();
            if (stopped && Owned() && !Isolated) Launch(profile);
            throw;
        } finally { DeleteOwnedTemporary(tx.Stage); }
        if (request != null || (!Isolated && stopped) || args.Contains("--reopen")) Launch(profile);
    }

    private static void CheckStartup(Transaction tx) {
        var report = Path.Combine(tx.Backup, "startup.json");
        var checkState = Path.Combine(tx.Backup, "startup-state");
        // Fresh installations validate against a disposable empty library.
        var data = tx.ExistingLibrary ? tx.Profile.DataRoot : Path.Combine(tx.Backup, "startup-data");
        var info = StartInfo(Path.Combine(Destination, "Openfy.exe"), "--state-dir", checkState, "--data-dir", data, "--port", tx.Profile.Port.ToString(), "--startup-check", report);
        if (tx.ExistingLibrary) info.ArgumentList.Add("--verify-update");
        using var check = Process.Start(info) ?? throw new IOException("No se pudo comprobar el primer arranque.");
        if (!check.WaitForExit(55000)) {
            using var close = Process.Start(StartInfo(info.FileName, "--state-dir", checkState, "--shutdown"));
            if (!check.WaitForExit(10000)) { check.Kill(entireProcessTree: true); check.WaitForExit(); }
            throw new IOException("La nueva versión no completó el primer arranque.");
        }
        if (check.ExitCode != 0 || !File.Exists(report) || !Read<JsonElement>(report).GetProperty("passed").GetBoolean()) throw new IOException("La nueva versión no abrió la biblioteca.");
        CheckClosed(tx.Profile);
    }

    private static void Recover() {
        if (!File.Exists(Journal)) return;
        var tx = Read<Transaction>(Journal); ValidateProfile(tx.Profile);
        if (tx.Phase == "committed") { Finish(tx); return; }
        if (tx.Phase is not ("replacing" or "validating")) throw new IOException("Transacción desconocida.");
        if (tx.Phase == "validating") {
            StopApplication(Path.Combine(tx.Backup, "startup-state"));
            CheckClosed(tx.Profile);
            if (tx.ExistingLibrary) {
                string db = Path.Combine(tx.Profile.DataRoot, "openfy.sqlite");
                if (!File.Exists(Path.Combine(tx.Backup, "openfy.sqlite"))) throw new IOException("El respaldo no está disponible.");
                File.Copy(Path.Combine(tx.Backup, "openfy.sqlite"), db + ".restoring", true);
                File.Delete(db + "-wal"); File.Delete(db + "-shm"); File.Move(db + ".restoring", db, true);
            }
            CopyState(Path.Combine(tx.Backup, "desktop"), tx.Profile.StateRoot);
            if (File.Exists(Path.Combine(tx.Backup, "configuration.env"))) File.Copy(Path.Combine(tx.Backup, "configuration.env"), Config, true);
            Durable(Journal, tx = tx with { Phase = "replacing" });
        }
        if (Directory.Exists(tx.Previous) || !tx.ExistingInstall) {
            if (Directory.Exists(Destination)) {
                if (!Owned()) throw new IOException("No se reconoce la versión instalada.");
                Directory.Move(Destination, Path.Combine(Programs, "Openfy.rejected-" + tx.Id));
            }
            if (tx.ExistingInstall) Directory.Move(tx.Previous, Destination);
        }
        if (tx.ExistingInstall && !Owned()) throw new IOException("No se pudo recuperar la versión anterior.");
        if (!File.Exists(Path.Combine(tx.Backup, "failure.json"))) RecordFailure(tx, "Actualización interrumpida y revertida.");
        DeleteOwnedTemporary(tx.Stage);
        File.Delete(Journal);
    }

    private static void Finish(Transaction tx) {
        Durable(Path.Combine(tx.Backup, "success.json"), new { tx.Release, completed = DateTimeOffset.UtcNow });
        DeleteOwnedTemporary(tx.Previous);
        File.Delete(Journal);
        var completed = Directory.EnumerateDirectories(Backups).Where(path => Guid.TryParseExact(Path.GetFileName(path), "D", out _) && File.Exists(Path.Combine(path, "success.json")))
            .OrderByDescending(path => File.GetLastWriteTimeUtc(Path.Combine(path, "success.json"))).Skip(3);
        foreach (string path in completed) Directory.Delete(path, true);
    }
}
