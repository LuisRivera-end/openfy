using System.Collections.ObjectModel;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Controls.Primitives;
using Microsoft.UI.Xaml.Markup;
using Microsoft.UI.Xaml.Media;
using Openfy.Windows.ViewModels;

namespace Openfy.Windows.Views;

public sealed partial class MainWindow
{
    private readonly Dictionary<ObservableCollection<SongRow>, (ListView View, long Used)> trackTables = new();
    private long trackTableClock;
    private readonly SolidColorBrush artistTrackText = Ui.Brush("#FFFFFF");
    private readonly SolidColorBrush artistTrackSurface = Ui.Brush(PendingArtistTheme.Surface);
    private readonly SolidColorBrush defaultTrackNumber = Ui.Brush("#757581");
    private readonly SolidColorBrush defaultTrackDetail = Ui.Brush("#9999A2");
    private readonly SolidColorBrush defaultTrackPlays = Ui.Brush("#F4F4F5");
    private readonly SolidColorBrush defaultTrackHeading = Ui.Brush("#A1A1AA");
    private static readonly string[] ArtistTrackBackgroundKeys = ["ListViewItemBackgroundPointerOver", "ListViewItemBackgroundSelected", "ListViewItemBackgroundSelectedPointerOver", "ListViewItemBackgroundPressed", "ListViewItemBackgroundSelectedPressed"];
    private static readonly int[] HiddenArtistTrackColumns = [5, 7, 8];
    private static readonly int[] HiddenAlbumTrackColumns = [4, 5];
    private static readonly int[] HiddenCompactAlbumTrackColumns = [3, 4, 5, 6, 7, 8];

    private void ApplyPageTrackStyle()
    {
        bool profile = model.Page == "artist";
        bool album = AlbumSurfacePage;
        trackNumberHeading.Foreground = album ? albumMuted : ArtistSurfacePage ? artistTrackText : defaultTrackHeading;
        trackSection.MinWidth = album ? CompactAlbum ? 0 : 630 : profile ? 480 : 1040;
        trackSection.Width = Math.Max(trackSection.MinWidth, trackScroll.ActualWidth);
        LayoutTrackColumns(trackTableHeading);
        trackTableHeading.Height = album ? 36 : 42;
        trackTableHeading.Visibility = CompactAlbum ? Visibility.Collapsed : Visibility.Visible;
        trackTableHeading.BorderBrush = album ? albumTrackSurface : Ui.Brush("#FFFFFF0D");
        foreach (var button in trackTableHeading.Children.OfType<Button>())
        {
            bool wasAlbum = button.Foreground == albumMuted;
            if (album)
            {
                button.Foreground = albumMuted;
                button.MinHeight = 0;
                button.HorizontalContentAlignment = Grid.GetColumn(button) == 2 ? HorizontalAlignment.Right : HorizontalAlignment.Left;
                StateBrushes.Of(button)?.Follow(albumTrackSurface, AlbumButtonStateKeys);
                AlbumFocus(button);
            }
            else if (wasAlbum)
            {
                button.ClearValue(Control.ForegroundProperty);
                button.MinHeight = 44;
                button.HorizontalContentAlignment = HorizontalAlignment.Left;
                ClearAlbumButtonStyle(button);
            }
        }
        artistTrackSurface.Color = ArtistThemes.Color((artistTheme ?? PendingArtistTheme).Surface);
        StateBrushes.Refresh();
        if (tracks.ItemsPanelRoot is not Panel panel) return;
        foreach (var item in panel.Children.OfType<ListViewItem>())
            if (item.ContentTemplateRoot is Grid grid) StyleTrackRow(item, grid);
    }

