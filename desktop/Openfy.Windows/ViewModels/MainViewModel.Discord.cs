using Openfy.Core;
using Openfy.Windows.Services;

namespace Openfy.Windows.ViewModels;

public sealed partial class MainViewModel
{
    private DiscordPresenceService? discord;
    private bool presenceReady, presenceStarted, presenceClosing;
    private long lastAudioPresenceSequence, presenceSequence;
    private PlaybackPresenceSnapshot? presenceTrack;
    private AudioPlaybackSnapshot? pendingAudioPresence;
    private string discordStatus = "Desactivado";
    public string DiscordStatus { get => discordStatus; private set { if (discordStatus == value) return; discordStatus = value; Notify(); } }

    public void InitializeDiscord(bool automated, Func<IDiscordPresenceTransport>? factory = null)
    {
        if (automated || discord != null || presenceClosing) return;
        discord = new(factory ?? (() => new DiscordRpcTransport()));
        discord.StatusChanged += status => ui(() => {
            if (presenceClosing) return;
            DiscordStatus = status switch {
                DiscordPresenceStatus.Connected => "Conectado", DiscordPresenceStatus.Waiting => "Esperando Discord",
                DiscordPresenceStatus.Error => "Error de conexión", _ => "Desactivado"
            };
        });
        discord.SetEnabled(Settings.DiscordPresenceEnabled);
        if (presenceTrack != null) PublishDiscord(pendingAudioPresence);
        DiscordStatus = Settings.DiscordPresenceEnabled ? "Esperando Discord" : "Desactivado";
    }
    public async Task SetDiscordPresenceAsync(bool enabled)
    {
        if (Settings.DiscordPresenceEnabled == enabled) return;
        Settings.DiscordPresenceEnabled = enabled;
        discord?.SetEnabled(enabled);
        DiscordStatus = enabled && discord != null ? "Esperando Discord" : "Desactivado";
        await PersistAsync();
    }
    private void BeginDiscordSelection(SongRow row, int generation, bool autoplay)
    {
        Engine.InvalidateSelection(generation);
        presenceReady = false; pendingAudioPresence = null; lastAudioPresenceSequence = 0;
        if (autoplay) presenceStarted = true;
        var original = row.Entry.Source == "youtube" ? FindSaved(row.Entry.Song?.VideoId)?.Song : null;
        presenceTrack = new(generation, ++presenceSequence, row.Key, PlaybackPresenceState.Loading, row.Title, row.Artist, row.Album,
            DiscordPresencePolicy.PublicArtwork(row.Entry, original), 0, row.Duration, DateTimeOffset.UtcNow);
        discord?.Submit(presenceTrack);
    }
    private void OnAudioPresence(AudioPlaybackSnapshot audio)
    {
        if (presenceClosing || audio.Generation != selectionGeneration || audio.Sequence <= lastAudioPresenceSequence) return;
        lastAudioPresenceSequence = audio.Sequence; pendingAudioPresence = audio;
        if (!presenceReady) return;
        PublishDiscord(audio);
        if (audio.State == PlaybackPresenceState.Failed) Error = "No se pudo reproducir. " + audio.Error + " Puedes reintentar la canción.";
        if (audio.State == PlaybackPresenceState.Ended) { SampleListening(); _ = RunAsync(() => AdvanceAsync(1, true, audio.Generation)); }
    }
    private void CompleteDiscordSelection(int generation)
    {
        if (generation != selectionGeneration) return;
        presenceReady = true;
        var audio = Engine.CapturePresence();
        if (audio.Generation == generation) {
            lastAudioPresenceSequence = Math.Max(lastAudioPresenceSequence, audio.Sequence);
            pendingAudioPresence = audio; PublishDiscord(audio);
            if (audio.State == PlaybackPresenceState.Ended) _ = RunAsync(() => AdvanceAsync(1, true, audio.Generation));
        }
    }
    private void FailDiscordSelection(int generation)
    {
        if (generation != selectionGeneration || presenceTrack == null) return;
        presenceReady = false;
        discord?.Submit(presenceTrack with { Sequence = ++presenceSequence, State = PlaybackPresenceState.Failed, CapturedAt = DateTimeOffset.UtcNow });
    }
    private void PublishDiscord(AudioPlaybackSnapshot? audio)
    {
        if (presenceTrack == null || audio == null || !presenceReady || !presenceStarted || presenceClosing || audio.Generation != presenceTrack.Generation) return;
        discord?.Submit(presenceTrack with { Sequence = ++presenceSequence, State = audio.State, Position = audio.Position, Duration = audio.Duration, CapturedAt = audio.CapturedAt });
    }
    internal async Task CloseDiscordAsync()
    {
        presenceClosing = true;
        if (discord != null) { await discord.DisposeAsync(); discord = null; }
    }
}
