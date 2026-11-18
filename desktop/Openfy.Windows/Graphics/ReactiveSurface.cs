using System.Diagnostics;
using System.Numerics;
using System.Runtime.InteropServices;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Openfy.Windows.ViewModels;
using Openfy.Windows.Services;
using Vortice.Direct3D;
using Vortice.Direct3D11;
using Vortice.DXGI;
using Vortice.Mathematics;
using static Vortice.Direct3D11.D3D11;
using static Vortice.DXGI.DXGI;

namespace Openfy.Windows.Graphics;

public sealed class ReactiveSurface : IDisposable
{
    private static readonly object GraphicsGate = new();
    private static ID3D11Device? device;
    private static ID3D11DeviceContext? context;
    private static ID3D11VertexShader? vertex;
    private static ID3D11PixelShader? pixel;
    private readonly SwapChainPanel panel;
    private readonly Window window;
    private readonly MainViewModel model;
    private IDXGISwapChain2? swap;
    private ID3D11RenderTargetView? target;
    private ID3D11Buffer? constants;
    private static ID3D11SamplerState? sampler;
    private readonly ID3D11Texture2D?[] artTextures = new ID3D11Texture2D?[3];
    private readonly ID3D11ShaderResourceView?[] artViews = new ID3D11ShaderResourceView?[3];
    private byte[]? previewPixels, promotedPixels;
    private string? previewOwnerId;
    private bool previewPending;
    private Vector4 previewRect;
    private float previewRadius = 16, previewScrim = -1;
    private int currentArt;
    private volatile bool artworkPending = true;
    private bool artworkLoaded;
    private double fadeStart = double.NegativeInfinity;
    private float scrim = Openfy.Core.Ambient.ScrimMin, phase, speed;
    private volatile float lyricsScrim;
    private float scrimFrom;
    private long scrimStart;
    private readonly CancellationTokenSource cancellation = new();
    private readonly AutoResetEvent wake = new(false);
    private Task? rendering;
    private bool disposed;
    private volatile bool visible, reducedMotion;
    private volatile float width = 300, height = 200;
    private volatile float bass, mid, high;
    private int renderedWidth, renderedHeight;
    private volatile bool dirty = true;
    private double refresh = 60, fps, frames;
    private long fullscreenUntil;
    private string monitor = "";
    private bool otherFullscreen;
    private string? failure;
    private readonly Microsoft.UI.Dispatching.DispatcherQueueTimer policyTimer;
    public string Diagnostics => $"{monitor} · {refresh:0.##} Hz · objetivo {Target:0.##} FPS · real {fps:0.0} FPS · {(otherFullscreen || model.Settings.Force24 ? "límite 24 FPS" : "automático")}" + (failure == null ? "" : " · " + failure);
    public double Target { get; private set; }
    public double ActualFps => fps;
    public bool Failed => failure != null;
    /// <summary>Extra darkening toward the right edge, behind the lyrics column of the split layout.</summary>
    public float LyricsScrim { get => lyricsScrim; set => SetLyricsScrim(value, true); }
    /// <summary>Eases toward the new darkening over the Big Picture layout change (Immersive.LayoutMilliseconds) unless instant.</summary>
    public void SetLyricsScrim(float value, bool instant)
    {
        lock (GraphicsGate) {
            if (lyricsScrim == value) return;
            scrimFrom = instant ? value : CurrentLyricsScrim(Stopwatch.GetTimestamp()); lyricsScrim = value;
            scrimStart = instant ? 0 : Stopwatch.GetTimestamp(); dirty = true;
        }
        wake.Set();
    }
    private float CurrentLyricsScrim(long now)
    {
        if (scrimStart == 0) return lyricsScrim;
        float t = (float)Math.Clamp((now - scrimStart) / (double)Stopwatch.Frequency * 1000 / Openfy.Core.Immersive.LayoutMilliseconds, 0, 1);
        if (t >= 1) { scrimStart = 0; return lyricsScrim; }
        return scrimFrom + (lyricsScrim - scrimFrom) * t * t * (3 - 2 * t);
    }
    public void SetPreview(byte[] pixels)
    {
        lock (GraphicsGate) { previewOwnerId ??= model.Current?.Entry.QueueId; previewPixels = pixels; previewPending = true; previewScrim = Openfy.Core.Ambient.Scrim(Openfy.Core.Ambient.MeanLuma(pixels)); dirty = true; }
        wake.Set();
    }
    public void PositionPreview(double x, double y, double w, double h, double radius = 16)
    {
        var next = new Vector4((float)x, (float)y, (float)w, (float)h);
        lock (GraphicsGate) {
            if (previewRect == next && previewRadius == (float)radius) return;
            previewRect = next; previewRadius = (float)radius; dirty = true;
        }
        wake.Set();
    }
    public void ClearPreview(bool promote = false)
    {
        lock (GraphicsGate) {
            if (promote && previewPixels != null) { promotedPixels = previewPixels; artworkPending = true; }
            else if (previewPixels != null) artworkPending = true;
            previewPixels = null; previewOwnerId = null; previewPending = false; previewScrim = -1; dirty = true;
        }
        wake.Set();
    }
    public ReactiveSurface(SwapChainPanel surface, Window owner, MainViewModel viewModel)
    {
        panel = surface; window = owner; model = viewModel;
        policyTimer = owner.DispatcherQueue.CreateTimer(); policyTimer.Interval = TimeSpan.FromSeconds(1); policyTimer.Tick += OnPolicyTick;
        panel.Loaded += OnLoaded;
        panel.SizeChanged += OnSizeChanged;
        model.ArtworkChanged += OnArtwork;
        WindowsIntegration.PresentationChanged += OnPresentation;
        WindowsIntegration.WatchPresentation();
        owner.AppWindow.Changed += OnWindowChanged;
    }
    private void OnLoaded(object sender, RoutedEventArgs args) { if (disposed || rendering != null) return; try { Initialize(); UpdatePolicy(); policyTimer.Start(); rendering = Task.Run(RenderLoop); } catch (Exception error) { failure = error.Message; Debug.WriteLine(error); } }
    private void OnSizeChanged(object sender, SizeChangedEventArgs args) { width = (float)Math.Max(1, panel.ActualWidth); height = (float)Math.Max(1, panel.ActualHeight); dirty = true; wake.Set(); }
    private void OnPolicyTick(Microsoft.UI.Dispatching.DispatcherQueueTimer sender, object args) => UpdatePolicy();
    private void OnWindowChanged(Microsoft.UI.Windowing.AppWindow sender, Microsoft.UI.Windowing.AppWindowChangedEventArgs args) => UpdatePolicy();
    // Keep the previous cover on screen while the next one is being prepared.
    private void OnArtwork() { if (model.ArtworkPending || previewPixels != null && previewOwnerId != model.Current?.Entry.QueueId) return; artworkPending = true; dirty = true; wake.Set(); }
    private void OnPresentation() => window.DispatcherQueue.TryEnqueue(() => { if (!disposed) UpdatePolicy(); });
    private unsafe void Initialize()
    {
        lock (GraphicsGate)
        {
            if (device == null)
            {
                D3D11CreateDevice(null, DriverType.Hardware, DeviceCreationFlags.BgraSupport, [FeatureLevel.Level_11_0], out device, out context).CheckError();
                using var protection = context.QueryInterface<ID3D11Multithread>();
                protection.SetMultithreadProtected(true);
                var vs = Vortice.D3DCompiler.Compiler.Compile(Shader, "VS", "openfy.hlsl", "vs_5_0");
                var ps = Vortice.D3DCompiler.Compiler.Compile(Shader, "PS", "openfy.hlsl", "ps_5_0");
                vertex = device.CreateVertexShader(vs.Span); pixel = device.CreatePixelShader(ps.Span);
                sampler = device.CreateSamplerState(new SamplerDescription(Filter.MinMagMipLinear, TextureAddressMode.Mirror, TextureAddressMode.Mirror, TextureAddressMode.Mirror));
            }
            for (int i = 0; i < 3; i++)
            {
                artTextures[i] = device.CreateTexture2D(new Texture2DDescription(Format.B8G8R8A8_UNorm, Openfy.Core.Ambient.TextureSize, Openfy.Core.Ambient.TextureSize, 1, 0,
                    BindFlags.ShaderResource | BindFlags.RenderTarget, ResourceUsage.Default, CpuAccessFlags.None, 1, 0, ResourceOptionFlags.GenerateMips));
                artViews[i] = device.CreateShaderResourceView(artTextures[i]!);
                Upload(i, Openfy.Core.Ambient.PaletteTexture(model.Palette));
            }
            using var factory = CreateDXGIFactory2<IDXGIFactory2>(false);
            var description = new SwapChainDescription1 { Width = 300, Height = 200, Format = Format.B8G8R8A8_UNorm,
                BufferCount = 2, BufferUsage = Usage.RenderTargetOutput, SampleDescription = new(1, 0),
                Scaling = Scaling.Stretch, SwapEffect = SwapEffect.FlipSequential, AlphaMode = AlphaMode.Ignore,
                Flags = SwapChainFlags.FrameLatencyWaitableObject };
            using var initial = factory.CreateSwapChainForComposition(device, description);
            swap = initial.QueryInterface<IDXGISwapChain2>(); swap.MaximumFrameLatency = 1;
            Attach(swap.NativePointer);
            constants = device.CreateBuffer((uint)Marshal.SizeOf<Constants>(), BindFlags.ConstantBuffer, ResourceUsage.Default);
            width = (float)Math.Max(1, panel.ActualWidth); height = (float)Math.Max(1, panel.ActualHeight);
        }
    }
    private unsafe void Attach(nint value)
    {
        nint inspectable = WinRT.MarshalInspectable<object>.FromManaged(panel);
        var iid = new Guid("63aad0b8-7c24-40ff-85a8-640d944cc325");
        try {
            Marshal.ThrowExceptionForHR(Marshal.QueryInterface(inspectable, in iid, out nint native));
            try { var table = *(nint**)native; var attach = (delegate* unmanaged[Stdcall]<nint, nint, int>)table[3]; Marshal.ThrowExceptionForHR(attach(native, value)); }
            finally { Marshal.Release(native); }
        } finally { Marshal.Release(inspectable); }
    }
    private void UpdatePolicy()
    {
        try
        {
            var display = WindowsIntegration.Display(WindowsIntegration.Handle(window));
            monitor = display.Name; refresh = display.Hz;
            bool previousVisible = visible;
            double previousTarget = Target;
            visible = WindowsIntegration.Visible(WindowsIntegration.Handle(window)); reducedMotion = !WindowsIntegration.AnimationsEnabled;
            if (WindowsIntegration.OtherFullscreen()) fullscreenUntil = Stopwatch.GetTimestamp() + 2 * Stopwatch.Frequency;
            otherFullscreen = Stopwatch.GetTimestamp() < fullscreenUntil;
            Target = Openfy.Core.RenderPolicy.Target(refresh, visible, model.Playing, model.Settings.Effects, reducedMotion, otherFullscreen, model.Settings.Force24);
            if (Target == 0) fps = 0;
            if (previousVisible != visible || previousTarget != Target) dirty = true;
            wake.Set();
        }
        catch { refresh = 60; }
    }
    private void RenderLoop()
    {
        var clock = Stopwatch.StartNew(); double last = 0, measuredAt = 0;
        using var latency = new NativeWaitHandle(new(swap!.FrameLatencyWaitableObject, true));
        using var pacing = new NativeWaitHandle(CreateWaitableTimerEx(0, null, 2, 0x1F0003));
        var frameWait = new WaitHandle[] { latency, cancellation.Token.WaitHandle };
        var paceWait = new WaitHandle[] { pacing, cancellation.Token.WaitHandle };
        try
        {
            while (!cancellation.IsCancellationRequested)
            {
                double targetFps = Openfy.Core.RenderPolicy.Target(refresh, visible, model.Playing, model.Settings.Effects, reducedMotion, otherFullscreen, model.Settings.Force24);
                Target = targetFps;
                if (!visible || targetFps == 0 && !dirty) { wake.WaitOne(); continue; }
                double now = clock.Elapsed.TotalSeconds;
                // Composition swap chains can accept frames faster than their monitor.
                // Bound submission explicitly, using a high-resolution kernel timer
                // rather than the managed timer quantum. Present still requests VSync.
                if (targetFps > 0)
                {
                    double remaining = 1 / targetFps - (now - last);
                    if (remaining > .0001) {
                        long due = -(long)Math.Ceiling(remaining * 10_000_000);
                        SetWaitableTimer(pacing.SafeWaitHandle, ref due, 0, 0, 0, false);
                        if (WaitHandle.WaitAny(paceWait) == 1) break;
                    }
                }
                if (WaitHandle.WaitAny(frameWait, 1000) == 1) break;
                now = clock.Elapsed.TotalSeconds;
                dirty = false; Draw((float)now, targetFps > 0, (float)(now - last)); last = now;
                frames++;
                if (now - measuredAt >= 1) { fps = frames / (now - measuredAt); frames = 0; measuredAt = now; }
                if (targetFps == 0) fps = 0;
            }
        }
        catch (Exception error) { failure = error.Message; Debug.WriteLine("Renderer: " + error); }
    }
    private void Draw(float time, bool reactive, float elapsed)
    {
        lock (GraphicsGate)
        {
            if (swap == null || device == null || context == null) return;
            float scale = Math.Min(1, Math.Min(1280 / width, 720 / height));
            int w = Math.Max(1, (int)(width * scale)), h = Math.Max(1, (int)(height * scale));
            if (w != renderedWidth || h != renderedHeight)
            {
                context.ClearState(); target?.Dispose();
                swap.ResizeBuffers(2, (uint)w, (uint)h, Format.B8G8R8A8_UNorm, SwapChainFlags.FrameLatencyWaitableObject).CheckError();
                using var back = swap.GetBuffer<ID3D11Texture2D>(0); target = device.CreateRenderTargetView(back);
                swap.MatrixTransform = Matrix3x2.CreateScale(width / w, height / h);
                renderedWidth = w; renderedHeight = h;
            }
            var analysis = model.Engine.Analyzer.At(model.Engine.Position);
            float step = Math.Clamp(elapsed, 0, .1f);
            float Envelope(float value, float target) => value + (target - value) * (1 - MathF.Exp(-Math.Clamp(elapsed, .001f, .1f) / (target > value ? .06f : .26f)));
            bass = Envelope(bass, reactive ? analysis.Bass : 0);
            mid = Envelope(mid, reactive ? analysis.Mid : 0);
            high = Envelope(high, reactive ? analysis.High : 0);
            // Motion is a phase that only advances while reactive, so pausing freezes it instead of snapping back.
            speed += ((reactive ? 1 : 0) - speed) * (1 - MathF.Exp(-step / .6f));
            phase += step * speed * Openfy.Core.Ambient.MotionSpeed * (1 + mid * .6f);
            if (previewPending) { previewPending = false; Upload(2, previewPixels!); }
            if (artworkPending)
            {
                artworkPending = false;
                var pixels = promotedPixels ?? model.AmbientPixels ?? Openfy.Core.Ambient.PaletteTexture(model.Palette);
                currentArt ^= 1; Upload(currentArt, pixels);
                scrim = Openfy.Core.Ambient.Scrim(Openfy.Core.Ambient.MeanLuma(pixels));
                bool instant = promotedPixels != null || !artworkLoaded || reducedMotion || !model.Settings.Effects;
                promotedPixels = null;
                fadeStart = instant ? double.NegativeInfinity : time; artworkLoaded = true;
            }
            float mix = Openfy.Core.Ambient.Fade(time - fadeStart);
            if (mix < 1) dirty = true;
            float lyricsShade = CurrentLyricsScrim(Stopwatch.GetTimestamp());
            if (scrimStart != 0) dirty = true;
            var data = new Constants { Values = new(phase, bass, mid, high), Look = new(width / height, mix, scrim, lyricsShade),
                Grading = new(Openfy.Core.Ambient.LumaFloor, Openfy.Core.Ambient.LumaCeiling, Openfy.Core.Ambient.Saturation, Openfy.Core.Ambient.TextureSize),
                PreviewRect = previewRect, PreviewLook = new(width, height, previewRadius, previewScrim) };
            context.UpdateSubresource(data, constants!);
            Bind(target!, w, h);
            context.Draw(3, 0);
        }
        // A Present can wait for a display; never hold the shared device gate
        // while waiting, otherwise one monitor serializes every other surface.
        if (!cancellation.IsCancellationRequested) swap?.Present(1, PresentFlags.None).CheckError();
    }
    // Caller holds GraphicsGate.
    private void Bind(ID3D11RenderTargetView view, int w, int h)
    {
        context!.OMSetRenderTargets(view); context.RSSetViewport(new Viewport(0, 0, w, h));
        context.IASetPrimitiveTopology(PrimitiveTopology.TriangleList);
        context.VSSetShader(vertex); context.PSSetShader(pixel); context.PSSetConstantBuffer(0, constants);
        context.PSSetShaderResources(0, [artViews[currentArt ^ 1]!, artViews[currentArt]!, artViews[2]!]); context.PSSetSampler(0, sampler);
    }
    /// <summary>
    /// Opt-in QA readback (--visual-players): renders the last frame's state into an offscreen target, since a
    /// flip-model swap chain's presented buffer cannot be read back. Returns BGRA rows at the render resolution.
    /// </summary>
    public byte[]? CaptureFrame(out int w, out int h)
    {
        lock (GraphicsGate)
        {
            w = renderedWidth; h = renderedHeight;
            if (device == null || context == null || constants == null || w == 0 || h == 0) return null;
            using var texture = device.CreateTexture2D(new Texture2DDescription(Format.B8G8R8A8_UNorm, (uint)w, (uint)h, 1, 1, BindFlags.RenderTarget));
            using var view = device.CreateRenderTargetView(texture);
            Bind(view, w, h); context.Draw(3, 0);
            using var staging = device.CreateTexture2D(new Texture2DDescription(Format.B8G8R8A8_UNorm, (uint)w, (uint)h, 1, 1, BindFlags.None, ResourceUsage.Staging, CpuAccessFlags.Read));
            context.CopyResource(staging, texture);
            var map = context.Map(staging, 0, MapMode.Read);
            try
            {
                var pixels = new byte[w * h * 4];
                for (int y = 0; y < h; y++) Marshal.Copy(map.DataPointer + (nint)(y * map.RowPitch), pixels, y * w * 4, w * 4);
                return pixels;
            }
            finally { context.Unmap(staging, 0); dirty = true; wake.Set(); }
        }
    }
    // Caller holds GraphicsGate.
    private void Upload(int slot, byte[] pixels)
    {
        context!.UpdateSubresource(pixels, artTextures[slot]!, 0, Openfy.Core.Ambient.TextureSize * 4, 0);
        context.GenerateMips(artViews[slot]!);
    }
    [StructLayout(LayoutKind.Sequential)] private struct Constants { public Vector4 Values, Look, Grading, PreviewRect, PreviewLook; }
    private sealed class NativeWaitHandle : WaitHandle { public NativeWaitHandle(Microsoft.Win32.SafeHandles.SafeWaitHandle handle) { SafeWaitHandle = handle; } }
    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)] private static extern Microsoft.Win32.SafeHandles.SafeWaitHandle CreateWaitableTimerEx(nint attributes, string? name, uint flags, uint access);
    [DllImport("kernel32.dll", SetLastError = true)] [return: MarshalAs(UnmanagedType.Bool)] private static extern bool SetWaitableTimer(Microsoft.Win32.SafeHandles.SafeWaitHandle timer, ref long due, int period, nint completion, nint argument, bool resume);
    public void Dispose()
    {
        if (disposed) return; disposed = true;
        cancellation.Cancel(); wake.Set(); policyTimer.Stop(); model.ArtworkChanged -= OnArtwork;
        panel.Loaded -= OnLoaded; panel.SizeChanged -= OnSizeChanged; window.AppWindow.Changed -= OnWindowChanged; policyTimer.Tick -= OnPolicyTick;
        WindowsIntegration.PresentationChanged -= OnPresentation; WindowsIntegration.UnwatchPresentation();
        rendering?.GetAwaiter().GetResult();
        if (swap != null) Attach(0);
        lock (GraphicsGate) {
            context?.ClearState(); target?.Dispose(); constants?.Dispose();
            foreach (var view in artViews) view?.Dispose();
            foreach (var texture in artTextures) texture?.Dispose();
            context?.Flush();
            swap?.Dispose(); swap = null; context?.Flush();
        }
        cancellation.Dispose(); wake.Dispose();
    }
    // Twin of the GLSL in app/lib/ambient-gl.ts. Grading constants come from Openfy.Core.Ambient
    // (tests/fixtures/ambient-contract.json). v=(phase,bass,mid,high) look=(aspect,mix,scrim,lyricsScrim)
    // grading=(floor,ceiling,saturation,textureSize).
    private const string Shader = """
    cbuffer Settings : register(b0) { float4 v; float4 look; float4 grading; float4 previewRect; float4 previewLook; };
    Texture2D previousArt : register(t0); Texture2D currentArt : register(t1); Texture2D previewArt : register(t2); SamplerState mirror : register(s0);
    struct Vertex { float4 p : SV_POSITION; float2 uv : TEXCOORD; };
    Vertex VS(uint id : SV_VertexID) { Vertex o; o.uv=float2((id<<1)&2,id&2); o.p=float4(o.uv*float2(2,-2)+float2(-1,1),0,1); return o; }
    float hash(float2 p) { return frac(sin(dot(p, float2(127.1, 311.7))) * 43758.5453); }
    float noise(float2 p) { float2 i = floor(p), f = frac(p), u = f * f * (3 - 2 * f); return lerp(lerp(hash(i), hash(i + float2(1, 0)), u.x), lerp(hash(i + float2(0, 1)), hash(i + 1), u.x), u.y); }
    float fbm(float2 p) { return noise(p) * .65 + noise(p * 2.03 + 17.1) * .35; }
    float2 spin(float2 p, float a) { float s = sin(a), c = cos(a); return float2(c * p.x - s * p.y, s * p.x + c * p.y); }
    float3 tap(Texture2D art, float2 at, float lod) { float res = grading.w / exp2(lod); float2 x = at * res + .5, i = floor(x), f = x - i; f = f * f * (3 - 2 * f); return art.SampleLevel(mirror, (i + f - .5) / res, lod).rgb; }
    float3 sampleArt(Texture2D art, float2 a, float2 b) { return (tap(art, a, 2) + tap(art, b, 3)) * .5; }
    float3 grade(float3 c) { float l = dot(c, float3(.2126, .7152, .0722)); return saturate(lerp(grading.x, grading.y, l) + (c - l) * grading.z); }
    float4 PS(Vertex i) : SV_TARGET {
      float2 p = (i.uv * 2 - 1) * float2(look.x, 1) / max(1, look.x * .8);
      float t = v.x, w = .62 + v.y * .45;
      p /= 1 + v.y * .05;
      float2 q = p + w * (float2(fbm(p * 1.3 + t * .11), fbm(p * 1.3 + float2(5.2, 1.3) - t * .09)) - .5);
      q += w * .6 * (float2(fbm(q * 2.1 - t * .07 + 3.7), fbm(q * 2.1 + t * .08 + 9.1)) - .5);
      float2 a = spin(q, t * .07) / 1.6 * .5 + .5, b = spin(q, -t * .05 + 1.7) / 2.2 * .5 + .5;
      float3 c = lerp(sampleArt(previousArt, a, b), sampleArt(currentArt, a, b), look.y);
      c = grade(c) * (.96 + v.w * .08);
      c *= 1 - saturate(look.z + look.w * smoothstep(.15, .85, i.uv.x));
      if (previewLook.w >= 0) {
        float2 d = abs(i.uv * previewLook.xy - previewRect.xy - previewRect.zw * .5) - previewRect.zw * .5 + previewLook.z;
        float edge = length(max(d, 0)) + min(max(d.x, d.y), 0) - previewLook.z;
        float3 next = grade(sampleArt(previewArt, a, b)) * (.96 + v.w * .08) * (1 - previewLook.w);
        c = lerp(c, next, 1 - smoothstep(-1, 1, edge));
      }
      c += (hash(i.p.xy) + hash(i.p.xy + 19.19) - 1) / 255;
      return float4(saturate(c), 1);
    }
    """;
}
