using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Media;
using Openfy.Core;
using Openfy.Windows.ViewModels;

namespace Openfy.Windows.Views;

public sealed partial class MainWindow
{
    private string renderedHomeKey = "";
    private List<UIElement>? cachedHome;
    private string cachedHomeKey = "";
    private readonly Dictionary<string, double> homeOffsets = [];
    private string HomeContentKey() => string.Join('|',
        model.RecommendationsBusy, model.Recommendations.Error,
        string.Join(';', model.Recommendations.Songs.Select(song => song.VideoId + song.Artwork + song.Title + string.Join(',', song.Artists))),
        string.Join(';', (model.Recommendations.Releases ?? []).Select(release => release.Id + release.Year)),
        string.Join(';', model.Statistics.ByTrack.Where(pair => pair.Value.ListenedMs > 0).Select(pair => pair.Key).Order()),
        string.Join(';', model.RecentListening.Items.Select(card => card.Key + card.Artwork + card.Title + card.Subtitle)),
        string.Join(';', model.Library.Tracks.Select(track => track.Id + track.Artwork + track.Favorite + track.Title + track.Artist + track.Album + track.AddedAt)),
        string.Join(';', model.Library.SavedSongs.Select(saved => saved.Song.VideoId + saved.Song.Artwork + saved.LocalAudio?.Artwork + saved.Favorite + saved.Song.Title + saved.Song.Album + string.Join(',', saved.Song.Artists) + saved.AddedAt)),
        string.Join(';', model.Library.Playlists.Select(list => list.Id + list.Name + list.Revision)));

    private static Button? FindHomeFocus(DependencyObject node, string name)
    {
        if (node is Button button && AutomationProperties.GetAutomationId(button) == name) return button;
        for (int i = 0; i < VisualTreeHelper.GetChildrenCount(node); i++) if (FindHomeFocus(VisualTreeHelper.GetChild(node, i), name) is { } found) return found;
        return null;
    }

    private IReadOnlyList<SongRow> HomeLibrarySongs() => model.LibrarySongs;

    private void BuildMusicHome()
    {
        renderedHomeKey = HomeContentKey();
        var title = Ui.Text("Inicio", 34, true); title.Margin = new(0, 0, 0, 8); title.CharacterSpacing = -25;
        catalog.Children.Add(title);
        var suggestions = model.Recommendations.Songs.Where(model.IsDiscoverySong).Take(12).Select(song => model.Describe(new("youtube", Song: song))).ToArray();
        var releases = (model.Recommendations.Releases ?? []).Where(release => release.Year == DateTime.Now.Year).Take(12).ToArray();
        var recent = model.RecentListening.Items;
        var recentSongs = recent.Where(card => card.Kind == "song" && card.Item != null).Select(card => model.Describe(card.Item!.Entry)).ToArray();
        var library = HomeLibrarySongs();
        bool hasMusic = library.Count > 0 || recent.Length > 0 || model.Library.Playlists.Count > 0 || suggestions.Length > 0;
        if (hasMusic || model.RecommendationsBusy)
        {
            var refresh = Ui.Button(model.RecommendationsBusy ? "Buscando…" : "Actualizar", () => _ = model.RunAsync(() => model.LoadRecommendationsAsync(true)));
            AutomationProperties.SetAutomationId(refresh, "home:suggestions-refresh");
            refresh.IsEnabled = !model.RecommendationsBusy; refresh.Background = Ui.Brush("#FFFFFF00"); refresh.BorderThickness = new(0); refresh.Padding = new(8, 0, 8, 0); refresh.FontSize = 12;
            var cards = suggestions.Select(song => HomeSongCard(song, suggestions, true)).ToArray();
            if (cards.Length > 0) catalog.Children.Add(HomeShelf("Sugerencias para ti", cards, refresh));
            else if (model.RecommendationsBusy)
            {
                var placeholders = Enumerable.Range(0, 4).Select(_ => (FrameworkElement)new Border { Width = 280, Height = 350, CornerRadius = new(10), Background = Ui.Brush("#202024"), Child = Ui.Icon("music", 36), Tag = "home-artwork", Margin = new(8) }).ToArray();
                catalog.Children.Add(HomeShelf("Sugerencias para ti", placeholders, refresh));
            }
            else
            {
                catalog.Children.Add(CatalogSectionHeading("Sugerencias para ti"));
                catalog.Children.Add(Ui.Muted(model.Recommendations.Error ?? "Descubre tu próxima canción a partir de lo que escuchas y guardas.", 13));
                var actions = Ui.Row(refresh, Ui.Button("Buscar música", ReturnToSearch)); catalog.Children.Add(actions);
            }
            if (suggestions.Length > 0 && model.Recommendations.Error is { } failure) catalog.Children.Add(Ui.Muted(failure, 12));
        }
        else
        {
            var empty = new StackPanel { Spacing = 16, Padding = new(0, 30, 0, 36) };
            var icon = Ui.Icon("headphones", 36); icon.HorizontalAlignment = HorizontalAlignment.Left; empty.Children.Add(icon);
            empty.Children.Add(Ui.Text("¿Qué quieres escuchar?", 24, true)); empty.Children.Add(Ui.Muted("Busca una canción o añade música de tu PC.", 14));
            empty.Children.Add(Ui.Row(Ui.PrimaryButton("Buscar música", ReturnToSearch), Ui.Button("Importar música", () => _ = model.RunAsync(ImportAsync)))); catalog.Children.Add(empty);
        }
        if (releases.Length > 0) catalog.Children.Add(HomeShelf("Lanzamientos de " + DateTime.Now.Year, releases.Select(release => HomeCollectionCard(release.Title, string.Join(", ", release.Artists.Select(artist => artist.Name)) + " · " + release.Year, release.Artwork, () => _ = model.RunAsync(() => model.AlbumAsync(release.Id)), key: release.Id)).ToArray()));
        if (recent.Length > 0) catalog.Children.Add(HomeShelf("Escuchado recientemente", recent.Select(card => card.Kind == "song" && card.Item != null
            ? HomeSongCard(recentSongs.First(song => song.Key == card.Item.Id), recentSongs, listening: new("song"))
            : HomeCollectionCard(card.Title, card.Subtitle, card.Artwork, () => OpenRecentCollection(card), favorite: card.Kind == "favorites", key: card.Key)).ToArray()));
        var collections = new List<FrameworkElement>();
        var favorites = library.Where(song => song.Favorite).ToArray();
        if (favorites.Length > 0) collections.Add(HomeCollectionCard("Tus favoritas", favorites.Length + " canciones", null, () => NavigateLocal("favorites"), true, "favorites"));
        foreach (var list in model.Library.Playlists.Take(12 - collections.Count))
        {
            var art = list.TrackIds.Select(id => library.FirstOrDefault(song => song.Key == id)?.Artwork).FirstOrDefault(url => url != null);
            collections.Add(HomeCollectionCard(list.Name, "Playlist", art, () => NavigateLocal("playlist", list.Id), key: list.Id));
        }
        if (collections.Count > 0) catalog.Children.Add(HomeShelf("Tus favoritas y playlists", collections));

    }

