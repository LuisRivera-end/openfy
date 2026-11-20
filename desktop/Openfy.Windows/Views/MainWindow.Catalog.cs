using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Shapes;
using Openfy.Core;
using Openfy.Windows.ViewModels;

namespace Openfy.Windows.Views;

public sealed partial class MainWindow
{
    private string libraryTab = "songs", renderedCatalogPage = "";
    private bool applyingCatalogFilter;
    private Action? refreshCatalogFilter;

    private void BuildCatalog()
    {
        if (applyingCatalogFilter) return;
        if (model.Page == "search") {
            if (renderedCatalogPage != "search") DetachCatalog();
            renderedCatalogPage = "search"; trackSection.Visibility = Visibility.Collapsed; UpdateNavigation(); return;
        }
        UpdateSearchSurface();
        if (model.ContentLoading) { BuildLoadingCatalog(); return; }
        if (model.PageLoadError.Length > 0) {
            DetachCatalog(); renderedCatalogPage = "error:" + model.Page; trackSection.Visibility = Visibility.Collapsed; UpdateNavigation();
            catalog.Children.Add(CatalogEmptyState("offline", "No se pudo cargar esta sección.", model.PageLoadError));
            catalog.Children.Add(Ui.AsyncButton("Reintentar", model, model.RetryPageAsync)); return;
        }
        if (model.Page == "library" && renderedCatalogPage == "library" && renderedLibraryTab == libraryTab && LibraryViewCurrent(renderedLibraryView, LibraryFilterKey())) { UpdateNavigation(); return; }
        if (model.Page == "favorites" && renderedCatalogPage == "favorites" && ReferenceEquals(renderedFavoritesLibrary, model.Library)
            && ReferenceEquals(renderedFavoritesStatistics, model.Statistics) && renderedFavoritesFilter == FavoritesFilterKey()) {
            refreshCatalogFilter?.Invoke(); UpdateNavigation(); return;
        }
        if (model.Page == "downloads" && renderedCatalogPage == "downloads" && renderedDownloadsKey == DownloadsContentKey()) { UpdateNavigation(); return; }
        if (model.Page == "home" && renderedCatalogPage == "home" && renderedHomeKey == HomeContentKey()) { UpdateNavigation(); return; }
        var homeOffset = model.Page == "home" && renderedCatalogPage == "home" ? pageScroll.VerticalOffset : 0;
        var homeFocus = model.Page == "home" && root.XamlRoot != null && Microsoft.UI.Xaml.Input.FocusManager.GetFocusedElement(root.XamlRoot) is FrameworkElement focused ? AutomationProperties.GetAutomationId(focused) : null;
        DetachCatalog();
        if (model.Page == "localartist") _ = LoadArtistThemeAsync(ArtistThemeKey, model.CatalogArtwork);
        lastCatalogBuild = DateTime.UtcNow;
        refreshCatalogFilter = null;
        if (renderedCatalogPage != model.Page) pageScroll.ChangeView(null, 0, null, true);
        renderedCatalogPage = model.Page;
        UpdateNavigation();
        trackSection.Visibility = model.Songs.Count > 0 ? Visibility.Visible : Visibility.Collapsed;
        if (model.Page == "home") {
            trackSection.Visibility = Visibility.Collapsed;
            if (cachedHome != null && cachedHomeKey == HomeContentKey()) {
                foreach (var child in cachedHome) catalog.Children.Add(child);
                renderedHomeKey = cachedHomeKey; cachedHome = null;
            } else {
                if (cachedHome != null) { foreach (var child in cachedHome) Ui.ReleaseTree(child); cachedHome = null; }
                BuildHomeCatalog();
            }
            DispatcherQueue.TryEnqueue(() => {
                if (model.Page != "home") return;
                root.UpdateLayout(); pageScroll.ChangeView(null, homeOffset, null, true);
                if (!string.IsNullOrEmpty(homeFocus)) FindHomeFocus(catalog, homeFocus)?.Focus(FocusState.Programmatic);
            });
            return;
        }
        if (model.Page == "most-played") { BuildMostPlayedCatalog(); return; }
        if (model.Page == "settings") { trackSection.Visibility = Visibility.Collapsed; BuildSettingsCatalog(); return; }
        if (model.Page == "downloads") { BuildDownloadsCatalog(); return; }
        if (model.Page == "library") { if (!RestoreLibraryView()) BuildLibraryCatalog(); return; }
        if (model.Page is "search" or "localSearch") { BuildSearchCatalog(); return; }
        if (model.Page == "artist") { BuildArtistCatalog(); return; }
        if (model.Page == "favorites" && cachedFavorites != null) {
            if (ReferenceEquals(cachedFavoritesLibrary, model.Library) && ReferenceEquals(cachedFavoritesStatistics, model.Statistics) && cachedFavoritesFilter == FavoritesFilterKey()) {
                foreach (var child in cachedFavorites) catalog.Children.Add(child);
                renderedFavoritesLibrary = cachedFavoritesLibrary; renderedFavoritesStatistics = cachedFavoritesStatistics; renderedFavoritesFilter = cachedFavoritesFilter;
                refreshCatalogFilter = cachedFavoritesRefresh; cachedFavorites = null; cachedFavoritesRefresh = null;
                refreshCatalogFilter?.Invoke(); return;
            }
            foreach (var child in cachedFavorites) Ui.ReleaseTree(child);
            cachedFavorites = null; cachedFavoritesRefresh = null;
        }
        BuildCollectionCatalog();
    }
    private void DetachCatalog()
    {
        if (renderedCatalogPage == "library") CacheLibraryView();
        else if (renderedCatalogPage == "home" && model.Page != "home") {
            if (cachedHome != null) foreach (var child in cachedHome) Ui.ReleaseTree(child);
            cachedHome = catalog.Children.ToList(); cachedHomeKey = renderedHomeKey;
            catalog.Children.Clear();
        } else if (renderedCatalogPage == "favorites" && model.Page != "favorites") {
            if (cachedFavorites != null) foreach (var child in cachedFavorites) Ui.ReleaseTree(child);
            cachedFavorites = catalog.Children.ToList(); cachedFavoritesLibrary = renderedFavoritesLibrary;
            cachedFavoritesStatistics = renderedFavoritesStatistics; cachedFavoritesFilter = renderedFavoritesFilter;
            cachedFavoritesRefresh = refreshCatalogFilter; catalog.Children.Clear();
        } else ClearCatalogPanel(catalog);
        ClearCatalogPanel(catalogTail);
        // Every way out of a page passes here (search, errors, rebuilds): the artist wash and video follow the new page.
        SyncArtistSurface();
    }

