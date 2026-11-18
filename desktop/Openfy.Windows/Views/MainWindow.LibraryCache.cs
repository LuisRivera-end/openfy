using Microsoft.UI.Xaml;
using Openfy.Core;

namespace Openfy.Windows.Views;

public sealed partial class MainWindow
{
    private sealed record LibraryView(List<UIElement> Content, List<UIElement> Tail, Action? Refresh, Library Library, ListeningStats Statistics, string Filter);
    private readonly Dictionary<string, LibraryView> libraryViews = new();
    private LibraryView? renderedLibraryView;
    private string renderedLibraryTab = "";
    private string LibraryFilterKey() => System.Text.Json.JsonSerializer.Serialize(model.Filters, Contracts.Json);
    private bool LibraryViewCurrent(LibraryView? view, string filter) => view != null && ReferenceEquals(view.Library, model.Library) && ReferenceEquals(view.Statistics, model.Statistics) && view.Filter == filter;
    private void CacheLibraryView()
    {
        if (renderedLibraryView == null) return;
        if (libraryViews.Remove(renderedLibraryTab, out var previous)) foreach (var child in previous.Content.Concat(previous.Tail)) Ui.ReleaseTree(child);
        libraryViews[renderedLibraryTab] = renderedLibraryView with { Content = catalog.Children.ToList(), Tail = catalogTail.Children.ToList(), Refresh = refreshCatalogFilter };
        catalog.Children.Clear(); catalogTail.Children.Clear();
    }
    private bool RestoreLibraryView()
    {
        if (!libraryViews.Remove(libraryTab, out var view)) return false;
        if (!LibraryViewCurrent(view, LibraryFilterKey())) { foreach (var child in view.Content.Concat(view.Tail)) Ui.ReleaseTree(child); return false; }
        foreach (var child in view.Content) catalog.Children.Add(child);
        foreach (var child in view.Tail) catalogTail.Children.Add(child);
        refreshCatalogFilter = view.Refresh; renderedLibraryView = view; renderedLibraryTab = libraryTab;
        trackSection.Visibility = libraryTab == "songs" && model.Songs.Count > 0 ? Visibility.Visible : Visibility.Collapsed;
        return true;
    }
    private bool CanReuseLocalCatalog(string target)
    {
        var filter = model.Settings.LibraryFilters.GetValueOrDefault(target + ":") ?? new();
        if (target is "library" or "favorites") filter = filter.ForCollection();
        string key = System.Text.Json.JsonSerializer.Serialize(filter, Contracts.Json);
        bool tableReady = model.CachedLocalRows(target) is { } rows && trackTables.ContainsKey(rows);
        return target switch {
            "home" => cachedHome != null && cachedHomeKey == HomeContentKey(),
            "favorites" => tableReady && cachedFavorites != null && ReferenceEquals(cachedFavoritesLibrary, model.Library) && ReferenceEquals(cachedFavoritesStatistics, model.Statistics) && cachedFavoritesFilter == key,
            "library" => tableReady && libraryViews.TryGetValue(libraryTab, out var view) && LibraryViewCurrent(view, key),
            _ => false
        };
    }
}
