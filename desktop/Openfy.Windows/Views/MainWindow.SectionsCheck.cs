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
            var artistExit = await CheckArtistExitAsync(fixture);
            if (!reusedArtist || !cancelledAlbum || !partialSearch || !rankingSkeleton || !latestRanking || !cancelledRanking || !errorRecovered || !leftError) throw new IOException($"Carga de secciones: caché={reusedArtist}, álbum cancelado={cancelledAlbum}, búsqueda parcial={partialSearch}, ranking={rankingSkeleton}/{latestRanking}/{cancelledRanking}, error={errorRecovered}/{leftError}.");
            return new { artistSkeleton, albumSkeleton, rankingSkeleton, partialSearch, reusedArtist, cancelledAlbum, latestRanking, cancelledRanking, errorRecovered, leftError, integratedSearch, artistExit };
        } finally { model.SwapCheckBackend(originalApi); }
    }

    /// <summary>
    /// Leaves a transparent artist page through the same controls a person uses, with the clicked control, the
    /// search box and the top bar held in their pointer/focus visual states, so a page change that rewrites the
    /// resources those states resolve fails here instead of in the installed app.
    /// </summary>
    private async Task<object> CheckArtistExitAsync(SectionFixtureServer fixture)
    {
        // Ordinary rows and buttons fall back to the theme colours: they must resolve, or hover feedback disappears.
        foreach (string key in ArtistTrackBackgroundKeys.Concat(AlbumButtonStateKeys).Append("ButtonBackgroundDisabled"))
            if (StateBrushes.ThemeColor(key).A == 0) throw new IOException($"El tema no resuelve el color de {key}.");
        string transparency = model.Settings.Transparency;
        model.Settings.Transparency = "on"; UpdatePlaybackTransparency();
        var routes = new List<object>();
        // TextBox PointerOver and Focused share one state group, so each route holds one of them.
        string searchState = "PointerOver";
        try {
            var exits = new[] { ("home", false), ("home", true), ("library", false), ("downloads", false), ("most-played", false) };
            for (int i = 0; i < exits.Length; i++) {
                var (target, cached) = exits[i];
                searchState = i % 2 == 0 ? "PointerOver" : "Focused";
                await OpenArtistFromSearchAsync();
                if (target == "home" && !cached && cachedHome != null) { foreach (var child in cachedHome) Ui.ReleaseTree(child); cachedHome = null; }
                else if (cached && !CanReuseLocalCatalog(target)) throw new IOException($"{target} no conserva su vista para volver desde el artista.");
                var (visible, skeleton) = await LeaveArtistAsync(navButtons[target], target);
                if (cached && skeleton) throw new IOException($"{target} volvió a cargar pese a estar en caché.");
                routes.Add(new { target, cached, searchState, skeleton, visible });
            }

            searchState = "Focused";
            await OpenArtistFromSearchAsync();
            int albumRequests = fixture.AlbumRequests;
            var open = FindButton(artistLatestRelease, "Abrir Álbum del artista") ?? FindButton(catalogTail, "Abrir Álbum del artista")
                ?? throw new IOException("La ficha de artista no muestra su álbum.");
            var (albumText, albumSkeleton) = await LeaveArtistAsync(open, "album");
            if (fixture.AlbumRequests != albumRequests + 1 || model.Songs.Count != 30)
                throw new IOException($"El álbum abierto desde el artista no se cargó: solicitudes={fixture.AlbumRequests - albumRequests}, canciones={model.Songs.Count}.");
            // Rows reused from the artist list keep the brushes registered when their container was created.
            var row = tracks.ContainerFromIndex(0) as ListViewItem;
            var rowButtons = (row?.ContentTemplateRoot as Grid)?.Children.OfType<Button>().ToArray() ?? [];
            if (row == null || StateBrushes.Of(row)?.Has(ArtistTrackBackgroundKeys) != true || rowButtons.Length != 2 || rowButtons.Any(button => StateBrushes.Of(button)?.Has(AlbumButtonStateKeys) != true))
                throw new IOException($"Las filas del álbum no conservan sus pinceles de estado: fila={row != null}, contenedor={(row == null ? null : StateBrushes.Of(row)?.Has(ArtistTrackBackgroundKeys))}, botones={rowButtons.Length}/{rowButtons.Count(button => StateBrushes.Of(button)?.Has(AlbumButtonStateKeys) == true)}.");
            routes.Add(new { target = "album", cached = false, searchState, skeleton = albumSkeleton, visible = albumText });

            searchState = "PointerOver";
            await OpenArtistFromSearchAsync();
            await LeaveArtistAsync(navButtons["home"], "home");
            bool clearedAfterHome = await ClearSearchAsync();
            searchState = "Focused";
            await OpenArtistFromSearchAsync();
            bool clearedOnArtist = await ClearSearchAsync();
            if (!clearedAfterHome || !clearedOnArtist) throw new IOException($"La X no dejó el buscador limpio y enfocado: tras Inicio={clearedAfterHome}, en el artista={clearedOnArtist}.");
            var (after, _) = await LeaveArtistAsync(navButtons["library"], "library", fromArtist: false);
            return new { routes, clearedAfterHome, clearedOnArtist, operativeAfterClear = after };
        } finally { model.Settings.Transparency = transparency; UpdatePlaybackTransparency(); }

        async Task OpenArtistFromSearchAsync()
        {
            // TextChanged is raised asynchronously: let the box empty first so the query is typed again from scratch.
            if (search.Text.Length > 0) { search.Text = ""; await WaitForAsync(() => model.Page == "search" && model.Query.Length == 0, "La búsqueda no se vació."); }
            search.Text = "Rauw";
            await WaitForAsync(() => model.Page == "search" && model.Query == "Rauw" && !model.Busy, "La búsqueda no responde.");
            await model.ArtistAsync("fixture-artist");
            await WaitForAsync(() => model.Page == "artist" && !model.ContentLoading && !model.Busy, "La ficha de artista no termina de cargar.");
            if (!TopBarGlass) throw new IOException("La barra superior del artista no usa la transparencia activada.");
            await Task.Delay(60); root.UpdateLayout();
        }

        async Task<(int Texts, bool Skeleton)> LeaveArtistAsync(Button control, string page, bool fromArtist = true)
        {
            if (fromArtist && model.Page != "artist") throw new IOException("La prueba no partió de la ficha de artista.");
            int skeletons = skeletonPresentations;
            HoldPointerStates(searchState);
            VisualStateManager.GoToState(control, "Pressed", false);
            new Microsoft.UI.Xaml.Automation.Peers.ButtonAutomationPeer(control).Invoke();
            VisualStateManager.GoToState(control, "PointerOver", false);
            await WaitForAsync(() => model.Page == page && !model.ContentLoading && !model.Busy, $"No se pudo abrir {page} desde el artista.");
            HoldPointerStates(searchState);
            await WaitForAsync(() => { root.UpdateLayout(); return !renderedCatalogPage.StartsWith("loading:", StringComparison.Ordinal) && catalog.ActualHeight > 0 && pageScroll.ActualHeight > 0; }, $"{page} no termina de presentarse.");
            if (TopBarGlass) throw new IOException($"{page} conserva la barra superior del artista.");
            if (model.Error.Length > 0 || model.PageLoadError.Length > 0) throw new IOException($"{page} terminó con error: {model.Error}{model.PageLoadError}");
            int texts = DownloadText(catalog).Concat(DownloadText(catalogTail)).Concat(DownloadText(trackLayout)).Count(text => text.Trim().Length > 0);
            if (texts == 0 || renderedCatalogPage.StartsWith("loading:", StringComparison.Ordinal) || catalog.Children.Count == 0 || catalog.ActualHeight <= 0 || pageScroll.ActualHeight <= 0)
                throw new IOException($"{page} quedó vacío o cargando al salir del artista ({renderedCatalogPage}).");
            return (texts, skeletonPresentations > skeletons);
        }

        async Task<bool> ClearSearchAsync()
        {
            if (clearSearchButton.Visibility != Visibility.Visible) throw new IOException("La X del buscador no está disponible.");
            HoldPointerStates(searchState);
            new Microsoft.UI.Xaml.Automation.Peers.ButtonAutomationPeer(clearSearchButton).Invoke();
            await WaitForAsync(() => search.Text.Length == 0 && model.Query.Length == 0 && !model.Busy, "La X no limpió la búsqueda.");
            HoldPointerStates("Focused");
            await Task.Delay(80); root.UpdateLayout();
            return clearSearchButton.Visibility == Visibility.Collapsed && search.FocusState != FocusState.Unfocused && model.Error.Length == 0;
        }
    }

    /// <summary>What a pointer resting on the top bar (or focus in the search box) leaves while the page changes.</summary>
    private void HoldPointerStates(string searchState)
    {
        if (!VisualStateManager.GoToState(search, searchState, false)) throw new IOException($"El buscador no entra en el estado {searchState}.");
        foreach (var button in new[] { topbarImport, topbarAvatar, topbarBack }.Where(button => button.Visibility == Visibility.Visible))
            if (!VisualStateManager.GoToState(button, "PointerOver", false)) throw new IOException("Un botón superior no entra en PointerOver.");
        foreach (var button in navButtons.Values) VisualStateManager.GoToState(button, "PointerOver", false);
    }

    private static Button? FindButton(DependencyObject parent, string name)
    {
        if (parent is Button button && Microsoft.UI.Xaml.Automation.AutomationProperties.GetName(button) == name) return button;
        for (int i = 0; i < Microsoft.UI.Xaml.Media.VisualTreeHelper.GetChildrenCount(parent); i++)
            if (FindButton(Microsoft.UI.Xaml.Media.VisualTreeHelper.GetChild(parent, i), name) is { } found) return found;
        return null;
    }

    private async Task WaitForAsync(Func<bool> condition, string failure)
    {
        var clock = Stopwatch.StartNew();
        while (!condition()) {
            if (clock.ElapsedMilliseconds > 6000) throw new IOException($"{failure} página={model.Page}, cargando={model.ContentLoading}, ocupado={model.Busy}, consulta={model.Query}, texto={search.Text}, error={model.PageLoadError}{model.Error}.");
            await Task.Delay(25);
        }
    }
}
