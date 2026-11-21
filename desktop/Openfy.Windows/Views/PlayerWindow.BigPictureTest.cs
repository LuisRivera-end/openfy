using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Media;
using Openfy.Core;

namespace Openfy.Windows.Views;

public sealed partial class PlayerWindow
{
    // Isolated opt-in QA, driven by --visual-players --big-picture-check.
    internal async Task<object> VerifyBigPictureAsync(string directory)
    {
        void Require(bool condition, string message) { if (!condition) throw new InvalidOperationException(message); }
        async Task Until(Func<bool> condition, string message, int milliseconds = 10000) {
            long start = Environment.TickCount64;
            while (!condition() && Environment.TickCount64 - start < milliseconds) { model.Tick(); await Task.Delay(40); }
            Require(condition(), message);
        }
        var songs = model.Library.Tracks.Take(2).Select(track => model.Describe(new("local", track.Id))).ToArray();
        Require(Full && songs.Length == 2, "Se necesitan dos canciones para comprobar Big Picture.");
        await model.PlayCollectionAsync(songs); model.Engine.Pause(); model.Tick(); ResetBigPicture();
        await Task.Delay(250);
        play.Focus(FocusState.Keyboard); lastInteraction = Environment.TickCount64 - Immersive.IdleMilliseconds - 1;
        PictureTick(pictureTimer!, EventArgs.Empty);
        Require(!pictureIdle, "El dock se ocultó conservando el foco de teclado.");
        (header as Microsoft.UI.Xaml.Controls.Grid)?.Children.OfType<Microsoft.UI.Xaml.Controls.Button>().FirstOrDefault()?.Focus(FocusState.Programmatic);
        keyboardInput = false; pointerHeld = true; PictureTick(pictureTimer!, EventArgs.Empty);
        Require(!pictureIdle, "El dock se ocultó durante una pulsación sostenida.");
        pointerHeld = false; PictureActivity();
        await Until(() => !model.LyricsPending, "La letra de la prueba no terminó de cargarse.");
        await Task.Delay(Immersive.LayoutMilliseconds + 200);
        // Fixtures with synced lyrics use split; the rest keep the song alone in the centre over the same dock.
        bool split = model.Lyrics is { Status: "synced" };
        Require(layout == (split ? Immersive.Split : Immersive.Cover), $"Big Picture eligió {layout} para una letra {model.Lyrics?.Status ?? "ausente"}.");
        void RequireCentred(string state) {
            Require(Math.Abs(presentationArtBounds.X + presentationArtBounds.Width / 2 - pictureRoot!.ActualWidth / 2) < 2, $"La portada {state} sin letra sincronizada no está centrada.");
            Require(pictureLyricsView?.Visibility == Visibility.Collapsed && pictureLyricsSlot?.Visibility == Visibility.Collapsed, $"La columna de letras sigue visible en la portada {state}.");
        }
        await CaptureAsync(Path.Combine(directory, split ? "windows-full.png" : "windows-cover.png"));
        double normalSide = presentationArtBounds.Width, fullGap = presentationLyricsBounds.Left - presentationArtBounds.Right;
        if (split) Require(Math.Abs(presentationLyricsBounds.Top - presentationArtBounds.Top - presentationArtBounds.Height * Immersive.LyricsTop) < 1, "El tope de letras no coincide con el 20 % de la portada.");
        else RequireCentred("completa");
        await Task.Delay(Immersive.IdleMilliseconds + 400);
        Require(pictureIdle && PictureDocks.All(dock => ((FrameworkElement)dock.Children[0]).Visibility == Visibility.Collapsed), "El dock no se ocultó después de cuatro segundos en pausa.");
        Require(miniProgress?.Visibility == Visibility.Visible, "No apareció la línea compacta.");
        await CaptureAsync(Path.Combine(directory, split ? "windows-compact.png" : "windows-cover-compact.png"));
        Require(Math.Abs(presentationArtBounds.Width / normalSide - Immersive.CompactScale) < .01, "La portada compacta no aumentó un 20 %.");
        if (split) {
            Require(Math.Abs(presentationLyricsBounds.Top - presentationArtBounds.Top - presentationArtBounds.Height * Immersive.LyricsTop) < 1, "Las letras compactas perdieron el tope del 20 %.");
            Require(Math.Abs(presentationLyricsBounds.Left - presentationArtBounds.Right - fullGap) < 1, $"Las letras compactas no conservan la separación de la portada: {presentationLyricsBounds.Left - presentationArtBounds.Right:0} frente a {fullGap:0}.");
            Require(presentationLyricsBounds.Right <= pictureRoot!.ActualWidth - Immersive.SideMargin + 1, "Las letras compactas invaden el margen lateral.");
        }
        else RequireCentred("compacta");
        PictureActivity();
        Require(!pictureIdle && PictureDocks.All(dock => ((FrameworkElement)dock.Children[0]).Visibility == Visibility.Visible), "La actividad no recuperó el dock.");
        // A pointer drag writes the slider's value locally before the seek; the bar must keep following playback afterwards.
        var dockSeek = ((Microsoft.UI.Xaml.Controls.Panel)((Microsoft.UI.Xaml.Controls.Panel)seekBlock!).Children[0]).Children[0] as Microsoft.UI.Xaml.Controls.Slider ?? throw new InvalidOperationException("No se encontró la barra de Big Picture.");
        dockSeek.Value = 5; await model.SeekAsync(dockSeek.Value);
        if (!model.Playing) await model.ToggleAsync();
        await Until(() => model.Position > 7, "El audio no avanzó después de buscar desde la barra.");
        Require(Math.Abs(dockSeek.Value - model.Position) < .5, $"La barra de Big Picture dejó de seguir la reproducción después de buscar: {dockSeek.Value:0.0} s frente a {model.Position:0.0} s.");
        model.Engine.Pause(); model.Tick(); PictureActivity();
        async Task RequireEntry(bool compact) {
            var frames = new List<Immersive.CardBounds>();
            void Sample(object? sender, object args) { if (cardEntering) frames.Add(VisibleCardBounds()); }
            CompositionTarget.Rendering += Sample;
            try {
                await model.SeekAsync(Math.Max(0, model.Duration - 7)); model.Tick(); UpdatePicture();
                await Until(() => nextCard?.Visibility == Visibility.Visible && !cardMoving, "La entrada no terminó.", 1000);
            }
            finally { CompositionTarget.Rendering -= Sample; }
            var target = CardTarget();
            Require(pictureIdle == compact && frames.Count > 0, $"No hubo fotogramas de entrada (compacto: {pictureIdle}, movimiento: {PictureMotion}).");
            Require(Math.Abs(frames[0].X - pictureRoot!.ActualWidth) < 1 && frames[0].Y == target.Y, $"La entrada partió de {frames[0]} con ancho {pictureRoot.ActualWidth:0.0} y destino {target}.");
            Require(frames.Any(frame => frame.X < frames[0].X - 1 && frame.X > target.X + 1), "Faltó una posición intermedia en la entrada.");
            Require(frames.All(frame => frame.Y == target.Y), "La tarjeta se desplazó verticalmente durante la entrada.");
            Require(VisibleCardBounds() == target, "La entrada no terminó en las coordenadas previstas.");
        }
        await RequireEntry(false);
        await Until(() => nextCard?.Visibility == Visibility.Visible && nextCover?.Source != null, "Faltó la tarjeta o su portada precargada.");
        Require(previewSong?.Entry.QueueId == model.Queue[1].Entry.QueueId, "Se anunció otra aparición de la cola.");
        Require(nextCard!.Background == null && surface?.Failed == false, "La tarjeta perdió el fondo ambiental compartido.");
        Require(miniFill != null && miniProgress!.ActualWidth > 0, "La línea compacta perdió su geometría.");
        Require(previewBounds.Bottom < seekBlock!.TransformToVisual(pictureRoot).TransformPoint(default).Y, "La tarjeta tapa el dock.");
        await CaptureAsync(Path.Combine(directory, "windows-next-card.png"));
        var originalCard = previewBounds;
        Require(cardScale == 1 && previewBounds.Height == Immersive.CardHeight, "La tarjeta con controles no conserva su tamaño.");
        // Compact mode moves the card to the larger bottom-right corner version; activity brings it back above the dock.
        void RequireCorner() {
            var corner = Immersive.NextCardBounds(pictureRoot!.ActualWidth, pictureRoot.ActualHeight, 0, 0, 0, true, presentationColumnBounds?.Right, presentationColumnBounds?.Bottom);
            Require(Math.Abs(previewBounds.X - corner.X) < 1 && Math.Abs(previewBounds.Y - corner.Y) < 1 && Math.Abs(previewBounds.Width - corner.Width) < 1 && Math.Abs(cardScale - corner.Scale) < .001,
                $"La tarjeta compacta no ocupa la esquina inferior derecha: {previewBounds} frente a {corner}.");
            Require(Math.Abs(pictureRoot.ActualWidth - previewBounds.Right - Immersive.CornerMargin) < 1 && Math.Abs(pictureRoot.ActualHeight - previewBounds.Bottom - Immersive.CornerMargin) < 1, "La tarjeta compacta no respeta el margen de la esquina.");
            if (layout == Immersive.Split) Require(presentationLyricsBounds.Bottom <= previewBounds.Top - 15, "Las letras ampliadas invaden la tarjeta compacta.");
            // Without synced lyrics the card narrows (or shrinks) to keep AvoidGap beside the centred song; below 315 px an overlap is accepted.
            if (layout == Immersive.Cover && presentationColumnBounds is { } column && previewBounds.Top < column.Bottom && previewBounds.Width > Immersive.CardWidth * .75 + 1)
                Require(previewBounds.Left >= column.Right + Immersive.AvoidGap - 1, $"La tarjeta compacta invade la portada centrada: {previewBounds} frente a {column}.");
        }
        lastInteraction = Environment.TickCount64 - Immersive.IdleMilliseconds - 1; PictureTick(pictureTimer!, EventArgs.Empty);
        await Until(() => pictureIdle && !cardMoving && cardScale > 1, "La tarjeta no pasó a la esquina en reposo.");
        RequireCorner();
        await CaptureAsync(Path.Combine(directory, "windows-next-card-compact.png"));
        PictureActivity();
        await Until(() => !pictureIdle && !cardMoving && cardScale == 1, "La tarjeta no volvió sobre el dock con actividad.");
        Require(previewBounds == originalCard, "La tarjeta no recuperó su posición sobre el dock.");
        await model.SeekAsync(5); model.Tick(); UpdatePicture();
        Require(!cardMoving && nextCard.Visibility == Visibility.Collapsed, "La búsqueda dejó una tarjeta activa fuera del intervalo.");
        lastInteraction = Environment.TickCount64 - Immersive.IdleMilliseconds - 1; PictureTick(pictureTimer!, EventArgs.Empty);
        await RequireEntry(true);
        RequireCorner();
        await model.ToggleAsync(); PictureActivity();
        await Until(() => pictureIdle, "El dock no entró en reposo antes del cambio.", 5500);
        await Until(() => !cardMoving || promoting, "La tarjeta no terminó de moverse a la esquina.", 1000);
        if (!promoting) RequireCorner();
        await Until(() => promoting, "La tarjeta no se expandió al comenzar el tema anunciado.");
        await CaptureAsync(Path.Combine(directory, "windows-transition.png"));
        await Until(() => !promoting && visualQueueId == model.Queue[1].Entry.QueueId, "La escena final no corresponde al tema anunciado.");
        Require(pictureIdle && model.Playing, "La transición alteró el reposo o detuvo el audio.");
        await CaptureAsync(Path.Combine(directory, "windows-next-playing.png"));
        model.Settings.Effects = false;
        await model.PlayCollectionAsync(songs); model.Engine.Pause(); model.Tick(); ResetBigPicture();
        await model.SeekAsync(Math.Max(0, model.Duration - 1)); model.Tick(); UpdatePicture();
        Require(!cardMoving && nextCard.Visibility == Visibility.Visible && VisibleCardBounds() == CardTarget(), "La tarjeta no apareció directamente con los efectos desactivados.");
        await Until(() => nextCover?.Source != null, "No se preparó la portada con movimiento reducido.");
        await model.ToggleAsync();
        await Until(() => visualQueueId == model.Queue[1].Entry.QueueId, "El movimiento reducido bloqueó el cambio de escena.");
        Require(!promoting && flyingCover?.Visibility == Visibility.Collapsed, "El movimiento reducido conserva la expansión.");
        Close(); ShowView();
        Require(!pictureIdle && previewSong == null, "La reapertura conservó el estado de reposo o una tarjeta obsoleta.");
        object? followup = null;
        if (Environment.GetCommandLineArgs().Contains("--big-picture-followup")) followup = await VerifyBigPictureFollowupAsync(directory);
        return new { layout = split ? Immersive.Split : Immersive.Cover, idleWhilePaused = true, keyboardFocus = true, heldPointer = true, movementRestores = true, previewMatchesQueue = true, cardEntry = true, promotion = true, audioContinues = true, compactPreserved = true, reducedMotion = true, reopenResets = true, followup, renderer = Diagnostics };
    }

