using NAudio.Wave;
using Openfy.Core;

namespace Openfy.Windows.Audio;

public sealed class AudioEngine(BackendClient api) : IAsyncDisposable
{
    private WasapiPlayer? output;
    private MediaFoundationReader? decoder;
    private HttpRangeStream? network;
    private BufferedWaveProvider? buffer;
    private CancellationTokenSource? cancellation;
    private Task? producer;
    private Task? monitor;
    private double offset;
    private double pausedPosition;
    private volatile bool eof;
    private bool reportedEnd;
    private readonly SemaphoreSlim transition = new(1, 1);
    private long requestedGeneration, activeGeneration, presenceSequence;
    private AudioPlaybackSnapshot presence = new(0, 0, PlaybackPresenceState.Idle, 0, 0, DateTimeOffset.UtcNow);
    public event Action<AudioPlaybackSnapshot>? PresenceChanged;
    public AudioPlaybackSnapshot CapturePresence()
    {
        var current = Volatile.Read(ref presence);
        return current with { Position = Position, Duration = Duration, CapturedAt = DateTimeOffset.UtcNow };
    }
    public void InvalidateSelection(long generation)
    {
        long previous;
        do { previous = Volatile.Read(ref requestedGeneration); if (previous >= generation) return; }
        while (Interlocked.CompareExchange(ref requestedGeneration, generation, previous) != previous);
    }
    private void Report(PlaybackPresenceState state, string? error = null)
    {
        var value = new AudioPlaybackSnapshot(activeGeneration, Interlocked.Increment(ref presenceSequence), state, Position, Duration, DateTimeOffset.UtcNow, error);
        Volatile.Write(ref presence, value); PresenceChanged?.Invoke(value); Changed?.Invoke();
    }
    public AudioAnalyzer Analyzer { get; } = new();
    public bool Playing { get; private set; }
    public bool Buffering { get; private set; }
    public double Duration { get; private set; }
    public double Volume { get; private set; } = .75;
    public double Position
    {
        get { if (!Playing) return pausedPosition; try { return Math.Min(Duration, offset + (output is null ? 0 : output.GetPosition() / (double)output.OutputWaveFormat.AverageBytesPerSecond)); } catch { return offset; } }
    }
    public event Action? Ended;
    public event Action<string>? Failed;
    public event Action? Changed;
    // Media Foundation seeks and WASAPI initialization can block even when opening
    // a local file. Keep the entire transition (including disposal) off the UI.
    public Task OpenAsync(string source, bool remote, double position, bool autoplay, long generation = 0)
    {
        if (generation == 0) generation = Interlocked.Increment(ref requestedGeneration);
        else InvalidateSelection(generation);
        return Task.Run(() => OpenCoreAsync(source, remote, position, autoplay, generation));
    }
    private async Task OpenCoreAsync(string source, bool remote, double position, bool autoplay, long generation)
    {
        await transition.WaitAsync();
        try
        {
            if (generation != Volatile.Read(ref requestedGeneration)) return;
            await StopCoreAsync();
            activeGeneration = generation;
            cancellation = new(); var token = cancellation.Token;
            Buffering = true; Report(PlaybackPresenceState.Loading);
            decoder = await Task.Run(() => {
                var options = new MediaFoundationReader.MediaFoundationReaderSettings { RequestFloatOutput = true, SingleReaderObject = true };
                if (!remote) return new MediaFoundationReader(source, options);
                network = new HttpRangeStream(api.Http, source);
                return new StreamMediaFoundationReader(FragmentedMp4Stream.Open(network), options, "audio/mp4", "openfy.m4a");
            }, token);
            Duration = decoder.TotalTime.TotalSeconds;
            offset = Math.Clamp(position, 0, Math.Max(0, Duration - .01));
            pausedPosition = offset;
            Analyzer.Reset(offset);
            if (offset > 0) decoder.CurrentTime = TimeSpan.FromSeconds(offset);
            buffer = new BufferedWaveProvider(decoder.WaveFormat, TimeSpan.FromSeconds(2)) { ReadFully = true };
            output = await new WasapiPlayerBuilder().WithSharedMode().WithDefaultDeviceStreamRouting().WithLatency(100).WithMmcssThreadPriority("Audio").BuildAsync();
            output.Init(new AnalysisProvider(buffer, Analyzer));
            output.Volume = (float)Volume;
            output.PlaybackStopped += (_, args) => { if (args.Exception != null && !token.IsCancellationRequested) Fail(args.Exception.Message, generation); };
            eof = false; reportedEnd = false;
            if (generation != Volatile.Read(ref requestedGeneration)) { await StopCoreAsync(); return; }
            Playing = autoplay;
            Report(autoplay ? PlaybackPresenceState.Buffering : PlaybackPresenceState.Paused);
            producer = Task.Run(() => ProduceAsync(token, generation), token);
            monitor = MonitorAsync(token, generation);
        }
        catch (Exception error) { await StopCoreAsync(); if (generation == Volatile.Read(ref requestedGeneration)) Report(PlaybackPresenceState.Failed, error.Message); throw; }
        finally { transition.Release(); }
    }
    private async Task ProduceAsync(CancellationToken token, long generation)
    {
        var reader = decoder!; var pending = buffer!;
        int chunk = reader.WaveFormat.BlockAlign * Math.Max(1, reader.WaveFormat.SampleRate / 10);
        var bytes = new byte[chunk]; long decoded = 0;
        try
        {
            while (!token.IsCancellationRequested)
            {
                if (pending.BufferedDuration.TotalSeconds > 1.5) { await Task.Delay(Playing ? 400 : 250, token); continue; }
                int count = reader.Read(bytes, 0, bytes.Length);
                token.ThrowIfCancellationRequested();
                if (count == 0) {
                    if (decoded == 0) throw new IOException("El decodificador terminó antes de iniciar el audio.");
                    eof = true; return;
                }
                decoded += count;
                pending.AddSamples(bytes, 0, count);
            }
        }
        catch (OperationCanceledException) { }
        catch (Exception error) { if (!token.IsCancellationRequested) Fail(error.Message, generation); }
    }
    private async Task MonitorAsync(CancellationToken token, long generation)
    {
        try
        {
            while (!token.IsCancellationRequested)
            {
                if (output != null && buffer != null)
                {
                    bool wasBuffering = Buffering;
                    bool starved = buffer.BufferedDuration.TotalSeconds < .02 && !eof;
                    if (Playing && starved) { if (output.PlaybackState == PlaybackState.Playing) output.Pause(); Buffering = true; }
                    else if (Playing && (buffer.BufferedDuration.TotalSeconds >= .15 || eof)) { if (output.PlaybackState != PlaybackState.Playing) output.Play(); Buffering = false; }
                    if (wasBuffering != Buffering) Report(Buffering ? PlaybackPresenceState.Buffering : PlaybackPresenceState.Playing);
                    if (eof && buffer.BufferedBytes == 0 && Playing && !reportedEnd && Position >= Duration - .03)
                    { reportedEnd = true; pausedPosition = Duration; Playing = false; output.Pause(); Report(PlaybackPresenceState.Ended); Ended?.Invoke(); }
                }
                await Task.Delay(Playing ? 100 : 250, token);
            }
        }
        catch (OperationCanceledException) { }
        catch (Exception error) { if (!token.IsCancellationRequested) Fail(error.Message, generation); }
    }
    private void Fail(string message, long generation)
    {
        if (generation != Volatile.Read(ref activeGeneration) || generation != Volatile.Read(ref requestedGeneration)) return;
        pausedPosition = Position; Playing = false; output?.Pause();
        cancellation?.Cancel(); network?.Cancel();
        Report(PlaybackPresenceState.Failed, message); Failed?.Invoke(message);
    }
    public void Toggle()
    {
        if (output == null) return;
        if (Playing) { Pause(); return; }
        Playing = true; output.Play();
        Report(Buffering ? PlaybackPresenceState.Buffering : PlaybackPresenceState.Playing);
    }
    public void Pause()
    {
        pausedPosition = Position; Playing = false; output?.Pause();
        var state = Volatile.Read(ref presence).State;
        Report(state is PlaybackPresenceState.Ended or PlaybackPresenceState.Failed or PlaybackPresenceState.Idle ? state : PlaybackPresenceState.Paused);
    }
    public void SetVolume(double value) { Volume = Math.Clamp(value, 0, 1); if (output != null) output.Volume = (float)Volume; }
    private async Task StopCoreAsync()
    {
        Playing = false; Buffering = false;
        cancellation?.Cancel(); network?.Cancel();
        if (monitor != null) { await monitor; monitor = null; }
        if (output != null) { await output.DisposeAsync(); output = null; }
        if (producer != null) { try { await producer; } catch (OperationCanceledException) { } producer = null; }
        decoder?.Dispose(); decoder = null;
        network?.Dispose(); network = null;
        buffer = null; cancellation?.Dispose(); cancellation = null;
        Duration = 0; pausedPosition = 0;
    }
    public async ValueTask DisposeAsync() { await transition.WaitAsync(); try { await StopCoreAsync(); Analyzer.Dispose(); } finally { transition.Release(); } }
    private sealed class AnalysisProvider(BufferedWaveProvider source, AudioAnalyzer analyzer) : IWaveProvider
    {
        public WaveFormat WaveFormat => source.WaveFormat;
        public int Read(Span<byte> data) { int count = source.Read(data); analyzer.Add(data[..count], WaveFormat.Channels, WaveFormat.SampleRate); return count; }
        public int Read(byte[] data, int offset, int count) => Read(data.AsSpan(offset, count));
    }
}
