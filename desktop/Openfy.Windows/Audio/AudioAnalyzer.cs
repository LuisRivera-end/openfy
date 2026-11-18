using System.Runtime.InteropServices;
using NAudio.Dsp;
using Openfy.Core;

namespace Openfy.Windows.Audio;

public sealed class AudioAnalyzer : IDisposable
{
    private readonly float[] ring = new float[2048], samples = new float[2048];
    private readonly Complex[] spectrum = new Complex[1025];
    private readonly FftProcessor fft = new(2048, FftWindowType.Hann);
    private readonly CancellationTokenSource lifetime = new();
    private readonly SemaphoreSlim wake = new(0, 1);
    private long written;
    private int sampleRate = 48000;
    private double offset;
    private int generation, historyIndex;
    private readonly AudioAnalysis?[] history = new AudioAnalysis?[48];
    private volatile bool enabled;
    public AudioAnalysis Latest { get; private set; } = new(0, 0, 0, 0);
    public AudioAnalysis At(double audiblePosition)
    {
        AudioAnalysis? selected = null;
        foreach (var frame in history) if (frame != null && frame.Time <= audiblePosition && (selected == null || frame.Time > selected.Time)) selected = frame;
        return selected ?? new(0, 0, 0, 0);
    }
    public void Reset(double start)
    {
        Interlocked.Increment(ref generation); offset = start; Volatile.Write(ref written, 0); Array.Clear(history); Array.Clear(ring);
    }
    public bool Enabled
    {
        get => enabled;
        set { enabled = value; if (value && wake.CurrentCount == 0) wake.Release(); }
    }
    public AudioAnalyzer() => _ = AnalyzeAsync();
    public void Add(ReadOnlySpan<byte> bytes, int channels, int rate)
    {
        if (!enabled) { Interlocked.Add(ref written, bytes.Length / sizeof(float) / channels); return; }
        sampleRate = rate;
        var floats = MemoryMarshal.Cast<byte, float>(bytes);
        long cursor = written;
        for (int i = 0; i + channels <= floats.Length; i += channels)
        {
            float mono = 0; for (int channel = 0; channel < channels; channel++) mono += floats[i + channel];
            ring[(int)(cursor++ & 2047)] = mono / channels;
        }
        Volatile.Write(ref written, cursor);
    }
    private async Task AnalyzeAsync()
    {
        try
        {
            while (!lifetime.IsCancellationRequested)
            {
                if (!enabled) { await wake.WaitAsync(lifetime.Token); continue; }
                long cursor = Volatile.Read(ref written);
                int own = generation;
                if (cursor >= 2048)
                {
                    for (int i = 0; i < 2048; i++) samples[i] = ring[(int)((cursor - 2048 + i) & 2047)];
                    fft.RealForward(samples, spectrum);
                    float bass = 0, mid = 0, high = 0;
                    for (int i = 1; i < spectrum.Length; i++)
                    {
                        float magnitude = MathF.Sqrt(spectrum[i].Real * spectrum[i].Real + spectrum[i].Imaginary * spectrum[i].Imaginary) / 2048;
                        double hz = (double)i * sampleRate / 2048;
                        if (hz < 250) bass += magnitude; else if (hz < 2500) mid += magnitude; else high += magnitude;
                    }
                    if (own == generation) { Latest = new(offset + cursor / (double)sampleRate, Math.Clamp(bass * 5, 0, 1), Math.Clamp(mid * 3, 0, 1), Math.Clamp(high * 2, 0, 1)); Volatile.Write(ref history[historyIndex++ % history.Length], Latest); }
                }
                await Task.Delay(34, lifetime.Token);
            }
        }
        catch (OperationCanceledException) { }
    }
    public void Dispose() { lifetime.Cancel(); }
}
