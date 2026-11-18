using Microsoft.UI.Xaml;
using Openfy.Windows.Services;
using Openfy.Windows.ViewModels;
using Openfy.Windows.Views;
using Openfy.Core;

namespace Openfy.Windows;

public partial class App : Application
{
    private Mutex? instance;
    private MainWindow? main;
    private StartupWindow? splash;
    private readonly StartupCoordinator startup = new();
    private bool launching;
    private readonly CancellationTokenSource applicationLifetime = new();
    private MainViewModel? model;
    private TrayIcon? tray;
    private MediaControls? media;
    private PlayerWindow? mini, widget, fullscreen;
    private Microsoft.UI.Dispatching.DispatcherQueueTimer? timer;
    private bool exiting;
    private EventWaitHandle? quitEvent;
    private RegisteredWaitHandle? quitRegistration;
    private EventWaitHandle? activationEvent;
    private RegisteredWaitHandle? activationRegistration;
    public App()
    {
        UnhandledException += (_, args) => LogNativeError(args.Exception);
        try { InitializeComponent(); RequestedTheme = ApplicationTheme.Dark; }
        catch (Exception error) { LogNativeError(error); throw; }
    }
    private static void LogNativeError(Exception error)
    {
        SessionLog.Write("native.unhandled", "failed", error: error);
        try {
            var directory = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "Openfy", "logs"); Directory.CreateDirectory(directory);
            File.AppendAllText(Path.Combine(directory, "native-error.log"), DateTimeOffset.Now + " " + error + Environment.NewLine);
        } catch { /* Preserve the original failure if logging is unavailable. */ }
    }
    protected override async void OnLaunched(LaunchActivatedEventArgs args)
    {
        string profile = Convert.ToHexString(System.Security.Cryptography.SHA256.HashData(System.Text.Encoding.UTF8.GetBytes(MainViewModel.StateDirectory())))[..12];
        string quitName = "Local\\Openfy.Native.Quit." + Environment.UserName + profile;
        if (Environment.GetCommandLineArgs().Contains("--shutdown"))
        { try { using var previous = EventWaitHandle.OpenExisting(quitName); previous.Set(); } catch (WaitHandleCannotBeOpenedException) { } Exit(); return; }
        activationEvent = new EventWaitHandle(false, EventResetMode.AutoReset, "Local\\Openfy.Native.Activate." + Environment.UserName + profile);
        instance = new Mutex(true, "Local\\Openfy.Native." + Environment.UserName + profile, out bool created);
        if (!created) { activationEvent.Set(); activationEvent.Dispose(); Exit(); return; }
        SessionLog.Begin(Path.Combine(MainViewModel.StateDirectory(), "session-logs"));
        var dispatch = Microsoft.UI.Dispatching.DispatcherQueue.GetForCurrentThread();
        activationRegistration = ThreadPool.RegisterWaitForSingleObject(activationEvent, (sender, timedOut) => dispatch.TryEnqueue(() => {
            if (exiting) return;
            if (splash != null) { splash.AppWindow.Show(); splash.Activate(); }
            else if (main != null) { main.AppWindow.Show(); main.Activate(); }
        }), null, Timeout.Infinite, false);
        quitEvent = new EventWaitHandle(false, EventResetMode.AutoReset, quitName);
        quitRegistration = ThreadPool.RegisterWaitForSingleObject(quitEvent, (sender, timedOut) => dispatch.TryEnqueue(() => _ = ShutdownAsync()), null, Timeout.Infinite, false);
        splash = new(() => _ = LaunchMainAsync(), () => _ = ShutdownAsync());
        startup.Changed += () => { if (startup.Phase == StartupPhase.Error) splash?.Fail(startup.Error); };
        splash.Activate();
        await LaunchMainAsync();
    }
    private async Task LaunchMainAsync()
    {
        if (launching || exiting || startup.Phase == StartupPhase.Ready) return;
        launching = true;
        try {
        var dispatch = Microsoft.UI.Dispatching.DispatcherQueue.GetForCurrentThread();
        model ??= new(action => dispatch.TryEnqueue(() => action()));
        splash?.Loading(false);
        bool verifying = Environment.GetCommandLineArgs().Contains("--verify-update");
        await startup.StartAsync(async cancellation => {
            await model.PrepareStartupSettingsAsync(cancellation);
            splash?.SetMotion(model.Settings.Effects);
            if (verifying) { await model.Host.StartAsync(cancellation); await model.RefreshAsync().WaitAsync(cancellation); }
            else await model.InitializeAsync(cancellation);
        }, cancellation => verifying || Environment.GetCommandLineArgs().Any(arg => arg is "--navigation-check" or "--sections-check") ? Task.CompletedTask : model.PrepareStartupContentAsync(applicationLifetime.Token));
        if (exiting || startup.Phase != StartupPhase.Revealing) return;
        model.Settings.Windows.TryGetValue("main", out var placement);
        main = new(model, OpenPlayer) { Title = "Openfy · Preparando" };
        await main.RevealStartupAsync(placement, () => { splash?.Finish(); splash = null; }, applicationLifetime.Token);
        startup.Complete();
        tray = new(main, command => { if (command == 1) { main.AppWindow.Show(); main.Activate(); } else if (command == 2) OpenPlayer("mini"); else if (command == 3) OpenPlayer("widget"); else if (command == 4) _ = ShutdownAsync(); });
        media = new(main, model);
        model.InitializeDiscord(CheckRun);
        timer = dispatch.CreateTimer(); timer.Interval = TimeSpan.FromMilliseconds(100); timer.Tick += (_, _) => {
            model.Tick();
            model.Engine.Analyzer.Enabled = model.Playing && model.Settings.Effects && WindowsIntegration.AnimationsEnabled && (mini?.Visible == true || widget?.Visible == true || fullscreen?.Visible == true);
            bool compact = mini?.Visible == true || widget?.Visible == true;
            if (compact != model.CompactLyricsVisible) { model.CompactLyricsVisible = compact; if (model.WantsLyrics && model.Lyrics == null) _ = model.RunAsync(() => model.LoadLyricsAsync()); }
            // The ordinary transport displays seconds. Only visible synchronized lyrics need a faster UI
            // clock (line changes); Direct3D and the per-word fill read the audible clock every frame.
            timer.Interval = TimeSpan.FromMilliseconds(model.Playing && model.WantsLyrics ? 50 : 1000);
        }; timer.Start();
        model.RenderDiagnostics = () => new[] { mini?.Diagnostics, widget?.Diagnostics, fullscreen?.Diagnostics }.OfType<string>().ToArray();
        await model.RunAsync(async () => {
            if (Environment.GetCommandLineArgs().Contains("--verify-update")) {
                var verifyArgs = Environment.GetCommandLineArgs();
                var report = verifyArgs[Array.IndexOf(verifyArgs, "--startup-check") + 1];
                try {
                    await Task.Delay(300);
                    bool visible = main.Content is FrameworkElement element && element.ActualWidth > 0 && element.ActualHeight > 0;
                    await File.WriteAllTextAsync(report, System.Text.Json.JsonSerializer.Serialize(new { passed = visible && model.Host.Connected }));
                } finally { await model.Host.DisposeAsync(); Exit(); }
                return;
            }
            var arguments = Environment.GetCommandLineArgs();
            if (arguments.Contains("--sections-check")) {
                try {
                    if (!arguments.Contains("--state-dir") || !arguments.Contains("--data-dir")) throw new IOException("La prueba de secciones requiere directorios separados.");
                    await model.Store.WriteAsync("sections-performance", await main.CheckSectionsPerformanceAsync());
                } catch (Exception error) { await model.Store.WriteAsync("sections-performance", new { passed = false, error = error.ToString() }); }
                finally { await ShutdownAsync(); }
                return;
            }
            int discordTest = Array.FindIndex(arguments, arg => arg is "--discord-test" or "--discord-live-test");
            if (discordTest >= 0 && discordTest + 1 < arguments.Length) { await DiscordSmokeAsync(arguments[discordTest + 1], arguments[discordTest] == "--discord-live-test"); return; }
            if (arguments.Contains("--navigation-check")) {
                try {
                    if (!arguments.Contains("--state-dir") || !arguments.Contains("--data-dir")) throw new IOException("La prueba de navegación requiere directorios separados.");
                    await model.Store.WriteAsync("navigation-performance", await main.CheckNavigationPerformanceAsync());
                } catch (Exception error) { await model.Store.WriteAsync("navigation-performance", new { passed = false, error = error.ToString() }); }
                finally { await ShutdownAsync(); }
                return;
            }
            if (arguments.Contains("--downloads-check")) {
                try {
                    if (!arguments.Contains("--state-dir") || !arguments.Contains("--data-dir")) throw new IOException("La prueba de rendimiento requiere directorios de prueba separados.");
                    await model.Store.WriteAsync("downloads-performance", await main.CheckDownloadsPerformanceAsync());
                } catch (Exception error) { await model.Store.WriteAsync("downloads-performance", new { passed = false, error = error.ToString() }); }
                finally { await ShutdownAsync(); }
                return;
            }
            int startupCheck = Array.IndexOf(arguments, "--startup-check");
            if (startupCheck >= 0 && startupCheck + 1 < arguments.Length)
            {
                await Task.Delay(300);
                bool visible = main.StartupRevealed && startup.Phase == StartupPhase.Ready && main.Content is FrameworkElement content && content.ActualWidth > 0 && content.ActualHeight > 0;
                await File.WriteAllTextAsync(arguments[startupCheck + 1], System.Text.Json.JsonSerializer.Serialize(new { passed = visible && model.Host.Connected, windowCreated = visible, startup = startup.Phase.ToString(), splashClosed = splash == null, backend = model.Host.Connected, installedDirectory = AppContext.BaseDirectory }, Contracts.Json));
                await ShutdownAsync(); return;
            }
            if (!arguments.Contains("--benchmark-mode")) { if (model.Settings.MiniVisible) OpenPlayer("mini"); if (model.Settings.WidgetVisible) OpenPlayer("widget"); }
            int smoke = Array.IndexOf(arguments, "--smoke-test");
            if (smoke >= 0 && smoke + 1 < arguments.Length) await SmokeAsync(arguments[smoke + 1]);
            int listeningTest = Array.IndexOf(arguments, "--listening-test");
            if (listeningTest >= 0 && listeningTest + 1 < arguments.Length) { await ListeningSmokeAsync(arguments[listeningTest + 1]); return; }
            int benchmark = Array.IndexOf(arguments, "--benchmark-mode");
            if (benchmark >= 0 && benchmark + 1 < arguments.Length) await BenchmarkAsync(arguments[benchmark + 1]);
            int youtube = Array.IndexOf(arguments, "--youtube-test");
            if (youtube >= 0 && youtube + 1 < arguments.Length) await RemoteSmokeAsync(arguments[youtube + 1]);
            int offline = Array.IndexOf(arguments, "--offline-test");
            if (offline >= 0 && offline + 1 < arguments.Length) { await OfflineSmokeAsync(arguments[offline + 1]); return; }
            int players = Array.IndexOf(arguments, "--visual-players");
            if (players >= 0 && players + 1 < arguments.Length) { try { await PlayerVisualAsync(arguments[players + 1]); } finally { await ShutdownAsync(); } return; }
            int visual = Array.IndexOf(arguments, "--visual-check");
            if (visual >= 0 && visual + 1 < arguments.Length)
            {
                try { await main.VisualCheckAsync(arguments[visual + 1]); }
                finally { await ShutdownAsync(); }
            }
        });
        if (!exiting && !CheckRun) _ = model.RunAsync(main.ShowPendingReleaseNotesAsync);
        if (!exiting && !Environment.GetCommandLineArgs().Any(arg => arg is "--workspace" || CheckModes.Contains(arg)) && File.Exists(Path.Combine(AppContext.BaseDirectory, ".openfy-installation"))) {
            model.Updates = new(model, ShutdownAsync);
            main.AttachUpdates(model.Updates);
            await model.Updates.StartAsync();
        }
        } catch (OperationCanceledException) when (exiting) { }
        catch (Exception error) {
            SessionLog.Write("startup.window", "failed", error: error);
            if (!exiting && startup.Phase != StartupPhase.Ready) {
                if (main != null) { main.Exiting = true; main.Close(); main = null; }
                if (splash == null) { splash = new(() => _ = LaunchMainAsync(), () => _ = ShutdownAsync()); splash.Activate(); }
                splash.Fail(error);
            }
        }
        finally { launching = false; }
    }
    /// <summary>Self-exiting checks and benchmarks: no update driver and no "Novedades" dialog in front of them.</summary>
    private static readonly string[] CheckModes = ["--startup-check", "--verify-update", "--smoke-test", "--benchmark-mode", "--visual-check", "--visual-players", "--listening-test", "--youtube-test", "--offline-test", "--navigation-check", "--downloads-check", "--sections-check", "--discord-test", "--discord-live-test"];
    internal static bool CheckRun => Environment.GetCommandLineArgs().Any(CheckModes.Contains);
    private void OpenPlayer(string kind)
    {
        if (model == null || main == null) return;
        var existing = kind == "mini" ? mini : kind == "widget" ? widget : fullscreen;
        if (existing != null) {
            if (kind == "mini") model.Settings.MiniVisible = true; else if (kind == "widget") model.Settings.WidgetVisible = true;
            existing.ShowView(kind == "fullscreen" ? WindowsIntegration.Placement(main) : null);
            if (kind == "fullscreen") main.AppWindow.Hide();
            return;
        }
        model.Settings.Windows.TryGetValue(kind, out var placement);
        if (kind == "fullscreen") placement = WindowsIntegration.Placement(main);
        var created = new PlayerWindow(model, kind, placement, () => {
            if (kind == "mini") model.Settings.MiniVisible = false;
            else if (kind == "widget") model.Settings.WidgetVisible = false;
            else if (!exiting) { model.LyricsVisible = main.LyricsOpen; main.AppWindow.Show(); main.Activate(); }
        });
        if (kind == "mini") { mini = created; model.Settings.MiniVisible = true; }
        else if (kind == "widget") { widget = created; model.Settings.WidgetVisible = true; }
        else { fullscreen = created; main.AppWindow.Hide(); }
        created.Activate();
    }
    private async Task ShutdownAsync()
    {
        if (exiting) return; exiting = true; applicationLifetime.Cancel(); startup.Cancel(); timer?.Stop(); model?.Updates?.Dispose();
        splash?.Finish(); splash = null;
        if (model != null) await model.DisposeAsync();
        tray?.Dispose(); mini?.Destroy(); widget?.Destroy(); fullscreen?.Destroy();
        if (main != null) { main.Exiting = true; main.Close(); }
        activationRegistration?.Unregister(null); activationEvent?.Dispose();
        quitRegistration?.Unregister(null); quitEvent?.Dispose(); startup.Dispose(); instance?.ReleaseMutex(); instance?.Dispose(); Exit();
    }
    /// <summary>Opt-in QA for fullscreen (cover, split, stacked), mini and widget, background included.</summary>
    private async Task PlayerVisualAsync(string directory)
    {
        directory = Path.GetFullPath(directory); Directory.CreateDirectory(directory);
        var arguments = Environment.GetCommandLineArgs();
        var steps = new Dictionary<string, object>();
        void Require(bool condition, string message) { if (!condition) throw new InvalidOperationException(message); }
        try
        {
            int fixtures = Array.IndexOf(arguments, "--visual-fixtures");
            Require(fixtures >= 0 && fixtures + 1 < arguments.Length, "Falta --visual-fixtures con canciones de prueba.");
            string[] files = Directory.GetFiles(Path.GetFullPath(arguments[fixtures + 1])).Where(file => file.EndsWith(".mp3") || file.EndsWith(".m4a")).OrderBy(file => file).ToArray();
            await model!.Host.CallAsync<System.Text.Json.JsonElement>("importPaths", new { paths = files });
            for (int i = 0; i < 150; i++) { await model.RefreshAsync(); if (model.Library.Tracks.Count >= files.Length) break; await Task.Delay(100); }
            Require(model.Library.Tracks.Count >= files.Length && files.Length > 0, "No se importaron las canciones de prueba.");
            model.Settings.Effects = true; model.Settings.Force24 = false; model.Settings.CompactLyrics = true; model.Volume = 0;
            if (arguments.Contains("--motion-check")) {
                OpenPlayer("fullscreen");
                steps["motionArt"] = await fullscreen!.VerifyMotionAsync(directory);
                await File.WriteAllTextAsync(Path.Combine(directory, "visual-players.json"), System.Text.Json.JsonSerializer.Serialize(new { passed = true, steps }, Contracts.Json));
                return;
            }
            if (arguments.Contains("--big-picture-check")) {
                OpenPlayer("fullscreen");
                steps["bigPicture"] = await fullscreen!.VerifyBigPictureAsync(directory);
                await File.WriteAllTextAsync(Path.Combine(directory, "visual-players.json"), System.Text.Json.JsonSerializer.Serialize(new { passed = true, steps }, Contracts.Json));
                return;
            }
            int seekAt = Array.IndexOf(arguments, "--visual-seek");
            double seconds = seekAt >= 0 && seekAt + 1 < arguments.Length ? double.Parse(arguments[seekAt + 1], System.Globalization.CultureInfo.InvariantCulture) : 1.2;
            foreach (var track in model.Library.Tracks.OrderBy(track => track.Title))
            {
                string name = string.Concat(track.Title.Where(char.IsLetterOrDigit)).ToLowerInvariant();
                await model.PlayAsync(model.Describe(new("local", track.Id)));
                await model.SeekAsync(seconds); await Task.Delay(1500); model.Tick();
                OpenPlayer("fullscreen"); await Task.Delay(1200); model.Tick();
                for (int wait = 0; wait < 100 && model.LyricsPending; wait++) await Task.Delay(100);
                await Task.Delay(Openfy.Core.Immersive.LayoutMilliseconds + 200); fullscreen!.SeekLyricsForCheck();
                // Big Picture keeps the lyrics column only for synced lyrics; otherwise the song stays alone in the centre.
                bool synced = model.Lyrics is { Status: "synced" };
                Require(fullscreen.Layout == (synced ? Openfy.Core.Immersive.Split : Openfy.Core.Immersive.Cover), synced ? "La pantalla completa ancha no usó el diseño dividido." : "Una canción sin letra sincronizada no usó la portada centrada.");
                steps[name + (synced ? "-split" : "-cover")] = await fullscreen.CaptureAsync(Path.Combine(directory, name + (synced ? "-fullscreen-lyrics.png" : "-fullscreen-cover.png")));
                // A portrait window reaches the stacked layout that a 16:9 monitor never shows in fullscreen.
                fullscreen.AppWindow.SetPresenter(Microsoft.UI.Windowing.AppWindowPresenterKind.Overlapped); fullscreen.AppWindow.Resize(new(720, 980)); await Task.Delay(800);
                steps[name + (synced ? "-stacked" : "-cover-narrow")] = await fullscreen.CaptureAsync(Path.Combine(directory, name + (synced ? "-fullscreen-stacked.png" : "-fullscreen-cover-narrow.png")));
                Require(fullscreen.Layout == (synced ? Openfy.Core.Immersive.Stacked : Openfy.Core.Immersive.Cover), synced ? "La ventana estrecha no usó el diseño apilado." : "La ventana estrecha mostró letras sin sincronizar.");
                fullscreen.Close(); OpenPlayer("mini"); OpenPlayer("widget"); await Task.Delay(800); model.Tick();
                steps[name + "-mini"] = await mini!.CaptureAsync(Path.Combine(directory, name + "-mini.png"));
                steps[name + "-widget"] = await widget!.CaptureAsync(Path.Combine(directory, name + "-widget.png"));
                mini.Close(); widget.Close();
            }
            await File.WriteAllTextAsync(Path.Combine(directory, "visual-players.json"), System.Text.Json.JsonSerializer.Serialize(new { passed = true, steps }, Contracts.Json));
        }
        catch (Exception error) { await File.WriteAllTextAsync(Path.Combine(directory, "visual-players.json"), System.Text.Json.JsonSerializer.Serialize(new { passed = false, error = error.ToString(), steps }, Contracts.Json)); }
    }
    private async Task SmokeAsync(string fixture)
    {
        string report = Path.Combine(model!.Store.Root, "native-smoke.json");
        var steps = new Dictionary<string, object>();
        try
        {
            void Require(bool condition, string message) { if (!condition) throw new InvalidOperationException(message); }
            await AppearanceSmokeAsync(steps);
            model.Settings.Force24 = false; model.Settings.Effects = true;
            await model.Host.CallAsync<System.Text.Json.JsonElement>("importPaths", new { paths = new[] { Path.GetFullPath(fixture) } });
            for (int i = 0; i < 100; i++) { await model.RefreshAsync(); if (model.Library.Tracks.Count > 0) break; await Task.Delay(100); }
            Require(model.Library.Tracks.Count > 0, "La importación del puente local no produjo una canción."); steps["import"] = true;
            model.Volume = 0;
            await model.PlayAsync(model.Describe(new("local", model.Library.Tracks[0].Id)));
            await Task.Delay(700); model.Tick(); Require(model.Position > .1, "El audio nativo no avanzó."); steps["wasapi"] = model.Position;
            int previousNode = model.Host.ProcessId!.Value;
            double beforeRecovery = model.Engine.Position;
            using (var ownedNode = System.Diagnostics.Process.GetProcessById(previousNode)) ownedNode.Kill();
            for (int i = 0; i < 150; i++) { await Task.Delay(100); if (model.Host.Connected && model.Host.ProcessId != previousNode) break; }
            Require(model.Host.Connected && model.Host.ProcessId != previousNode, "Node no se recuperó tras una caída.");
            Require(model.Playing && model.Engine.Position > beforeRecovery, "La caída de Node interrumpió el archivo local abierto.");
            steps["nodeRecovery"] = true;
            model.Engine.Pause(); await model.SeekAsync(1); Require(!model.Playing, "Seek pausado inició la reproducción."); steps["pausedSeek"] = model.Position;
            await model.LoadLyricsAsync(); steps["lyrics"] = model.Lyrics?.Status ?? "not_found";
            await model.ToggleAsync(); OpenPlayer("mini"); OpenPlayer("widget"); OpenPlayer("fullscreen");
            var monitors = WindowsIntegration.Displays();
            if (monitors.Count > 1) widget!.AppWindow.Move(new(monitors[1].Work.Left + 30, monitors[1].Work.Top + 30));
            steps["monitors"] = monitors.Select(display => new { display.Name, display.Hz }).ToArray();
            await Task.Delay(2500);
            steps["normalRendering"] = model.RenderDiagnostics();
            Require(mini!.ActualFps > 0 && widget!.ActualFps > 0 && fullscreen!.ActualFps > 0, "Una vista no produjo frames Direct3D.");
            steps["windowInteraction"] = new[] { await mini!.VerifyCaptionAsync(), await widget!.VerifyCaptionAsync() };
            model.Settings.Force24 = true; await Task.Delay(2200);
            Require(mini!.TargetFps <= 24 && widget!.TargetFps <= 24 && fullscreen!.TargetFps <= 24, "El límite global de 24 FPS no se aplicó."); steps["limitedRendering"] = model.RenderDiagnostics();
            model.Engine.Pause(); await Task.Delay(1200); Require(mini!.TargetFps == 0 && widget!.TargetFps == 0 && fullscreen!.TargetFps == 0, "Las vistas pausadas siguen renderizando."); steps["pausedRendering"] = true;
            void CloseViews() { mini?.Close(); widget?.Close(); fullscreen?.Close(); }
            var observedWindows = new List<WeakReference<PlayerWindow>>();
            async Task Cycle() { CloseViews(); OpenPlayer("mini"); OpenPlayer("widget"); OpenPlayer("fullscreen"); observedWindows.Add(new(mini!)); observedWindows.Add(new(widget!)); observedWindows.Add(new(fullscreen!)); await Task.Delay(300); CloseViews(); await Task.Delay(100); }
            for (int i = 0; i < 3; i++) await Cycle();
            GC.Collect(); GC.WaitForPendingFinalizers(); GC.Collect(); await Task.Delay(300);
            using var currentProcess = System.Diagnostics.Process.GetCurrentProcess(); currentProcess.Refresh();
            long beforeBytes = currentProcess.PrivateMemorySize64; int beforeHandles = currentProcess.HandleCount, beforeThreads = currentProcess.Threads.Count;
            for (int i = 0; i < 5; i++) await Cycle();
            GC.Collect(); GC.WaitForPendingFinalizers(); GC.Collect(); await Task.Delay(500); currentProcess.Refresh();
            int firstGrowth = currentProcess.HandleCount - beforeHandles;
            beforeBytes = currentProcess.PrivateMemorySize64; beforeHandles = currentProcess.HandleCount; beforeThreads = currentProcess.Threads.Count;
            for (int i = 0; i < 5; i++) await Cycle();
            GC.Collect(); GC.WaitForPendingFinalizers(); GC.Collect(); await Task.Delay(500); currentProcess.Refresh();
            int retained = observedWindows.Select(reference => reference.TryGetTarget(out var window) ? window : null).OfType<PlayerWindow>().Distinct().Count();
            steps["windowCycles"] = new { count = 13, retainedPlayerWindows = retained, firstBatchHandleDelta = firstGrowth, privateDeltaMiB = (currentProcess.PrivateMemorySize64 - beforeBytes) / 1048576d, handleDelta = currentProcess.HandleCount - beforeHandles, threadDelta = currentProcess.Threads.Count - beforeThreads };
            Require(retained == 3, "Las vistas no reutilizan sus tres ventanas.");
            Require(currentProcess.HandleCount - beforeHandles < 8 && currentProcess.Threads.Count - beforeThreads < 8 && currentProcess.PrivateMemorySize64 - beforeBytes < 16 * 1048576, "Los ciclos de ventanas acumulan recursos después del calentamiento.");
            await File.WriteAllTextAsync(report, System.Text.Json.JsonSerializer.Serialize(new { passed = true, steps }, Contracts.Json));
        }
        catch (Exception error) { await File.WriteAllTextAsync(report, System.Text.Json.JsonSerializer.Serialize(new { passed = false, error = error.ToString(), steps }, Contracts.Json)); }
        finally { await ShutdownAsync(); }
    }
    private async Task BenchmarkAsync(string scenario)
    {
        try
        {
            model!.Settings.Force24 = scenario == "limited"; model.Settings.Effects = true;
            model.Volume = 0;
            if (scenario != "idle" && model.Library.Tracks.Count > 0) await model.PlayAsync(model.Describe(new("local", model.Library.Tracks[0].Id)));
            if (scenario is "animated" or "limited") { OpenPlayer("mini"); OpenPlayer("widget"); OpenPlayer("fullscreen"); }
            await model.Store.WriteAsync("benchmark-ready", new { scenario, pid = Environment.ProcessId, node = model.Host.ProcessId, rendering = model.RenderDiagnostics() });
            await Task.Delay(TimeSpan.FromMinutes(2));
        }
        finally { await ShutdownAsync(); }
    }
    private async Task RemoteSmokeAsync(string id)
    {
        var steps = new Dictionary<string, object>();
        try
        {
            model!.Volume = 0;
            var result = await model.Api.GetAsync<SongPage>("api/music/search?q=Lady%20Gaga%20Bad%20Romance");
            var song = result.Songs.FirstOrDefault(song => song.VideoId == id) ?? new YouTubeSong(id, "Comprobación de YouTube", [], null, null, null);
            await model.PlayAsync(model.Describe(new("youtube", Song: song)));
            await Task.Delay(3500); model.Tick();
            if (!model.Playing || model.Position < 1 || model.Duration < 10) throw new IOException("El audio remoto no avanzó. " + model.Error);
            steps["initialPosition"] = model.Position; steps["duration"] = model.Duration;
            double target = model.Duration * .55;
            await model.SeekAsync(target); await Task.Delay(2000); model.Tick();
            if (!model.Playing || model.Position < target + .5) throw new IOException("El audio remoto no continuó tras el salto. " + model.Error);
            steps["seekPosition"] = model.Position;
            model.Engine.Pause(); await model.SeekAsync(5);
            if (model.Playing) throw new IOException("El salto pausado inició audio remoto.");
            await model.Store.WriteAsync("youtube-smoke", new { passed = true, id, steps });
        }
        catch (Exception error) { await model!.Store.WriteAsync("youtube-smoke", new { passed = false, id, steps, error = error.ToString() }); }
        finally { await ShutdownAsync(); }
    }
}
