using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.Graphics.Canvas;
using Microsoft.Graphics.Canvas.Geometry;
using Microsoft.Graphics.Canvas.UI.Xaml;
using Openfy.Core;
using Openfy.Windows.ViewModels;
using MediaPlaybackState = global::Windows.Media.Playback.MediaPlaybackState;
using MediaPlayer = global::Windows.Media.Playback.MediaPlayer;
using MediaPlayerFailedEventArgs = global::Windows.Media.Playback.MediaPlayerFailedEventArgs;

namespace Openfy.Windows.Views;

/// <summary>
/// Motion art: the album's silent looping video over the static cover of the fullscreen window
/// (web twin: MotionArt.vue and useMotionArt.ts). The backend finds, stores and serves the file.
/// </summary>
public sealed partial class PlayerWindow
{
    private sealed record MotionAnswer(string? Url, long RetryAt);
    /// <summary>Videos are reused; negatives and failures expire instead of sticking for the session.</summary>
    private static readonly Dictionary<string, MotionAnswer> MotionKnown = [];
    private Microsoft.UI.Dispatching.DispatcherQueueTimer? motionRetryTimer;
    private Grid? artHost;
    private CanvasControl? motionView;
    private CanvasRenderTarget? motionFrame;
    private MediaPlayer? motionPlayer;
    private string? motionKey, motionUrl;
    private int motionGeneration;
    private bool motionShown;
    private int motionFrameQueued;
    private bool motionFramePending;
    private int motionFramesDrawn;

    // The 56 px cover of the stacked layout stays static; the split and docked-cover artwork can play it.
    private bool MotionWanted => Full && !released && model.Settings.MotionArt && PictureMotion && layout is Immersive.Split or Immersive.Cover;
    internal bool MotionVisible => motionShown && motionUrl != null;
    internal bool MotionPlaying => motionPlayer?.PlaybackSession.PlaybackState == MediaPlaybackState.Playing;

    private string? MotionAlbum(PlaybackEntry entry)
    {
        if (entry.Source == "local") return model.Library.Tracks.FirstOrDefault(track => track.Id == entry.TrackId)?.AlbumId is { Length: > 0 } id ? "local:" + id : null;
        return entry.Song is { Album.Length: > 0, Artists.Length: > 0 } song ? ("youtube:" + song.Artists[0] + "\n" + song.Album).ToLowerInvariant() : null;
    }

    /// <summary>Follows the scene on screen, reusing videos and respecting negative-answer deadlines.</summary>
    private void RefreshMotion()
    {
        if (!MotionWanted || model.Current is not { } current) { HideMotion(); return; }
        // While a transition is held the outgoing scene, and its video, stay as they are.
        if (current.Entry.QueueId != visualQueueId) return;
        if (MotionAlbum(current.Entry) is not { } key) { HideMotion(); return; }
        if (key == motionKey) {
            if (MotionKnown.TryGetValue(key, out var answer) && answer.RetryAt <= Environment.TickCount64) MotionKnown.Remove(key);
            else { if (answer is { Url: null }) RetryMotionAt(answer.RetryAt); SyncMotionPlayback(); return; }
        }
        HideMotion(); motionKey = key;
        if (MotionKnown.TryGetValue(key, out var known) && known.RetryAt > Environment.TickCount64) {
            if (known.Url != null) ShowMotion(known.Url); else RetryMotionAt(known.RetryAt);
            return;
        }
        MotionKnown.Remove(key);
        _ = ResolveMotionAsync(current.Entry, key, motionGeneration);
    }

