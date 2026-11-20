using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Controls.Primitives;
using Openfy.Windows.ViewModels;

namespace Openfy.Windows.Views;

public sealed partial class MainWindow
{
    private List<UIElement>? cachedFavorites;
    private Openfy.Core.Library? renderedFavoritesLibrary, cachedFavoritesLibrary;
    private Openfy.Core.ListeningStats? renderedFavoritesStatistics, cachedFavoritesStatistics;
    private string renderedFavoritesFilter = "", cachedFavoritesFilter = "";
    private Action? cachedFavoritesRefresh;
    private string FavoritesFilterKey() => System.Text.Json.JsonSerializer.Serialize(model.Filters, Openfy.Core.Contracts.Json);
    private static void SetCollectionButtonContent(Button button, string icon, string label)
    {
        var symbol = Ui.Icon(icon, 18); Ui.Tint(symbol, button.Foreground);
        var text = Ui.Text(label, 14, true); text.Foreground = button.Foreground;
        button.Content = Ui.Row(symbol, text);
        button.HorizontalContentAlignment = HorizontalAlignment.Center;
        button.VerticalContentAlignment = VerticalAlignment.Center;
        button.Padding = new(16, 0, 16, 0); button.MinHeight = 44;
    }

    private Panel CollectionPlaybackControls(out Action refresh)
    {
        if (model.Page == "localartist") {
            var record = ArtistPlayButton(() => _ = model.RunAsync(() => model.PlayCollectionAsync(model.Songs.ToArray(), context: model.PageContext)));
            AutomationProperties.SetName(record, "Reproducir esta colección");
            var shuffle = Ui.Button("Aleatorio", () => _ = model.RunAsync(() => model.PlayCollectionAsync(model.Songs.ToArray(), true, model.PageContext)), "Reproducir esta colección en aleatorio");
            ArtistGlass(shuffle);
            SetCollectionButtonContent(shuffle, "shuffle", "Aleatorio");
            refresh = () => { record.IsEnabled = model.Songs.Count > 0; shuffle.IsEnabled = model.Songs.Count > 1; };
            refresh(); return Ui.Wrap(record, shuffle);
        }
        var play = Ui.PrimaryButton("Reproducir", () => _ = model.RunAsync(() => model.PlayCollectionAsync(model.Songs.ToArray(), context: model.PageContext)));
        AutomationProperties.SetName(play, "Reproducir esta colección"); SetCollectionButtonContent(play, "play", "Reproducir");
        var mix = Ui.Button("Aleatorio", () => _ = model.RunAsync(() => model.PlayCollectionAsync(model.Songs.ToArray(), true, model.PageContext)));
        AutomationProperties.SetName(mix, "Reproducir esta colección en aleatorio"); SetCollectionButtonContent(mix, "shuffle", "Aleatorio");
        refresh = () => { play.IsEnabled = mix.IsEnabled = model.Songs.Count > 0; };
        refresh(); return Ui.Wrap(play, mix);
    }

