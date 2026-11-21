using Microsoft.UI.Input;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Controls.Primitives;
using Microsoft.UI.Xaml.Input;
using Openfy.Core;
using Openfy.Windows.ViewModels;
using Windows.System;
using Windows.UI.Core;

namespace Openfy.Windows.Views;

/// <summary>Translates WinUI input into <see cref="Shortcuts"/> and runs the playback commands every Openfy window shares.</summary>
internal static class ShortcutKeys
{
    private static double unmuted = 1;

    private static bool Down(VirtualKey key) => InputKeyboardSource.GetKeyStateForCurrentThread(key).HasFlag(CoreVirtualKeyStates.Down);

    private static string? Name(VirtualKey key) => key switch {
        >= VirtualKey.A and <= VirtualKey.Z => ((char)key).ToString(),
        VirtualKey.Space => "Space", VirtualKey.Escape => "Escape", VirtualKey.F11 => "F11",
        VirtualKey.Left => "ArrowLeft", VirtualKey.Right => "ArrowRight", VirtualKey.Up => "ArrowUp", VirtualKey.Down => "ArrowDown",
        VirtualKey.GoBack => "BrowserBack", VirtualKey.GoForward => "BrowserForward",
        _ => null,
    };

    /// <summary>Text entry keeps every key it can type or edit with.</summary>
    private static bool Editable(object? source) => source is TextBox or PasswordBox or RichEditBox or AutoSuggestBox or ComboBox { IsEditable: true };

    /// <summary>Space activates or selects the focused control; only an inert target makes it play or pause.</summary>
    private static bool ActivatesWithSpace(object? source) => source is ButtonBase or Slider or SelectorItem or ToggleSwitch or ComboBox or HyperlinkButton;

    /// <summary>The shortcut command for a key press, or null when the focused control keeps it.</summary>
    public static string? Command(KeyRoutedEventArgs args, XamlRoot? root)
    {
        if (args.Handled || Name(args.Key) is not { } key) return null;
        // Dialogs and menus own the keyboard while they are open.
        if (root != null && Microsoft.UI.Xaml.Media.VisualTreeHelper.GetOpenPopupsForXamlRoot(root).Count > 0) return null;
        // Holding a key repeats seek and volume only; a repeated toggle would flicker.
        if (args.KeyStatus.WasKeyDown && key is not ("ArrowLeft" or "ArrowRight" or "ArrowUp" or "ArrowDown")) return null;
        bool editable = Editable(args.OriginalSource);
        if (key == "Space" && !editable && ActivatesWithSpace(args.OriginalSource)) return null;
        return Shortcuts.Command(new(key, Down(VirtualKey.Control), Down(VirtualKey.Shift), Down(VirtualKey.Menu), Down(VirtualKey.LeftWindows) || Down(VirtualKey.RightWindows), editable));
    }

    /// <summary>"back" or "forward" for the mouse side buttons (XButton1/XButton2), otherwise null.</summary>
    public static string? Command(PointerRoutedEventArgs args, UIElement relativeTo)
    {
        if (args.Pointer.PointerDeviceType != PointerDeviceType.Mouse) return null;
        var properties = args.GetCurrentPoint(relativeTo).Properties;
        string? key = properties.IsXButton1Pressed ? "MouseBack" : properties.IsXButton2Pressed ? "MouseForward" : null;
        return key == null || relativeTo.XamlRoot is { } root && Microsoft.UI.Xaml.Media.VisualTreeHelper.GetOpenPopupsForXamlRoot(root).Count > 0 ? null : Shortcuts.Command(new(key));
    }

    /// <summary>Runs a playback command shared by the main window and the player windows; false when it is not one.</summary>
    public static bool RunPlayback(MainViewModel model, string command)
    {
        switch (command)
        {
            case "toggle-playback": if (model.Current == null) return false; _ = model.RunAsync(model.ToggleAsync); return true;
            case "next": _ = model.RunAsync(() => model.AdvanceAsync(1)); return true;
            case "previous": _ = model.RunAsync(() => model.AdvanceAsync(-1)); return true;
            case "seek-forward" or "seek-backward":
                if (model.Current == null) return false;
                double target = Math.Clamp(model.Position + (command == "seek-forward" ? Shortcuts.SeekSeconds : -Shortcuts.SeekSeconds), 0, Math.Max(0, model.Duration));
                _ = model.RunAsync(() => model.SeekAsync(target)); return true;
            case "volume-up" or "volume-down":
                model.Volume = Math.Clamp(Math.Round(model.Volume + (command == "volume-up" ? Shortcuts.VolumeStep : -Shortcuts.VolumeStep), 2), 0, 1); return true;
            case "mute":
                if (model.Volume > 0) { unmuted = model.Volume; model.Volume = 0; } else model.Volume = unmuted > 0 ? unmuted : 1;
                return true;
            case "shuffle": if (model.Current == null) return false; model.Shuffle(); return true;
            case "repeat": model.CycleRepeat(); return true;
            case "favorite": if (model.Current is not { } song) return false; _ = model.RunAsync(() => model.FavoriteAsync(song)); return true;
            default: return false;
        }
    }
}
