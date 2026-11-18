using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using Openfy.Core;
using Openfy.Windows.ViewModels;

namespace Openfy.Windows.Views;

public sealed partial class MainWindow
{
    private sealed record FacetChoice(string Key, string Label);
    private FrameworkElement ListeningPeriodPicker()
    {
        var box = new ComboBox { MinWidth = 170, HorizontalAlignment = HorizontalAlignment.Left };
        foreach (var (key, text) in new[] { ("7d", "Últimos 7 días"), ("30d", "Últimos 30 días"), ("year", "Este año"), ("all", "Todo el historial") }) box.Items.Add(new ComboBoxItem { Tag = key, Content = text });
        box.SelectedItem = box.Items.OfType<ComboBoxItem>().First(item => (string)item.Tag == model.ListeningPeriod);
        AutomationProperties.SetName(box, "Período de escucha");
        SelectionChangedEventHandler change = (_, _) => { if (box.SelectedItem is ComboBoxItem item) _ = model.RunAsync(() => model.SetListeningPeriodAsync((string)item.Tag)); };
        box.SelectionChanged += change; Ui.OnRelease(box, () => box.SelectionChanged -= change); return box;
    }
    private void BuildListeningSummary()
    {
        var numbers = CatalogResponsiveGrid(190, 24, 2);
        var minutes = new StackPanel { Spacing = 5, Padding = new Thickness(0, 12, 0, 20) }; minutes.Children.Add(Ui.Text((model.PeriodStatistics.ListenedMs / 60000).ToString("N0"), 42, true)); minutes.Children.Add(Ui.Muted("minutos escuchados", 12)); numbers.Children.Add(minutes);
        var plays = new StackPanel { Spacing = 5, Padding = new Thickness(0, 12, 0, 20) }; plays.Children.Add(Ui.Text(model.PeriodStatistics.Plays.ToString("N0"), 42, true)); plays.Children.Add(Ui.Muted("reproducciones", 12)); numbers.Children.Add(plays); catalog.Children.Add(numbers);
        if (model.Listening.PendingCount > 0) catalog.Children.Add(Ui.Muted("Hay escucha pendiente de sincronizar con tu PC.", 11));
        if (model.Listening.StorageError is { } storageError) catalog.Children.Add(Ui.Muted(storageError, 11));
    }
    private void BuildMostPlayedCatalog()
    {
        catalog.Children.Add(CatalogPageHeading("Tu historial de escucha", "Tus más reproducidas")); catalog.Children.Add(ListeningPeriodPicker());
        BuildListeningSummary();
        catalog.Children.Add(Ui.Muted("Una reproducción cuenta al escuchar el 90 % de la canción.", 12));
        catalog.Children.Add(CatalogFilterInput()); catalog.Children.Add(CatalogFacets(true));
        if (model.Songs.Count == 0) catalog.Children.Add(CatalogEmptyState("music", "Todavía no hay canciones aquí.", "Prueba otro período o ajusta los filtros."));
        if (model.Ranking.Items.Length < model.Ranking.Total) catalogTail.Children.Add(Ui.Button("Cargar 50 canciones más", () => _ = model.RunAsync(() => model.LoadRankingAsync(true))));
    }
    private FrameworkElement CatalogFacets(bool ranking = false)
    {
        var panel = new StackPanel { Spacing = 12, Margin = new Thickness(0, 8, 0, 16) };
        var fields = CatalogResponsiveGrid(150, 10, 4); fields.RowSpacing = 10;
        var candidates = model.UnfilteredSongs;
        void Select(string label, IEnumerable<(string Key, string Label)> options, string selected, Action<string> apply)
        {
            var control = new ComboBox { HorizontalAlignment = HorizontalAlignment.Stretch, MinWidth = 100, FontSize = 12 };
            var choices = options.Select(option => new FacetChoice(option.Key, option.Label)).ToList();
            if (!choices.Any(item => item.Key == selected) && selected.Length > 0) choices.Add(new(selected, selected));
            control.ItemsSource = choices; control.DisplayMemberPath = nameof(FacetChoice.Label);
            control.SelectedItem = choices.FirstOrDefault(item => item.Key == selected) ?? choices[0];
            AutomationProperties.SetName(control, label);
            SelectionChangedEventHandler change = (_, _) => { if (control.SelectedItem is FacetChoice item) apply(item.Key); };
            control.SelectionChanged += change; Ui.OnRelease(control, () => control.SelectionChanged -= change); fields.Children.Add(control);
        }
        IEnumerable<(string, string)> Options(string label, IEnumerable<string> values) => new[] { ("", label) }.Concat(values.Distinct().OrderBy(value => value).Select(value => (value, value)));
        Select("Filtrar por artista", Options("Todos los artistas", candidates.Select(row => row.Artist)), model.Filters.Artist, value => model.UpdateFilters(filter => filter.Artist = value));
        Select("Filtrar por álbum", Options("Todos los álbumes", candidates.Select(row => row.Album)), model.Filters.Album, value => model.UpdateFilters(filter => filter.Album = value));
        Select("Filtrar por género", Options("Todos los géneros", candidates.SelectMany(row => row.Genres.Length > 0 ? row.Genres : ["Sin género"])), model.Filters.Genre, value => model.UpdateFilters(filter => filter.Genre = value));
        Select("Filtrar por origen", new[] { ("all", "Todas las fuentes"), ("local", "Archivos locales"), ("youtube", "YouTube Music") }, model.Filters.Source, value => model.UpdateFilters(filter => filter.Source = value));
        panel.Children.Add(fields);
        var controls = Ui.Row();
        var favorite = new CheckBox { Content = "Solo favoritas", IsChecked = model.Filters.Favorite, FontSize = 12 };
        RoutedEventHandler toggle = (_, _) => model.UpdateFilters(filter => filter.Favorite = favorite.IsChecked == true); favorite.Checked += toggle; favorite.Unchecked += toggle; Ui.OnRelease(favorite, () => { favorite.Checked -= toggle; favorite.Unchecked -= toggle; }); controls.Children.Add(favorite);
        if (!ranking) {
            var downloaded = new CheckBox { Content = "Solo descargadas", IsChecked = model.Filters.Downloaded, FontSize = 12 };
            RoutedEventHandler toggleDownloads = (_, _) => model.UpdateFilters(filter => filter.Downloaded = downloaded.IsChecked == true);
            downloaded.Checked += toggleDownloads; downloaded.Unchecked += toggleDownloads;
            Ui.OnRelease(downloaded, () => { downloaded.Checked -= toggleDownloads; downloaded.Unchecked -= toggleDownloads; }); controls.Children.Add(downloaded);
        }
        controls.Children.Add(Ui.Button("Limpiar filtros", model.ResetFilters)); controls.Children.Add(Ui.Muted((ranking ? model.Ranking.Total : model.Songs.Count) + " canciones", 11)); panel.Children.Add(controls);
        if (ranking)
        {
            var order = Ui.Row(Ui.Button("Por reproducciones", () => _ = model.RunAsync(() => model.SortRankingAsync("plays"))), Ui.Button("Por minutos", () => _ = model.RunAsync(() => model.SortRankingAsync("minutes")))); panel.Children.Add(order);
        }
        return panel;
    }
}
