using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Automation.Provider;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Openfy.Windows.Services;

namespace Openfy.Windows.Views;

public sealed partial class PlayerWindow
{
    // Opt-in native smoke assertions; no mouse injection or desktop capture.
    internal async Task<object> VerifyCaptionAsync()
    {
        void Require(bool condition, string message) { if (!condition) throw new InvalidOperationException(message); }
        Button? FindLock(DependencyObject node) {
            if (node is Button button && AutomationProperties.GetName(button) == "Bloquear o mover widget") return button;
            for (int i = 0; i < VisualTreeHelper.GetChildrenCount(node); i++)
                if (FindLock(VisualTreeHelper.GetChild(node, i)) is { } found) return found;
            return null;
        }
        UpdateCaptionRegion();
        Require(captionRegion is { Width: > 0, Height: > 0 }, "Falta la región nativa de arrastre de " + kind);
        if (kind == "widget") {
            var button = FindLock((DependencyObject)Content) ?? throw new InvalidOperationException("Falta el candado del widget.");
            var invoke = (IInvokeProvider)new ButtonAutomationPeer(button).GetPattern(PatternInterface.Invoke);
            Require(button.ActualWidth >= 44 && button.ActualHeight >= 44, "El candado perdió su área de interacción.");
            invoke.Invoke(); await Task.Delay(150);
            Require(model.Settings.WidgetLocked && captionRegion is { Width: 0 } && AppWindow.Presenter is Microsoft.UI.Windowing.OverlappedPresenter { IsResizable: false }, "El candado no bloquea la región de arrastre y el tamaño.");
            invoke.Invoke(); await Task.Delay(150);
            Require(!model.Settings.WidgetLocked && captionRegion is { Width: > 0 } && AppWindow.Presenter is Microsoft.UI.Windowing.OverlappedPresenter { IsResizable: true }, "Desbloquear no restaura la región de arrastre.");
        }
        var before = WindowsIntegration.Placement(this);
        var work = WindowsIntegration.Display(WindowsIntegration.Handle(this)).Work;
        int x = Math.Clamp(before.X + 40, work.Left, Math.Max(work.Left, work.Right - before.Width));
        int y = Math.Clamp(before.Y + 30, work.Top, Math.Max(work.Top, work.Bottom - before.Height));
        AppWindow.Move(new(x, y)); await Task.Delay(150);
        Require(AppWindow.Position.X == x && AppWindow.Position.Y == y, "La ventana no se movió dentro del monitor.");
        Require(model.Settings.Windows.TryGetValue(kind, out var saved) && saved.X == x && saved.Y == y, "La nueva posición no se guardó.");
        Close(); ShowView(); await Task.Delay(150);
        Require(AppWindow.Position.X == x && AppWindow.Position.Y == y, "La reapertura perdió la posición.");
        return new { kind, caption = true, lockChecked = kind == "widget", positionPreserved = true };
    }
}
