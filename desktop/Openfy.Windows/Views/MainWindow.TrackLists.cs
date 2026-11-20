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

    private void ApplyArtistTrackContrast()
    {
        bool profile = model.Page == "artist";
        trackNumberHeading.Foreground = ArtistSurfacePage ? artistTrackText : defaultTrackHeading;
        trackSection.MinWidth = profile ? 480 : 1040;
        trackSection.Width = Math.Max(trackSection.MinWidth, trackScroll.ActualWidth);
        LayoutArtistTracks(trackTableHeading, profile);
        artistTrackSurface.Color = ArtistThemes.Color((artistTheme ?? PendingArtistTheme).Surface);
        if (tracks.ItemsPanelRoot is not Panel panel) return;
        foreach (var item in panel.Children.OfType<ListViewItem>())
            if (item.ContentTemplateRoot is Grid grid) StyleTrackRow(item, grid);
    }

    private void StyleTrackRow(SelectorItem item, Grid grid)
    {
        bool artist = ArtistSurfacePage;
        LayoutArtistTracks(grid, model.Page == "artist");
        foreach (string key in ArtistTrackBackgroundKeys) {
            if (artist) item.Resources[key] = artistTrackSurface;
            else item.Resources.Remove(key);
        }
        foreach (var text in grid.Children.OfType<TextBlock>())
            text.Foreground = artist ? artistTrackText : text.Name == "TrackNumber" ? defaultTrackNumber : Grid.GetColumn(text) == 7 ? defaultTrackPlays : defaultTrackDetail;
        if (grid.FindName("TrackTitle") is TextBlock title) {
            if (artist) title.Foreground = artistTrackText;
            else title.ClearValue(TextBlock.ForegroundProperty);
        }
        foreach (var slot in grid.Children.OfType<ContentControl>())
            if (slot.Content is TrackLink link) link.SetPageForeground(artist ? artistTrackText : null);
    }

    private static void LayoutArtistTracks(Grid grid, bool profile)
    {
        if (grid.Tag is bool previous ? previous == profile : !profile) return;
        grid.Tag = profile;
        grid.ColumnSpacing = profile ? 8 : 12;
        grid.ColumnDefinitions[1].Width = new(profile ? 2.8 : 2, GridUnitType.Star);
        grid.ColumnDefinitions[2].Width = new(profile ? 54 : 64);
        foreach (int column in HiddenArtistTrackColumns)
            grid.ColumnDefinitions[column].Width = new(profile ? 0 : column == 5 ? 90 : column == 7 ? 100 : 64);
        foreach (var child in grid.Children.OfType<FrameworkElement>())
            if (HiddenArtistTrackColumns.Contains(Grid.GetColumn(child))) child.Visibility = profile ? Visibility.Collapsed : Visibility.Visible;
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
        <Grid Grid.Column="1" ColumnSpacing="12"><Grid.ColumnDefinitions><ColumnDefinition Width="44"/><ColumnDefinition Width="*"/><ColumnDefinition Width="Auto"/></Grid.ColumnDefinitions><ContentControl Content="{Binding}" ContentTemplate="{StaticResource TrackCoverTemplate}" HorizontalContentAlignment="Stretch" VerticalContentAlignment="Stretch" IsTabStop="False"/><TextBlock x:Name="TrackTitle" xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml" Grid.Column="1" Text="{Binding Title}" FontSize="13" FontWeight="SemiBold" VerticalAlignment="Center" TextTrimming="CharacterEllipsis"/><ContentControl x:Name="DownloadIndicator" xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml" Grid.Column="2" VerticalAlignment="Center" IsTabStop="False" Visibility="Collapsed"/></Grid>
        <TextBlock Grid.Column="2" Text="{Binding Length}" FontSize="11" Foreground="#9999A2" VerticalAlignment="Center" HorizontalAlignment="Right"/>
        <ContentControl x:Name="ArtistSlot" xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml" Grid.Column="3" VerticalAlignment="Center" HorizontalContentAlignment="Stretch" IsTabStop="False"/>
        <ContentControl x:Name="AlbumSlot" xmlns:x="http://schemas.microsoft.com/winfx/2006/xaml" Grid.Column="4" VerticalAlignment="Center" HorizontalContentAlignment="Stretch" IsTabStop="False"/>
        <TextBlock Grid.Column="5" Text="{Binding Genre}" FontSize="11" Foreground="#9999A2" VerticalAlignment="Center" TextTrimming="CharacterEllipsis"/>
        <Button Grid.Column="6" Width="36" Height="36" MinWidth="0" MinHeight="0" Padding="0" Background="Transparent" BorderThickness="0" CornerRadius="18"/>
        <TextBlock Grid.Column="7" Text="{Binding Plays}" FontSize="12" Foreground="#F4F4F5" VerticalAlignment="Center" HorizontalAlignment="Right"/>
        <TextBlock Grid.Column="8" Text="{Binding Minutes}" FontSize="11" Foreground="#9999A2" VerticalAlignment="Center" HorizontalAlignment="Right"/>
        <Button Grid.Column="9" Width="36" Height="36" MinWidth="0" MinHeight="0" Padding="0" Background="Transparent" BorderThickness="0" CornerRadius="18"/>
        </Grid></DataTemplate>
        """);
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
