using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Controls.Primitives;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Markup;
using Microsoft.UI.Xaml.Media;
using Openfy.Core;
using Openfy.Windows.Services;
using Openfy.Windows.ViewModels;

namespace Openfy.Windows.Views;

public sealed partial class MainWindow
{
    private readonly StackPanel catalogTail = new() { Spacing = 18 };
    private readonly StackPanel trackSection = new();
    private readonly TextBlock trackNumberHeading = Ui.Muted("#", 11);
    private readonly Grid trackTableHeading = new() { Height = 42, Padding = new(12, 0, 12, 0), ColumnSpacing = 12, BorderBrush = Ui.Brush("#FFFFFF0D"), BorderThickness = new(0, 0, 0, 1) };
    private readonly ScrollViewer trackScroll;
    private readonly StackPanel shellNotices = new() { Padding = new(36, 0, 36, 0) };

    private readonly ScrollViewer pageScroll;
    private readonly Border sidePanel;
    private readonly Dictionary<string, Button> navButtons = [];

    private readonly ProgressBar loading = new() { IsIndeterminate = true, Height = 2, Visibility = Visibility.Collapsed };
    private string previousPage = "";

    private readonly StackPanel updateNotice = new() { Spacing = 8, Visibility = Visibility.Collapsed, Margin = new(0,0,0,12) };
    public void AttachUpdates(DesktopUpdates updates)
    {
        var status = Ui.Text(updates.Status, 14, true);
        updateNotice.Children.Add(status);
        updateNotice.Children.Add(Ui.Row(Ui.Button("Actualizar y reiniciar", async () => await updates.ApplyAsync(true)), Ui.Button("Posponer", async () => await updates.PostponeAsync())));
        AutomationProperties.SetLiveSetting(status, Microsoft.UI.Xaml.Automation.Peers.AutomationLiveSetting.Polite);
        updates.Changed += () => { status.Text = updates.Status; updateNotice.Visibility = updates.Available == null ? Visibility.Collapsed : Visibility.Visible; };
        root.AddHandler(UIElement.PointerPressedEvent, new PointerEventHandler((_, _) => updates.Interacted()), true);
        root.AddHandler(UIElement.KeyDownEvent, new KeyEventHandler((_, _) => updates.Interacted()), true);
        updates.Editing = () => root.XamlRoot != null && VisualTreeHelper.GetOpenPopupsForXamlRoot(root.XamlRoot).Count > 0;
    }
    public MainWindow(MainViewModel state, Action<string> player)
    {
        model = state; TrackArtwork.Service = model.Artwork; openPlayer = player; Title = "Openfy";
        AppWindow.SetIcon(Path.Combine(AppContext.BaseDirectory, "Assets", "Openfy.ico"));
        AppWindow.TitleBar.BackgroundColor = Ui.Brush("#09090B").Color;
        AppWindow.TitleBar.ForegroundColor = Ui.Brush("#A1A1AA").Color;
        AppWindow.TitleBar.ButtonBackgroundColor = Ui.Brush("#09090B").Color;
        AppWindow.TitleBar.ButtonForegroundColor = Ui.Brush("#A1A1AA").Color;
        SystemBackdrop = new MicaBackdrop(); WindowsIntegration.ResizeDefault(this, 1320, 880);
        root = new Grid { RequestedTheme = ElementTheme.Dark, Background = Ui.Brush("#09090B"), Padding = new(9), RowSpacing = 9 };
        root.RowDefinitions.Add(new() { Height = new(1, GridUnitType.Star) }); root.RowDefinitions.Add(new() { Height = new(112) });
        var body = new Grid { ColumnSpacing = 9 };
        body.ColumnDefinitions.Add(new() { Width = new(244) }); body.ColumnDefinitions.Add(new() { Width = new(1, GridUnitType.Star) });
        root.Children.Add(body);
        body.Children.Add(Navigation());
        var main = new Grid(); main.RowDefinitions.Add(new() { Height = new(82) }); main.RowDefinitions.Add(new() { Height = new(1, GridUnitType.Star) });
        var mainPanel = new Border { Child = main, Background = Ui.Gradient("#17191B", "#101012"), CornerRadius = new(12), BorderBrush = Ui.Brush("#FFFFFF06"), BorderThickness = new(1) };
        Grid.SetColumn(mainPanel, 1); body.Children.Add(mainPanel);
        var topbar = new Grid { Padding = new(36, 0, 36, 0), ColumnSpacing = 16 };
        topbar.ColumnDefinitions.Add(new() { Width = new(1, GridUnitType.Star) }); topbar.ColumnDefinitions.Add(new() { Width = GridLength.Auto });
        var shortcut = new Grid { Width = 275, HorizontalAlignment = HorizontalAlignment.Left };
        search.PlaceholderText = "¿Qué quieres escuchar?"; search.MaxLength = 200; search.Height = 44; search.Padding = new(34, 0, 38, 0); search.VerticalContentAlignment = VerticalAlignment.Center; search.CornerRadius = new(12); search.Background = Ui.Brush("#202024"); search.FontSize = 14;
        AutomationProperties.SetName(search, "Buscar canciones, artistas o álbumes"); shortcut.Children.Add(search);
        var searchIcon = Ui.Icon("search", 18); searchIcon.HorizontalAlignment = HorizontalAlignment.Left; searchIcon.VerticalAlignment = VerticalAlignment.Center; searchIcon.Margin = new(12,0,0,0); shortcut.Children.Add(searchIcon);
        var clearSearch = Ui.IconButton("close", "Limpiar búsqueda", () => { search.Text = ""; search.Focus(FocusState.Programmatic); }); clearSearch.HorizontalAlignment = HorizontalAlignment.Right; clearSearch.Visibility = Visibility.Collapsed; shortcut.Children.Add(clearSearch);
        search.TextChanged += (_, _) => clearSearch.Visibility = search.Text.Length > 0 ? Visibility.Visible : Visibility.Collapsed;
        topbar.Children.Add(shortcut);
        var import = Ui.AsyncButton("Importar música", model, ShowImportAsync); import.Content = Ui.Row(Ui.Icon("plus", 18), Ui.Text("Importar música", 11, true)); import.MinHeight = 38; import.Height = 38; import.Padding = new(14, 0, 14, 0);
        var avatar = Ui.Button("OF", () => _ = model.RunAsync(SettingsAsync), "Abrir ajustes"); avatar.Width = avatar.Height = avatar.MinWidth = avatar.MinHeight = 36; avatar.Padding = new(0); avatar.FontSize = 11; avatar.Background = Ui.Brush("#383442"); avatar.Foreground = Ui.Brush("#D5CCE9");
        var actions = Ui.Row(import, avatar); actions.Spacing = 17; actions.VerticalAlignment = VerticalAlignment.Center; Grid.SetColumn(actions, 1); topbar.Children.Add(actions); main.Children.Add(topbar);
        var page = new StackPanel { Padding = new(36, 18, 36, 42), Spacing = 0 };
        shellNotices.Children.Add(updateNotice);
        var error = Ui.Text("", 13); error.Foreground = Ui.Brush("#FFA3A3"); Ui.Bind(error, TextBlock.TextProperty, model, nameof(model.Error)); error.Margin = new(0, 0, 0, 12); error.Visibility = Visibility.Collapsed; AutomationProperties.SetLiveSetting(error, Microsoft.UI.Xaml.Automation.Peers.AutomationLiveSetting.Polite); shellNotices.Children.Add(error);
        main.RowDefinitions.Insert(1, new() { Height = GridLength.Auto }); Grid.SetRow(shellNotices, 1); main.Children.Add(shellNotices);
        page.Children.Add(loading); page.Children.Add(catalog);
        var tableHeading = trackTableHeading;
        foreach (var width in new[] { new GridLength(28), new GridLength(2, GridUnitType.Star), new GridLength(64), new GridLength(1, GridUnitType.Star), new GridLength(1, GridUnitType.Star), new GridLength(90), new GridLength(38), new GridLength(100), new GridLength(64), new GridLength(36) }) tableHeading.ColumnDefinitions.Add(new() { Width = width });
        trackNumberHeading.VerticalAlignment = VerticalAlignment.Center; tableHeading.Children.Add(trackNumberHeading);
        int column = 1;
        foreach (var (key, label) in new[] { ("title", "Título"), ("duration", "Duración"), ("artist", "Artista"), ("album", "Álbum"), ("genre", "Género"), ("favorite", "☆"), ("plays", "Reproducciones"), ("minutes", "Minutos") })
        {
            var button = Ui.Button(label, () => { if (model.Page == "most-played") { if (key is "plays" or "minutes") _ = model.RunAsync(() => model.SortRankingAsync(key)); } else model.SortLibrary(key); });
            button.FontSize = 11; button.Padding = new(0); button.Background = Ui.Brush("#FFFFFF00"); button.BorderThickness = new(0); button.HorizontalAlignment = HorizontalAlignment.Stretch; button.HorizontalContentAlignment = HorizontalAlignment.Left;
            AutomationProperties.SetName(button, "Ordenar por " + label); Grid.SetColumn(button, column++); tableHeading.Children.Add(button);
        }
        trackSection.MinWidth = 1040; trackSection.Children.Add(tableHeading);
        tracks = CreateTrackList(model.Songs);
        trackTables[model.Songs] = (tracks, ++trackTableClock);
        trackSection.Children.Add(tracks);
        // A horizontal ScrollViewer measures its content with infinite width, which lets every row size its star columns
        // to its own text (long albums pushed the other columns aside and never trimmed). A finite width keeps all rows
        // and the heading on the same columns; below the minimum the table still scrolls horizontally.
        trackScroll = new ScrollViewer { Content = trackSection, HorizontalScrollBarVisibility = ScrollBarVisibility.Auto, VerticalScrollBarVisibility = ScrollBarVisibility.Disabled };
        trackScroll.SizeChanged += (_, args) => trackSection.Width = Math.Max(trackSection.MinWidth, args.NewSize.Width);
        page.Children.Add(trackScroll); page.Children.Add(catalogTail);
        pageScroll = new ScrollViewer { Content = page, HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled, VerticalScrollBarVisibility = ScrollBarVisibility.Auto }; Grid.SetRow(pageScroll, 2); main.Children.Add(pageScroll); AttachArtistWash(main, page);
        BuildSearchSurface(main);
        ObserveSearchScroll(searchSongRows, "song");
        sidePanel = new Border { Child = side, Background = Ui.Glass(), CornerRadius = new(12), BorderBrush = Ui.Brush("#FFFFFF0B"), BorderThickness = new(1), HorizontalAlignment = HorizontalAlignment.Right, Width = 340, Visibility = Visibility.Collapsed }; Grid.SetColumnSpan(sidePanel, 2); body.Children.Add(sidePanel); Canvas.SetZIndex(sidePanel, 10);
        var bar = PlayerBar(); Grid.SetRow(bar, 1); root.Children.Add(bar);
        root.SizeChanged += (_, _) => { bool compact = root.ActualWidth < 1100; body.ColumnDefinitions[0].Width = new(compact ? 210 : 244); double inset = compact ? 24 : root.ActualWidth >= 1400 ? 48 : 36; topbar.Padding = new(inset, 0, inset, 0); page.Padding = new(inset, 18, inset, 42); shellNotices.Padding = new(inset, 0, inset, 0); searchSurface.Padding = new(inset, 0, inset, 18); avatar.Visibility = root.ActualWidth < 900 ? Visibility.Collapsed : Visibility.Visible; shortcut.Width = Math.Clamp(root.ActualWidth - (compact ? 210 : 244) - 2 * inset - (root.ActualWidth < 900 ? 180 : 245), 150, 275); sidePanel.Width = Math.Min(lyricsVisible ? 420 : 380, Math.Max(240, root.ActualWidth - 40)); ResizeTracks(); };
        pageScroll.SizeChanged += (_, _) => ResizeTracks();
        search.KeyDown += (_, args) => { if (args.Key == global::Windows.System.VirtualKey.Enter) { args.Handled = true; debounce?.Cancel(); Search(); } };
        search.TextChanged += async (_, _) => {
            debounce?.Cancel(); if (restoringSearch || search.Text == model.Query) return;
            model.Query = search.Text; model.EmptySearch();
            if (search.Text.Trim().Length < 2) return;
            var token = (debounce = new()).Token;
            try { await Task.Delay(350, token); Search(); } catch (OperationCanceledException) { }
        };
        root.KeyDown += (_, args) => { if (args.Key == global::Windows.System.VirtualKey.Escape) { queueVisible = lyricsVisible = model.LyricsVisible = false; BuildSide(); } else if (args.Key == global::Windows.System.VirtualKey.Space && args.OriginalSource is not (TextBox or Slider or Button) && !lyricsVisible) { args.Handled = true; _ = model.RunAsync(model.ToggleAsync); } };
        Content = root; Appearance.Attach(root);
        model.YieldForNavigationAsync = YieldForCatalogPaintAsync; model.CanReuseLocalView = CanReuseLocalCatalog;
        model.ContentChanged += () => DispatcherQueue.TryEnqueue(() => { Appearance.Apply(catalog); Appearance.Apply(catalogTail); });
        model.SearchLeaving += () => { if (ActiveSearchScroll() is { } scroll) searchOffsets[searchCategory] = scroll.VerticalOffset; };
        model.ContentChanged += BuildCatalog; model.ArtworkChanged += () => Ui.Cover(cover, model.Cover); model.LyricsChanged += BuildSide;
        model.PropertyChanged += (_, args) => { if (args.PropertyName == nameof(model.Query) && search.Text != model.Query) { restoringSearch = true; try { search.Text = model.Query; } finally { restoringSearch = false; } } if (args.PropertyName == nameof(model.Songs)) SwitchTrackSource(); if (args.PropertyName == nameof(model.Library)) BuildPlaylists(); if (args.PropertyName == nameof(model.Position)) HighlightLyrics(); if (args.PropertyName == nameof(model.Busy)) loading.Visibility = model.Busy ? Visibility.Visible : Visibility.Collapsed; if (args.PropertyName == nameof(model.Error)) error.Visibility = string.IsNullOrEmpty(model.Error) ? Visibility.Collapsed : Visibility.Visible; };
        AppWindow.Closing += (_, args) => { if (!Exiting) { args.Cancel = true; AppWindow.Hide(); } };
        AppWindow.Changed += (_, _) => { if (!restoringStartupPlacement && StartupRevealed && AppWindow.Presenter.Kind != Microsoft.UI.Windowing.AppWindowPresenterKind.FullScreen) model.Settings.Windows["main"] = WindowsIntegration.Placement(this); };
        BuildPlaylists(); BuildCatalog();
    }

