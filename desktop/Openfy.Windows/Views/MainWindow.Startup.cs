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
    /// <summary>
    /// Completes the first time the window is visible with its content loaded. WinUI can raise
    /// Loaded while the window is still hidden, so visibility is checked as well.
    /// </summary>
    public async Task FirstShownAsync(CancellationToken cancellation)
    {
        if (!AppWindow.IsVisible) {
            var visible = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
            global::Windows.Foundation.TypedEventHandler<Microsoft.UI.Windowing.AppWindow, Microsoft.UI.Windowing.AppWindowChangedEventArgs> changed = (sender, args) => { if (args.DidVisibilityChange && sender.IsVisible) visible.TrySetResult(); };
            AppWindow.Changed += changed;
            try { if (!AppWindow.IsVisible) await visible.Task.WaitAsync(cancellation); }
            finally { AppWindow.Changed -= changed; }
        }
        if (root.IsLoaded) return;
        var loaded = new TaskCompletionSource(TaskCreationOptions.RunContinuationsAsynchronously);
        RoutedEventHandler handler = (_, _) => loaded.TrySetResult();
        root.Loaded += handler;
        try { if (!root.IsLoaded) await loaded.Task.WaitAsync(cancellation); }
        finally { root.Loaded -= handler; }
    }
    /// <summary>
    /// A sign-in launch prepares the window like any other, but leaves it hidden in the tray: no
    /// show, no activation and no fade. The content loads the first time the user opens it.
    /// </summary>
    public void PrepareHiddenStartup(WindowPlacement? placement, Action handoff)
    {
        restoringStartupPlacement = true;
        try { WindowsIntegration.Restore(this, placement); }
        finally { restoringStartupPlacement = false; }
        Title = "Openfy"; root.Opacity = 1; root.IsHitTestVisible = true;
        handoff(); StartupRevealed = true;
    }
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