    private static void ClearCatalogPanel(Panel panel)
    {
        foreach (var child in panel.Children) Ui.ReleaseTree(child);
        panel.Children.Clear();
    }

    private void LocalAlbum(string id) => _ = model.RunAsync(() => model.NavigateLocalAlbumAsync(id));
    private void LocalArtist(string name) => _ = model.RunAsync(() => model.NavigateLocalArtistAsync(name));

    private void BuildHomeCatalog() => BuildMusicHome();

    private FrameworkElement CatalogPageHeading(string greeting, string title, string? detail = null, Button? action = null)
    {
        var heading = new Grid { Margin = new Thickness(0, 0, 0, 25), ColumnSpacing = 20 };
        heading.ColumnDefinitions.Add(new() { Width = new GridLength(1, GridUnitType.Star) });
        heading.ColumnDefinitions.Add(new() { Width = GridLength.Auto });
        var copy = new StackPanel { Spacing = 10 };
        copy.Children.Add(Ui.Muted(greeting, 12)); var pageTitle = Ui.Text(title, 40, true); pageTitle.CharacterSpacing = -35; pageTitle.FontWeight = Microsoft.UI.Text.FontWeights.Bold; copy.Children.Add(pageTitle); heading.Children.Add(copy);
        if (action != null) { Grid.SetColumn(action, 1); action.VerticalAlignment = VerticalAlignment.Center; heading.Children.Add(action); }
        else if (detail != null)
        {
            var tag = Ui.Row(Ui.Icon("headphones", 16), Ui.Muted(detail, 10)); tag.Opacity = .75; tag.VerticalAlignment = VerticalAlignment.Center;
            Grid.SetColumn(tag, 1); heading.Children.Add(tag);
            SizeChangedEventHandler compact = (_, args) => tag.Visibility = args.NewSize.Width < 650 ? Visibility.Collapsed : Visibility.Visible;
            heading.SizeChanged += compact; Ui.OnRelease(heading, () => heading.SizeChanged -= compact);
        }
        return heading;
    }