    private void StyleTrackRow(SelectorItem item, Grid grid)
    {
        bool artist = ArtistSurfacePage, album = AlbumSurfacePage;
        bool wasAlbum = grid.Tag is "album" or "compactAlbum";
        LayoutTrackColumns(grid);
        if (album || wasAlbum)
        {
            grid.Height = TrackRowHeight;
            grid.Padding = album ? new(12, 0, 12, 0) : new(12, 8, 12, 8);
            grid.BorderBrush = album ? albumTrackSurface : null;
            grid.BorderThickness = album ? new(0, 0, 0, 1) : new(0);
            item.MinHeight = TrackRowHeight;
            if (album) AlbumFocus(item); else ClearAlbumFocus(item);
            if (grid.FindName("TrackCoverSlot") is ContentControl cover && cover.Parent is Grid titleCell)
            {
                cover.Visibility = album ? Visibility.Collapsed : Visibility.Visible;
                titleCell.ColumnDefinitions[0].Width = new(album ? 0 : 44);
                titleCell.ColumnSpacing = album ? 0 : 12;
            }
            if (!album)
            {
                grid.Background = null;
                if (grid.FindName("TrackActiveIcon") is FontIcon icon) icon.Visibility = Visibility.Collapsed;
                if (grid.FindName("TrackNumber") is TextBlock number) number.Visibility = Visibility.Visible;
                if (grid.FindName("TrackSecondaryArtist") is TextBlock secondary) secondary.Visibility = Visibility.Collapsed;
                AutomationProperties.SetItemStatus(item, "");
            }
        }
        // Recycled containers carry these overrides from page to page (artist → album reuses the same list): they are
        // registered when the container is created (ChoosingItemContainer) and the row buttons declare theirs in the
        // template, so styling a row only recolours them.
        var rowStates = StateBrushes.Of(item) ?? StateBrushes.Register(item, ArtistTrackBackgroundKeys);
        if (album || artist) rowStates.Follow(album ? albumTrackSurface : artistTrackSurface, ArtistTrackBackgroundKeys);
        else rowStates.Reset(ArtistTrackBackgroundKeys);
        foreach (var text in grid.Children.OfType<TextBlock>())
        {
            text.Foreground = album ? albumMuted : artist ? artistTrackText : text.Name == "TrackNumber" ? defaultTrackNumber : Grid.GetColumn(text) == 7 ? defaultTrackPlays : defaultTrackDetail;
            if (Grid.GetColumn(text) == 2 && (album || wasAlbum))
                Microsoft.UI.Xaml.Documents.Typography.SetNumeralAlignment(text, album ? FontNumeralAlignment.Tabular : FontNumeralAlignment.Normal);
        }
        if (grid.FindName("TrackTitle") is TextBlock title) {
            if (album || artist) title.Foreground = album ? albumPrimary : artistTrackText;
            else title.ClearValue(TextBlock.ForegroundProperty);
        }
        foreach (var slot in grid.Children.OfType<ContentControl>())
            if (slot.Content is TrackLink link)
            {
                link.SetPageForeground(album ? albumMuted : artist ? artistTrackText : null);
                if (album) AlbumFocus(link); else if (wasAlbum) ClearAlbumFocus(link);
            }
        foreach (var button in grid.Children.OfType<Button>())
        {
            var buttonStates = StateBrushes.Adopt(button, AlbumButtonStateKeys);
            if (album)
            {
                buttonStates.Follow(albumTrackSurface, AlbumButtonStateKeys);
                AlbumFocus(button);
            }
            else if (wasAlbum) ClearAlbumButtonStyle(button);
        }
        if (album) StyleAlbumTrackState(item, grid);
    }

    private void StyleAlbumTrackState(SelectorItem item, Grid grid)
    {
        if (item.Content is not SongRow song) return;
        bool current = model.Current?.Key == song.Key;
        grid.Background = current ? albumTrackSurface : null;
        AutomationProperties.SetItemStatus(item, current ? "Pista actual" : "");
        if (grid.FindName("TrackActiveIcon") is FontIcon icon) icon.Visibility = current ? Visibility.Visible : Visibility.Collapsed;
        if (grid.FindName("TrackNumber") is TextBlock number) number.Visibility = current ? Visibility.Collapsed : Visibility.Visible;
        if (grid.FindName("TrackDuration") is TextBlock duration)
            duration.Visibility = double.IsFinite(song.Duration) && song.Duration > 0 ? Visibility.Visible : Visibility.Collapsed;
        if (grid.FindName("TrackSecondaryArtist") is TextBlock secondary)
        {
            secondary.Text = song.Artist;
            secondary.Foreground = albumMuted;
            secondary.Visibility = CompactAlbum && song.Artist.Length > 0 && song.Artist != model.CatalogSubtitle ? Visibility.Visible : Visibility.Collapsed;
        }
        if (CompactAlbum)
            foreach (var button in grid.Children.OfType<Button>().Where(button => Grid.GetColumn(button) == 6))
                button.Visibility = Visibility.Collapsed;
    }

    private static void ClearAlbumFocus(FrameworkElement control)
    {
        control.ClearValue(FrameworkElement.FocusVisualPrimaryBrushProperty);
        control.ClearValue(FrameworkElement.FocusVisualPrimaryThicknessProperty);
        control.ClearValue(FrameworkElement.FocusVisualSecondaryThicknessProperty);
        control.ClearValue(FrameworkElement.FocusVisualMarginProperty);
    }

    private static readonly string[] AlbumButtonStateKeys = ["ButtonBackgroundPointerOver", "ButtonBackgroundPressed"];

