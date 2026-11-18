using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Markup;

namespace Openfy.Windows.Views;

public sealed partial class MainWindow
{
    private sealed record CatalogTile(string Title, string Subtitle, string? Artwork, Action Open, bool Round = false);
    private int catalogCardsCreated;
    private FrameworkElement CatalogCards(IEnumerable<CatalogTile> source)
    {
        var tiles = source.ToArray();
        if (tiles.Length <= 12) {
            var grid = CatalogResponsiveGrid(145, 20);
            foreach (var tile in tiles) grid.Children.Add(CatalogCard(tile.Title, tile.Subtitle, tile.Artwork, tile.Open, tile.Round));
            return grid;
        }
        var rows = new GridView { ItemsSource = tiles, SelectionMode = ListViewSelectionMode.None, HorizontalContentAlignment = HorizontalAlignment.Stretch, IsItemClickEnabled = false, Padding = new(0) };
        ScrollViewer.SetHorizontalScrollBarVisibility(rows, ScrollBarVisibility.Disabled);
        rows.ItemsPanel = (ItemsPanelTemplate)XamlReader.Load("""
        <ItemsPanelTemplate xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"><ItemsWrapGrid Orientation="Horizontal" ItemWidth="165" ItemHeight="230"/></ItemsPanelTemplate>
        """);
        rows.ItemContainerStyle = (Style)XamlReader.Load("""
        <Style xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation" TargetType="GridViewItem"><Setter Property="HorizontalContentAlignment" Value="Stretch"/><Setter Property="Padding" Value="0"/><Setter Property="Margin" Value="0"/></Style>
        """);
        rows.ItemTemplate = (DataTemplate)XamlReader.Load("""
        <DataTemplate xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"><ContentControl HorizontalContentAlignment="Stretch" IsTabStop="False"/></DataTemplate>
        """);
        void Prepare(ListViewBase sender, ContainerContentChangingEventArgs args) {
            if (args.ItemContainer.ContentTemplateRoot is not ContentControl host) { if (args.Phase == 0 && !args.InRecycleQueue) args.RegisterUpdateCallback(Prepare); return; }
            Ui.ReleaseTree(host); host.Content = null;
            if (!args.InRecycleQueue && args.Item is CatalogTile tile) { host.Content = CatalogCard(tile.Title, tile.Subtitle, tile.Artwork, tile.Open, tile.Round); Appearance.Apply(host); }
        }
        rows.ContainerContentChanging += Prepare;
        void Resize() {
            double width = Math.Max(165, rows.ActualWidth); int columns = Math.Max(1, (int)(width / 165));
            double itemHeight = width / columns + 70;
            if (Ui.Find<ItemsWrapGrid>(rows) is { } panel) { panel.ItemWidth = width / columns; panel.ItemHeight = itemHeight; }
            rows.Height = Math.Min(Math.Ceiling((double)tiles.Length / columns) * itemHeight, Math.Max(270, root.ActualHeight - 360));
        }
        RoutedEventHandler loaded = (_, _) => Resize(); SizeChangedEventHandler resized = (_, _) => Resize();
        rows.Loaded += loaded; rows.SizeChanged += resized; root.SizeChanged += resized;
        Ui.OnRelease(rows, () => { rows.ItemsSource = null; rows.Loaded -= loaded; rows.SizeChanged -= resized; root.SizeChanged -= resized; rows.ContainerContentChanging -= Prepare; });
        Resize(); return rows;
    }
}