    private async Task ResolveMotionAsync(PlaybackEntry entry, string key, int own)
    {
        try {
            var result = await model.Api.SendAsync<MotionArtResult>("api/motion/resolve", HttpMethod.Post, new { entry });
            string? url = result.Status == "ready" ? result.Url : null;
            long wait = result.RetryAfterMs > 0 ? result.RetryAfterMs : result.Status == "none" ? 30L * 24 * 3_600_000 : 24L * 3_600_000;
            var answer = new MotionAnswer(url, url != null ? long.MaxValue : Environment.TickCount64 + Math.Clamp(wait, 1000, 30L * 24 * 3_600_000));
            MotionKnown[key] = answer;
            if (own == motionGeneration && motionKey == key && MotionWanted) {
                if (url != null) ShowMotion(url); else RetryMotionAt(answer.RetryAt);
            }
        } catch (Exception error) {
            long wait = error.Data["RetryAfterMs"] is long retry ? Math.Clamp(retry, 1000, 30L * 24 * 3_600_000) : 15 * 60_000;
            var answer = new MotionAnswer(null, Environment.TickCount64 + wait);
            MotionKnown[key] = answer;
            if (own == motionGeneration && motionKey == key) RetryMotionAt(answer.RetryAt);
        }
    }

    private void RetryMotionAt(long deadline)
    {
        if (!MotionWanted || !AppWindow.IsVisible || deadline == long.MaxValue) return;
        if (motionRetryTimer?.IsRunning == true) return;
        if (motionRetryTimer == null) {
            motionRetryTimer = DispatcherQueue.CreateTimer(); motionRetryTimer.IsRepeating = false;
            motionRetryTimer.Tick += RetryMotion;
        }
        motionRetryTimer.Stop();
        motionRetryTimer.Interval = TimeSpan.FromMilliseconds(Math.Max(1, Math.Min(deadline - Environment.TickCount64, 2_147_000_000)));
        motionRetryTimer.Start();
    }
    private void RetryMotion(Microsoft.UI.Dispatching.DispatcherQueueTimer sender, object args)
    {
        sender.Stop(); motionKey = null; RefreshMotion();
    }

    private void ShowMotion(string url)
    {
        if (artHost == null || released || model.Api.Http.BaseAddress is not { } origin) return;
        if (motionPlayer == null || motionView == null) {
            motionPlayer = new MediaPlayer { IsLoopingEnabled = true, IsMuted = true, AutoPlay = false, IsVideoFrameServerEnabled = true };
            // The system media controls belong to the music, never to this video.
            motionPlayer.CommandManager.IsEnabled = false;
            motionPlayer.VideoFrameAvailable += MotionFrameAvailable;
            motionPlayer.MediaFailed += MotionFailed;
            // A normal XAML surface can be clipped. MediaPlayerElement's independent video surface cannot.
            // Frames stay on the GPU; redraw only when the decoder supplies a frame or XAML resizes the cover.
            motionView = new CanvasControl { ClearColor = Microsoft.UI.Colors.Transparent, Opacity = 0, IsHitTestVisible = false, IsTabStop = false };
            AutomationProperties.SetAccessibilityView(motionView, AccessibilityView.Raw);
            motionView.CreateResources += (_, _) => { motionFrame?.Dispose(); motionFrame = null; motionFramePending = motionUrl != null; };
            motionView.Draw += DrawMotion;
            artHost.Children.Add(motionView);
        }
        motionUrl = url; motionShown = false;
        motionView.OpacityTransition = null; motionView.Opacity = 0;
        SetMotionSource(global::Windows.Media.Core.MediaSource.CreateFromUri(new Uri(origin, url)));
        SyncMotionPlayback();
    }
    // MediaSource owns a Media Foundation pipeline: close the previous one now instead of waiting for its finalizer.
    private void SetMotionSource(global::Windows.Media.Core.MediaSource? next)
    {
        if (motionPlayer == null) { next?.Dispose(); return; }
        var previous = motionPlayer.Source as global::Windows.Media.Core.MediaSource;
        motionPlayer.Source = next;
        previous?.Dispose();
    }

    /// <summary>The video runs only with the music, in a visible window.</summary>
    private void SyncMotionPlayback()
    {
        if (motionPlayer == null || motionUrl == null) return;
        if (model.Playing && !released && AppWindow.IsVisible) motionPlayer.Play(); else motionPlayer.Pause();
    }
    private void PauseMotion() { motionRetryTimer?.Stop(); if (motionUrl != null) motionPlayer?.Pause(); }

