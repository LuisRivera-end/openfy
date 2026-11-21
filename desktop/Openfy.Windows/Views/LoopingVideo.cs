using Microsoft.Graphics.Canvas;
using Microsoft.Graphics.Canvas.UI.Xaml;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Openfy.Core;
using MediaPlaybackState = global::Windows.Media.Playback.MediaPlaybackState;
using MediaPlayer = global::Windows.Media.Playback.MediaPlayer;

namespace Openfy.Windows.Views;

/// <summary>
/// A silent, looping, cover-fitted video drawn through Win2D frame-server mode, like the fullscreen motion art
/// (PlayerWindow.Motion.cs), so it obeys XAML clipping and layout. Used by the artist header. It stays transparent
/// until a decoded frame has been drawn, so the static image underneath remains the fallback.
/// </summary>
internal sealed class LoopingVideo
{
    private readonly CanvasControl view = new() { ClearColor = Microsoft.UI.Colors.Transparent, Opacity = 0, IsHitTestVisible = false, IsTabStop = false };
    private readonly Microsoft.UI.Dispatching.DispatcherQueue dispatcher;
    private MediaPlayer? player;
    private CanvasRenderTarget? frame;
    private int generation, queued;
    private bool pending, shown, released, wantPlaying;

    /// <summary>0 keeps the top of the frame, .5 the centre: the fraction of the overflow cropped above.</summary>
    public double VerticalAnchor { get; init; } = .3;
    public bool Fade { get; set; } = true;
    public int FadeMilliseconds { get; init; } = 450;
    public FrameworkElement View => view;
    public bool Visible => shown;
    public bool Playing => player?.PlaybackSession.PlaybackState == MediaPlaybackState.Playing;
    public int FramesDrawn { get; private set; }
    public event Action<bool>? VisibilityChanged;
    /// <summary>Raised on the UI thread when the source cannot be decoded; the static image stays.</summary>
    public event Action? Failed;

    public LoopingVideo(Microsoft.UI.Dispatching.DispatcherQueue queue)
    {
        dispatcher = queue;
        AutomationProperties.SetAccessibilityView(view, AccessibilityView.Raw);
        view.CreateResources += (_, _) => { frame?.Dispose(); frame = null; pending = player?.Source != null; };
        view.Draw += Draw;
    }

    public void Show(Uri source)
    {
        if (released) return;
        if (player == null) {
            player = new MediaPlayer { IsLoopingEnabled = true, IsMuted = true, AutoPlay = false, IsVideoFrameServerEnabled = true };
            // The system media controls belong to the music, never to this video.
            player.CommandManager.IsEnabled = false;
            player.VideoFrameAvailable += FrameAvailable;
            player.MediaFailed += MediaFailed;
        }
        generation++; SetVisible(false); view.OpacityTransition = null; view.Opacity = 0;
        SetSource(global::Windows.Media.Core.MediaSource.CreateFromUri(source));
        if (wantPlaying) player.Play();
    }

    public void Play()
    {
        if (wantPlaying || released) return;
        wantPlaying = true;
        if (player?.Source != null) player.Play();
    }
    public void Pause()
    {
        if (!wantPlaying) return;
        wantPlaying = false;
        player?.Pause();
    }

    public void Hide()
    {
        generation++; SetVisible(false); pending = false;
        view.OpacityTransition = null; view.Opacity = 0;
        if (player != null) { player.Pause(); SetSource(null); }
        frame?.Dispose(); frame = null;
    }

    private void SetVisible(bool visible)
    {
        if (shown == visible) return;
        shown = visible;
        VisibilityChanged?.Invoke(visible);
    }

    public void Release()
    {
        if (released) return;
        released = true; Hide();
        view.Draw -= Draw;
        if (player != null) {
            player.VideoFrameAvailable -= FrameAvailable; player.MediaFailed -= MediaFailed;
            player.Dispose(); player = null;
        }
        view.RemoveFromVisualTree();
    }

    // MediaSource owns a Media Foundation pipeline: close the previous one now instead of waiting for its finalizer.
    private void SetSource(global::Windows.Media.Core.MediaSource? next)
    {
        if (player == null) { next?.Dispose(); return; }
        var previous = player.Source as global::Windows.Media.Core.MediaSource;
        player.Source = next;
        previous?.Dispose();
    }

    // Coalesce decoder events: a busy UI never accumulates a queue of obsolete frames.
    private void FrameAvailable(MediaPlayer sender, object args)
    {
        int own = Volatile.Read(ref generation);
        if (Interlocked.Exchange(ref queued, 1) != 0) return;
        if (!dispatcher.TryEnqueue(() => {
            Interlocked.Exchange(ref queued, 0);
            if (released || !wantPlaying || own != generation || sender != player) return;
            pending = true; view.Invalidate();
        })) Interlocked.Exchange(ref queued, 0);
    }

    private void Draw(CanvasControl sender, CanvasDrawEventArgs args)
    {
        if (released || player?.Source == null) return;
        try {
            var session = player.PlaybackSession;
            uint width = session.NaturalVideoWidth, height = session.NaturalVideoHeight;
            if (width == 0 || height == 0 || sender.ActualWidth <= 0 || sender.ActualHeight <= 0) return;
            if (pending && wantPlaying) {
                if (frame == null || frame.SizeInPixels.Width != width || frame.SizeInPixels.Height != height) {
                    frame?.Dispose();
                    frame = new CanvasRenderTarget(sender, width, height, 96, global::Windows.Graphics.DirectX.DirectXPixelFormat.B8G8R8A8UIntNormalized, CanvasAlphaMode.Ignore);
                }
                player.CopyFrameToVideoSurface(frame);
                pending = false; FramesDrawn++;
            }
            if (frame == null) return;
            double w = frame.Size.Width, h = frame.Size.Height;
            double scale = Math.Max(sender.ActualWidth / w, sender.ActualHeight / h);
            double cropWidth = sender.ActualWidth / scale, cropHeight = sender.ActualHeight / scale;
            var source = new global::Windows.Foundation.Rect((w - cropWidth) / 2, (h - cropHeight) * VerticalAnchor, cropWidth, cropHeight);
            args.DrawingSession.DrawImage(frame, new global::Windows.Foundation.Rect(0, 0, sender.ActualWidth, sender.ActualHeight), source);
            // Reveal only after a decoded frame has actually been drawn, never on PlaybackState alone.
            if (!shown) {
                sender.OpacityTransition = Fade ? new ScalarTransition { Duration = TimeSpan.FromMilliseconds(FadeMilliseconds) } : null;
                sender.Opacity = 1;
                SetVisible(true);
            }
        } catch (Exception error) when (!sender.Device.IsDeviceLost(error.HResult)) {
            SessionLog.Write("motion.render", "failed", error: error);
            Hide(); Failed?.Invoke();
        }
    }

    private void MediaFailed(MediaPlayer sender, global::Windows.Media.Playback.MediaPlayerFailedEventArgs args)
    {
        int own = Volatile.Read(ref generation);
        dispatcher.TryEnqueue(() => {
            if (released || own != generation || sender != player || player.Source == null) return;
            Hide(); Failed?.Invoke();
        });
    }
}
