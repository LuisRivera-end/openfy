using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Shapes;
using Openfy.Core;
using Openfy.Windows.Services;
using Openfy.Windows.ViewModels;
using Color = global::Windows.UI.Color;

namespace Openfy.Windows.Views;

public sealed partial class MainWindow
{
    private string libraryTab = "songs", renderedCatalogPage = "";
    private bool applyingCatalogFilter;
    private Action? refreshCatalogFilter;
    private static readonly AlbumTint NeutralAlbumTint = AlbumTint.From(null);
    private SolidColorBrush albumTrackSurface => frameSurface;
    private SolidColorBrush albumMuted => frameMuted;
    private readonly SolidColorBrush albumPrimary = Ui.Brush("#F4F4F5");
    private readonly SolidColorBrush albumFocus = Ui.Brush("#6DED9A");
    private readonly Dictionary<string, long> failedAlbumVideos = [];
    private AlbumTint albumTintTarget = NeutralAlbumTint;
    private long albumDominantAfter;
    private string? albumWashKey, albumCoverSource, albumDominant, albumTintInput, albumVideoUrl;
    private Border? albumCover;
    private LoopingVideo? albumVideo;
    private long albumVideoStarted, albumVideoElapsed;
    private bool albumDialogOpen;
    private Action? refreshAlbumDescription;
    private bool AlbumSurfacePage => model.Page is "album" or "localalbum";
    private bool CompactAlbum => AlbumSurfacePage && pageScroll.ActualWidth < 560;
    private string? AlbumPageKey => AlbumSurfacePage ? model.Page + ":" + model.PageContext?.Id : null;
    private bool PageEffects => model.Settings.Effects && WindowsIntegration.AnimationsEnabled;

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
        ClearCatalogPanel(artistPopularHeading);
        ClearCatalogPanel(artistLatestRelease);
        layoutLatestRelease = null;
        LayoutArtistReleases();
        // Search, errors, and rebuilds all pass through here.
        SyncAlbumSurface();
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
        if (model.Page == "album") BuildAlbumPage(local: false);
    }

    private void BuildAlbumPage(bool local)
    {
        string title = model.Heading;
        var header = new StackPanel();
        var back = new HyperlinkButton { Content = local ? "Volver a la biblioteca" : "Volver a buscar", Foreground = albumPrimary, Padding = new(0), Margin = new(0, 0, 0, 12) };
        back.Click += (_, _) => { if (local) NavigateLocal("library"); else ReturnToSearch(); };
        AlbumFocus(back);
        header.Children.Add(back);

        string? coverSource = model.CatalogArtwork;
        Border? cover = null;
        cover = CatalogArtworkView(coverSource, 224, opened: async prepared => {
            if (coverSource == null || cover != albumCover) return;
            var dominant = await ArtistThemes.LoadAlbumDominantAsync(coverSource, prepared);
            if (cover == null || cover != albumCover) return;
            albumDominant = dominant;
            UpdateAlbumTint();
        });
        cover.CornerRadius = new(12);
        cover.Tag = "home-artwork";
        albumCover = cover;
        if (albumVideo != null)
        {
            var view = albumVideo.View;
            (view.Parent as Panel)?.Children.Remove(view);
            ((Grid)cover.Child).Children.Add(view);
        }
        var copy = new StackPanel { VerticalAlignment = VerticalAlignment.Top };
        var heading = Ui.Text(title, 44, true);
        heading.Tag = "display";
        heading.FontWeight = Microsoft.UI.Text.FontWeights.Bold;
        heading.CharacterSpacing = -30;
        copy.Children.Add(heading);
        if (model.CatalogAlbumArtists.Length > 0)
        {
            var credits = Ui.Wrap();
            credits.Margin = new(0, 4, 0, 0);
            foreach (var artist in model.CatalogAlbumArtists)
            {
                if (string.IsNullOrWhiteSpace(artist.Name)) continue;
                if (artist.Id != null || local && model.Library.Tracks.Any(track => track.Artist == artist.Name))
                {
                    var credit = new HyperlinkButton { Content = artist.Name, Foreground = albumPrimary, FontSize = 17, Padding = new(0) };
                    credit.Click += (_, _) => { if (artist.Id is { } artistId) _ = model.RunAsync(() => model.ArtistAsync(artistId)); else LocalArtist(artist.Name); };
                    AlbumFocus(credit);
                    credits.Children.Add(credit);
                }
                else credits.Children.Add(new TextBlock { Text = artist.Name, FontSize = 17, LineHeight = 23, Tag = "display", Foreground = albumPrimary });
            }
            copy.Children.Add(credits);
        }
        if (model.CatalogAlbumYear is > 0 and var year)
            copy.Children.Add(new TextBlock { Text = year.ToString(), Foreground = albumMuted, FontSize = 13, LineHeight = 18, Tag = "display", Margin = new(0, 4, 0, 0) });
        copy.Children.Add(BuildAlbumDescription(title));
        header.Children.Add(CatalogHeroLayout(cover, copy, heading));

        var actions = CollectionPlaybackControls(out var refreshPlayback);
        actions.Margin = new(0, 20, 0, 0);
        if (model.CurrentOfflineKey != null)
        {
            var download = Ui.AsyncButton(model.CollectionDownloadLabel, model, model.ToggleCollectionDownloadAsync);
            StyleAlbumButton(download);
            actions.Children.Add(download);
        }
        header.Children.Add(actions);
        var songs = model.UnfilteredSongs;
        string time = songs.All(song => double.IsFinite(song.Duration) && song.Duration > 0) ? CatalogDuration(songs.Sum(song => song.Duration)) : "";
        var summary = new TextBlock { Text = (songs.Length == 1 ? "1 canción" : $"{songs.Length} canciones") + (time.Length > 0 ? " · " + time : ""),
            FontSize = 13, Tag = "display", Foreground = albumMuted, Margin = new(0, 24, 0, 4) };
        header.Children.Add(summary);
        catalog.Children.Add(header);

        Action? refreshToolbar = null;
        if (local) catalog.Children.Add(CollectionToolbar(out refreshToolbar));
        var empty = new StackPanel();
        catalog.Children.Add(empty);
        refreshCatalogFilter = () => {
            refreshPlayback();
            refreshToolbar?.Invoke();
            ClearCatalogPanel(empty);
            trackSection.Visibility = model.Songs.Count > 0 ? Visibility.Visible : Visibility.Collapsed;
            empty.Visibility = model.Songs.Count == 0 ? Visibility.Visible : Visibility.Collapsed;
            if (model.Songs.Count == 0) empty.Children.Add(local ? CollectionEmptyState()
                : CatalogEmptyState("music", "No hay canciones disponibles.", "Vuelve a buscar el álbum para actualizar su contenido."));
        };
        refreshCatalogFilter();
        refreshAlbumDescription?.Invoke();
        albumHeaderTimer?.Start();
        SyncAlbumVideo();
    }

    private FrameworkElement BuildAlbumDescription(string title)
    {
        var block = new StackPanel { Spacing = 4, Margin = new(0, 12, 0, 0), Visibility = Visibility.Collapsed };
        var preview = new TextBlock { Tag = "display", FontSize = 14, LineHeight = 21, Foreground = albumMuted,
            TextWrapping = TextWrapping.Wrap, MaxLines = 3, TextTrimming = TextTrimming.CharacterEllipsis, HorizontalAlignment = HorizontalAlignment.Left };
        var more = new HyperlinkButton { Content = "Más", Foreground = albumPrimary, Padding = new(0), Visibility = Visibility.Collapsed };
        AutomationProperties.SetHelpText(more, "Abre un diálogo con la descripción del álbum");
        AlbumFocus(more);
        block.Children.Add(preview);
        block.Children.Add(more);
        preview.IsTextTrimmedChanged += (_, _) => more.Visibility = preview.IsTextTrimmed ? Visibility.Visible : Visibility.Collapsed;

        var measure = new TextBlock { FontFamily = preview.FontFamily, FontSize = preview.FontSize,
            Text = new string('0', 65), IsTextScaleFactorEnabled = false };
        void MeasureWidth()
        {
            measure.Measure(new(double.PositiveInfinity, double.PositiveInfinity));
            preview.MaxWidth = measure.DesiredSize.Width * albumAccessibility.TextScaleFactor;
        }
        block.Loaded += (_, _) => MeasureWidth();
        albumAccessibility.TextScaleFactorChanged += TextScaleChanged;
        void TextScaleChanged(global::Windows.UI.ViewManagement.UISettings sender, object args)
            => DispatcherQueue.TryEnqueue(() => { if (block.IsLoaded) MeasureWidth(); });
        Ui.OnRelease(block, () => albumAccessibility.TextScaleFactorChanged -= TextScaleChanged);
        MeasureWidth();

        more.Click += async (_, _) => {
            if (model.CatalogAlbumDescription is not { } description || albumDialogOpen) return;
            double offset = pageScroll.VerticalOffset;
            albumDialogOpen = true;
            SyncAlbumVideo();
            try {
                var full = Ui.Text(description.Text, 14);
                full.LineHeight = 21; full.IsTextSelectionEnabled = true;
                var source = Ui.Muted(description.Source == "apple" ? "Texto de Apple Music" : "Texto de YouTube Music", 13);
                var text = new StackPanel { Spacing = 16, Children = { full, source } };
                var scroll = new ScrollViewer { Content = text, VerticalScrollBarVisibility = ScrollBarVisibility.Auto,
                    MaxHeight = Math.Clamp(root.ActualHeight - 220, 120, 440) };
                await new ContentDialog { Title = title, Content = scroll, CloseButtonText = "Cerrar", XamlRoot = root.XamlRoot }.ShowAsync();
            }
            finally {
                albumDialogOpen = false;
                if (more.IsLoaded) {
                    more.Focus(FocusState.Programmatic);
                    pageScroll.ChangeView(null, offset, null, true);
                }
                SyncAlbumVideo();
            }
        };

        refreshAlbumDescription = () => {
            var text = model.CatalogAlbumDescription?.Text ?? "";
            if (preview.Text == text) return;
            double before = trackScroll.TransformToVisual(pageScroll).TransformPoint(new(0, 0)).Y;
            bool anchor = block.IsLoaded && trackSection.Visibility == Visibility.Visible && pageScroll.VerticalOffset > 0
                && before < pageScroll.ViewportHeight;
            preview.Text = text;
            block.Visibility = text.Length == 0 ? Visibility.Collapsed : Visibility.Visible;
            if (!anchor) return;
            DispatcherQueue.TryEnqueue(() => {
                if (!block.IsLoaded) return;
                root.UpdateLayout();
                double after = trackScroll.TransformToVisual(pageScroll).TransformPoint(new(0, 0)).Y;
                pageScroll.ChangeView(null, pageScroll.VerticalOffset + after - before, null, true);
            });
        };
        return block;
    }

    private void SyncAlbumSurface()
    {
        albumCover = null;
        refreshAlbumDescription = null;
        albumHeaderTimer?.Stop();
        string? key = AlbumPageKey;
        if (albumWashKey != key || albumCoverSource != model.CatalogArtwork || model.ContentLoading || model.PageLoadError.Length > 0)
        {
            ReleaseAlbumVideo();
            if (albumWashKey == null || key == null)
            {
                albumTintInput = null;
                albumTintTarget = NeutralAlbumTint;
            }
            if (key != null && albumWashKey != key) pageScroll.ChangeView(null, 0, null, true);
            albumWashKey = key;
            albumCoverSource = model.CatalogArtwork;
            albumDominant = key != null && !model.ContentLoading ? ArtistThemes.CachedAlbumDominant(albumCoverSource) : null;
            albumDominantAfter = Environment.TickCount64 + 800;
        }
        UpdateAlbumTint();
    }

    private void UpdateAlbumTint()
    {
        if (!AlbumSurfacePage) return;
        string? color = model.ContentLoading ? null : model.AlbumArtworkColor;
        if (color == null && !model.ContentLoading && (!model.AlbumMetadataLoading || Environment.TickCount64 >= albumDominantAfter))
            color = albumDominant;
        if (color != albumTintInput)
        {
            albumTintInput = color;
            albumTintTarget = AlbumTint.From(color);
        }
        UpdateFrameTint();
    }

    private void AlbumFocus(FrameworkElement control)
    {
        control.FocusVisualPrimaryBrush = albumFocus;
        control.FocusVisualPrimaryThickness = new(2);
        control.FocusVisualSecondaryThickness = new(0);
        control.FocusVisualMargin = new(-2);
    }

    private void StyleAlbumButton(Button button)
    {
        button.Foreground = albumPrimary;
        button.Background = albumTrackSurface;
        button.BorderThickness = new(0);
        button.MinHeight = 48;
        button.Resources["ButtonBackgroundPointerOver"] = albumTrackSurface;
        button.Resources["ButtonBackgroundPressed"] = albumTrackSurface;
        AlbumFocus(button);
    }

    private void SyncAlbumVideo()
    {
        if (albumCover is not { } cover || albumWashKey != AlbumPageKey || !cover.IsLoaded) return;
        if (!model.Settings.MotionArt || !PageEffects || MeteredNetwork(requireUnrestricted: true))
        {
            ReleaseAlbumVideo();
            return;
        }
        var position = cover.TransformToVisual(pageScroll).TransformPoint(new(0, 0));
        bool onScreen = Visible && AppWindow.IsVisible && WindowsIntegration.Visible(WindowsIntegration.Handle(this))
            && pageScroll.Visibility == Visibility.Visible && position.Y + cover.ActualHeight > 0 && position.Y < pageScroll.ViewportHeight
            && position.X + cover.ActualWidth > 0 && position.X < pageScroll.ViewportWidth && !albumDialogOpen
            && (root.XamlRoot == null || VisualTreeHelper.GetOpenPopupsForXamlRoot(root.XamlRoot).Count == 0);
        long now = Environment.TickCount64;
        if (!onScreen)
        {
            if (albumVideoStarted != 0) albumVideoElapsed += now - albumVideoStarted;
            albumVideoStarted = 0;
            albumVideo?.Pause();
            return;
        }
        var url = model.AlbumMotion is { Status: "ready" } motion ? motion.Url : null;
        if (albumVideoUrl != url) ReleaseAlbumVideo();
        if (albumVideo is { } existing)
        {
            albumVideoStarted = albumVideoStarted == 0 ? now : albumVideoStarted;
            if (!existing.Visible && albumVideoElapsed + now - albumVideoStarted >= 8_000)
            {
                FailAlbumVideo(url!, retryAt: now + 15 * 60_000);
                return;
            }
            existing.Play();
            return;
        }
        if (string.IsNullOrEmpty(url))
        {
            _ = model.RequestAlbumMotionAsync();
            return;
        }
        if (failedAlbumVideos.GetValueOrDefault(url) > now || !Uri.TryCreate(model.Api.Http.BaseAddress, url, out var source)) return;
        var video = new LoopingVideo(DispatcherQueue) { VerticalAnchor = .5, Fade = true, FadeMilliseconds = 160 };
        albumVideo = video;
        albumVideoUrl = url;
        albumVideoStarted = now;
        ((Grid)cover.Child).Children.Add(video.View);
        video.Failed += () => {
            if (ReferenceEquals(albumVideo, video)) FailAlbumVideo(url);
        };
        try { video.Show(source); video.Play(); }
        catch (Exception) { FailAlbumVideo(url); }
    }

    private void FailAlbumVideo(string url, long retryAt = long.MaxValue)
    {
        if (albumWashKey != AlbumPageKey || model.AlbumMotion?.Url != url)
        {
            ReleaseAlbumVideo();
            return;
        }
        bool retry = model.InvalidateAlbumMotionForRetry(url);
        if (!retry) failedAlbumVideos[url] = retryAt;
        ReleaseAlbumVideo();
        if (retry) _ = model.RequestAlbumMotionAsync();
    }

    private void ReleaseAlbumVideo()
    {
        var video = albumVideo;
        albumVideo = null;
        albumVideoUrl = null;
        albumVideoStarted = albumVideoElapsed = 0;
        if (video == null) return;
        (video.View.Parent as Panel)?.Children.Remove(video.View);
        video.Release();
    }

    private void CatalogReleases(string title, IEnumerable<YouTubeAlbum> releases, bool singles)
    {
        var albums = releases.ToArray(); if (albums.Length == 0) return;
        catalogTail.Children.Add(CatalogSectionHeading(title, (singles ? model.MoreSinglesAvailable : model.MoreAlbumsAvailable) ? "Ver más" : null, () => _ = model.RunAsync(() => model.ReleasesAsync(singles))));
        catalogTail.Children.Add(CatalogCards(albums.Select(album => new CatalogTile(album.Title, (album.Year is { } year ? year + " · " : "") + (singles ? "Single / EP" : "Álbum"), album.Artwork, () => _ = model.RunAsync(() => model.AlbumAsync(album.Id))))));
    }

    private Grid CatalogHeroLayout(FrameworkElement artwork, FrameworkElement copy, TextBlock title)
    {
        var hero = new Grid();
        hero.ColumnDefinitions.Add(new() { Width = GridLength.Auto }); hero.ColumnDefinitions.Add(new() { Width = new GridLength(1, GridUnitType.Star) });
        hero.RowDefinitions.Add(new() { Height = GridLength.Auto }); hero.RowDefinitions.Add(new() { Height = GridLength.Auto });
        hero.Children.Add(artwork); hero.Children.Add(copy);
        void Layout()
        {
            double width = pageScroll.ActualWidth;
            bool compact = width < 560, wide = width >= 720;
            double size = compact ? Math.Max(0, Math.Min(216, Math.Min(Math.Floor(width * .56), width - 40))) : wide ? 224 : 168;
            artwork.Width = artwork.Height = size;
            artwork.HorizontalAlignment = compact ? HorizontalAlignment.Center : HorizontalAlignment.Left;
            artwork.VerticalAlignment = VerticalAlignment.Top;
            Grid.SetColumnSpan(artwork, compact ? 2 : 1);
            Grid.SetColumn(copy, compact ? 0 : 1); Grid.SetColumnSpan(copy, compact ? 2 : 1); Grid.SetRow(copy, compact ? 1 : 0);
            hero.RowSpacing = compact ? 16 : 0;
            hero.ColumnSpacing = compact ? 0 : wide ? 28 : 20;
            title.FontSize = compact ? 28 : wide ? 44 : 34;
            title.LineHeight = compact ? 32 : wide ? 48 : 40;
        }
        SizeChangedEventHandler resize = (_, _) => Layout();
        pageScroll.SizeChanged += resize; Ui.OnRelease(hero, () => pageScroll.SizeChanged -= resize);
        Layout();
        return hero;
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

    private Border CatalogArtworkView(string? url, double size, bool round = false, bool favorite = false, double height = 0, Action<string[]>? palette = null, Action<ArtworkResult>? opened = null)
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
                try {
                    var result = await model.Artwork.GetAsync(url, ArtworkRequest(Math.Max(boxWidth, boxHeight)));
                    if (released) return;
                    if (opened != null) {
                        void OnOpened(object sender, RoutedEventArgs args) { if (!released) opened(result); }
                        image.ImageOpened += OnOpened;
                        Ui.OnRelease(image, () => image.ImageOpened -= OnOpened);
                    }
                    Ui.Cover(image, result.Path, Box(border.Width, border.ActualWidth, boxWidth), Box(border.Height, border.ActualHeight, boxHeight), result.Width, result.Height);
                    if (result.Palette.Length > 0) palette?.Invoke(result.Palette);
                }
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