    private void BuildLibraryCatalog()
    {
        catalog.Children.Add(CatalogPageHeading("Todo lo que te gusta, aquí", "Tu biblioteca", action: Ui.Button("+ Crear playlist", () => _ = model.RunAsync(CreatePlaylistAsync))));
        Action refreshPlayback = () => {};
        if (libraryTab == "songs") catalog.Children.Add(CollectionPlaybackControls(out refreshPlayback));
        var tabs = Ui.Wrap();
        foreach (var (key, name) in new[] { ("songs", "Canciones"), ("albums", "Álbumes"), ("artists", "Artistas") })
        {
            var tab = Ui.Button(name, () => { if (libraryTab == key) return; libraryTab = key; _ = model.RunAsync(() => model.NavigateLocalAsync("library", force: true)); });
            if (libraryTab == key) { tab.Background = Ui.Brush("#E9E9EA"); tab.Foreground = Ui.Brush("#131315"); }
            AutomationProperties.SetName(tab, "Ver " + name.ToLowerInvariant()); tabs.Children.Add(tab);
        }
        catalog.Children.Add(tabs);
        catalog.Children.Add(CollectionToolbar(out var refreshToolbar));
        var results = new StackPanel { Spacing = 12 }; catalog.Children.Add(results);
        refreshCatalogFilter = () => {
            refreshPlayback(); refreshToolbar();
            ClearCatalogPanel(results); trackSection.Visibility = libraryTab == "songs" && model.Songs.Count > 0 ? Visibility.Visible : Visibility.Collapsed;
            if (libraryTab == "albums")
            {
                var localAlbums = model.Library.Tracks.ToDictionary(track => track.Id, track => track.AlbumId);
                var albums = model.Songs.GroupBy(row => row.Entry.Source == "local" ? localAlbums.GetValueOrDefault(row.Key, row.Key) : MainViewModel.SavedAlbumKey(row.Entry.Song!)).ToArray();
                results.Children.Add(CatalogCards(albums.Select(album => new CatalogTile(album.First().Album, album.First().Artist, album.FirstOrDefault(track => track.Artwork != null)?.Artwork, () => LocalAlbum(album.Key)))));
                if (albums.Length == 0) results.Children.Add(CatalogEmptyState("music", "No hay álbumes aquí todavía.", "Importa tus archivos o prueba con otra búsqueda."));
            }
            else if (libraryTab == "artists")
            {
                var artists = model.Songs.GroupBy(track => track.Artist).OrderBy(group => group.Key).ToArray();
                results.Children.Add(CatalogCards(artists.Select(artist => new CatalogTile(artist.Key, artist.Count() + " canciones", artist.FirstOrDefault(track => track.Artwork != null)?.Artwork, () => LocalArtist(artist.Key), true))));
                if (artists.Length == 0) results.Children.Add(CatalogEmptyState("music", "No hay artistas que coincidan.", "Importa tus archivos o prueba con otro nombre."));
            }
            else if (model.Songs.Count == 0) results.Children.Add(model.Filters.Downloaded ? CollectionEmptyState() : CatalogEmptyState("music", model.LibraryFilter.Length > 0 ? "Ninguna canción coincide." : "Tu colección empieza contigo.", model.LibraryFilter.Length > 0 ? "Prueba con otro título, artista o álbum." : "Importa tus archivos desde el PC para empezar a escuchar.", model.Library.Tracks.Count == 0));
            renderedLibraryView = new([], [], refreshCatalogFilter, model.Library, model.Statistics, LibraryFilterKey());
        };
        refreshCatalogFilter();
        renderedLibraryView = new([], [], refreshCatalogFilter, model.Library, model.Statistics, LibraryFilterKey()); renderedLibraryTab = libraryTab;
    }

