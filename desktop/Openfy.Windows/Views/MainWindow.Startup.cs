using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Media.Animation;
using Openfy.Core;
using Openfy.Windows.Services;

namespace Openfy.Windows.Views;

public sealed partial class MainWindow
{
    private bool restoringStartupPlacement;
    public bool StartupRevealed { get; private set; }
    public async Task RevealStartupAsync(WindowPlacement? placement, Action handoff, CancellationToken cancellation)
    {
        restoringStartupPlacement = true;
        try { WindowsIntegration.Restore(this, placement); }
        finally { restoringStartupPlacement = false; }
        root.Opacity = 0; root.IsHitTestVisible = false;
        var loaded = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        RoutedEventHandler? handler = null;
        handler = (_, _) => { root.Loaded -= handler; loaded.TrySetResult(); };
        root.Loaded += handler;
        try {
            AppWindow.Show(false);
            if (root.IsLoaded) loaded.TrySetResult();
            await loaded.Task.WaitAsync(TimeSpan.FromSeconds(5), cancellation);
            root.UpdateLayout();
            cancellation.ThrowIfCancellationRequested();
            Title = "Openfy"; Activate(); handoff();
            if (model.Settings.Effects && WindowsIntegration.AnimationsEnabled) {
                var finished = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
                var storyboard = new Storyboard();
                var fade = new DoubleAnimation { From = 0, To = 1, Duration = TimeSpan.FromMilliseconds(240) };
                Storyboard.SetTarget(fade, root); Storyboard.SetTargetProperty(fade, "Opacity"); storyboard.Children.Add(fade);
                storyboard.Completed += (_, _) => finished.TrySetResult(); storyboard.Begin();
                try { await finished.Task.WaitAsync(TimeSpan.FromSeconds(2), cancellation); }
                finally { storyboard.Stop(); }
            }
            root.Opacity = 1; root.IsHitTestVisible = true; StartupRevealed = true;
            model.Settings.Windows["main"] = WindowsIntegration.Placement(this);
        } finally { root.Loaded -= handler; }
    }
}