    private FrameworkElement HomeShelf(string title, IEnumerable<FrameworkElement> cards, Button? action = null)
    {
        var section = new StackPanel { Spacing = 12, Margin = new(0, 0, 0, 18) };
        AutomationProperties.SetName(section, title);
        var heading = new Grid { ColumnSpacing = 12 };
        heading.ColumnDefinitions.Add(new() { Width = new(1, GridUnitType.Star) }); heading.ColumnDefinitions.Add(new() { Width = GridLength.Auto });
        var label = Ui.Text(title, 22, true); label.VerticalAlignment = VerticalAlignment.Center; heading.Children.Add(label);
        // Cards carry an 8 px hover box around the artwork; the negative scroller margin keeps covers on the section edge.
        var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 4, Padding = new(4) };
        foreach (var card in cards) {
            foreach (var button in HomeButtons(card)) AutomationProperties.SetAutomationId(button, title + ":" + AutomationProperties.GetAutomationId(button));
            row.Children.Add(card);
        }
        var scroll = new ScrollViewer { Content = row, HorizontalScrollMode = ScrollMode.Enabled, VerticalScrollMode = ScrollMode.Disabled, HorizontalScrollBarVisibility = ScrollBarVisibility.Hidden, VerticalScrollBarVisibility = ScrollBarVisibility.Disabled, ZoomMode = ZoomMode.Disabled, IsTabStop = false, Margin = new(-12, -12, -12, -12) };
        Button? previous = null, next = null;
        void Move(double direction) => scroll.ChangeView(Math.Clamp(scroll.HorizontalOffset + direction * Math.Max(200, scroll.ViewportWidth * .85), 0, scroll.ScrollableWidth), null, null, true);
        previous = Ui.IconButton("back", "Anterior en " + title, () => Move(-1), 34);
        next = Ui.IconButton("back", "Siguiente en " + title, () => Move(1), 34);
        AutomationProperties.SetAutomationId(previous, title + ":previous"); AutomationProperties.SetAutomationId(next, title + ":next");
        ((FrameworkElement)next.Content).RenderTransformOrigin = new(.5, .5); ((FrameworkElement)next.Content).RenderTransform = new RotateTransform { Angle = 180 };
        var tools = Ui.Row(); if (action != null) tools.Children.Add(action); tools.Children.Add(previous); tools.Children.Add(next); Grid.SetColumn(tools, 1); heading.Children.Add(tools);
        void Measure() { previous.IsEnabled = scroll.HorizontalOffset > 2; next.IsEnabled = scroll.HorizontalOffset < scroll.ScrollableWidth - 2; }
        EventHandler<ScrollViewerViewChangedEventArgs> changed = (_, _) => { homeOffsets[title] = scroll.HorizontalOffset; Measure(); };
        SizeChangedEventHandler resized = (_, _) => Measure();
        RoutedEventHandler loaded = (_, _) => { scroll.ChangeView(homeOffsets.GetValueOrDefault(title), null, null, true); Measure(); };
        KeyEventHandler keys = (_, args) => {
            if (args.Key is not (global::Windows.System.VirtualKey.Left or global::Windows.System.VirtualKey.Right or global::Windows.System.VirtualKey.Home or global::Windows.System.VirtualKey.End)) return;
            var buttons = row.Children.Select(card => FindHomeCard(card)).Where(button => button != null).Cast<Button>().ToArray();
            var focused = FocusManager.GetFocusedElement(root.XamlRoot) as Button; int index = Array.IndexOf(buttons, focused);
            if (index < 0) return;
            int target = args.Key == global::Windows.System.VirtualKey.Home ? 0 : args.Key == global::Windows.System.VirtualKey.End ? buttons.Length - 1 : Math.Clamp(index + (args.Key == global::Windows.System.VirtualKey.Right ? 1 : -1), 0, buttons.Length - 1);
            args.Handled = true; buttons[target].Focus(FocusState.Keyboard); buttons[target].StartBringIntoView();
        };
        scroll.ViewChanged += changed; scroll.SizeChanged += resized; scroll.Loaded += loaded; scroll.KeyDown += keys;
        Ui.OnRelease(scroll, () => { homeOffsets[title] = scroll.HorizontalOffset; scroll.ViewChanged -= changed; scroll.SizeChanged -= resized; scroll.Loaded -= loaded; scroll.KeyDown -= keys; });
        section.Children.Add(heading); section.Children.Add(scroll); return section;
    }

    private static Button? FindHomeCard(DependencyObject node)
    {
        if (node is Button button && Equals(button.Tag, "home-card")) return button;
        if (node is Panel panel) foreach (var child in panel.Children) if (FindHomeCard(child) is { } found) return found;
        return null;
    }

    private static IEnumerable<Button> HomeButtons(DependencyObject node)
    {
        if (node is Button button) yield return button;
        else if (node is Panel panel) foreach (var child in panel.Children) foreach (var nested in HomeButtons(child)) yield return nested;
    }

    /// <summary>Card chrome shared by every home card: a quiet box hover with room around the artwork, never a pill.</summary>
    private static void HomeCardChrome(Button button)
    {
        button.Padding = new(8); button.CornerRadius = new(9); button.BorderThickness = new(0); button.Background = Ui.Brush("#FFFFFF00");
        button.HorizontalContentAlignment = HorizontalAlignment.Stretch; button.VerticalAlignment = VerticalAlignment.Top; button.Tag = "home-card";
        button.Resources["ButtonBackgroundPointerOver"] = Ui.Brush("#FFFFFF0D"); button.Resources["ButtonBackgroundPressed"] = Ui.Brush("#FFFFFF08");
    }

    private static global::Windows.UI.Color Tint(string? hex)
    {
        var color = Ui.Brush(hex is { Length: 7 } ? hex : "#28483E").Color;
        // Deep enough for white text at AA contrast, still recognisably the cover's colour.
        static byte Mix(byte value) => (byte)(value * .32 + 9 * .68);
        return global::Windows.UI.Color.FromArgb(255, Mix(color.R), Mix(color.G), Mix(color.B));
    }

    private void OpenRecentCollection(RecentCard card)
    {
        if (card.Kind == "favorites") { NavigateLocal("favorites"); return; }
        if (card.Id == null) return;
        if (card.Kind == "playlist") { NavigateLocal("playlist", card.Id); return; }
        bool catalog = card.Id.StartsWith("youtube:", StringComparison.Ordinal);
        var id = catalog ? card.Id[8..] : card.Id;
        if (card.Kind == "album") { if (catalog) _ = model.RunAsync(() => model.AlbumAsync(id)); else LocalAlbum(id); }
        if (card.Kind == "artist") { if (catalog) _ = model.RunAsync(() => model.ArtistAsync(id)); else LocalArtist(id); }
    }

    private FrameworkElement HomeSongCard(SongRow song, SongRow[] collection, bool featured = false, ListeningContext? listening = null)
    {
        double width = featured ? 280 : 180;
        var card = new Grid { VerticalAlignment = VerticalAlignment.Top };
        var content = new Grid { Width = width };
        var copy = new StackPanel { Spacing = 3 };
        var name = CatalogTruncatedText(song.Title, featured ? 19 : 14, true);
        if (featured) { name.TextWrapping = TextWrapping.Wrap; name.MaxLines = 2; name.LineHeight = 25; }
        copy.Children.Add(name); var artist = CatalogTruncatedText(song.Artist, featured ? 13 : 12); if (featured) artist.Foreground = Ui.Brush("#E0E0E5"); copy.Children.Add(artist);
        if (featured)
        {
            // The full square cover sits on top; the lower band continues in the cover's own colour,
            // so nothing is cropped to fit a portrait card.
            var surface = new Border { Width = width, Height = 350, CornerRadius = new(10), Background = new SolidColorBrush(Tint(null)), Tag = "home-artwork" };
            var layers = new Grid(); surface.Child = layers;
            var shade = new LinearGradientBrush { StartPoint = new(0, 0), EndPoint = new(0, 1) };
            void Paint(global::Windows.UI.Color tint)
            {
                ((SolidColorBrush)surface.Background).Color = tint; shade.GradientStops.Clear();
                shade.GradientStops.Add(new() { Color = global::Windows.UI.Color.FromArgb(0, tint.R, tint.G, tint.B), Offset = 0 });
                shade.GradientStops.Add(new() { Color = global::Windows.UI.Color.FromArgb(214, tint.R, tint.G, tint.B), Offset = .45 });
                shade.GradientStops.Add(new() { Color = tint, Offset = .72 });
            }
            Paint(Tint(null));
            var artwork = CatalogArtworkView(song.Artwork, width, palette: colors => Paint(Tint(colors.FirstOrDefault()))); artwork.Height = width; artwork.VerticalAlignment = VerticalAlignment.Top; artwork.CornerRadius = new(10, 10, 0, 0); artwork.Tag = "home-artwork"; layers.Children.Add(artwork);
            copy.Padding = new(18, 0, 50, 20); copy.VerticalAlignment = VerticalAlignment.Bottom;
            layers.Children.Add(new Border { Height = 190, Background = shade, VerticalAlignment = VerticalAlignment.Bottom, Child = copy, Tag = "home-artwork" });
            content.Children.Add(surface);
        }
        else
        {
            var artwork = CatalogArtworkView(song.Artwork, width); artwork.Height = width; artwork.Tag = "home-artwork"; artwork.CornerRadius = new(8);
            copy.Padding = new(0, 10, 30, 2);
            content.RowDefinitions.Add(new() { Height = GridLength.Auto }); content.RowDefinitions.Add(new() { Height = GridLength.Auto });
            content.Children.Add(artwork); Grid.SetRow(copy, 1); content.Children.Add(copy);
        }
        var play = Ui.Button(song.Title, () => _ = model.RunAsync(() => model.PlayAsync(song, collection, listening)), "Reproducir " + song.Title);
        play.Content = content; HomeCardChrome(play); card.Children.Add(play); ToolTipService.SetToolTip(play, song.Title + "\n" + song.Artist);
        AutomationProperties.SetAutomationId(play, song.Key);
        var menu = Ui.IconButton("more", "Opciones de " + song.Title, () => { }, 32); menu.HorizontalAlignment = HorizontalAlignment.Right; menu.VerticalAlignment = VerticalAlignment.Bottom; menu.Margin = featured ? new(0, 0, 18, 24) : new(0, 0, 4, 12); if (featured) menu.Background = Ui.Brush("#00000066");
        AutomationProperties.SetAutomationId(menu, "options:" + song.Key);
        RoutedEventHandler open = (_, _) => SongMenu(song, listening).ShowAt(menu); menu.Click += open; Ui.OnRelease(menu, () => menu.Click -= open); card.Children.Add(menu);
        return card;
    }

    private FrameworkElement HomeCollectionCard(string title, string subtitle, string? artwork, Action action, bool favorite = false, string? key = null)
    {
        var card = new StackPanel { Width = 180, Spacing = 3, Padding = new(0, 0, 0, 2) };
        var art = CatalogArtworkView(artwork, 180, favorite: favorite); art.CornerRadius = new(8); art.Margin = new(0, 0, 0, 7); card.Children.Add(art);
        card.Children.Add(CatalogTruncatedText(title, 14, true)); card.Children.Add(CatalogTruncatedText(subtitle, 12));
        var button = Ui.Button(title, action); button.Content = card; HomeCardChrome(button); AutomationProperties.SetAutomationId(button, key ?? title); ToolTipService.SetToolTip(button, title); return button;
    }
}