    private FrameworkElement CatalogFilterInput()
    {
        var filter = new CollectionSearchBox { Text = model.LibraryFilter, PlaceholderText = "Buscar en esta colección", MinWidth = 150, Height = 44, FontSize = 14, VerticalContentAlignment = VerticalAlignment.Center, CornerRadius = new CornerRadius(12), Background = Ui.Brush("#FFFFFF0A"), BorderBrush = Ui.Brush("#FFFFFF10") };
        AutomationProperties.SetName(filter, "Buscar en esta colección");
        TextChangedEventHandler changed = (_, _) => { applyingCatalogFilter = true; try { model.FilterLibrary(filter.Text); } finally { applyingCatalogFilter = false; } refreshCatalogFilter?.Invoke(); };
        filter.TextChanged += changed; Ui.OnRelease(filter, () => filter.TextChanged -= changed);
        filter.Padding = new(34, 0, 12, 0);
        var input = new Grid(); input.Children.Add(filter);
        var icon = Ui.Icon("search", 16); icon.HorizontalAlignment = HorizontalAlignment.Left; icon.VerticalAlignment = VerticalAlignment.Center; icon.Margin = new(12, 0, 0, 0); icon.IsHitTestVisible = false; input.Children.Add(icon);
        return input;
    }

    private void BuildSearchCatalog()
    {
        // Compatibility for a restored localSearch destination; collection filters now own local searching.
        catalog.Children.Add(CatalogSectionHeading("Canciones"));
        if (model.Songs.Count == 0) catalog.Children.Add(CatalogEmptyState("search", "No encontramos canciones.", "Prueba con otro título, artista o álbum."));
    }

    private void BuildCollectionCatalog()
    {
        if (model.Page is "favorites" or "playlist" or "localalbum" or "localartist") {
            BuildSavedCollection();
            if (model.Page == "favorites") { renderedFavoritesLibrary = model.Library; renderedFavoritesStatistics = model.Statistics; renderedFavoritesFilter = FavoritesFilterKey(); }
            return;
        }
        bool artist = model.Page is "artist" or "localartist";
        var copy = new StackPanel { Spacing = 13, VerticalAlignment = VerticalAlignment.Bottom };
        copy.Children.Add(Ui.Muted(model.CatalogKind, 12)); copy.Children.Add(Ui.Text(model.Heading, artist ? 54 : 48, true));
        string time = CatalogDuration(model.Songs.Sum(song => song.Duration));
        string detail = (model.CatalogSubtitle.Length > 0 ? model.CatalogSubtitle + " · " : "") + model.Songs.Count + " canciones" + (time.Length > 0 ? " · " + time : "");
        copy.Children.Add(Ui.Muted(detail, 12));
        var hero = CatalogHeroLayout(CatalogArtworkView(model.CatalogArtwork, 208, artist, model.Page == "favorites"), copy, 208); hero.Margin = new Thickness(0, 12, 0, 8); catalog.Children.Add(hero);
        if (model.Description.Length > 0)
        {
            var biography = Ui.Muted(model.Description, 13); biography.MaxWidth = 680; biography.HorizontalAlignment = HorizontalAlignment.Left; biography.LineHeight = 23; biography.MaxLines = 3; biography.TextTrimming = TextTrimming.CharacterEllipsis; catalog.Children.Add(biography);
            if (model.Description.Length > 240) catalog.Children.Add(Ui.Button("Más información", () => biography.MaxLines = biography.MaxLines == 3 ? 0 : 3));
        }
        var controls = Ui.Row(); controls.Spacing = 18; controls.Margin = new Thickness(0, 16, 0, 12);
        var play = Ui.PlayButton(() => { if (model.Songs.Count > 0) _ = model.RunAsync(() => model.PlayAsync(model.Songs[0], model.Songs.ToArray(), model.PageContext)); }, 56, true); AutomationProperties.SetName(play, "Reproducir esta colección"); play.IsEnabled = model.Songs.Count > 0; controls.Children.Add(play);
        if (model.CurrentOfflineKey != null) controls.Children.Add(Ui.AsyncButton(model.CollectionDownloadLabel, model, model.ToggleCollectionDownloadAsync));
        if (model.Page is "artist" or "album") controls.Children.Add(Ui.Button("Volver a buscar", ReturnToSearch));
        if (model.CurrentPlaylist is { } playlist)
        {
            controls.Children.Add(Ui.Button("Editar nombre", () => _ = model.RunAsync(async () => { var name = await AskAsync("Editar playlist", playlist.Name); if (name != null) await model.EditPlaylistAsync(playlist, name); })));
        }
        catalog.Children.Add(controls);
        if (artist)
        {
            if (model.Songs.Count > 0) catalog.Children.Add(CatalogSectionHeading("Canciones populares", model.MoreSongsAvailable ? "Ver todas las canciones" : null, () => _ = model.RunAsync(model.MoreAsync)));
        }
        else if (model.Songs.Count == 0 && model.Page == "album") catalog.Children.Add(CatalogEmptyState("music", "No hay canciones disponibles.", "Vuelve a buscar el álbum para actualizar su contenido."));
    }