    private void Search() { model.Query = search.Text; if (search.Text.Trim().Length < 2) model.EmptySearch(); else _ = model.RunAsync(() => model.SearchAsync()); }
    private void ResizeTracks() { if (tracks != null) tracks.Height = Math.Min(model.Songs.Count * 67 + 4, Math.Max(335, (pageScroll?.ActualHeight ?? 600) - 240)); }
    private void UpdateNavigation()
    {
        if (model.Page is not ("search" or "localSearch")) debounce?.Cancel();
        UpdateSearchSurface();
        foreach (var pair in navButtons) { bool selected = pair.Key == model.Page || pair.Key == "search" && model.Page is "artist" or "album" or "localSearch" || pair.Key == "library" && model.Page is "localalbum" or "localartist"; pair.Value.Background = Ui.Brush(selected ? "#FFFFFF0C" : "#FFFFFF00"); pair.Value.Resources["ButtonBackgroundPointerOver"] = Ui.Brush(selected ? "#FFFFFF12" : "#FFFFFF08"); pair.Value.Foreground = Ui.Brush(selected ? "#F4F4F5" : "#A1A1AA"); if (pair.Value.Content is StackPanel row) { foreach (var text in row.Children.OfType<TextBlock>()) text.Foreground = pair.Value.Foreground; foreach (var icon in row.Children.OfType<Viewbox>()) Ui.Tint(icon, pair.Value.Foreground); } }
        foreach (var button in playlists.Children.OfType<Button>()) button.Background = Ui.Brush(model.CurrentPlaylist?.Name == AutomationProperties.GetName(button) ? "#FFFFFF08" : "#FFFFFF00");
        if (model.Page != previousPage) { previousPage = model.Page; pageScroll.ChangeView(null, 0, null, true); }
        ResizeTracks();
    }
    private Border Navigation()
    {
        var grid = new Grid(); grid.RowDefinitions.Add(new() { Height = GridLength.Auto }); grid.RowDefinitions.Add(new() { Height = GridLength.Auto }); grid.RowDefinitions.Add(new() { Height = new(1, GridUnitType.Star) }); grid.RowDefinitions.Add(new() { Height = GridLength.Auto });
        var logo = Ui.Image(34); Ui.Cover(logo, Path.Combine(AppContext.BaseDirectory, "Assets", "Openfy.png"));
        var brand = Ui.Row(new Border { Child = logo, Width = 34, Height = 34, CornerRadius = new(17) }, Ui.Text("openfy", 30, true), Ui.Text(".", 30, true)); brand.Spacing = 0; brand.Children[0].SetValue(FrameworkElement.MarginProperty, new Thickness(0, 0, 8, 0)); ((TextBlock)brand.Children[2]).Foreground = Ui.Brush("#1ED760"); brand.Margin = new(24, 26, 24, 27); grid.Children.Add(brand);
        var nav = new StackPanel { Spacing = 3, Padding = new(12, 0, 12, 22) };
        void Add(string key, string icon, string label, Action action) { var button = NavButton(icon, label, action); nav.Children.Add(button); navButtons[key] = button; }
        Add("home", "home", "Inicio", () => NavigateLocal("home")); Add("library", "library", "Tu biblioteca", () => NavigateLocal("library")); Add("downloads", "download", "Descargas", () => NavigateLocal("downloads")); Add("most-played", "headphones", "Más reproducidas", () => _ = model.RunAsync(model.ShowMostPlayedAsync));
        var navBorder = new Border { Child = nav, BorderBrush = Ui.Brush("#FFFFFF0D"), BorderThickness = new(0, 0, 0, 1) }; Grid.SetRow(navBorder, 1); grid.Children.Add(navBorder);
        var collection = new StackPanel { Padding = new(12, 15, 12, 15), Spacing = 8 }; var title = new Grid(); title.Children.Add(new TextBlock { Text = "Tu colección", FontSize = 12, Foreground = Ui.Brush("#A1A1AA"), VerticalAlignment = VerticalAlignment.Center, Margin = new(12, 0, 0, 0) }); var plus = Ui.IconButton("plus", "Crear playlist", () => _ = model.RunAsync(CreatePlaylistAsync)); plus.HorizontalAlignment = HorizontalAlignment.Right; title.Children.Add(plus); collection.Children.Add(title);
        var favorites = CollectionButton("Tus favoritas", "0 canciones", "heart", () => NavigateLocal("favorites"), true); collection.Children.Add(favorites); navButtons["favorites"] = favorites; collection.Children.Add(playlists);
        var collections = new ScrollViewer { Content = collection, HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled }; Grid.SetRow(collections, 2); grid.Children.Add(collections);
        // Ajustes is a navigation destination like the others: same box, same hover, same selected state.
        var footer = new StackPanel { Padding = new(12, 10, 12, 18), Spacing = 8 }; var settings = NavButton("settings", "Ajustes", () => _ = model.RunAsync(SettingsAsync)); navButtons["settings"] = settings; footer.Children.Add(settings);
        var status = Ui.Muted(model.Status, 10); status.MaxLines = 2; var dot = new Border { Width = 5, Height = 5, CornerRadius = new(3), Background = Ui.Brush("#777777"), VerticalAlignment = VerticalAlignment.Center }; var connection = Ui.Row(dot, status); connection.Margin = new(16, 0, 0, 0); footer.Children.Add(connection);
        System.ComponentModel.PropertyChangedEventHandler connectionChanged = (_, args) => { if (args.PropertyName is nameof(model.Status) or nameof(model.Library)) { status.Text = model.Host.Connected ? "Conectado a tu PC" : model.Status; dot.Background = Ui.Brush(model.Host.Connected ? "#1ED760" : "#777777"); ToolTipService.SetToolTip(connection, model.Status); } }; model.PropertyChanged += connectionChanged; Ui.OnRelease(connection, () => model.PropertyChanged -= connectionChanged);
        var footerBorder = new Border { Child = footer, BorderBrush = Ui.Brush("#FFFFFF0D"), BorderThickness = new(0, 1, 0, 0) }; Grid.SetRow(footerBorder, 3); grid.Children.Add(footerBorder);
        // Short windows (common at 175-200 % scaling) would collapse the collection row to nothing and clip the footer.
        // Keep room for the collection and let the whole sidebar scroll when the fixed rows do not fit.
        var sidebar = new ScrollViewer { Content = grid, HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled, VerticalScrollBarVisibility = ScrollBarVisibility.Auto };
        void Fit()
        {
            double needed = brand.DesiredSize.Height + navBorder.DesiredSize.Height + footerBorder.DesiredSize.Height + 150;
            double height = Math.Max(sidebar.ViewportHeight, needed);
            if (sidebar.ViewportHeight > 0 && (double.IsNaN(grid.Height) || Math.Abs(grid.Height - height) > .5)) grid.Height = height;
        }
        SizeChangedEventHandler fit = (_, _) => Fit();
        sidebar.SizeChanged += fit; footerBorder.SizeChanged += fit;
        Ui.OnRelease(sidebar, () => { sidebar.SizeChanged -= fit; footerBorder.SizeChanged -= fit; });
        return new Border { Child = sidebar, Background = Ui.Glass("#151517", .75), CornerRadius = new(12), BorderBrush = Ui.Brush("#FFFFFF0B"), BorderThickness = new(1) };
    }
    /// <summary>Sidebar destination: 48 px box, radius 7, a hover quieter than the selected fill.</summary>
    private static Button NavButton(string icon, string label, Action action)
    {
        var button = Ui.Button(label, action); var row = Ui.Row(Ui.Icon(icon), Ui.Text(label, 14, true)); row.Spacing = 14; button.Content = row;
        button.Height = 48; button.MinHeight = 48; button.CornerRadius = new(7); button.BorderThickness = new(0); button.Background = Ui.Brush("#FFFFFF00"); button.Padding = new(16, 0, 16, 0);
        button.HorizontalAlignment = HorizontalAlignment.Stretch; button.HorizontalContentAlignment = HorizontalAlignment.Left; button.VerticalContentAlignment = VerticalAlignment.Center;
        button.Resources["ButtonBackgroundPointerOver"] = Ui.Brush("#FFFFFF08"); button.Resources["ButtonBackgroundPressed"] = Ui.Brush("#FFFFFF05");
        foreach (var text in row.Children.OfType<TextBlock>()) text.Foreground = Ui.Brush("#A1A1AA");
        return button;
    }
    private Button CollectionButton(string title, string subtitle, string icon, Action action, bool favorite = false)
    {
        var artwork = favorite ? CatalogArtworkView(null, 44, favorite: true) : new Border { Width = 44, Height = 44, CornerRadius = new(5), Background = Ui.Brush("#26262B"), Child = Ui.Icon(icon, 23) };
        var copy = new StackPanel { Spacing = 4, VerticalAlignment = VerticalAlignment.Center }; var name = Ui.Text(title, 13, true); name.TextWrapping = TextWrapping.NoWrap; name.TextTrimming = TextTrimming.CharacterEllipsis; copy.Children.Add(name); copy.Children.Add(Ui.Muted(subtitle, 11));
        var row = new Grid { ColumnSpacing = 12 }; row.ColumnDefinitions.Add(new() { Width = new(44) }); row.ColumnDefinitions.Add(new() { Width = new(1, GridUnitType.Star) }); row.Children.Add(artwork); Grid.SetColumn(copy, 1); row.Children.Add(copy);
        var button = Ui.Button(title, action); button.Content = row; button.Padding = new(10); button.Background = Ui.Brush("#FFFFFF00"); button.BorderThickness = new(0); button.CornerRadius = new(7); button.HorizontalAlignment = HorizontalAlignment.Stretch; button.HorizontalContentAlignment = HorizontalAlignment.Stretch; return button;
    }
    private async Task ShowImportAsync()
    {
        var content = new StackPanel { Spacing = 20, MaxWidth = 390 }; content.Children.Add(Ui.Muted("Selecciona archivos de tu PC. Openfy conservará una copia en tu biblioteca personal."));
        var dialog = new ContentDialog { XamlRoot = root.XamlRoot, Title = "Añade tu música", Content = content, CloseButtonText = "Cancelar" };
        content.Children.Add(Ui.Button("Seleccionar archivos", () => { dialog.Hide(); _ = model.RunAsync(ImportAsync); })); content.Children.Add(Ui.Button("Seleccionar una carpeta", () => { dialog.Hide(); _ = model.RunAsync(ImportFolderAsync); })); content.Children.Add(Ui.Muted("MP3, AAC, M4A y FLAC\nLas versiones para el iPhone se preparan en tu PC.", 12)); await dialog.ShowAsync();
    }
    private MenuFlyout SongMenu(SongRow song) => SongMenu(song, model.ItemContext);
    private MenuFlyout SongMenu(SongRow song, ListeningContext? context)
    {
        var menu = new MenuFlyout(); void Item(string text, Func<Task> action) { var item = new MenuFlyoutItem { Text = text }; item.Click += (_, _) => _ = model.RunAsync(action); menu.Items.Add(item); }
        Item("Añadir a la cola", () => { model.Enqueue(song, context); return Task.CompletedTask; });
        Item(model.Library.IsFavorite(song.Entry) ? "Quitar de favoritos" : "Añadir a favoritos", () => model.FavoriteAsync(song));
        if (song.Entry.Song != null) {
            if (model.Library.AudioFor(song.Entry) != null) Item("Eliminar descarga de este PC", () => model.RemoveDownloadAsync(song.Entry.Song.VideoId));
            else Item("Descargar en este PC", () => model.DownloadSongAsync(song));
        }
        foreach (var list in model.Library.Playlists) if (!list.TrackIds.Contains(song.Key)) Item("Añadir a " + list.Name, () => model.AddToPlaylistAsync(song, list));
        if (model.CurrentPlaylist is { } current) Item("Quitar de esta playlist", () => model.EditPlaylistAsync(current, remove: song.Key));
        if (song.Entry.Source == "local") { var track = model.Library.Tracks.Find(t => t.Id == song.Entry.TrackId); if (track != null) { Item("Abrir álbum", () => { LocalAlbum(track.AlbumId); return Task.CompletedTask; }); if (ArtistTarget(song) is { } artist) Item("Abrir artista", artist); } }
        else { foreach (var artist in song.Entry.Song?.ArtistRefs ?? []) if (artist.Id != null) Item("Abrir " + artist.Name, () => model.ArtistAsync(artist.Id)); if (song.Entry.Song?.AlbumId is { } id) Item("Abrir álbum", () => model.AlbumAsync(id)); } return menu;
    }
    /// <summary>Where the artist name of a song leads: the local artist page, or the first linked YouTube artist.</summary>
    private Func<Task>? ArtistTarget(SongRow? song)
    {
        if (song == null) return null;
        if (song.Entry.Source == "local") {
            var track = model.Library.Tracks.Find(t => t.Id == song.Entry.TrackId);
            if (track == null || string.IsNullOrWhiteSpace(track.Artist) || track.Artist == "Artista desconocido") return null;
            return () => { LocalArtist(track.Artist); return Task.CompletedTask; };
        }
        return song.Entry.Song?.ArtistRefs?.FirstOrDefault(artist => artist.Id != null)?.Id is { } id ? () => model.ArtistAsync(id) : null;
    }
    /// <summary>Where the album name of a song leads: the local album page, or the YouTube album.</summary>
    private Func<Task>? AlbumTarget(SongRow? song)
    {
        if (song == null) return null;
        if (song.Entry.Source == "local") {
            var track = model.Library.Tracks.Find(t => t.Id == song.Entry.TrackId);
            if (track == null || string.IsNullOrWhiteSpace(track.AlbumId)) return null;
            return () => { LocalAlbum(track.AlbumId); return Task.CompletedTask; };
        }
        return song.Entry.Song?.AlbumId is { } id ? () => model.AlbumAsync(id) : null;
    }
    private TrackLink NewArtistLink(double fontSize, string foreground) => new(fontSize, foreground, "Abrir artista", target => _ = model.RunAsync(target));
    private TrackLink NewAlbumLink(double fontSize, string foreground) => new(fontSize, foreground, "Abrir álbum", target => _ = model.RunAsync(target));
    private void PrepareTrack(ListViewBase sender, ContainerContentChangingEventArgs args)
    {
        if (args.InRecycleQueue) { if (args.ItemContainer.ContentTemplateRoot is Grid old) Ui.ReleaseTree(old); return; }
        if (args.Item is not SongRow song) return;
        if (args.ItemContainer.ContentTemplateRoot is not Grid template) { if (args.Phase == 0) args.RegisterUpdateCallback(PrepareTrack); return; }
        if (template.FindName("TrackNumber") is TextBlock number) number.Text = (args.ItemIndex + 1).ToString();
        if (args.Phase == 0) {
            StyleTrackRow(args.ItemContainer, template);
            if (template.FindName("DownloadIndicator") is ContentControl indicator) indicator.Visibility = Visibility.Collapsed;
            foreach (var slotName in new[] { "ArtistSlot", "AlbumSlot" })
                if (template.FindName(slotName) is ContentControl { Content: TrackLink link }) link.Set("", null);
            foreach (var button in template.Children.OfType<Button>()) { Ui.ReleaseTree(button); button.Visibility = Visibility.Collapsed; }
            args.RegisterUpdateCallback(PrepareTrack); return;
        }
        if (template.FindName("DownloadIndicator") is ContentControl download) PrepareDownloadIndicator(download, song);
        if (template.FindName("ArtistSlot") is ContentControl artistSlot) {
            if (artistSlot.Content is not TrackLink artistLink) artistSlot.Content = artistLink = NewArtistLink(11, "#9999A2");
            artistLink.Set(song.Artist, ArtistTarget(song));
            artistLink.SetPageForeground(ArtistSurfacePage ? artistTrackText : null);
        }
        if (template.FindName("AlbumSlot") is ContentControl albumSlot) {
            if (albumSlot.Content is not TrackLink albumLink) albumSlot.Content = albumLink = NewAlbumLink(11, "#9999A2");
            albumLink.Set(song.Album, AlbumTarget(song));
            albumLink.SetPageForeground(ArtistSurfacePage ? artistTrackText : null);
        }
        foreach (var button in template.Children.OfType<Button>().Where(button => Grid.GetColumn(button) is 6 or 9))
        {
            Ui.ReleaseTree(button); bool favorite = Grid.GetColumn(button) == 6; button.Foreground = Ui.Brush("#A1A1AA"); Ui.SetIcon(button, favorite ? "heart" : "more", 17); button.Visibility = Visibility.Visible;
            void TintAction()
            {
                if (favorite) Ui.SetActive(button, model.Library.IsFavorite(song.Entry));
                if (ArtistSurfacePage && button.Content is FrameworkElement icon) Ui.Tint(icon, artistTrackText);
            }
            TintAction();
            AutomationProperties.SetName(button, favorite ? "Marcar favorito: " + song.Title : "Opciones de " + song.Title); ToolTipService.SetToolTip(button, favorite ? "Favorito" : "Opciones");
            RoutedEventHandler handler = (_, _) => { if (favorite) _ = model.RunAsync(async () => { await model.FavoriteAsync(song); TintAction(); }); else SongMenu(song).ShowAt(button); }; button.Click += handler; Ui.OnRelease(button, () => button.Click -= handler);
        }
        Appearance.Apply(template);
    }
}
