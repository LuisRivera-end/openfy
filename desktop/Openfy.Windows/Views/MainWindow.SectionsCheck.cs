using System.Diagnostics;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media.Imaging;
using Openfy.Core;
using Openfy.Windows.ViewModels;
using Windows.Graphics.Imaging;
using Windows.Storage;

namespace Openfy.Windows.Views;

public sealed partial class MainWindow
{
    internal async Task<object> CheckSectionsPerformanceAsync()
    {
        model.SeedNavigationCheck(558, 500, varied: true);
        model.Settings.Effects = false;
        var samples = new List<object>();
        var headers = new Dictionary<string, UIElement[]>();
        var tables = new Dictionary<string, ListView>();
        int changes = 0;
        System.Collections.Specialized.NotifyCollectionChangedEventHandler changed = (_, _) => changes++;
        var observedSongs = model.Songs;
        observedSongs.CollectionChanged += changed;
        System.ComponentModel.PropertyChangedEventHandler sourceChanged = (_, args) => { if (args.PropertyName == nameof(model.Songs)) { observedSongs.CollectionChanged -= changed; observedSongs = model.Songs; observedSongs.CollectionChanged += changed; } };
        model.PropertyChanged += sourceChanged;
        var yield = model.YieldForNavigationAsync; bool captureLoading = true;
        model.YieldForNavigationAsync = async () => { await yield(); if (captureLoading) { captureLoading = false; await CaptureSectionAsync("skeleton-library"); } };
        try {
            foreach (var target in new[] { "library", "favorites", "library", "favorites", "library", "playlist", "home", "downloads", "settings" }) {
                changes = 0;
                var clock = Stopwatch.StartNew(); var operation = model.NavigateLocalAsync(target, target == "playlist" ? "performance-playlist" : null);
                double requestMs = clock.Elapsed.TotalMilliseconds; bool skeleton = model.ContentLoading;
                await operation; double readyMs = clock.Elapsed.TotalMilliseconds;
                clock.Restart(); root.UpdateLayout(); double layoutMs = clock.Elapsed.TotalMilliseconds;
                await Task.Delay(80);
                if (target is "library" or "favorites") {
                    if (tables.TryGetValue(target, out var table) && (!ReferenceEquals(table, tracks) || changes != 0 || !headers[target].SequenceEqual(catalog.Children))) throw new IOException("Biblioteca y Favoritas reconstruyen sus controles al volver sin cambios.");
                    tables[target] = tracks; headers[target] = catalog.Children.ToArray();
                }
                samples.Add(new { target, requestMs, readyMs, layoutMs, skeleton, changes, songs = model.Songs.Count });
            }
            model.ShowLocal("library");
            foreach (var tab in new[] { "albums", "artists", "songs" }) {
                var clock = Stopwatch.StartNew(); libraryTab = tab; int created = catalogCardsCreated;
                var operation = model.NavigateLocalAsync("library", force: true); double requestMs = clock.Elapsed.TotalMilliseconds;
                await operation; root.UpdateLayout(); double readyMs = clock.Elapsed.TotalMilliseconds;
                await Task.Delay(80);
                int cardsCreated = catalogCardsCreated - created;
                samples.Add(new { target = "library/" + tab, requestMs, readyMs, cardsCreated });
                if (cardsCreated >= 100) throw new IOException("La biblioteca construye tarjetas fuera de la ventana visible.");
                if (tab == "albums") await CaptureSectionAsync("library-albums");
                if (tab is "albums" or "artists") {
                    var grid = Ui.Find<GridView>(catalog) ?? throw new IOException("Falta la cuadrícula virtualizada.");
                    grid.ScrollIntoView(grid.Items[grid.Items.Count - 1]); await Task.Delay(100); root.UpdateLayout();
                    if (grid.ContainerFromIndex(grid.Items.Count - 1) == null) throw new IOException("No se puede recorrer la colección hasta el final.");
                    var elements = catalog.Children.ToArray();
                    await model.NavigateLocalAsync("favorites"); await model.NavigateLocalAsync("library"); root.UpdateLayout();
                    if (!elements.SequenceEqual(catalog.Children) || libraryTab != tab) throw new IOException("La biblioteca pierde la pestaña o reconstruye las tarjetas al volver.");
                }
            }
            var first = model.NavigateLocalAsync("playlist", "performance-playlist");
            await model.NavigateLocalAsync("favorites"); await first;
            if (model.Page != "favorites" || model.Songs.Count != 500 || model.ContentLoading) throw new IOException("Una navegación cancelada sustituyó la sección actual.");
        } finally { observedSongs.CollectionChanged -= changed; model.PropertyChanged -= sourceChanged; model.YieldForNavigationAsync = yield; }
        var network = await CheckDelayedSectionsAsync();
        foreach (var album in model.Library.SavedSongs.Take(20).Where((_, index) => index % 2 == 0)) { await model.NavigateLocalAlbumAsync(MainViewModel.SavedAlbumKey(album.Song)); root.UpdateLayout(); }
        if (trackTables.Count > 6 || localRowCacheCount > 6) throw new IOException("Las vistas de canciones crecen sin límite.");
        int beforeReturn = skeletonPresentations;
        await model.NavigateLocalAsync("favorites"); root.UpdateLayout();
        bool evictedViewReloaded = skeletonPresentations > beforeReturn && model.Songs.Count == 500;
        if (!evictedViewReloaded) throw new IOException("Una vista retirada de la caché no presenta su carga al volver.");
        return new { passed = true, samples, network, evictedViewReloaded, skeletonPresentations, cachedTables = trackTables.Count, cachedRows = localRowCacheCount };
    }
    private int localRowCacheCount => model.LocalRowViewCount;
    private async Task CaptureSectionAsync(string name)
    {
        root.UpdateLayout(); var bitmap = new RenderTargetBitmap(); await bitmap.RenderAsync(root);
        var pixels = global::System.Runtime.InteropServices.WindowsRuntime.WindowsRuntimeBufferExtensions.ToArray(await bitmap.GetPixelsAsync());
        var folder = await StorageFolder.GetFolderFromPathAsync(model.Store.Root); var file = await folder.CreateFileAsync(name + ".png", CreationCollisionOption.ReplaceExisting);
        using var stream = await file.OpenAsync(FileAccessMode.ReadWrite); var encoder = await BitmapEncoder.CreateAsync(BitmapEncoder.PngEncoderId, stream);
        encoder.SetPixelData(BitmapPixelFormat.Bgra8, BitmapAlphaMode.Premultiplied, (uint)bitmap.PixelWidth, (uint)bitmap.PixelHeight, 96, 96, pixels); await encoder.FlushAsync();
    }
    private async Task<object> CheckDelayedSectionsAsync()
    {
        await using var fixture = new SectionFixtureServer();
        using var checkApi = new BackendClient(); checkApi.SetPort(fixture.Port);
        var originalApi = model.SwapCheckBackend(checkApi);
        try {
            int before = skeletonPresentations;
            var artist = model.ArtistAsync("fixture-artist"); await Task.Delay(80);
            bool artistSkeleton = model.Page == "artist" && model.ContentLoading && skeletonPresentations > before;
            await CaptureSectionAsync("skeleton-artist"); await artist;
            if (!artistSkeleton || model.ContentLoading || model.Songs.Count != 30) throw new IOException("El artista no muestra su estado de carga.");
            int requests = fixture.ArtistRequests; await model.NavigateLocalAsync("favorites"); await model.ArtistAsync("fixture-artist");
            bool reusedArtist = requests == fixture.ArtistRequests;
            var abandoned = model.AlbumAsync("abandoned"); await model.NavigateLocalAsync("favorites"); await abandoned;
            bool cancelledAlbum = model.Page == "favorites" && model.Songs.Count == 500;
            var album = model.AlbumAsync("fixture-album"); await Task.Delay(60); bool albumSkeleton = model.ContentLoading; await album;
            if (!albumSkeleton || model.Songs.Count != 30) throw new IOException("El álbum no muestra su estado de carga.");
            model.Query = "prueba"; var search = model.SearchAsync(); await Task.Delay(220);
            bool partialSearch = model.Songs.Count > 0 && model.SearchAlbumsLoading;
            await CaptureSectionAsync("search-partial"); await search;
            var integratedSearch = await CheckIntegratedSearchAsync(fixture);
            var ranking = model.ShowMostPlayedAsync(); await Task.Delay(40); bool rankingSkeleton = model.ContentLoading; await ranking;
            await Task.Delay(80); root.UpdateLayout();
            if (!DownloadText(catalog).Contains("Todos los artistas")) throw new IOException("El filtro de artista no muestra su etiqueta.");
            await CaptureSectionAsync("ranking-ready");
            model.Filters.Query = "slow"; var slow = model.LoadRankingAsync(); model.Filters.Query = "fast"; var fast = model.LoadRankingAsync(); await Task.WhenAll(slow, fast);
            bool latestRanking = model.Ranking.Items.FirstOrDefault()?.Item.Title == "fast";
            model.Filters.Query = "slow"; var oldRanking = model.LoadRankingAsync(); await model.NavigateLocalAsync("favorites"); await oldRanking;
            bool cancelledRanking = model.Page == "favorites" && model.Songs.Count == 500;
            await model.ArtistAsync("failure"); await Task.Delay(40); root.UpdateLayout(); bool errorRecovered = !model.ContentLoading && model.PageLoadError.Length > 0 && DownloadText(catalog).Contains("Reintentar");
            await model.NavigateLocalAsync("library"); bool leftError = model.PageLoadError.Length == 0 && model.Page == "library";
            if (!reusedArtist || !cancelledAlbum || !partialSearch || !rankingSkeleton || !latestRanking || !cancelledRanking || !errorRecovered || !leftError) throw new IOException($"Carga de secciones: caché={reusedArtist}, álbum cancelado={cancelledAlbum}, búsqueda parcial={partialSearch}, ranking={rankingSkeleton}/{latestRanking}/{cancelledRanking}, error={errorRecovered}/{leftError}.");
            return new { artistSkeleton, albumSkeleton, rankingSkeleton, partialSearch, reusedArtist, cancelledAlbum, latestRanking, cancelledRanking, errorRecovered, leftError, integratedSearch };
        } finally { model.SwapCheckBackend(originalApi); }
    }
}