    private async Task<object> VerifyBigPictureFollowupAsync(string directory)
    {
        void Require(bool condition, string message) { if (!condition) throw new InvalidOperationException(message); }
        async Task Until(Func<bool> condition, string message, int milliseconds = 12000) {
            long start = Environment.TickCount64;
            while (!condition() && Environment.TickCount64 - start < milliseconds) { model.Tick(); await Task.Delay(30); }
            Require(condition(), message);
        }
        model.Settings.Effects = true;
        var songs = model.Library.Tracks.Take(2).Select(track => model.Describe(new("local", track.Id))).ToArray();
        foreach (bool preview in new[] { true, false }) {
            await model.PlayCollectionAsync(songs); model.Engine.Pause(); model.Tick(); ResetBigPicture();
            await model.SeekAsync(preview ? model.Duration - 2 : model.Duration / 2);
            await Until(() => model.Lyrics is { Status: "synced", Lines.Length: >= 30 }, "Faltan las letras largas incrustadas de la prueba.");
            layer.UpdateLayout();
            await Until(() => lyricsScroll.VerticalOffset > 500, "La letra saliente no alcanzó una posición inferior.");
            UpdateLyricsDepth();
            // The top edge fades like the bottom one: lines already past either edge are fully transparent.
            foreach (var row in lyricsPanel.Children.OfType<Microsoft.UI.Xaml.Controls.Button>()) {
                double rowY = row.TransformToVisual(lyricsPanel).TransformPoint(default).Y - lyricsScroll.VerticalOffset;
                if (rowY + row.ActualHeight <= 0 || rowY >= lyricsScroll.ViewportHeight) Require(row.Opacity == 0, "Un verso fuera de los bordes conserva opacidad.");
            }
            double outgoing = lyricsScroll.VerticalOffset;
            await model.AdvanceAsync(1);
            await Until(() => !promoting && !sceneSwitching && !HoldingBigPicture && visualQueueId == model.Queue[1].Entry.QueueId && model.Lyrics is { Status: "synced" }, "La canción siguiente no terminó de presentarse.");
            Require(lyricsScroll.VerticalOffset < 150 && !lyricsNeedSnap, $"La nueva letra conservó el desplazamiento anterior: {outgoing:0} → {lyricsScroll.VerticalOffset:0}.");
            await CaptureAsync(Path.Combine(directory, preview ? "lyrics-reset-preview.png" : "lyrics-reset-skip.png"));
        }
        model.Engine.Pause(); model.Tick(); ResetBigPicture();
        play.Focus(FocusState.Keyboard); keyboardInput = true; LeavePicture();
        lastInteraction = Environment.TickCount64 - Immersive.IdleMilliseconds - 1;
        PictureTick(pictureTimer!, EventArgs.Empty);
        Require(pictureIdle, "El foco anterior del teclado bloqueó el reposo al salir de Big Picture.");
        ResetBigPicture();
        pointerHeld = true; mouseHeld = true; PictureTick(pictureTimer!, EventArgs.Empty);
        Require(Openfy.Windows.Services.WindowsIntegration.PointerButtonsDown || !pointerHeld, "Se conservó una pulsación del ratón ya liberada fuera de la ventana.");
        PictureActivity(); play.Focus(FocusState.Keyboard);
        var other = new Window { Title = "Openfy QA · otra ventana", Content = new Microsoft.UI.Xaml.Controls.Grid() };
        try {
            other.AppWindow.Resize(new(320, 200)); other.Activate();
            await Until(() => !pictureActive, "No se recibió la pérdida de foco de la ventana.");
            Require(pictureTimer!.IsRunning, "Perder el foco detuvo el temporizador de reposo.");
            await Until(() => pictureIdle, "Big Picture no entró en reposo al usar otra ventana.", 5500);
            await CaptureAsync(Path.Combine(directory, "idle-other-window.png"));
        } finally { other.Close(); }
        Require(pictureIdle, "Recuperar el foco borró el reposo sin una interacción.");
        PictureActivity(); Require(!pictureIdle, "La actividad real no recuperó los controles.");
        return new { lyricsBeforeReveal = true, automaticAndManualSkip = true, pointerExit = true, lostMouseRelease = true, inactiveWindowIdle = true, focusDoesNotResetClock = true };
    }
}