    private void CatalogReleases(string title, IEnumerable<YouTubeAlbum> releases, bool singles)
    {
        var albums = releases.ToArray(); if (albums.Length == 0) return;
        catalogTail.Children.Add(CatalogSectionHeading(title, (singles ? model.MoreSinglesAvailable : model.MoreAlbumsAvailable) ? "Ver más" : null, () => _ = model.RunAsync(() => model.ReleasesAsync(singles))));
        catalogTail.Children.Add(CatalogCards(albums.Select(album => new CatalogTile(album.Title, (album.Year is { } year ? year + " · " : "") + (singles ? "Single / EP" : "Álbum"), album.Artwork, () => _ = model.RunAsync(() => model.AlbumAsync(album.Id))))));
    }

    private static Grid CatalogHeroLayout(FrameworkElement artwork, FrameworkElement copy, double size)
    {
        var hero = new Grid { ColumnSpacing = 30 };
        hero.ColumnDefinitions.Add(new() { Width = GridLength.Auto }); hero.ColumnDefinitions.Add(new() { Width = new GridLength(1, GridUnitType.Star) });
        hero.Children.Add(artwork); Grid.SetColumn(copy, 1); hero.Children.Add(copy);
        SizeChangedEventHandler resize = (_, args) => { double artSize = args.NewSize.Width < 650 ? Math.Min(150, size) : size; artwork.Width = artSize; artwork.Height = artSize; hero.ColumnSpacing = args.NewSize.Width < 650 ? 20 : 30; };
        hero.SizeChanged += resize; Ui.OnRelease(hero, () => hero.SizeChanged -= resize); return hero;
    }

    private FrameworkElement CatalogSectionHeading(string title, string? actionLabel = null, Action? action = null)
    {
        var heading = new Grid { Margin = new Thickness(0, 20, 0, 7), ColumnSpacing = 15 };
        heading.ColumnDefinitions.Add(new() { Width = new GridLength(1, GridUnitType.Star) }); heading.ColumnDefinitions.Add(new() { Width = GridLength.Auto });
        var text = Ui.Text(title, 19, true); text.VerticalAlignment = VerticalAlignment.Center; heading.Children.Add(text);
        if (actionLabel != null && action != null) {
            var button = Ui.Button(actionLabel, action); button.FontSize = 11; button.Background = Ui.Brush("#00000000"); button.BorderThickness = new Thickness(0);
            if (ArtistSurfacePage) StyleArtistCatalogButton(button);
            Grid.SetColumn(button, 1); heading.Children.Add(button);
        }
        return heading;
    }

