using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;

namespace Openfy.Windows.Views;

/// <summary>The player windows answer the playback shortcuts; Big Picture also leaves with B, F11, Back and the mouse back button.</summary>
public sealed partial class PlayerWindow
{
    private void AttachShortcuts(Grid root)
    {
        KeyEventHandler keys = (_, args) => { if (ShortcutKeys.Command(args, root.XamlRoot) is { } command && RunShortcut(command)) args.Handled = true; };
        PointerEventHandler buttons = (_, args) => { if (ShortcutKeys.Command(args, root) is { } command && RunShortcut(command)) args.Handled = true; };
        root.PreviewKeyDown += keys; root.AddHandler(UIElement.PointerPressedEvent, buttons, true);
        Ui.OnRelease(root, () => { root.PreviewKeyDown -= keys; root.RemoveHandler(UIElement.PointerPressedEvent, buttons); });
    }

    private bool RunShortcut(string command)
    {
        if (ShortcutKeys.RunPlayback(model, command)) return true;
        if (Full && command is "big-picture" or "back") { Close(); return true; }
        return false;
    }
}