    private static void ClearAlbumButtonStyle(Button button)
    {
        StateBrushes.Of(button)?.Reset(AlbumButtonStateKeys);
        ClearAlbumFocus(button);
    }

    private void LayoutTrackColumns(Grid grid)
    {
        bool profile = model.Page == "artist", album = AlbumSurfacePage, compact = CompactAlbum;
        string mode = compact ? "compactAlbum" : album ? "album" : profile ? "artist" : "";
        if ((grid.Tag as string ?? "") == mode) return;
        grid.Tag = mode;
        grid.ColumnSpacing = compact ? 4 : profile ? 8 : 12;
        grid.ColumnDefinitions[1].Width = new(profile ? 2.8 : 2, GridUnitType.Star);
        grid.ColumnDefinitions[2].Width = new(compact ? 42 : profile ? 54 : 64);
        int[] hidden = compact ? HiddenCompactAlbumTrackColumns : album ? HiddenAlbumTrackColumns : profile ? HiddenArtistTrackColumns : [];
        foreach (int column in HiddenCompactAlbumTrackColumns)
            grid.ColumnDefinitions[column].Width = hidden.Contains(column) ? new(0)
                : column is 3 or 4 ? new(1, GridUnitType.Star) : new(column == 5 ? 90 : column == 6 ? 38 : column == 7 ? 100 : 64);
        foreach (var child in grid.Children.OfType<FrameworkElement>())
            if (HiddenCompactAlbumTrackColumns.Contains(Grid.GetColumn(child)))
                child.Visibility = hidden.Contains(Grid.GetColumn(child)) ? Visibility.Collapsed : Visibility.Visible;
        if (!album && grid.FindName("TrackDuration") is TextBlock duration) duration.Visibility = Visibility.Visible;
    }

