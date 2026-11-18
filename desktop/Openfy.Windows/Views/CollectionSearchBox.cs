using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;

namespace Openfy.Windows.Views;

/// <summary>The default WinUI TextBox template does not bind VerticalContentAlignment.</summary>
public sealed partial class CollectionSearchBox : TextBox
{
    public bool ShowClearButton { get; init; } = true;
    protected override void OnApplyTemplate()
    {
        base.OnApplyTemplate();
        if (GetTemplateChild("ContentElement") is FrameworkElement content) content.VerticalAlignment = VerticalAlignment.Center;
        if (GetTemplateChild("PlaceholderTextContentPresenter") is FrameworkElement placeholder) placeholder.VerticalAlignment = VerticalAlignment.Center;
        if (GetTemplateChild("DeleteButton") is Button clear) {
            if (!ShowClearButton) {
                // TextBox visual states can restore Visibility when text or focus changes.
                clear.MinWidth = clear.MaxWidth = clear.Width = 0;
                clear.Visibility = Visibility.Collapsed; clear.IsHitTestVisible = false; clear.IsTabStop = false;
                AutomationProperties.SetAccessibilityView(clear, Microsoft.UI.Xaml.Automation.Peers.AccessibilityView.Raw); return;
            }
            AutomationProperties.SetName(clear, "Borrar búsqueda");
            AutomationProperties.SetAccessibilityView(clear, Microsoft.UI.Xaml.Automation.Peers.AccessibilityView.Control);
            clear.IsTabStop = true;
        }
    }
}
