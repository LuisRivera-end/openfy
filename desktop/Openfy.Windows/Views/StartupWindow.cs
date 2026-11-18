using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Media.Animation;
using Openfy.Windows.Services;

namespace Openfy.Windows.Views;

public sealed class StartupWindow : Window
{
    private readonly Image logo = Ui.Image(80);
    private readonly TextBlock message = Ui.Muted("Abriendo tu música…", 14);
    private readonly StackPanel actions = Ui.Row();
    private readonly Storyboard pulse = new();
    private bool finishing;
    public StartupWindow(Action retry, Action exit)
    {
        Title = "Openfy";
        AppWindow.SetIcon(Path.Combine(AppContext.BaseDirectory, "Assets", "Openfy.ico"));
        AppWindow.TitleBar.BackgroundColor = AppWindow.TitleBar.ButtonBackgroundColor = Ui.Brush("#09090B").Color;
        AppWindow.TitleBar.ForegroundColor = AppWindow.TitleBar.ButtonForegroundColor = Ui.Brush("#A1A1AA").Color;
        if (AppWindow.Presenter is Microsoft.UI.Windowing.OverlappedPresenter presenter) { presenter.IsResizable = false; presenter.IsMaximizable = false; presenter.IsMinimizable = false; }
        WindowsIntegration.ResizeDefault(this, 420, 300);
        var work = WindowsIntegration.Display(WindowsIntegration.Handle(this)).Work;
        AppWindow.Move(new(work.Left + (work.Width - AppWindow.Size.Width) / 2, work.Top + (work.Height - AppWindow.Size.Height) / 2));
        Ui.Cover(logo, Path.Combine(AppContext.BaseDirectory, "Assets", "Openfy.png"));
        logo.RenderTransformOrigin = new(.5, .5);
        var scale = new ScaleTransform(); logo.RenderTransform = scale;
        foreach (string property in new[] { "ScaleX", "ScaleY" }) {
            var animation = new DoubleAnimation { From = 1, To = 1.04, Duration = TimeSpan.FromMilliseconds(700), AutoReverse = true, RepeatBehavior = RepeatBehavior.Forever, EasingFunction = new SineEase { EasingMode = EasingMode.EaseInOut } };
            Storyboard.SetTarget(animation, scale); Storyboard.SetTargetProperty(animation, property); pulse.Children.Add(animation);
        }
        message.TextAlignment = TextAlignment.Center; message.MaxWidth = 340;
        AutomationProperties.SetLiveSetting(message, Microsoft.UI.Xaml.Automation.Peers.AutomationLiveSetting.Polite);
        actions.Children.Add(Ui.PrimaryButton("Reintentar", retry)); actions.Children.Add(Ui.Button("Salir", exit));
        actions.HorizontalAlignment = HorizontalAlignment.Center; actions.Visibility = Visibility.Collapsed;
        var stack = new StackPanel { Spacing = 24, HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center };
        stack.Children.Add(logo); stack.Children.Add(message); stack.Children.Add(actions);
        Content = new Grid { Background = Ui.Brush("#09090B"), RequestedTheme = ElementTheme.Dark, Padding = new(24), Children = { stack } };
        AutomationProperties.SetAutomationId((FrameworkElement)Content, "startup-screen");
        AppWindow.Closing += (_, args) => { if (!finishing) { args.Cancel = true; exit(); } };
    }
    public void Loading(bool effects) { message.Text = "Abriendo tu música…"; actions.Visibility = Visibility.Collapsed; SetMotion(effects); }
    public void SetMotion(bool effects) { pulse.Stop(); if (effects && WindowsIntegration.AnimationsEnabled) pulse.Begin(); }
    public void Fail(Exception? error = null)
    {
        pulse.Stop(); message.Text = error is TimeoutException ? "Openfy está tardando demasiado en abrirse. Vuelve a intentarlo." : "No se pudo abrir tu biblioteca. Vuelve a intentarlo."; actions.Visibility = Visibility.Visible;
        WindowsIntegration.ResizeDefault(this, 420, 360);
        actions.Children.OfType<Button>().First().Focus(FocusState.Programmatic);
    }
    public void Finish() { if (finishing) return; finishing = true; pulse.Stop(); Ui.ReleaseTree((FrameworkElement)Content); Close(); }
}