    private FrameworkElement CollectionToolbar(out Action refresh)
    {
        var toolbar = new Grid { ColumnSpacing = 12, RowSpacing = 10 };
        toolbar.ColumnDefinitions.Add(new() { Width = new(1, GridUnitType.Star) }); toolbar.ColumnDefinitions.Add(new() { Width = GridLength.Auto });
        toolbar.RowDefinitions.Add(new() { Height = GridLength.Auto }); toolbar.RowDefinitions.Add(new() { Height = GridLength.Auto });
        var input = CatalogFilterInput(); input.MaxWidth = 400; input.HorizontalAlignment = HorizontalAlignment.Left;
        toolbar.Children.Add(input);
        var downloaded = new ToggleButton { IsChecked = model.Filters.Downloaded, MinHeight = 44, Padding = new(14, 0, 14, 0), CornerRadius = new(12), VerticalContentAlignment = VerticalAlignment.Center, Background = Ui.Brush("#FFFFFF0B"), BorderBrush = Ui.Brush("#FFFFFF10") };
        var label = Ui.Text("Solo descargadas", 14); var icon = Ui.Icon("download", 18); downloaded.Content = Ui.Row(icon, label);
        AutomationProperties.SetName(downloaded, "Solo descargadas");
        var count = Ui.Muted("", 12); count.VerticalAlignment = VerticalAlignment.Center;
        bool artist = model.Page == "localartist";
        if (artist) {
            count.Foreground = Ui.Brush(ArtistSecondaryText);
            ArtistFocus(downloaded);
            ArtistFocus(input);
        }
        AutomationProperties.SetLiveSetting(count, Microsoft.UI.Xaml.Automation.Peers.AutomationLiveSetting.Polite);
        var tools = Ui.Wrap(downloaded, count); Grid.SetColumn(tools, 1); toolbar.Children.Add(tools);
        refresh = () => {
            bool active = model.Filters.Downloaded;
            downloaded.IsChecked = active;
            var color = Ui.Brush(artist ? ArtistSecondaryText : active ? "#1ED760" : "#A1A1AA"); label.Foreground = color; Ui.Tint(icon, color);
            downloaded.Background = Ui.Brush(artist ? (active ? "#00000066" : "#00000026") : (active ? "#1ED76014" : "#FFFFFF0B"));
            downloaded.BorderBrush = Ui.Brush(artist ? (active ? "#FFFFFF9C" : "#FFFFFF40") : (active ? "#1ED76066" : "#FFFFFF10"));
            count.Text = (model.Filters.Query.Trim().Length > 0 || active ? model.Songs.Count + " de " + model.UnfilteredSongs.Length : model.Songs.Count.ToString()) + " canciones";
        };
        RoutedEventHandler toggle = (_, _) => {
            applyingCatalogFilter = true;
            try { model.UpdateFilters(filter => filter.Downloaded = downloaded.IsChecked == true); }
            finally { applyingCatalogFilter = false; }
            refreshCatalogFilter?.Invoke();
        };
        downloaded.Click += toggle; Ui.OnRelease(downloaded, () => downloaded.Click -= toggle);
        SizeChangedEventHandler resize = (_, args) => {
            bool narrow = args.NewSize.Width < 720;
            Grid.SetColumn(tools, narrow ? 0 : 1); Grid.SetRow(tools, narrow ? 1 : 0);
            input.Width = Math.Max(0, narrow ? args.NewSize.Width : Math.Min(400, args.NewSize.Width - tools.DesiredSize.Width - 12));
        };
        toolbar.SizeChanged += resize; Ui.OnRelease(toolbar, () => toolbar.SizeChanged -= resize);
        refresh(); return toolbar;
    }

    private FrameworkElement CollectionEmptyState()
    {
        if (model.Filters.Downloaded) {
            var empty = new StackPanel();
            empty.Children.Add(CatalogEmptyState("download", "No hay canciones descargadas que coincidan.", "Desactiva Solo descargadas para ver el resto de la colección."));
            empty.Children.Add(Ui.Button("Mostrar todas las canciones", () => { applyingCatalogFilter = true; try { model.UpdateFilters(filter => filter.Downloaded = false); } finally { applyingCatalogFilter = false; } refreshCatalogFilter?.Invoke(); }));
            return empty;
        }
        bool query = model.LibraryFilter.Trim().Length > 0;
        return CatalogEmptyState(model.Page == "favorites" ? "heart" : "music", query ? "Ninguna canción coincide." : model.Page == "favorites" ? "Aquí van las que más te gustan." : "Esta colección está esperando su primera canción.", query ? "Prueba con otro título, artista o álbum." : model.Page == "favorites" ? "Toca el corazón de cualquier canción para guardarla aquí." : "Abre las opciones de una canción y añádela a esta playlist.");
    }

