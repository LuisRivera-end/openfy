using System.Diagnostics;
using Microsoft.UI.Xaml;

namespace Openfy.Windows.Views;

public sealed partial class MainWindow
{
    internal async Task<object> CheckNavigationPerformanceAsync()
    {
        model.SeedNavigationCheck(500);
        model.ShowLocal("home"); root.UpdateLayout(); await Task.Delay(100);
        var homeElements = catalog.Children.ToArray();
        UIElement[]? favoriteElements = null;
        var changes = 0;
        System.Collections.Specialized.NotifyCollectionChangedEventHandler changed = (_, _) => changes++;
        var observedSongs = model.Songs; observedSongs.CollectionChanged += changed;
        System.ComponentModel.PropertyChangedEventHandler sourceChanged = (_, args) => { if (args.PropertyName == nameof(model.Songs)) { observedSongs.CollectionChanged -= changed; observedSongs = model.Songs; observedSongs.CollectionChanged += changed; } };
        model.PropertyChanged += sourceChanged;
        var samples = new List<object>();
        try {
            for (int cycle = 0; cycle < 4; cycle++) {
                foreach (var page in new[] { "favorites", "home" }) {
                    changes = 0;
                    var clock = Stopwatch.StartNew(); model.ShowLocal(page);
                    double modelMs = clock.Elapsed.TotalMilliseconds;
                    root.UpdateLayout(); double layoutMs = clock.Elapsed.TotalMilliseconds;
                    await Task.Delay(100);
                    if (page == "home" && !homeElements.SequenceEqual(catalog.Children)) throw new IOException("Inicio se reconstruye al volver sin cambios.");
                    if (page == "favorites") {
                        if (favoriteElements != null && !favoriteElements.SequenceEqual(catalog.Children)) throw new IOException("Favoritas se reconstruye al volver sin cambios.");
                        favoriteElements ??= catalog.Children.ToArray();
                    }
                    int realized = Enumerable.Range(0, tracks.Items.Count).Count(i => tracks.ContainerFromIndex(i) != null);
                    samples.Add(new { cycle, page, modelMs, layoutMs, changes, realized });
                    if (cycle > 0 && changes != 0) throw new IOException("Navegar sin cambios vuelve a modificar la lista de canciones.");
                    if (page == "favorites" && (model.Songs.Count != 500 || realized is <= 0 or >= 100)) throw new IOException($"Favoritas no virtualiza la colección: {realized} contenedores.");
                }
            }
        } finally { observedSongs.CollectionChanged -= changed; model.PropertyChanged -= sourceChanged; }
        model.SeedNavigationCheck(501); model.ShowLocal("home"); root.UpdateLayout();
        bool refreshedHome = DownloadText(catalog).Contains("501 canciones");
        model.ShowLocal("favorites"); root.UpdateLayout();
        bool refreshedFavorites = model.Songs.Count == 501 && DownloadText(catalog).Any(text => text.StartsWith("501 canciones"));
        if (!refreshedHome || !refreshedFavorites) throw new IOException("La vista reutilizada no incorpora los cambios de biblioteca.");
        await Task.Delay(100); root.UpdateLayout();
        var field = Ui.Find<CollectionSearchBox>(catalog) ?? throw new IOException("Falta el buscador de Favoritas.");
        field.Focus(FocusState.Programmatic);
        field.Text = "499"; await Task.Delay(100); root.UpdateLayout();
        bool searchPreserved = ReferenceEquals(field, Ui.Find<CollectionSearchBox>(catalog)) && model.Songs.Count == 1;
        var searchDetail = $"texto={field.Text}, consulta={model.LibraryFilter}, resultados={model.Songs.Count}, mismoCampo={ReferenceEquals(field, Ui.Find<CollectionSearchBox>(catalog))}";
        model.ShowLocal("home"); model.ShowLocal("favorites"); root.UpdateLayout();
        bool filterPreserved = model.Songs.Count == 1 && Ui.Find<CollectionSearchBox>(catalog)?.Text == "499";
        model.ResetFilters(); root.UpdateLayout();
        if (!searchPreserved || !filterPreserved || model.Songs.Count != 501) throw new IOException($"La navegación pierde la búsqueda o sus filtros: búsqueda={searchPreserved}, filtro={filterPreserved}, canciones={model.Songs.Count}; {searchDetail}.");
        return new { passed = true, songs = 500, refreshedHome, refreshedFavorites, searchPreserved, filterPreserved, samples };
    }
}