    private FrameworkElement CatalogEmptyState(string icon, string title, string text, bool import = false)
    {
        var empty = new StackPanel { Spacing = 16, Padding = new Thickness(24, 46, 24, 52), HorizontalAlignment = HorizontalAlignment.Center, MaxWidth = 480 };
        var symbol = Ui.Icon(icon, 42); symbol.HorizontalAlignment = HorizontalAlignment.Center; symbol.Opacity = .5; empty.Children.Add(symbol);
        var heading = Ui.Text(title, 22, true); heading.TextAlignment = TextAlignment.Center; empty.Children.Add(heading); var description = Ui.Muted(text, 13); description.TextAlignment = TextAlignment.Center; description.LineHeight = 23; empty.Children.Add(description);
        if (ArtistSurfacePage) description.Foreground = Ui.Brush(ArtistSecondaryText);
        if (import) { var button = Ui.PrimaryButton("Importar música", () => _ = model.RunAsync(ImportAsync)); button.HorizontalAlignment = HorizontalAlignment.Center; empty.Children.Add(button); } return empty;
    }

    private FrameworkElement CatalogCard(string title, string subtitle, string? url, Action action, bool round = false)
    {
        catalogCardsCreated++;
        var button = Ui.Button(title, action); button.Padding = new Thickness(8); button.HorizontalContentAlignment = HorizontalAlignment.Stretch; button.HorizontalAlignment = HorizontalAlignment.Stretch; button.VerticalAlignment = VerticalAlignment.Top; button.Background = Ui.Brush("#00000000"); button.BorderThickness = new Thickness(0); button.CornerRadius = new CornerRadius(9);
        var panel = new StackPanel { Spacing = 9 }; var artwork = CatalogArtworkView(url, 148, round); artwork.Width = double.NaN; artwork.HorizontalAlignment = HorizontalAlignment.Stretch; artwork.Margin = new Thickness(0, 0, 0, 4); panel.Children.Add(artwork);
        panel.Children.Add(CatalogTruncatedText(title, 13, true));
        var detail = CatalogTruncatedText(subtitle, 12);
        if (ArtistSurfacePage) { detail.Foreground = Ui.Brush(ArtistSecondaryText); StyleArtistCatalogButton(button); }
        panel.Children.Add(detail); button.Content = panel; ToolTipService.SetToolTip(button, title);
        SizeChangedEventHandler resize = (_, args) => artwork.Height = Math.Max(80, args.NewSize.Width - 16);
        button.SizeChanged += resize; Ui.OnRelease(button, () => button.SizeChanged -= resize); return button;
    }

    // Thresholds assume 150 % scaling, the common Windows default; the server never upscales.
    private static int ArtworkRequest(double logical) => logical <= 85 ? 128 : logical <= 341 ? 512 : logical <= 682 ? 1024 : 2048;