    private void BuildSavedCollection()
    {
        bool artist = model.Page == "localartist";
        var hero = new Grid { ColumnSpacing = 24, RowSpacing = 16, Margin = new(0, 4, 0, 0) };
        if (artist) artistHeroStage = hero;
        hero.ColumnDefinitions.Add(new() { Width = GridLength.Auto }); hero.ColumnDefinitions.Add(new() { Width = new(1, GridUnitType.Star) });
        hero.RowDefinitions.Add(new() { Height = GridLength.Auto }); hero.RowDefinitions.Add(new() { Height = GridLength.Auto });
        var artwork = CatalogArtworkView(model.CatalogArtwork, 160, artist, model.Page == "favorites"); hero.Children.Add(artwork); Grid.SetRowSpan(artwork, 2);
        var copy = new StackPanel { Spacing = 8, VerticalAlignment = VerticalAlignment.Center };
        var kind = Ui.Muted(model.CatalogKind, 12);
        copy.Children.Add(kind);
        var title = Ui.Text(model.Heading, 40, true); title.Tag = "display"; title.CharacterSpacing = -30; copy.Children.Add(title);
        string time = CatalogDuration(model.UnfilteredSongs.Sum(song => song.Duration));
        var detail = Ui.Muted((model.CatalogSubtitle.Length > 0 ? model.CatalogSubtitle + " · " : "") + model.UnfilteredSongs.Length + " canciones" + (time.Length > 0 ? " · " + time : ""), 12);
        if (artist) kind.Foreground = detail.Foreground = Ui.Brush(ArtistSecondaryText);
        copy.Children.Add(detail);
        Grid.SetColumn(copy, 1); hero.Children.Add(copy);
        var actions = new StackPanel { Spacing = 8 }; actions.Children.Add(CollectionPlaybackControls(out var refreshPlayback));
        var secondary = Ui.Wrap();
        if (model.Page == "favorites") {
            var download = Ui.AsyncButton("Descargar favoritas", model, model.DownloadFavoritesAsync);
            SetCollectionButtonContent(download, "download", "Descargar favoritas");
            download.IsEnabled = model.UnfilteredSongs.Length > 0;
            secondary.Children.Add(download);
        }
        if (model.CurrentOfflineKey != null) secondary.Children.Add(Ui.AsyncButton(model.CollectionDownloadLabel, model, model.ToggleCollectionDownloadAsync));
        if (model.CurrentPlaylist is { } playlist) secondary.Children.Add(Ui.Button("Editar nombre", () => _ = model.RunAsync(async () => { var name = await AskAsync("Editar playlist", playlist.Name); if (name != null) await model.EditPlaylistAsync(playlist, name); })));
        if (secondary.Children.Count > 0) actions.Children.Add(secondary);
        Grid.SetColumn(actions, 1); Grid.SetRow(actions, 1); hero.Children.Add(actions);
        SizeChangedEventHandler resize = (_, args) => {
            bool narrow = args.NewSize.Width < 650; double size = args.NewSize.Width < 420 ? 88 : narrow ? 112 : 160;
            artwork.Width = artwork.Height = size; hero.ColumnSpacing = narrow ? 16 : 24; title.FontSize = args.NewSize.Width < 420 ? 28 : narrow ? 32 : 40;
            Grid.SetRowSpan(artwork, narrow ? 1 : 2); Grid.SetColumn(actions, narrow ? 0 : 1); Grid.SetColumnSpan(actions, narrow ? 2 : 1);
        };
        hero.SizeChanged += resize; Ui.OnRelease(hero, () => hero.SizeChanged -= resize); catalog.Children.Add(hero);
        catalog.Children.Add(CollectionToolbar(out var refreshToolbar));
        var empty = new StackPanel(); catalog.Children.Add(empty);
        refreshCatalogFilter = () => {
            refreshPlayback(); refreshToolbar(); ClearCatalogPanel(empty);
            trackSection.Visibility = model.Songs.Count > 0 ? Visibility.Visible : Visibility.Collapsed;
            empty.Visibility = model.Songs.Count == 0 ? Visibility.Visible : Visibility.Collapsed;
            if (model.Songs.Count == 0) empty.Children.Add(CollectionEmptyState());
        };
        refreshCatalogFilter();
    }
}
