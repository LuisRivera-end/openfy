using System.Collections.Concurrent;
using System.Text.Json;
using Openfy.Core;
using Openfy.Windows.Services;

namespace Openfy.Windows;

public partial class App
{
    // Fake by default. Real Discord is contacted ONLY with the explicit --discord-live-test flag.
    private async Task DiscordSmokeAsync(string fixture, bool live)
    {
        var steps = new Dictionary<string, object>();
        var probes = new ConcurrentQueue<PresenceProbe>();
        void Require(bool condition, string message) { if (!condition) throw new InvalidOperationException(message); }
        async Task Until(Func<bool> ready, string description)
        {
            var until = DateTime.UtcNow.AddSeconds(live ? 25 : 8);
            while (!ready() && DateTime.UtcNow < until) await Task.Delay(50);
            Require(ready(), description);
        }
        try {
            var args = Environment.GetCommandLineArgs();
            Require(args.Contains("--state-dir") && args.Contains("--data-dir"), "La prueba de Discord requiere estado y biblioteca aislados.");
            await model!.Host.CallAsync<JsonElement>("importPaths", new { paths = new[] { Path.GetFullPath(fixture) } });
            for (int i = 0; i < 100; i++) { await model.RefreshAsync(); if (model.Library.Tracks.Count > 0) break; await Task.Delay(100); }
            Require(model.Library.Tracks.Count > 0, "No se importó la canción de prueba.");
            var track = model.Library.Tracks.First(); var song = model.Describe(new("local", track.Id)); model.Volume = 0;
            await model.RestoreAsync(new(3, [song.Entry], 0, .2, "off", false, 0));
            model.InitializeDiscord(false, () => { var probe = new PresenceProbe(live ? new DiscordRpcTransport() : null); probes.Enqueue(probe); return probe; });
            await Until(() => probes.TryPeek(out var probe) && probe.Status == DiscordPresenceStatus.Connected, "Discord no se conectó.");
            var first = probes.First(); await Task.Delay(350);
            Require(first.Calls.All(value => value == null), "Una cola restaurada publicó actividad antes de reproducir."); steps["restoredQueueHidden"] = true;

            await model.PlayAsync(song);
            await Until(() => first.Activity?.Start != null, "Reproducir no publicó timestamps.");
            if (first.Live != null) {
                await Until(() => first.Live.AcceptedUpdates > 0 && first.Live.AcceptedListening && first.Live.AcceptedActivity?.Start != null, "Discord no confirmó Listening con timestamps.");
                steps["discordAcknowledgedListening"] = true;
            }
            steps["playing"] = first.Activity!;
            model.Engine.Pause();
            await Until(() => first.Activity is { Start: null } activity && activity.State.StartsWith("En pausa"), "Pausa no conservó la canción sin timestamps.");
            if (first.Live != null) await Until(() => first.Live.AcceptedActivity is { Start: null } activity && activity.State.StartsWith("En pausa"), "Discord no confirmó la pausa sin timestamps.");
            steps["paused"] = first.Activity!;
            await model.SeekAsync(.6);
            await Task.Delay(350);
            Require(!model.Playing && first.Activity is { Start: null } pausedSeek && pausedSeek.State.StartsWith("En pausa"), "Seek pausado publicó un reloj activo.");
            steps["pausedSeek"] = true;
            await model.ToggleAsync();
            await Until(() => first.Activity?.Start != null, "Reanudar no restableció el progreso.");
            if (first.Live != null) await Until(() => first.Live.AcceptedActivity?.Start != null && !first.Live.AcceptedActivity.State.StartsWith("En pausa"), "Discord no confirmó los timestamps al reanudar.");
            steps["resumed"] = first.Activity!;
            await model.SeekAsync(Math.Max(0, track.Duration - .3));
            await Until(() => model.Engine.CapturePresence().State == PlaybackPresenceState.Ended && first.Activity == null, "El fin de cola dejó una actividad pausada.");
            steps["queueEndedCleared"] = true;

            await model.PlayAsync(song);
            await model.SetDiscordPresenceAsync(false);
            await Until(() => first.Disposed && first.Activity == null, "Desactivar no limpió la actividad pendiente.");
            steps["disabledCleared"] = true;
            model.Engine.Pause();
            await model.SetDiscordPresenceAsync(true);
            await Until(() => probes.Count == 2 && probes.Last().Activity is { Start: null } activity && activity.State.StartsWith("En pausa"), "Reactivar no recuperó el estado pausado vigente.");
            steps["reenabledCurrentPause"] = true;
            await model.CloseDiscordAsync();
            Require(probes.All(probe => probe.Disposed && probe.Activity == null), "El cierre dejó actividad residual.");
            steps["shutdownCleared"] = true;
            await model.Store.WriteAsync("discord-smoke", new { passed = true, live, steps });
        } catch (Exception error) {
            await model!.CloseDiscordAsync();
            await model.Store.WriteAsync("discord-smoke", new { passed = false, live, error = error.ToString(), steps });
        } finally { await ShutdownAsync(); }
    }
    private sealed class PresenceProbe(DiscordRpcTransport? inner) : IDiscordPresenceTransport
    {
        private DiscordActivity? activity;
        private long updates;
        public DiscordRpcTransport? Live => inner;
        public DiscordActivity? Activity => Volatile.Read(ref activity);
        public long Updates => Interlocked.Read(ref updates);
        public bool Disposed;
        public ConcurrentQueue<DiscordActivity?> Calls { get; } = new();
        public DiscordPresenceStatus Status => inner?.Status ?? DiscordPresenceStatus.Connected;
        public event Action<DiscordTransportError>? Error { add { if (inner != null) inner.Error += value; } remove { if (inner != null) inner.Error -= value; } }
        public void Start() => inner?.Start();
        public void Pump() => inner?.Pump();
        public void SetActivity(DiscordActivity? value) { inner?.SetActivity(value); Volatile.Write(ref activity, value); Calls.Enqueue(value); Interlocked.Increment(ref updates); }
        public void Dispose() { inner?.Dispose(); Disposed = true; }
    }
}
