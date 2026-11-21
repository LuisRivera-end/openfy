using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Controls.Primitives;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Markup;
using Microsoft.UI.Xaml.Media;
using Openfy.Core;
using Openfy.Windows.Services;
using Openfy.Windows.ViewModels;
using Windows.Storage.Pickers;

namespace Openfy.Windows.Views;

public sealed partial class MainWindow : Window
{
    private readonly MainViewModel model;
    private readonly Action<string> openPlayer;
    private readonly StackPanel playlists = new() { Spacing = 4 };
    private readonly StackPanel catalog = new() { Spacing = 12 };
    private readonly Grid side = new() { RowSpacing = 12, Padding = new Thickness(20) };
    private ListView tracks;
    private readonly Grid root;
    private readonly CollectionSearchBox search = new() { ShowClearButton = false, PlaceholderText = "¿Qué quieres escuchar?", MinWidth = 140, HorizontalAlignment = HorizontalAlignment.Stretch };
    private readonly Image cover = Ui.Image(40);
    private CancellationTokenSource? debounce;
    private bool following = true, queueVisible, lyricsVisible;
    private double? activeLyrics;
    private StackPanel? verses;
    private DateTime lastCatalogBuild;
    private bool restoringSearch;
    public bool Exiting { get; set; }
    public bool LyricsOpen => lyricsVisible;
    private event Action? PanelsChanged;
    private void BuildPlaylists()
    {
        foreach (var child in playlists.Children) Ui.ReleaseTree(child);
        playlists.Children.Clear();
        if (navButtons.TryGetValue("favorites", out var favorites) && favorites.Content is Grid grid && grid.Children.OfType<StackPanel>().FirstOrDefault() is { } copy && copy.Children.Count > 1 && copy.Children[1] is TextBlock count) count.Text = (model.Library.Tracks.Count(track => track.Favorite) + model.Library.SavedSongs.Count(song => song.Favorite)) + " canciones";
        if (model.Library.Playlists.Count == 0)
        {
            var empty = new StackPanel { Spacing = 7, Margin = new(10, 24, 10, 0) }; empty.Children.Add(Ui.Text("Un lugar para cada momento.", 12, true)); var hint = Ui.Muted("Crea tu primera playlist.", 12); hint.Foreground = frameMuted; empty.Children.Add(hint); var create = Ui.AsyncButton("Crear playlist", model, CreatePlaylistAsync); create.FontSize = 11; create.MinHeight = 36; create.Margin = new(0, 9, 0, 0); create.HorizontalAlignment = HorizontalAlignment.Left; empty.Children.Add(create); playlists.Children.Add(empty);
        }
        foreach (var playlist in model.Library.Playlists)
        {
            var button = CollectionButton(playlist.Name, "Playlist · " + playlist.TrackIds.Count + " canciones", "music", () => NavigateLocal("playlist", playlist.Id));
            var entry = model.Library.EntryForId(playlist.TrackIds.FirstOrDefault() ?? "");
            var artwork = entry == null ? null : model.Describe(entry).Artwork;
            if (button.Content is Grid row && row.Children[0] is Border picture) picture.Child = CatalogArtworkView(artwork, 44);
            StyleNavigationSelection(button, model.CurrentPlaylist?.Id == playlist.Id);
            var menu = new MenuFlyout();
            var rename = new MenuFlyoutItem { Text = "Renombrar" }; rename.Click += async (_, _) => { var name = await AskAsync("Renombrar playlist", playlist.Name); if (name != null) await model.RunAsync(() => model.EditPlaylistAsync(playlist, name)); }; menu.Items.Add(rename);
            var delete = new MenuFlyoutItem { Text = "Eliminar playlist" }; delete.Click += async (_, _) => {
                var confirm = new ContentDialog { XamlRoot = root.XamlRoot, Title = "Eliminar «" + playlist.Name + "»", Content = "Las canciones de tu biblioteca se conservan.", PrimaryButtonText = "Eliminar", CloseButtonText = "Cancelar" };
                if (await confirm.ShowAsync() == ContentDialogResult.Primary) await model.RunAsync(() => model.DeletePlaylistAsync(playlist));
            }; menu.Items.Add(delete); button.ContextFlyout = menu; playlists.Children.Add(button);
        }
    }
    private void ReturnToSearch()
    {
        debounce?.Cancel();
        bool restored = model.Page == "search" || model.RestoreSearch();
        if (!restored) { model.EmptySearch(); if (model.Query.Trim().Length >= 2) _ = model.SearchAsync(); }
        else { UpdateSearchSurface(); RestoreSearchOffset(); _ = model.SearchAsync(); }
        restoringSearch = true;
        try { if (search.Text != model.Query) search.Text = model.Query; }
        finally { restoringSearch = false; }
        if (!restored) search.Focus(FocusState.Programmatic);
    }
    private void BuildSide()
    {
        // The queue view is kept and reused (QueueView); release everything else.
        foreach (var child in side.Children) if (!ReferenceEquals(child, queuePanel)) Ui.ReleaseTree(child);
        side.Children.Clear(); sidePanel.Visibility = queueVisible || lyricsVisible ? Visibility.Visible : Visibility.Collapsed;
        sidePanel.Width = Math.Min(lyricsVisible ? 420 : 380, Math.Max(240, root.ActualWidth - 40));
        PanelsChanged?.Invoke();
        verses = null; activeLyrics = null;
        if (!queueVisible && !lyricsVisible) return;
        if (side.RowDefinitions.Count == 0)
        {
            side.RowDefinitions.Add(new() { Height = GridLength.Auto });
            side.RowDefinitions.Add(new() { Height = new(1, GridUnitType.Star) });
            side.RowDefinitions.Add(new() { Height = GridLength.Auto });
        }
        var header = new Grid(); header.ColumnDefinitions.Add(new() { Width = new(1, GridUnitType.Star) }); header.ColumnDefinitions.Add(new() { Width = GridLength.Auto });
        var heading = Ui.Text(queueVisible ? "Cola de reproducción" : "Letras", 19, true); heading.VerticalAlignment = VerticalAlignment.Center; header.Children.Add(heading);
        var close = Ui.IconButton("close", queueVisible ? "Cerrar cola" : "Cerrar letras", () => { queueVisible = lyricsVisible = model.LyricsVisible = false; BuildSide(); }); Grid.SetColumn(close, 1); header.Children.Add(close); side.Children.Add(header);
        if (queueVisible)
        {
            var queue = QueueView();
            Grid.SetRow(queue, 1); Grid.SetRowSpan(queue, 2); side.Children.Add(queue);
            Appearance.Apply(side);
            return;
        }
        var lyricsPanel = new Grid { RowSpacing = 12 };
        lyricsPanel.RowDefinitions.Add(new() { Height = GridLength.Auto });
        lyricsPanel.RowDefinitions.Add(new() { Height = new(1, GridUnitType.Star) });
        lyricsPanel.Children.Add(PlayerControls.SingleLine(model.Title, 13));
        verses = new StackPanel { Spacing = 14 };
        if (model.Lyrics is not { } lyrics) verses.Children.Add(Ui.Text("Busca la letra o reintenta cuando tengas conexión."));
        else if (lyrics.Status == "synced") foreach (var line in lyrics.Lines)
        {
            string label = line.Text.Length > 0 ? line.Text : "···";
            var button = Ui.AsyncButton(label, model, () => model.SeekAsync(line.Time));
            button.Tag = line.Time; button.Background = Ui.Brush("#FFFFFF00"); button.BorderThickness = new(0);
            button.CornerRadius = new(6); button.Padding = new(0, 9, 0, 9);
            button.HorizontalContentAlignment = HorizontalAlignment.Left; button.FontSize = 22;
            var text = Ui.Text(label, 22, true); text.Foreground = panelMuted;
            button.Content = text; verses.Children.Add(button);
        }
        else verses.Children.Add(Ui.Text(lyrics.Status == "instrumental" ? "Esta canción es instrumental." : lyrics.PlainText.Length > 0 ? lyrics.PlainText : "No encontramos letras para esta canción.", 19));
        var scroll = new ScrollViewer { Content = verses, HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled };
        scroll.PointerWheelChanged += (_, _) => following = false; scroll.PointerPressed += (_, _) => following = false;
        Grid.SetRow(scroll, 1); lyricsPanel.Children.Add(scroll);
        Grid.SetRow(lyricsPanel, 1); side.Children.Add(lyricsPanel);
        var footer = new StackPanel { Spacing = 8 };
        footer.Children.Add(Ui.Button("Seguir reproducción", () => following = true));
        footer.Children.Add(Ui.AsyncButton("Reintentar letras", model, () => model.LoadLyricsAsync(true)));
        if (model.Lyrics?.Attribution != null)
        {
            var attribution = Ui.Text(model.Lyrics.Attribution, 12); attribution.Foreground = panelMuted;
            footer.Children.Add(attribution);
        }
        Grid.SetRow(footer, 2); side.Children.Add(footer);
        HighlightLyrics();
    }
    private void HighlightLyrics()
    {
        if (verses == null || model.Lyrics == null) return;
        double? stamp = RenderPolicy.ActiveLyricsTime(model.Lyrics.Lines, model.Position); if (stamp == activeLyrics) return; activeLyrics = stamp;
        foreach (var button in verses.Children.OfType<Button>())
        {
            bool current = button.Tag is double time && time == stamp;
            if (button.Content is TextBlock text) text.Foreground = current ? frameWhite : panelMuted;
            if (current && following) button.StartBringIntoView(new BringIntoViewOptions { VerticalAlignmentRatio = .5, AnimationDesired = WindowsIntegration.AnimationsEnabled });
        }
    }
    private async Task ImportAsync()
    {
        var files = new FileOpenPicker(); WinRT.Interop.InitializeWithWindow.Initialize(files, WindowsIntegration.Handle(this));
        foreach (string extension in new[] { ".mp3", ".aac", ".m4a", ".flac" }) files.FileTypeFilter.Add(extension);
        var selected = await files.PickMultipleFilesAsync(); if (selected.Count == 0) return;
        await model.Host.CallAsync<System.Text.Json.JsonElement>("importPaths", new { paths = selected.Select(file => file.Path) }); await model.RefreshAsync();
    }
    private async Task ImportFolderAsync()
    {
        var picker = new FolderPicker(); picker.FileTypeFilter.Add("*"); WinRT.Interop.InitializeWithWindow.Initialize(picker, WindowsIntegration.Handle(this)); var folder = await picker.PickSingleFolderAsync();
        if (folder != null) { await model.Host.CallAsync<System.Text.Json.JsonElement>("importPaths", new { paths = new[] { folder.Path } }); await model.RefreshAsync(); }
    }
    private async Task<string?> AskAsync(string title, string initial = "")
    {
        var input = new TextBox { Text = initial, MaxLength = 100 }; var dialog = new ContentDialog { XamlRoot = root.XamlRoot, Title = title, Content = input, PrimaryButtonText = "Guardar", CloseButtonText = "Cancelar", DefaultButton = ContentDialogButton.Primary };
        return await dialog.ShowAsync() == ContentDialogResult.Primary && input.Text.Trim().Length > 0 ? input.Text.Trim() : null;
    }
    private async Task CreatePlaylistAsync() { var name = await AskAsync("Nueva playlist"); if (name != null) await model.CreatePlaylistAsync(name); }
    private Task SettingsAsync() => model.NavigateLocalAsync("settings");
}