    private Border CatalogArtworkView(string? url, double size, bool round = false, bool favorite = false, double height = 0, Action<string[]>? palette = null)
    {
        var artwork = new Grid(); var placeholder = Ui.Icon(favorite ? "heart" : "music", Math.Min(46, size * .4)); placeholder.HorizontalAlignment = HorizontalAlignment.Center; placeholder.VerticalAlignment = VerticalAlignment.Center; placeholder.Opacity = favorite ? 1 : .55; artwork.Children.Add(placeholder);
        if (favorite && placeholder is Viewbox box && box.Child is Panel shapes) foreach (var shape in shapes.Children.OfType<Shape>()) { shape.Fill = Ui.Brush("#FFFFFF"); shape.Stroke = Ui.Brush("#FFFFFF"); }
        var border = new Border { Width = size, Height = size, CornerRadius = new CornerRadius(round ? 1000 : 7), Background = favorite ? Ui.Gradient("#5142A4", "#A7BFB6") : Ui.Gradient("#28483E", "#151B23"), Child = artwork };
        if (!string.IsNullOrWhiteSpace(url))
        {
            bool released = false; Ui.OnRelease(border, () => released = true);
            var image = new Image { Stretch = Stretch.UniformToFill }; artwork.Children.Add(image);
            var failed = Ui.BeginArtworkLoad(image, placeholder);
            async Task Load()
            {
                // The border may be resized after creation (responsive grids, hero); read its final box at load time.
                double Box(double value, double actual, double fallback) => double.IsFinite(value) && value > 0 ? value : actual > 0 ? actual : fallback;
                double boxWidth = Box(border.Width, border.ActualWidth, size), boxHeight = Box(border.Height, border.ActualHeight, height > 0 ? height : size);
                try { var result = await model.Artwork.GetAsync(url, ArtworkRequest(Math.Max(boxWidth, boxHeight))); if (released) return; Ui.Cover(image, result.Path, Box(border.Width, border.ActualWidth, boxWidth), Box(border.Height, border.ActualHeight, boxHeight), result.Width, result.Height); if (result.Palette.Length > 0) palette?.Invoke(result.Palette); }
                catch { if (!released) failed(); }
            }
            _ = Load();
        }
        return border;
    }

    private static TextBlock CatalogTruncatedText(string text, double size, bool bold = false)
    {
        var block = bold ? Ui.Text(text, size, true) : Ui.Muted(text, size); block.TextWrapping = TextWrapping.NoWrap; block.TextTrimming = TextTrimming.CharacterEllipsis; return block;
    }

    private static Grid CatalogResponsiveGrid(double minimum, double gap, int maximumColumns = int.MaxValue)
    {
        var grid = new Grid { HorizontalAlignment = HorizontalAlignment.Stretch, ColumnSpacing = gap, RowSpacing = 24 }; int previousColumns = -1, previousCount = -1;
        void Layout(double width)
        {
            int columns = Math.Max(1, Math.Min(maximumColumns, (int)Math.Floor((Math.Max(minimum, width) + gap) / (minimum + gap))));
            if (columns == previousColumns && previousCount == grid.Children.Count) return; previousColumns = columns; previousCount = grid.Children.Count;
            grid.ColumnDefinitions.Clear(); grid.RowDefinitions.Clear();
            for (int i = 0; i < columns; i++) grid.ColumnDefinitions.Add(new() { Width = new GridLength(1, GridUnitType.Star) });
            for (int i = 0; i < (grid.Children.Count + columns - 1) / columns; i++) grid.RowDefinitions.Add(new() { Height = GridLength.Auto });
            for (int i = 0; i < grid.Children.Count; i++) { var item = (FrameworkElement)grid.Children[i]; Grid.SetColumn(item, i % columns); Grid.SetRow(item, i / columns); item.Margin = new Thickness(0); }
        }
        SizeChangedEventHandler resize = (_, args) => Layout(args.NewSize.Width); RoutedEventHandler loaded = (_, _) => Layout(grid.ActualWidth);
        grid.SizeChanged += resize; grid.Loaded += loaded; Ui.OnRelease(grid, () => { grid.SizeChanged -= resize; grid.Loaded -= loaded; }); return grid;
    }

    private IEnumerable<IGrouping<string, TrackInfo>> LocalAlbumGroups() => model.Library.Tracks.OrderByDescending(track => track.AddedAt).GroupBy(track => track.AlbumId);
    private void PlayCatalogTracks(IEnumerable<TrackInfo> tracksToPlay)
    {
        var songs = tracksToPlay.Select(track => model.Describe(new("local", track.Id))).ToArray(); if (songs.Length > 0) _ = model.RunAsync(() => model.PlayAsync(songs[0], songs, model.PageContext));
    }
    private static string CatalogDuration(double seconds) => seconds <= 0 ? "" : seconds >= 3600 ? $"{(int)(seconds / 3600)} h {(int)(seconds % 3600 / 60)} min" : $"{Math.Max(1, (int)(seconds / 60))} min";
}