    private ListView CreateTrackList(ObservableCollection<SongRow> source)
    {
        var rows = new ListView { ItemsSource = source, IsItemClickEnabled = true, SelectionMode = ListViewSelectionMode.Single, Background = Ui.Brush("#FFFFFF00"), HorizontalContentAlignment = HorizontalAlignment.Stretch, BorderThickness = new(0), Padding = new(0), MinHeight = 0 };
        rows.ItemContainerStyle = (Style)XamlReader.Load("""
        <Style xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation" TargetType="ListViewItem"><Setter Property="Padding" Value="0"/><Setter Property="Margin" Value="0"/><Setter Property="MinHeight" Value="67"/><Setter Property="HorizontalContentAlignment" Value="Stretch"/><Setter Property="CornerRadius" Value="6"/></Style>
        """);
        rows.ItemTemplate = (DataTemplate)XamlReader.Load("""
        <DataTemplate xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"><Grid Height="67" Padding="12,8" ColumnSpacing="12"><Grid.ColumnDefinitions><ColumnDefinition Width="28"/><ColumnDefinition Width="2*"/><ColumnDefinition Width="64"/><ColumnDefinition Width="*"/><ColumnDefinition Width="*"/><ColumnDefinition Width="90"/><ColumnDefinition Width="38"/><ColumnDefinition Width="100"/><ColumnDefinition Width="64"/><ColumnDefinition Width="36"/></Grid.ColumnDefinitions>
        <TextBlock x:Name="TrackNumber" xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml" FontSize="11" Foreground="#757581" VerticalAlignment="Center"/>
        <FontIcon x:Name="TrackActiveIcon" xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml" Glyph="&#xE768;" FontSize="12" Foreground="#1ED760" HorizontalAlignment="Left" Visibility="Collapsed" AutomationProperties.AccessibilityView="Raw"/>
        <Grid Grid.Column="1" ColumnSpacing="12"><Grid.ColumnDefinitions><ColumnDefinition Width="44"/><ColumnDefinition Width="*"/><ColumnDefinition Width="Auto"/></Grid.ColumnDefinitions><ContentControl x:Name="TrackCoverSlot" xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml" Content="{Binding}" ContentTemplate="{StaticResource TrackCoverTemplate}" HorizontalContentAlignment="Stretch" VerticalContentAlignment="Stretch" IsTabStop="False"/><StackPanel Grid.Column="1" VerticalAlignment="Center" Spacing="2"><TextBlock x:Name="TrackTitle" xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml" Text="{Binding Title}" FontSize="13" FontWeight="SemiBold" TextTrimming="CharacterEllipsis"/><TextBlock x:Name="TrackSecondaryArtist" xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml" FontSize="11" TextTrimming="CharacterEllipsis" Visibility="Collapsed"/></StackPanel><ContentControl x:Name="DownloadIndicator" xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml" Grid.Column="2" VerticalAlignment="Center" IsTabStop="False" Visibility="Collapsed"/></Grid>
        <TextBlock x:Name="TrackDuration" xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml" Grid.Column="2" Text="{Binding Length}" FontSize="11" Foreground="#9999A2" VerticalAlignment="Center" HorizontalAlignment="Right"/>
        <ContentControl x:Name="ArtistSlot" xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml" Grid.Column="3" VerticalAlignment="Center" HorizontalContentAlignment="Stretch" IsTabStop="False"/>
        <ContentControl x:Name="AlbumSlot" xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml" Grid.Column="4" VerticalAlignment="Center" HorizontalContentAlignment="Stretch" IsTabStop="False"/>
        <TextBlock Grid.Column="5" Text="{Binding Genre}" FontSize="11" Foreground="#9999A2" VerticalAlignment="Center" TextTrimming="CharacterEllipsis"/>
        <Button Grid.Column="6" Width="36" Height="36" MinWidth="0" MinHeight="0" Padding="0" Background="Transparent" BorderThickness="0" CornerRadius="18"><Button.Resources><SolidColorBrush xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml" x:Key="ButtonBackgroundPointerOver" Color="Transparent"/><SolidColorBrush xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml" x:Key="ButtonBackgroundPressed" Color="Transparent"/></Button.Resources></Button>
        <TextBlock Grid.Column="7" Text="{Binding Plays}" FontSize="12" Foreground="#F4F4F5" VerticalAlignment="Center" HorizontalAlignment="Right"/>
        <TextBlock Grid.Column="8" Text="{Binding Minutes}" FontSize="11" Foreground="#9999A2" VerticalAlignment="Center" HorizontalAlignment="Right"/>
        <Button Grid.Column="9" Width="36" Height="36" MinWidth="0" MinHeight="0" Padding="0" Background="Transparent" BorderThickness="0" CornerRadius="18"><Button.Resources><SolidColorBrush xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml" x:Key="ButtonBackgroundPointerOver" Color="Transparent"/><SolidColorBrush xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml" x:Key="ButtonBackgroundPressed" Color="Transparent"/></Button.Resources></Button>
        </Grid></DataTemplate>
        """);
        // Containers get their state brushes before they are templated; recycled ones arrive already registered.
        rows.ChoosingItemContainer += (_, args) => {
            if (args.ItemContainer != null) return;
            var container = new ListViewItem { Style = rows.ItemContainerStyle };
            StateBrushes.Register(container, ArtistTrackBackgroundKeys);
            args.ItemContainer = container;
        };
        rows.ItemClick += (_, args) => _ = model.RunAsync(() => model.PlayAsync((SongRow)args.ClickedItem, source.ToArray(), model.ItemContext)); rows.ContainerContentChanging += PrepareTrack;
        rows.ContextRequested += (_, args) => { var song = (args.OriginalSource as FrameworkElement)?.DataContext as SongRow ?? rows.SelectedItem as SongRow; if (song == null) return; SongMenu(song).ShowAt(args.OriginalSource as FrameworkElement ?? rows); args.Handled = true; };
        System.Collections.Specialized.NotifyCollectionChangedEventHandler changed = (_, _) => { if (ReferenceEquals(rows, tracks)) ResizeTracks(); };
        source.CollectionChanged += changed;
        ScrollViewer? observed = null;
        rows.Loaded += (_, _) => { var scroll = Ui.Find<ScrollViewer>(rows); if (scroll != null && !ReferenceEquals(scroll, observed)) observed = scroll; };
        Ui.OnRelease(rows, () => { source.CollectionChanged -= changed; rows.ItemsSource = null; });
        return rows;
    }
    private void SwitchTrackSource()
    {
        ListView next;
        if (trackTables.TryGetValue(model.Songs, out var cached)) next = cached.View;
        else {
            next = CreateTrackList(model.Songs); next.Visibility = Visibility.Collapsed;
            trackSection.Children.Add(next);
        }
        trackTables[model.Songs] = (next, ++trackTableClock);
        if (!ReferenceEquals(tracks, next)) { tracks.Visibility = Visibility.Collapsed; tracks = next; tracks.Visibility = Visibility.Visible; }
        ResizeTracks();
        if (trackTables.Count > 6) {
            var oldest = trackTables.MinBy(pair => pair.Value.Used); trackTables.Remove(oldest.Key); trackSection.Children.Remove(oldest.Value.View); Ui.ReleaseTree(oldest.Value.View);
        }
    }
}
