using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;

namespace Openfy.Windows.Views;

public sealed partial class MainWindow
{
    private async Task<object> CheckIntegratedSearchAsync(SectionFixtureServer fixture)
    {
        async Task Until(Func<bool> ready) { for (int i = 0; i < 60 && !ready(); i++) await Task.Delay(50); if (!ready()) throw new IOException($"La búsqueda no completó la carga esperada: categoría={searchCategory}, canciones={model.Songs.Count}, scroll={ActiveSearchScroll()?.VerticalOffset}/{ActiveSearchScroll()?.ScrollableHeight}, viewport={ActiveSearchScroll()?.ViewportHeight}, carga={model.SearchState(searchCategory).Loading}, más={model.SearchHasMore(searchCategory)}."); }
        if (searchTabs.Count != 4 || navButtons.ContainsKey("search") || searchSurface.Visibility != Visibility.Visible || pageScroll.Visibility != Visibility.Collapsed)
            throw new IOException("La búsqueda conserva navegación duplicada o scroll anidado.");
        if (model.Songs.Count != 20 || fixture.SearchContinuations != 0) throw new IOException("Todo carga continuaciones en segundo plano.");
        await CaptureSectionAsync("search-summary");
        double available = searchSurface.ActualHeight;
        await model.RunAsync(() => Task.FromException(new IOException("Aviso de reproducción de prueba"))); root.UpdateLayout();
        if (!DownloadText(shellNotices).Contains("Aviso de reproducción de prueba") || searchSurface.ActualHeight >= available) throw new IOException("La búsqueda oculta los avisos generales.");
        await model.RunAsync(() => Task.CompletedTask); root.UpdateLayout();
        SelectSearchCategory("song"); await Task.Delay(120); root.UpdateLayout();
        await CaptureSectionAsync("search-songs-initial");
        var source = searchSongRows.ItemsSource;
        ActiveSearchScroll()?.ChangeView(null, ActiveSearchScroll()!.ScrollableHeight, null, true);
        await Until(() => model.Songs.Count == 30 && !model.SearchSongsLoading); root.UpdateLayout();
        if (!ReferenceEquals(source, searchSongRows.ItemsSource)) throw new IOException("La continuación sustituye la lista de canciones.");
        int realized = Enumerable.Range(0, model.Songs.Count).Count(i => searchSongRows.ContainerFromIndex(i) != null);
        if (realized == 0 || Ui.Find<ItemsStackPanel>(searchSongRows) == null || searchSongRows.ActualHeight >= model.Songs.Count * 60) throw new IOException("La búsqueda no mantiene un viewport acotado y un panel virtualizado.");
        await CaptureSectionAsync("search-songs");
        ActiveSearchScroll()?.ChangeView(null, 200, null, true); await Task.Delay(100);
        double offset = ActiveSearchScroll()?.VerticalOffset ?? 0; int before = fixture.SearchRequests;
        await model.ArtistAsync("fixture-artist"); ReturnToSearch(); await Task.Delay(180);
        if (model.Page != "search" || searchCategory != "song" || model.Songs.Count != 30 || Math.Abs((ActiveSearchScroll()?.VerticalOffset ?? 0) - offset) > 2 || fixture.SearchRequests != before)
            throw new IOException($"Volver del artista pierde la categoría, resultados o posición: página={model.Page}, categoría={searchCategory}, canciones={model.Songs.Count}, posición={ActiveSearchScroll()?.VerticalOffset}/{offset}, solicitudes={fixture.SearchRequests - before}.");
        SelectSearchCategory("artist"); await Task.Delay(150); ActiveSearchScroll()?.ChangeView(null, ActiveSearchScroll()!.ScrollableHeight, null, true);
        await Until(() => model.Artists.Count == 12 && !model.SearchArtistsLoading);
        SelectSearchCategory("album"); await Task.Delay(150); ActiveSearchScroll()?.ChangeView(null, ActiveSearchScroll()!.ScrollableHeight, null, true);
        await Until(() => model.Albums.Count == 12 && !model.SearchAlbumsLoading);
        await CaptureSectionAsync("search-albums");
        var sample = model.Songs[0].Entry.Song!;
        for (int i = 0; i < 200; i++) model.Songs.Add(model.Describe(new("youtube", Song: sample with { VideoId = $"stress{i:00000}", Title = "Canción de prueba " + i })));
        SelectSearchCategory("song"); await Task.Delay(200); root.UpdateLayout();
        int stressRealized = Enumerable.Range(0, model.Songs.Count).Count(i => searchSongRows.ContainerFromIndex(i) != null);
        if (stressRealized <= 0 || stressRealized >= 150) throw new IOException($"La lista materializa demasiadas filas: {stressRealized}/{model.Songs.Count}.");
        model.Query = ""; model.EmptySearch(); root.UpdateLayout();
        if (searchCategory != "all" || model.Songs.Count != 0 || model.Artists.Count != 0 || model.Albums.Count != 0 || !DownloadText(searchOverview).Contains("¿Qué quieres escuchar?"))
            throw new IOException("Limpiar no recupera la búsqueda vacía.");
        return new { passed = true, songContinuations = 1, artistContinuations = 1, albumContinuations = 1, realized, stressSongs = 230, stressRealized, restoredOffset = offset, empty = true };
    }
}

