using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Openfy.Core;
using Openfy.Windows.Services;

namespace Openfy.Windows.Views;

public sealed partial class MainWindow
{
    // Runs only under --visual-check --visual-collections-only with isolated data/state.
    private async Task CheckCollectionsAsync(Func<string, Task> capture, Dictionary<string, object> steps)
    {
        void Require(bool condition, string message) { if (!condition) throw new InvalidOperationException(message); }
        IEnumerable<FrameworkElement> Elements(DependencyObject node) {
            if (node is FrameworkElement element) yield return element;
            for (int i = 0; i < VisualTreeHelper.GetChildrenCount(node); i++) foreach (var child in Elements(VisualTreeHelper.GetChild(node, i))) yield return child;
        }
        model.ShowLocal("favorites");
        Require(Elements(catalog).OfType<Button>().Any(button => Microsoft.UI.Xaml.Automation.AutomationProperties.GetName(button) == "Descargar favoritas"), "Falta el botón para descargar todas las favoritas.");
        Require(model.PageContext?.Kind == "favorites" && model.ItemContext?.Kind == "favorites", "Favoritas perdió su contexto de escucha.");
        Require(model.Songs.Count > 0, "Se necesita una biblioteca de revisión poblada.");
        Require(model.Filters.Artist == "" && model.Filters.Genre == "" && model.Filters.Source == "all" && !model.Filters.Favorite, "Persisten filtros retirados.");
        foreach (int width in new[] { 1360, 960, 780 }) {
            AppWindow.Resize(WindowsIntegration.Scaled(this, width, width == 1360 ? 940 : 760));
            await capture("collections-favorites-" + width);
            var input = Elements(catalog).OfType<CollectionSearchBox>().Single();
            var placeholder = Elements(input).FirstOrDefault(element => element.Name == "PlaceholderTextContentPresenter");
            Require(placeholder?.VerticalAlignment == VerticalAlignment.Center, "El placeholder no está centrado.");
            Require(Elements(catalog).OfType<ComboBox>().Count() == 0, "La colección conserva filtros avanzados.");
        }
        var originalPosition = AppWindow.Position;
        foreach (var display in WindowsIntegration.Displays()) {
            AppWindow.Move(new(display.Work.Left + 20, display.Work.Top + 20));
            await Task.Delay(200);
            int dpi = WindowsIntegration.Dpi(this);
            AppWindow.Resize(WindowsIntegration.Scaled(this, 960, 760));
            await capture("collections-display-" + dpi + "-" + steps.Count);
        }
        AppWindow.Move(originalPosition);
        AppWindow.Resize(WindowsIntegration.Scaled(this, 780, 760));
        var titleBefore = model.UnfilteredSongs.Length;
        var field = Elements(catalog).OfType<CollectionSearchBox>().Single();
        field.Focus(FocusState.Programmatic); field.Text = "Horizonte";
        await capture("collections-search-typed");
        Require(ReferenceEquals(field, Elements(catalog).OfType<CollectionSearchBox>().Single()), "Escribir reconstruyó el campo y perdió el foco.");
        Require(Elements(field).First(element => element.Name == "ContentElement").VerticalAlignment == VerticalAlignment.Center, "El texto escrito no está centrado.");
        field.Text = "NO-MATCH-OPENFY"; await capture("collections-search-empty");
        Require(model.Songs.Count == 0 && model.UnfilteredSongs.Length == titleBefore, "La búsqueda cambió el total de la colección.");
        model.FilterLibrary(""); model.UpdateFilters(filter => filter.Downloaded = true); await capture("collections-downloaded");
        Require(model.Songs.All(song => model.Library.IsDownloaded(song.Entry)), "El filtro de descargas incluye música sin descargar.");
        model.FilterLibrary("NO-MATCH-OPENFY"); await capture("collections-downloads-empty");
        Require(model.Songs.Count == 0, "La búsqueda no se combinó con descargas.");
        model.ResetFilters();
        if (model.Library.Playlists.FirstOrDefault() is { } playlist) {
            model.ShowLocal("playlist", playlist.Id);
            await capture("collections-long-playlist");
            AppWindow.Resize(WindowsIntegration.Scaled(this, 1360, 940)); await capture("collections-playlist-wide");
        }
        // Exercise the actual native queue initializer with valid local assets, muted.
        model.ShowLocal("library"); model.UpdateFilters(filter => filter.Downloaded = true);
        var rows = model.Songs.Where(song => song.Entry.Source == "local").Take(3).ToArray();
        Require(rows.Length > 0, "Faltan archivos locales para verificar la cola."); model.Volume = 0;
        await model.PlayCollectionAsync(rows, true, new("favorites")); model.Engine.Pause();
        Require(model.Queue.All(song => song.Entry.Context?.Kind == "favorites"), "El inicio aleatorio perdió el contexto.");
        Require(model.ShuffleEnabled && model.Queue.Count == rows.Length, "El inicio aleatorio perdió canciones o no activó el modo.");
        Require(model.Queue.Select(song => song.Key).Order().SequenceEqual(rows.Select(song => song.Key).Order()), "La cola contiene canciones ajenas al resultado.");
        var current = model.Current!.Entry.QueueId;
        model.Shuffle(); Require(!model.ShuffleEnabled && model.Current!.Entry.QueueId == current, "Desactivar aleatorio cambió la canción actual.");
        Require(model.Queue.All(song => song.Entry.Context?.Kind == "favorites"), "Desactivar aleatorio cambió el contexto.");
        Require(model.Queue.Skip(1).Select(song => song.Key).SequenceEqual(rows.Where(song => song.Entry.TrackId != model.Current!.Entry.TrackId).Select(song => song.Key)), "No se restauró el orden de las pendientes.");
        await model.PlayCollectionAsync(rows); model.Engine.Pause();
        Require(model.Queue.All(song => song.Entry.Context == null), "Una reproducción sin origen heredó un contexto anterior.");
        Require(!model.ShuffleEnabled && model.Queue.Select(song => song.Key).SequenceEqual(rows.Select(song => song.Key)), "La reproducción normal no restauró el orden.");
        await model.PlayCollectionAsync(rows.Take(1), true); model.Engine.Pause();
        Require(model.Queue.Count == 1 && model.ShuffleEnabled, "Falló aleatorio con una canción.");
        await model.PlayCollectionAsync([]); Require(model.Queue.Count == 1, "Una colección vacía alteró la cola.");
        await model.PlayAsync(rows[0], context: new("playlist", "context-check")); model.Engine.Pause();
        model.Enqueue(rows[0], new("song")); model.Enqueue(rows[0], null);
        Require(model.Queue.Select(song => song.Entry.Context?.Kind).SequenceEqual(new string?[] { "playlist", "song", null }), "La misma canción perdió sus orígenes independientes.");
        var contexts = model.Queue.ToDictionary(song => song.Entry.QueueId!, song => song.Entry.Context);
        model.Shuffle();
        Require(model.Queue.All(song => song.Entry.Context == contexts[song.Entry.QueueId!]), "Aleatorio mezcló los orígenes de canciones repetidas.");
        await model.PersistAsync();
        var savedQueue = await model.Store.ReadAsync<PlaybackSnapshot>("playback");
        Require(savedQueue != null, "No se guardó la cola de revisión.");
        await model.RestoreAsync(savedQueue!);
        Require(model.Queue.All(song => song.Entry.Context == contexts[song.Entry.QueueId!]) && !model.Playing, "Restaurar perdió los orígenes o inició audio.");
        steps["collection-playback"] = new { shuffled = true, restored = true, single = true, empty = true, contexts = true };
        // Real audio and the durable listening client must produce mixed recent cards.
        var sample = rows[0];
        var sampleTrack = model.Library.Tracks.Single(track => track.Id == sample.Entry.TrackId);
        var samplePlaylist = model.Library.Playlists.First();
        foreach (var target in new[] { "favorites", "playlist", "localalbum", "localartist", "song" }) {
            if (target == "localalbum") model.ShowLocalAlbum(sampleTrack.AlbumId);
            else if (target == "localartist") model.ShowLocalArtist(sampleTrack.Artist);
            else model.ShowLocal(target == "song" ? "localSearch" : target, target == "playlist" ? samplePlaylist.Id : null);
            var context = target == "song" ? model.ItemContext : model.PageContext;
            Require(context != null, "La página de revisión no tiene origen.");
            await model.PlayAsync(sample, context: context);
            await Task.Delay(700); model.Tick(); model.Engine.Pause();
            await model.Listening.CheckpointAsync(); await model.Listening.FlushAsync();
        }
        if (rows.Length > 1) {
            await model.PlayAsync(rows[1], context: new("song")); await Task.Delay(700); model.Tick(); model.Engine.Pause();
            await model.Listening.CheckpointAsync(); await model.Listening.FlushAsync();
        }
        await model.RefreshListeningAsync();
        Require(new[] { "favorites", "playlist", "album", "artist", "song" }.All(kind => model.RecentListening.Items.Any(card => card.Kind == kind)), "Faltan orígenes en las tarjetas recientes.");
        Require(model.RecentListening.Items.Select(card => card.Key).Distinct().Count() == model.RecentListening.Items.Length, "Hay tarjetas recientes duplicadas.");
        model.ShowLocal("home"); await capture("recent-context-cards");
        if (rows.Length > 1) {
            var button = FindHomeFocus(catalog, "Escuchado recientemente:" + sample.Key);
            Require(button != null, "Falta la tarjeta de canción reciente.");
            var peer = Microsoft.UI.Xaml.Automation.Peers.FrameworkElementAutomationPeer.CreatePeerForElement(button!);
            ((Microsoft.UI.Xaml.Automation.Provider.IInvokeProvider)peer.GetPattern(Microsoft.UI.Xaml.Automation.Peers.PatternInterface.Invoke)).Invoke();
            for (int i = 0; i < 100 && model.Current?.Key != sample.Key; i++) await Task.Delay(50);
            Require(model.Current?.Key == sample.Key && model.Queue.All(song => song.Entry.Context?.Kind == "song"), "La tarjeta reciente reprodujo otra canción o heredó un origen.");
            model.Engine.Pause();
        }
        steps["recent-contexts"] = new { listening = true, mixedCards = true, independentQueueOrigins = true, restored = true };
        model.ResetFilters(); await capture("collections-library");
        await model.ShowMostPlayedAsync(); await capture("collections-ranking");
        Require(Elements(catalog).OfType<ComboBox>().Count() >= 4, "El ranking perdió sus filtros.");
    }
}