    private void HideMotion()
    {
        motionGeneration++; motionKey = null; motionUrl = null; motionShown = false;
        motionRetryTimer?.Stop();
        if (motionView != null) { motionView.OpacityTransition = null; motionView.Opacity = 0; }
        if (motionPlayer != null) { motionPlayer.Pause(); SetMotionSource(null); }
        motionFramePending = false;
        motionFrame?.Dispose(); motionFrame = null;
    }

    // Coalesce decoder events: a busy UI never accumulates a queue of obsolete frames.
    private void MotionFrameAvailable(MediaPlayer sender, object args)
    {
        int own = Volatile.Read(ref motionGeneration);
        if (Interlocked.Exchange(ref motionFrameQueued, 1) != 0) return;
        if (!DispatcherQueue.TryEnqueue(() => {
            Interlocked.Exchange(ref motionFrameQueued, 0);
            if (released || own != motionGeneration || sender != motionPlayer || motionUrl == null || motionView == null) return;
            motionFramePending = true;
            motionView.Invalidate();
        })) Interlocked.Exchange(ref motionFrameQueued, 0);
    }

    private void DrawMotion(CanvasControl sender, CanvasDrawEventArgs args)
    {
        if (released || motionUrl == null || motionPlayer == null) return;
        try {
            var session = motionPlayer.PlaybackSession;
            uint width = session.NaturalVideoWidth, height = session.NaturalVideoHeight;
            if (width == 0 || height == 0 || sender.ActualWidth <= 0 || sender.ActualHeight <= 0) return;
            if (motionFramePending) {
                if (motionFrame == null || motionFrame.SizeInPixels.Width != width || motionFrame.SizeInPixels.Height != height) {
                    motionFrame?.Dispose();
                    motionFrame = new CanvasRenderTarget(sender, width, height, 96, global::Windows.Graphics.DirectX.DirectXPixelFormat.B8G8R8A8UIntNormalized, CanvasAlphaMode.Ignore);
                }
                motionPlayer.CopyFrameToVideoSurface(motionFrame);
                motionFramePending = false;
                motionFramesDrawn++;
            }
            if (motionFrame == null) return;
            var destination = new global::Windows.Foundation.Rect(0, 0, sender.ActualWidth, sender.ActualHeight);
            DrawMotionFrame(args.DrawingSession, destination);
            // Reveal only after a decoded frame has actually been drawn, never on PlaybackState alone.
            if (!motionShown) {
                motionShown = true;
                sender.OpacityTransition = PictureMotion ? new ScalarTransition { Duration = TimeSpan.FromMilliseconds(450) } : null;
                sender.Opacity = 1;
            }
        } catch (Exception error) when (!sender.Device.IsDeviceLost(error.HResult)) {
            SessionLog.Write("motion.render", "failed", error: error);
            string? key = motionKey; HideMotion(); motionKey = key;
        }
    }

    private void DrawMotionFrame(CanvasDrawingSession drawing, global::Windows.Foundation.Rect destination)
    {
        if (motionFrame == null) return;
        double width = motionFrame.Size.Width, height = motionFrame.Size.Height;
        double scale = Math.Max(destination.Width / width, destination.Height / height);
        double cropWidth = destination.Width / scale, cropHeight = destination.Height / scale;
        var source = new global::Windows.Foundation.Rect((width - cropWidth) / 2, (height - cropHeight) / 2, cropWidth, cropHeight);
        float radius = (float)artworkFrame.CornerRadius.TopLeft;
        using var clip = CanvasGeometry.CreateRoundedRectangle(drawing, destination, radius, radius);
        using (drawing.CreateLayer(1, clip)) drawing.DrawImage(motionFrame, destination, source);
    }
    private void MotionFailed(MediaPlayer sender, MediaPlayerFailedEventArgs args) => DispatcherQueue.TryEnqueue(() => {
        if (released) return;
        if (motionKey != null) MotionKnown[motionKey] = new(null, long.MaxValue);
        string? key = motionKey; HideMotion(); motionKey = key;
    });

