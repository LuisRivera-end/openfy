using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Markup;
using Openfy.Core;
using Openfy.Windows.ViewModels;

namespace Openfy.Windows.Views;

public sealed partial class MainWindow
{
    private string renderedDownloadsKey = "";
    private ListView? downloadRows;
    private int downloadRowsBuilt;
    private string DownloadsContentKey() => System.Text.Json.JsonSerializer.Serialize(model.OfflineCollections.Where(target => target.Enabled)
        .Select(target => new { target.Key, target.Title, target.Revision, Entries = target.Entries.Select(entry => entry.Key) }), Contracts.Json);
    private void PrepareDownloadIndicator(ContentControl indicator, SongRow song)
    {
        Ui.ReleaseTree(indicator);
        var icon = Ui.Icon("downloaded", 16); Ui.Tint(icon, Ui.Brush("#5BDA87")); indicator.Content = icon;
        Microsoft.UI.Xaml.Automation.AutomationProperties.SetName(indicator, "Descargada en este PC");
        Microsoft.UI.Xaml.Automation.AutomationProperties.SetHelpText(indicator, "Disponible sin conexión");
        Microsoft.UI.Xaml.Automation.AutomationProperties.SetAccessibilityView(indicator, Microsoft.UI.Xaml.Automation.Peers.AccessibilityView.Content);
        ToolTipService.SetToolTip(indicator, "Descargada en este PC · Disponible sin conexión");
        void Update() => indicator.Visibility = model.IsDownloaded(song.Entry) ? Visibility.Visible : Visibility.Collapsed;
        System.ComponentModel.PropertyChangedEventHandler changed = (_, args) => { if (args.PropertyName == nameof(model.Library)) Update(); };
        RoutedEventHandler loaded = (_, _) => { model.PropertyChanged -= changed; model.PropertyChanged += changed; Update(); };
        RoutedEventHandler unloaded = (_, _) => model.PropertyChanged -= changed;
        indicator.Loaded += loaded; indicator.Unloaded += unloaded;
        if (indicator.IsLoaded) model.PropertyChanged += changed;
        Update();
        Ui.OnRelease(indicator, () => { model.PropertyChanged -= changed; indicator.Loaded -= loaded; indicator.Unloaded -= unloaded; });
    }

    private void BuildDownloadsCatalog()
    {
        renderedDownloadsKey = DownloadsContentKey();
        trackSection.Visibility = Visibility.Collapsed;
        catalog.Children.Add(CatalogPageHeading("Tu música sin conexión", "Descargas", "Las copias permanecen hasta que las elimines manualmente."));
        foreach (var target in model.OfflineCollections.Where(target => target.Enabled))
        {
            var count = Ui.Muted("", 12);
            void UpdateCount() => count.Text = $"{target.Entries.Count(model.IsDownloaded)} de {target.Entries.Count} descargadas";
            System.ComponentModel.PropertyChangedEventHandler libraryChanged = (_, args) => { if (args.PropertyName == nameof(model.Library)) UpdateCount(); };
            model.PropertyChanged += libraryChanged; Ui.OnRelease(count, () => model.PropertyChanged -= libraryChanged); UpdateCount();
            var row = Ui.Row(Ui.Text(target.Title, 14, true), count);
            row.Children.Add(Ui.AsyncButton("Dejar de actualizar", model, async () => {
                await model.Api.SendAsync<Openfy.Core.OfflineCollection>($"api/offline/collections/{target.Kind}/{Uri.EscapeDataString(target.Id)}", HttpMethod.Put, new { enabled = false });
                await model.RefreshAsync();
            }));
            catalog.Children.Add(row);
        }
        var empty = CatalogEmptyState("download", "Tu música también va sin Internet.", "Descarga una canción o mantén descargado un álbum o playlist desde sus opciones.");
        catalog.Children.Add(empty);
        // A bounded viewport lets ListView recycle rows even inside the page's
        // ScrollViewer. Progress replaces one item, without visiting every job.
        var rows = new ListView {
            ItemsSource = model.Downloads, SelectionMode = ListViewSelectionMode.None,
            HorizontalContentAlignment = HorizontalAlignment.Stretch
        };
        downloadRows = rows;
        rows.ItemContainerStyle = (Style)XamlReader.Load("""
        <Style xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation" TargetType="ListViewItem"><Setter Property="HorizontalContentAlignment" Value="Stretch"/><Setter Property="Padding" Value="8"/></Style>
        """);
        rows.ItemTemplate = (DataTemplate)XamlReader.Load("""
        <DataTemplate xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"><ContentControl HorizontalContentAlignment="Stretch" IsTabStop="False"/></DataTemplate>
        """);
        rows.ContainerContentChanging += (_, args) => {
            if (args.ItemContainer.ContentTemplateRoot is not ContentControl host) return;
            Ui.ReleaseTree(host); host.Content = null;
            if (args.InRecycleQueue || args.Item is not AudioDownloadJob job) return;
            host.Content = DownloadRow(job);
        };
        void Resize() {
            empty.Visibility = model.Downloads.Count == 0 ? Visibility.Visible : Visibility.Collapsed;
            rows.Visibility = model.Downloads.Count == 0 ? Visibility.Collapsed : Visibility.Visible;
            rows.Height = Math.Min(model.Downloads.Count * 92, Math.Max(240, root.ActualHeight - 360));
        }
        System.Collections.Specialized.NotifyCollectionChangedEventHandler changed = (_, _) => Resize();
        SizeChangedEventHandler resized = (_, _) => Resize();
        model.Downloads.CollectionChanged += changed; root.SizeChanged += resized;
        Ui.OnRelease(rows, () => { model.Downloads.CollectionChanged -= changed; root.SizeChanged -= resized; rows.ItemsSource = null; });
        Resize(); catalog.Children.Add(rows);
    }
    private Grid DownloadRow(AudioDownloadJob job)
    {
        downloadRowsBuilt++;
        var row = new Grid { ColumnSpacing = 16, Margin = new Thickness(0, 6, 0, 6) };
        row.ColumnDefinitions.Add(new() { Width = new GridLength(1, GridUnitType.Star) }); row.ColumnDefinitions.Add(new() { Width = GridLength.Auto });
        var copy = new StackPanel { Spacing = 7 }; copy.Children.Add(Ui.Text(job.Song.Title, 15, true));
        copy.Children.Add(Ui.Muted(MainViewModel.DownloadLabel(job), 12));
        var progress = new ProgressBar {
            Minimum = 0, Maximum = Math.Max(1, job.Total), Value = Math.Clamp(job.Bytes, 0, Math.Max(1, job.Total)), Height = 3,
            HorizontalAlignment = HorizontalAlignment.Stretch, IsIndeterminate = job.State == "processing",
            Visibility = job.State is "downloading" or "processing" ? Visibility.Visible : Visibility.Collapsed
        };
        copy.Children.Add(progress); row.Children.Add(copy);
        var button = Ui.AsyncButton(job.State == "ready" ? "Eliminar del PC" : job.State is "queued" or "downloading" or "processing" ? "Cancelar" : "Reintentar", model, async () => {
            if (job.State == "ready") await model.RemoveDownloadAsync(job.VideoId);
            else await model.ChangeDownloadAsync(job, job.State is "queued" or "downloading" or "processing" ? "cancel" : "retry");
        });
        Grid.SetColumn(button, 1); row.Children.Add(button);
        return row;
    }
}
