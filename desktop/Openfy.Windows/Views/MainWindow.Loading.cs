using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Hosting;
using Microsoft.UI.Xaml.Media;
using Openfy.Windows.Services;

namespace Openfy.Windows.Views;

public sealed partial class MainWindow
{
    private int skeletonPresentations;
    private void NavigateLocal(string target, string? id = null) => _ = model.RunAsync(() => model.NavigateLocalAsync(target, id));
    private async Task YieldForCatalogPaintAsync()
    {
        var rendered = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        EventHandler<object> frame = (_, _) => rendered.TrySetResult();
        CompositionTarget.Rendering += frame;
        try { await Task.WhenAny(rendered.Task, Task.Delay(60)); }
        finally { CompositionTarget.Rendering -= frame; }
        await Task.Yield();
    }
    private void BuildLoadingCatalog()
    {
        if (renderedCatalogPage == "loading:" + model.Page) return;
        DetachCatalog(); renderedCatalogPage = "loading:" + model.Page; refreshCatalogFilter = null;
        trackSection.Visibility = Visibility.Collapsed; UpdateNavigation();
        var name = model.Page switch { "library" => "Tu biblioteca", "favorites" => "Tus favoritas", "artist" => "artista", "album" or "localalbum" => "álbum", "playlist" => "playlist", "most-played" => "Tus más reproducidas", "downloads" => "Descargas", "settings" => "Ajustes", _ => "Inicio" };
        catalog.Children.Add(CatalogSkeleton("Cargando " + name, model.Page)); skeletonPresentations++;
    }
    private FrameworkElement CatalogSkeleton(string label, string kind, bool section = false)
    {
        Border Block(double width, double height, double radius = 5) => new() { Width = width, Height = height, CornerRadius = new(radius), Background = Ui.Brush("#29292F"), HorizontalAlignment = HorizontalAlignment.Left, Tag = "loading-placeholder" };
        var panel = new StackPanel { Spacing = 18, IsHitTestVisible = false, Margin = new(0, section ? 4 : 12, 0, 16) };
        AutomationProperties.SetName(panel, label); AutomationProperties.SetLiveSetting(panel, Microsoft.UI.Xaml.Automation.Peers.AutomationLiveSetting.Polite);
        if (!section) {
            var header = new Grid { ColumnSpacing = 24 };
            header.ColumnDefinitions.Add(new() { Width = GridLength.Auto }); header.ColumnDefinitions.Add(new() { Width = new(1, GridUnitType.Star) });
            bool artwork = kind is "favorites" or "playlist" or "album" or "localalbum" or "artist" or "localartist";
            if (artwork) header.Children.Add(Block(128, 128, kind.Contains("artist") ? 64 : 8));
            var copy = new StackPanel { Spacing = 13, VerticalAlignment = VerticalAlignment.Center }; copy.Children.Add(Block(90, 12)); copy.Children.Add(Block(230, 30)); copy.Children.Add(Block(160, 12));
            if (artwork) Grid.SetColumn(copy, 1); header.Children.Add(copy); panel.Children.Add(header);
            var toolbar = new Grid { ColumnSpacing = 16 }; toolbar.ColumnDefinitions.Add(new() { Width = new(1, GridUnitType.Star) }); toolbar.ColumnDefinitions.Add(new() { Width = GridLength.Auto });
            toolbar.Children.Add(Block(220, 40, 10)); var action = Block(120, 40, 10); Grid.SetColumn(action, 1); toolbar.Children.Add(action); panel.Children.Add(toolbar);
        }
        bool cards = kind is "cards" or "home" or "artist";
        if (cards) {
            var row = new Grid { ColumnSpacing = 20 };
            for (int i = 0; i < 3; i++) { row.ColumnDefinitions.Add(new() { Width = new(1, GridUnitType.Star) }); var card = new StackPanel { Spacing = 10 }; card.Children.Add(new Border { Height = 140, CornerRadius = new(8), Background = Ui.Brush("#29292F") }); card.Children.Add(Block(100, 13)); card.Children.Add(Block(65, 10)); Grid.SetColumn(card, i); row.Children.Add(card); }
            panel.Children.Add(row);
        } else for (int i = 0; i < (section ? 4 : 6); i++) {
            var row = new Grid { Height = 55, ColumnSpacing = 16 };
            row.ColumnDefinitions.Add(new() { Width = new(44) }); row.ColumnDefinitions.Add(new() { Width = new(1, GridUnitType.Star) }); row.ColumnDefinitions.Add(new() { Width = new(60) });
            row.Children.Add(Block(44, 44)); var copy = new StackPanel { Spacing = 10, VerticalAlignment = VerticalAlignment.Center }; copy.Children.Add(Block(i % 2 == 0 ? 210 : 160, 12)); copy.Children.Add(Block(100, 10)); Grid.SetColumn(copy, 1); row.Children.Add(copy);
            var duration = Block(35, 10); duration.VerticalAlignment = VerticalAlignment.Center; Grid.SetColumn(duration, 2); row.Children.Add(duration); panel.Children.Add(row);
        }
        var visual = ElementCompositionPreview.GetElementVisual(panel);
        RoutedEventHandler loaded = (_, _) => {
            if (!model.Settings.Effects || !WindowsIntegration.AnimationsEnabled) return;
            var pulse = visual.Compositor.CreateScalarKeyFrameAnimation(); pulse.InsertKeyFrame(0, .55f); pulse.InsertKeyFrame(1, 1); pulse.Duration = TimeSpan.FromMilliseconds(1100);
            pulse.Direction = global::Microsoft.UI.Composition.AnimationDirection.Alternate; pulse.IterationBehavior = global::Microsoft.UI.Composition.AnimationIterationBehavior.Forever; visual.StartAnimation("Opacity", pulse);
        };
        RoutedEventHandler unloaded = (_, _) => { visual.StopAnimation("Opacity"); visual.Opacity = 1; };
        panel.Loaded += loaded; panel.Unloaded += unloaded;
        Ui.OnRelease(panel, () => { visual.StopAnimation("Opacity"); panel.Loaded -= loaded; panel.Unloaded -= unloaded; });
        return panel;
    }
}