    private void ReleaseMotion()
    {
        if (motionRetryTimer != null) { motionRetryTimer.Stop(); motionRetryTimer.Tick -= RetryMotion; motionRetryTimer = null; }
        if (motionPlayer == null) return;
        motionPlayer.VideoFrameAvailable -= MotionFrameAvailable; motionPlayer.MediaFailed -= MotionFailed;
        motionPlayer.Pause(); SetMotionSource(null);
        if (motionView != null) { motionView.Draw -= DrawMotion; motionView.RemoveFromVisualTree(); }
        motionFrame?.Dispose(); motionFrame = null;
        motionPlayer.Dispose(); motionPlayer = null; motionView = null; motionUrl = null; motionKey = null;
    }

    // Isolated opt-in QA, driven by --visual-players --motion-check. The backend of a check run never contacts
    // the provider, so the data directory must already hold the video of at least one fixture album.
    internal async Task<object> VerifyMotionAsync(string directory)
    {
        void Require(bool condition, string message) { if (!condition) throw new InvalidOperationException(message); }
        async Task<bool> Wait(Func<bool> condition, int milliseconds) {
            long start = Environment.TickCount64;
            while (!condition() && Environment.TickCount64 - start < milliseconds) { model.Tick(); await Task.Delay(40); }
            return condition();
        }
        var rows = model.Library.Tracks.Select(track => model.Describe(new("local", track.Id))).ToArray();
        Require(Full && rows.Length >= 2, "Se necesitan al menos dos canciones para comprobar las portadas animadas.");
        var states = new List<object>();
        SongRow? animated = null, still = null;
        foreach (var row in rows) {
            await model.PlayCollectionAsync([row]); model.Tick(); ResetBigPicture();
            Require(await Wait(() => visualQueueId == model.Current?.Entry.QueueId && !sceneSwitching, 6000), "La escena no llegó a la canción de prueba.");
            RefreshMotion();
            bool shown = await Wait(() => MotionVisible && MotionPlaying, 7000);
            states.Add(new { row.Title, row.Album, shown });
            if (shown) animated ??= row; else still ??= row;
        }
        Require(animated != null, "Ninguna canción de prueba mostró su portada animada.");
        Require(still != null, "Todas las canciones mostraron vídeo: falta el caso sin portada animada.");
        await model.PlayCollectionAsync([animated!]); model.Tick(); ResetBigPicture();
        Require(await Wait(() => MotionVisible && MotionPlaying, 7000), "La portada animada no volvió al repetir su álbum.");
        var size = motionPlayer!.PlaybackSession; uint width = size.NaturalVideoWidth, height = size.NaturalVideoHeight;
        Require(motionPlayer.IsLoopingEnabled && motionPlayer.IsMuted && !motionPlayer.CommandManager.IsEnabled, "El vídeo no está en bucle, silenciado y fuera de los controles del sistema.");
        Require(motionPlayer.IsVideoFrameServerEnabled && motionFrame != null, "No se dibujó ningún fotograma en la superficie recortable.");
        Require(Math.Abs(motionView!.ActualWidth - artworkFrame.ActualWidth) < 1 && Math.Abs(motionView.ActualHeight - artworkFrame.ActualHeight) < 1, "El vídeo no ocupa el hueco de la portada.");
        int framesBefore = motionFramesDrawn;
        Require(await Wait(() => motionFramesDrawn >= framesBefore + 10, 4000), "La portada mostró una imagen fija en vez de vídeo.");
        // Position can stay at zero for this silent frame-server player. Decoder events beyond the
        // complete clip duration prove it loops instead of merely retaining its final frame.
        Require(size.NaturalDuration > TimeSpan.Zero, "No se obtuvo la duración del vídeo.");
        await Task.Delay(size.NaturalDuration + TimeSpan.FromMilliseconds(300));
        int afterClip = motionFramesDrawn;
        Require(await Wait(() => MotionPlaying && motionFramesDrawn >= afterClip + 10, 4000), "El vídeo dejó de entregar fotogramas después de la duración del clip.");
        await CaptureAsync(Path.Combine(directory, "motion-playing.png"));
        var cornerChecks = new List<object>();
        // Read pixels from the same GPU drawing path, at two cover sizes, including after a resize while paused.
        async Task CheckCorners(string name) {
            Require(motionFrame != null, "Se perdió el fotograma durante la prueba de esquinas.");
            int w = (int)Math.Round(motionView.ActualWidth), h = (int)Math.Round(motionView.ActualHeight);
            using var target = new CanvasRenderTarget(motionView, w, h, 96);
            using (var draw = target.CreateDrawingSession()) { draw.Clear(Microsoft.UI.Colors.Transparent); DrawMotionFrame(draw, new(0, 0, w, h)); }
            byte[] pixels = target.GetPixelBytes();
            int[] alpha = [pixels[3], pixels[(w - 1) * 4 + 3], pixels[((h - 1) * w) * 4 + 3], pixels[(h * w - 1) * 4 + 3]];
            Require(alpha.All(a => a == 0) && pixels[((h / 2) * w + w / 2) * 4 + 3] == 255, "El vídeo no tiene las cuatro esquinas transparentes y el centro opaco.");
            await target.SaveAsync(Path.Combine(directory, name + "-cover.png"), CanvasBitmapFileFormat.Png);
            cornerChecks.Add(new { w, h, alpha, radius = artworkFrame.CornerRadius.TopLeft });
        }
        await CheckCorners("motion-playing");
        int hold = Array.IndexOf(Environment.GetCommandLineArgs(), "--motion-hold");
        if (hold >= 0) await Task.Delay(int.Parse(Environment.GetCommandLineArgs()[hold + 1]));
        await model.ToggleAsync(); model.Tick(); UpdatePlayback();
        Require(await Wait(() => !MotionPlaying, 4000) && MotionVisible, "Pausar la música no detuvo el vídeo en su último fotograma.");
        await Task.Delay(250); int pausedFrames = motionFramesDrawn;
        await Task.Delay(500); Require(motionFramesDrawn == pausedFrames, "El renderizador siguió procesando vídeo en pausa.");
        AppWindow.SetPresenter(Microsoft.UI.Windowing.AppWindowPresenterKind.Overlapped); AppWindow.Resize(new(1100, 780));
        await Task.Delay(600); await CheckCorners("motion-paused-resized");
        await CaptureAsync(Path.Combine(directory, "motion-paused-resized.png"));
        await model.ToggleAsync(); model.Tick(); UpdatePlayback();
        Require(await Wait(() => MotionPlaying, 4000), "Reanudar la música no reanudó el vídeo.");
        await model.PlayCollectionAsync([still!]); model.Tick();
        Require(await Wait(() => visualQueueId == model.Current?.Entry.QueueId && !sceneSwitching && !MotionVisible, 6000), "El vídeo siguió visible en un álbum sin portada animada.");
        model.Settings.MotionArt = false;
        await model.PlayCollectionAsync([animated!]); model.Tick(); ResetBigPicture();
        Require(!await Wait(() => MotionVisible, 2500), "El ajuste desactivado no impidió la portada animada.");
        model.Settings.MotionArt = true; model.Settings.Effects = false; ResetBigPicture();
        Require(!await Wait(() => MotionVisible, 2500), "Sin movimiento ambiental siguió apareciendo la portada animada.");
        model.Settings.Effects = true; ResetBigPicture();
        Require(await Wait(() => MotionVisible && MotionPlaying, 7000), "Reactivar los ajustes no recuperó la portada animada.");
        string retryKey = MotionAlbum(animated!.Entry)!;
        HideMotion(); MotionKnown[retryKey] = new(null, Environment.TickCount64 + 350); RefreshMotion();
        Require(!MotionVisible, "Un resultado negativo no conservó la portada fija durante su espera.");
        Require(await Wait(() => MotionVisible && MotionPlaying, 5000), "El resultado negativo no venció sin cambiar de álbum.");
        Close();
        Require(await Wait(() => !MotionPlaying, 4000), "Cerrar la pantalla completa no detuvo el vídeo.");
        return new { states, width, height, framesDrawn = motionFramesDrawn, cornerChecks, loops = true, muted = true, pausesWithMusic = true, pausedRendererSleeps = true, negativeExpires = true, hiddenWithoutVideo = true, settingOff = true, effectsOff = true, closedStops = true };
    }
}
