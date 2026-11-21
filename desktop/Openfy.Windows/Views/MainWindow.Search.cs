using System.Globalization;
using System.Text;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Markup;
using Openfy.Core;
using Openfy.Windows.ViewModels;

namespace Openfy.Windows.Views;

public sealed partial class MainWindow
{
    private readonly Grid searchSurface = new() { Visibility = Visibility.Collapsed, Padding = new(36, 0, 36, 0), RowSpacing = 12 };
    private readonly Dictionary<string, Button> searchTabs = [];
    private readonly Dictionary<string, double> searchOffsets = new() { ["all"] = 0, ["song"] = 0, ["artist"] = 0, ["album"] = 0 };
    private readonly StackPanel searchOverview = new() { Spacing = 24, Padding = new(0, 0, 0, PlayerInset) };
    private readonly StackPanel searchCategoryStatus = new() { Spacing = 10, Margin = new(0, 16, 0, 12) };
    private ScrollViewer searchOverviewScroll = null!;
    private ListView searchSongRows = null!;
    private GridView searchArtistCards = null!, searchAlbumCards = null!;
    private string searchCategory = "all", searchOverviewKey = "";
    private int renderedSearchRevision = -1;
    private bool restoringSearchOffset;

    private void BuildSearchSurface(Grid main)
    {
        searchSurface.RowDefinitions.Add(new() { Height = GridLength.Auto }); searchSurface.RowDefinitions.Add(new() { Height = new(1, GridUnitType.Star) });
        var tabs = Ui.Row(); tabs.Spacing = 8; AutomationProperties.SetName(tabs, "Categorías de búsqueda");
        var categories = new[] { ("all", "Todo"), ("song", "Canciones"), ("artist", "Artistas"), ("album", "Álbumes") };
        foreach (var (key, label) in categories) {
            var button = Ui.Button(label, () => SelectSearchCategory(key)); searchTabs[key] = button;
            button.Padding = new(14, 8, 14, 8); tabs.Children.Add(button);
            button.KeyDown += (_, args) => {
                int index = Array.FindIndex(categories, item => item.Item1 == key);
                int next = args.Key switch { global::Windows.System.VirtualKey.Left => (index + 3) % 4, global::Windows.System.VirtualKey.Right => (index + 1) % 4, global::Windows.System.VirtualKey.Home => 0, global::Windows.System.VirtualKey.End => 3, _ => -1 };
                if (next < 0) return; args.Handled = true; SelectSearchCategory(categories[next].Item1); searchTabs[categories[next].Item1].Focus(FocusState.Keyboard);
            };
        }
        searchSurface.Children.Add(tabs);
        searchOverviewScroll = new() { Content = searchOverview, HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled };
        KeepAbovePlayer(searchOverview, searchOverviewScroll);
        searchSongRows = new ListView { SelectionMode = ListViewSelectionMode.None, HorizontalContentAlignment = HorizontalAlignment.Stretch, Padding = new(0) };
        searchSongRows.ItemTemplate = SearchHostTemplate(); searchSongRows.ContainerContentChanging += PrepareSearchSong;
        searchSongRows.Header = SearchSongHeading();
        AutomationProperties.SetName(searchSongRows, "Canciones de YouTube Music");
        searchArtistCards = SearchCards("artist"); searchAlbumCards = SearchCards("album");
        foreach (var results in new ListViewBase[] { searchSongRows, searchArtistCards, searchAlbumCards })
            results.Margin = new(0, 0, 0, PlayerInset);
        foreach (var element in new FrameworkElement[] { searchOverviewScroll, searchSongRows, searchArtistCards, searchAlbumCards }) { Grid.SetRow(element, 1); searchSurface.Children.Add(element); }
        searchOverviewScroll.ViewChanged += (_, _) => { if (!restoringSearchOffset && model.Page == "search" && searchCategory == "all") searchOffsets["all"] = searchOverviewScroll.VerticalOffset; };
        searchSurface.SizeChanged += (_, _) => QueueSearchMore();
        Grid.SetRow(searchSurface, 2); main.Children.Add(searchSurface);
    }
    private static DataTemplate SearchHostTemplate() => (DataTemplate)XamlReader.Load("""
        <DataTemplate xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"><ContentControl HorizontalContentAlignment="Stretch" IsTabStop="False"/></DataTemplate>
        """);
    private GridView SearchCards(string kind)
    {
        var cards = new GridView { SelectionMode = ListViewSelectionMode.None, HorizontalContentAlignment = HorizontalAlignment.Stretch, Padding = new(0), ItemTemplate = SearchHostTemplate() };
        ScrollViewer.SetHorizontalScrollBarVisibility(cards, ScrollBarVisibility.Disabled);
        cards.ItemsPanel = (ItemsPanelTemplate)XamlReader.Load("""
            <ItemsPanelTemplate xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"><ItemsWrapGrid Orientation="Horizontal" ItemWidth="165" ItemHeight="235"/></ItemsPanelTemplate>
            """);
        cards.ContainerContentChanging += (_, args) => {
            if (args.ItemContainer.ContentTemplateRoot is not ContentControl host) return;
            Ui.ReleaseTree(host); host.Content = null;
            if (!args.InRecycleQueue) host.Content = args.Item switch { YouTubeArtist artist => SearchArtistCard(artist), YouTubeAlbum album => SearchAlbumCard(album), _ => null };
        };
        cards.SizeChanged += (_, _) => {
            if (Ui.Find<ItemsWrapGrid>(cards) is { } panel) { int columns = Math.Max(1, (int)(cards.ActualWidth / 165)); panel.ItemWidth = Math.Max(145, cards.ActualWidth / columns); panel.ItemHeight = panel.ItemWidth + 70; }
            QueueSearchMore();
        };
        ObserveSearchScroll(cards, kind); return cards;
    }
    private FrameworkElement SearchArtistCard(YouTubeArtist artist) => CatalogCard(artist.Name, "Artista", artist.Artwork, () => _ = model.RunAsync(() => model.ArtistAsync(artist.Id)), true);
    private FrameworkElement SearchAlbumCard(YouTubeAlbum album) => CatalogCard(album.Title, string.Join(" · ", new[] { string.Join(", ", album.Artists.Select(artist => artist.Name)), album.Year?.ToString() }.Where(text => !string.IsNullOrEmpty(text))), album.Artwork, () => _ = model.RunAsync(() => model.AlbumAsync(album.Id)));
    private void PrepareSearchSong(ListViewBase sender, ContainerContentChangingEventArgs args)
    {
        if (args.ItemContainer.ContentTemplateRoot is not ContentControl host) return;
        Ui.ReleaseTree(host); host.Content = null;
        if (!args.InRecycleQueue && args.Item is SongRow song) host.Content = SearchSongRow(song, false, args.ItemIndex + 1);
    }
    private FrameworkElement SearchSongHeading()
    {
        var row = new Grid { Height = 38, ColumnSpacing = 12, Margin = new(24, 0, 24, 0) };
        foreach (var width in new[] { new GridLength(28), new GridLength(44), new GridLength(2, GridUnitType.Star), new GridLength(1, GridUnitType.Star), new GridLength(52), new GridLength(36) }) row.ColumnDefinitions.Add(new() { Width = width });
        foreach (var (column, label) in new[] { (0, "#"), (2, "Título"), (3, "Álbum"), (4, "Duración") }) { var text = Ui.Muted(label, 12); text.VerticalAlignment = VerticalAlignment.Center; Grid.SetColumn(text, column); row.Children.Add(text); }
        row.SizeChanged += (_, args) => { row.ColumnDefinitions[0].Width = new(args.NewSize.Width < 500 ? 0 : 28); row.ColumnDefinitions[3].Width = args.NewSize.Width < 650 ? new(0) : new(1, GridUnitType.Star); foreach (var text in row.Children.OfType<FrameworkElement>()) if (Grid.GetColumn(text) is 0 or 3) text.Visibility = Grid.GetColumn(text) == 0 ? args.NewSize.Width < 500 ? Visibility.Collapsed : Visibility.Visible : args.NewSize.Width < 650 ? Visibility.Collapsed : Visibility.Visible; };
        return row;
    }
    private FrameworkElement SearchSongRow(SongRow song, bool compact = true, int number = 0)
    {
        var row = new Grid { ColumnSpacing = 12, Padding = new(8), MinHeight = 64, HorizontalAlignment = HorizontalAlignment.Stretch };
        if (compact) {
            row.Background = Ui.Brush("#FFFFFF00"); row.CornerRadius = new(8);
            PointerEventHandler entered = (_, _) => row.Background = Ui.Brush("#FFFFFF0D");
            PointerEventHandler exited = (_, _) => row.Background = Ui.Brush("#FFFFFF00");
            row.PointerEntered += entered; row.PointerExited += exited;
            Ui.OnRelease(row, () => { row.PointerEntered -= entered; row.PointerExited -= exited; });
        }
        var widths = compact ? new[] { new GridLength(44), new GridLength(1, GridUnitType.Star), new GridLength(52), GridLength.Auto } : new[] { new GridLength(28), new GridLength(44), new GridLength(2, GridUnitType.Star), new GridLength(1, GridUnitType.Star), new GridLength(52), new GridLength(36) };
        foreach (var width in widths) row.ColumnDefinitions.Add(new() { Width = width });
        if (!compact) { var index = Ui.Muted(number.ToString(), 12); index.VerticalAlignment = VerticalAlignment.Center; row.Children.Add(index); }
        Action play = () => _ = model.RunAsync(() => model.PlayAsync(song, model.Songs.ToArray(), new("song")));
        var artwork = Ui.Button("", play, "Reproducir " + song.Title); artwork.Content = CatalogArtworkView(song.Artwork, 44); artwork.Padding = new(0); artwork.Width = artwork.Height = 44; artwork.CornerRadius = new(5); artwork.BorderThickness = new(0); Grid.SetColumn(artwork, compact ? 0 : 1); row.Children.Add(artwork);
        var copy = new StackPanel { VerticalAlignment = VerticalAlignment.Center, Spacing = 3 };
        var title = Ui.Button(song.Title, play); title.Content = CatalogTruncatedText(song.Title, 14, true); title.MinHeight = 24; title.Padding = new(0); title.Background = Ui.Brush("#FFFFFF00"); title.BorderThickness = new(0); title.HorizontalContentAlignment = HorizontalAlignment.Left; title.HorizontalAlignment = HorizontalAlignment.Stretch;
        foreach (var key in new[] { "ButtonBackgroundPointerOver", "ButtonBackgroundPressed", "ButtonBorderBrushPointerOver", "ButtonBorderBrushPressed" }) title.Resources[key] = Ui.Brush("#FFFFFF00");
        copy.Children.Add(title); var artist = NewArtistLink(12, "#A1A1AA"); artist.Set(song.Artist, ArtistTarget(song)); copy.Children.Add(artist); Grid.SetColumn(copy, compact ? 1 : 2); row.Children.Add(copy);
        if (!compact) {
            var album = NewAlbumLink(12, "#A1A1AA"); album.Set(song.Album, AlbumTarget(song)); album.VerticalAlignment = VerticalAlignment.Center; Grid.SetColumn(album, 3); row.Children.Add(album);
            row.SizeChanged += (_, args) => { bool small = args.NewSize.Width < 650; album.Visibility = small ? Visibility.Collapsed : Visibility.Visible; row.ColumnDefinitions[3].Width = small ? new(0) : new(1, GridUnitType.Star); bool narrow = args.NewSize.Width < 500; row.Children[0].Visibility = narrow ? Visibility.Collapsed : Visibility.Visible; row.ColumnDefinitions[0].Width = new(narrow ? 0 : 28); };
        }
        var length = Ui.Muted(song.Length, 12); length.VerticalAlignment = VerticalAlignment.Center; length.HorizontalAlignment = HorizontalAlignment.Right; Grid.SetColumn(length, compact ? 2 : 4); row.Children.Add(length);
        var options = Ui.IconButton("more", "Opciones de " + song.Title, () => SongMenu(song, new("song")).ShowAt(row)); Grid.SetColumn(options, compact ? 3 : 5); row.Children.Add(options);
        row.ContextFlyout = SongMenu(song, new("song")); return row;
    }
    private void ObserveSearchScroll(ListViewBase view, string kind)
    {
        ScrollViewer? observed = null;
        void Attach() {
            view.ApplyTemplate();
            var scroll = Ui.Find<ScrollViewer>(view); if (scroll == null || ReferenceEquals(scroll, observed)) return; observed = scroll;
            scroll.ViewChanged += (_, _) => { if (model.Page != "search" || searchCategory != kind || restoringSearchOffset) return; searchOffsets[kind] = scroll.VerticalOffset; QueueSearchMore(); };
            QueueSearchMore();
        }
        view.Loaded += (_, _) => Attach(); view.SizeChanged += (_, _) => Attach();
    }
    private ScrollViewer? ActiveSearchScroll() => searchCategory switch { "all" => searchOverviewScroll, "song" => Ui.Find<ScrollViewer>(searchSongRows), "artist" => Ui.Find<ScrollViewer>(searchArtistCards), _ => Ui.Find<ScrollViewer>(searchAlbumCards) };
    private void SelectSearchCategory(string category)
    {
        if (searchCategory == category) return;
        if (ActiveSearchScroll() is { } scroll) searchOffsets[searchCategory] = scroll.VerticalOffset;
        searchCategory = category; UpdateSearchSurface(); RestoreSearchOffset();
    }
    private void RestoreSearchOffset()
    {
        restoringSearchOffset = true;
        DispatcherQueue.TryEnqueue(Microsoft.UI.Dispatching.DispatcherQueuePriority.Low, () => {
            searchSurface.UpdateLayout(); ActiveSearchScroll()?.ChangeView(null, searchOffsets[searchCategory], null, true); restoringSearchOffset = false; QueueSearchMore();
        });
    }
    private void QueueSearchMore() => DispatcherQueue.TryEnqueue(Microsoft.UI.Dispatching.DispatcherQueuePriority.Low, () => {
        if (model.Page != "search" || searchCategory == "all" || restoringSearchOffset || !model.SearchHasMore(searchCategory)) return;
        var state = model.SearchState(searchCategory);
        if (state.Loading || !state.Started || state.Error.Length > 0) return;
        if (ActiveSearchScroll() is { ViewportHeight: > 0 } scroll && scroll.ScrollableHeight - scroll.VerticalOffset <= 280) _ = model.LoadSearchSectionAsync(searchCategory);
    });
    private void UpdateSearchSurface()
    {
        bool visible = model.Page == "search"; searchSurface.Visibility = visible ? Visibility.Visible : Visibility.Collapsed; pageScroll.Visibility = visible ? Visibility.Collapsed : Visibility.Visible;
        if (!visible) return;
        if (renderedSearchRevision != model.SearchRevision) {
            renderedSearchRevision = model.SearchRevision; foreach (var key in searchOffsets.Keys.ToArray()) searchOffsets[key] = 0;
            if (model.Query.Trim().Length == 0) searchCategory = "all"; searchOverviewKey = ""; RestoreSearchOffset();
        }
        if (!ReferenceEquals(searchSongRows.ItemsSource, model.Songs)) searchSongRows.ItemsSource = model.Songs;
        searchArtistCards.ItemsSource = model.Artists; searchAlbumCards.ItemsSource = model.Albums;
        bool empty = model.Query.Trim().Length < 2;
        foreach (var pair in searchTabs) { pair.Value.Background = Ui.Brush(pair.Key == searchCategory ? "#E9E9EA" : "#FFFFFF08"); pair.Value.Foreground = Ui.Brush(pair.Key == searchCategory ? "#131315" : "#F4F4F5"); pair.Value.IsTabStop = pair.Key == searchCategory; AutomationProperties.SetHelpText(pair.Value, pair.Key == searchCategory ? "Seleccionado" : ""); }
        searchOverviewScroll.Visibility = empty || searchCategory == "all" ? Visibility.Visible : Visibility.Collapsed;
        searchSongRows.Visibility = !empty && searchCategory == "song" ? Visibility.Visible : Visibility.Collapsed;
        searchArtistCards.Visibility = !empty && searchCategory == "artist" ? Visibility.Visible : Visibility.Collapsed;
        searchAlbumCards.Visibility = !empty && searchCategory == "album" ? Visibility.Visible : Visibility.Collapsed;
        if (empty || searchCategory == "all") BuildSearchOverview(empty);
        else {
            searchSongRows.Footer = searchArtistCards.Footer = searchAlbumCards.Footer = null;
            BuildSearchStatus(searchCategoryStatus, searchCategory, true);
            if (searchCategory == "song") searchSongRows.Footer = searchCategoryStatus;
            else if (searchCategory == "artist") searchArtistCards.Footer = searchCategoryStatus;
            else searchAlbumCards.Footer = searchCategoryStatus;
        }
        QueueSearchMore();
    }
    private void BuildSearchStatus(StackPanel panel, string kind, bool end = false)
    {
        ClearCatalogPanel(panel); var state = model.SearchState(kind);
        var label = kind == "song" ? "canciones" : kind == "artist" ? "artistas" : "álbumes";
        int count = kind == "song" ? model.Songs.Count : kind == "artist" ? model.Artists.Count : model.Albums.Count;
        if (state.Loading || !state.Started) panel.Children.Add(Ui.Muted((count > 0 ? "Cargando más " : "Buscando ") + label + "…"));
        else if (state.Error.Length > 0) {
            var message = Ui.Muted(state.Error); AutomationProperties.SetLiveSetting(message, Microsoft.UI.Xaml.Automation.Peers.AutomationLiveSetting.Polite); panel.Children.Add(message);
            panel.Children.Add(Ui.Button(state.Expired ? "Actualizar búsqueda" : "Reintentar carga", async () => { bool refresh = state.Expired; await model.LoadSearchSectionAsync(kind, refresh || count == 0); if (refresh && state.Error.Length == 0) { searchOffsets[kind] = 0; RestoreSearchOffset(); } }));
        } else if (count == 0) panel.Children.Add(Ui.Muted("No hay " + label + " que coincidan. Prueba con otro título o artista."));
        else if (end && !model.SearchHasMore(kind)) panel.Children.Add(Ui.Muted("No hay más " + label + " para esta búsqueda."));
    }
    private void BuildSearchOverview(bool empty)
    {
        string key = $"{model.SearchRevision}:{empty}:{model.Songs.Count}:{model.Artists.Count}:{model.Albums.Count}:" + string.Join(";", new[] { "song", "artist", "album" }.Select(kind => $"{model.SearchState(kind).Started}:{model.SearchState(kind).Loading}:{model.SearchState(kind).Error}"));
        if (searchOverviewKey == key) return; searchOverviewKey = key; ClearCatalogPanel(searchOverview);
        if (empty) { searchOverview.Children.Add(CatalogEmptyState("search", "¿Qué quieres escuchar?", "Escribe al menos dos caracteres para encontrar canciones, artistas o álbumes.")); return; }
        var featured = new StackPanel { Spacing = 12 }; featured.Children.Add(CatalogSectionHeading("Resultado más relevante"));
        if (!model.SearchSettled) featured.Children.Add(Ui.Muted("Buscando coincidencias…"));
        else {
            static string Normalize(string text) => string.Concat(text.Trim().Normalize(NormalizationForm.FormD).Where(c => CharUnicodeInfo.GetUnicodeCategory(c) != UnicodeCategory.NonSpacingMark)).ToLowerInvariant();
            string needle = Normalize(model.Query);
            var artist = model.Artists.FirstOrDefault(item => Normalize(item.Name) == needle);
            var song = model.Songs.FirstOrDefault(item => Normalize(item.Title) == needle);
            var album = model.Albums.FirstOrDefault(item => Normalize(item.Title) == needle);
            FrameworkElement? result = artist != null ? SearchFeatured(artist: artist) : song != null ? SearchFeatured(song: song) : album != null ? SearchFeatured(album: album)
                : model.Songs.FirstOrDefault() is { } firstSong ? SearchFeatured(song: firstSong) : model.Artists.FirstOrDefault() is { } firstArtist ? SearchFeatured(artist: firstArtist) : model.Albums.FirstOrDefault() is { } firstAlbum ? SearchFeatured(album: firstAlbum) : null;
            if (result != null) featured.Children.Add(result);
            else featured.Children.Add(Ui.Muted("No hay coincidencias disponibles. Prueba con otra búsqueda."));
        }
        var songs = new StackPanel { Spacing = 4 }; songs.Children.Add(CatalogSectionHeading("Canciones", "Ver todas", () => SelectSearchCategory("song")));
        foreach (var song in model.Songs.Take(4)) songs.Children.Add(SearchSongRow(song));
        var songStatus = new StackPanel(); BuildSearchStatus(songStatus, "song"); songs.Children.Add(songStatus);
        var top = new Grid { ColumnSpacing = 24, RowSpacing = 24 };
        top.ColumnDefinitions.Add(new() { Width = new(1, GridUnitType.Star) }); top.ColumnDefinitions.Add(new() { Width = new(2, GridUnitType.Star) }); top.RowDefinitions.Add(new() { Height = GridLength.Auto }); top.RowDefinitions.Add(new() { Height = GridLength.Auto }); top.Children.Add(featured); top.Children.Add(songs);
        top.SizeChanged += (_, args) => { bool wide = args.NewSize.Width >= 800; Grid.SetColumn(songs, wide ? 1 : 0); Grid.SetRow(songs, wide ? 0 : 1); Grid.SetColumnSpan(featured, wide ? 1 : 2); Grid.SetColumnSpan(songs, wide ? 1 : 2); };
        searchOverview.Children.Add(top);
        foreach (var kind in new[] { "artist", "album" }) {
            var cards = kind == "artist" ? model.Artists.Take(6).Select(SearchArtistCard) : model.Albums.Take(6).Select(SearchAlbumCard);
            var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 12 }; foreach (var card in cards) { card.Width = 165; row.Children.Add(card); }
            var section = new StackPanel { Spacing = 12 }; section.Children.Add(CatalogSectionHeading(kind == "artist" ? "Artistas" : "Álbumes", "Ver todos", () => SelectSearchCategory(kind)));
            section.Children.Add(new ScrollViewer { Content = row, HorizontalScrollBarVisibility = ScrollBarVisibility.Auto, VerticalScrollBarVisibility = ScrollBarVisibility.Disabled });
            var status = new StackPanel(); BuildSearchStatus(status, kind); section.Children.Add(status); searchOverview.Children.Add(section);
        }
        Appearance.Apply(searchOverview);
    }
}
