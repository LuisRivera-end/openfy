using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;
using Openfy.Core;

namespace Openfy.Windows.Views;

/// <summary>Keyboard shortcuts, the mouse side buttons and the Back/Forward history of the main window.</summary>
public sealed partial class MainWindow
{
    private readonly NavigationHistory history = new();
    /// <summary>Set by the player bar: the same toggles as its Letras and Cola buttons.</summary>
    private Action? toggleLyricsPanel, toggleQueuePanel;

    private void AttachShortcuts()
    {
        model.PropertyChanged += (_, args) => { if (args.PropertyName == nameof(model.Page)) history.Visit(model.Route); };
        history.Visit(model.Route);
        // Preview (tunnelling) so lists and sliders do not swallow the modified arrows before the window sees them.
        root.PreviewKeyDown += (_, args) => {
            if (ShortcutKeys.Command(args, root.XamlRoot) is { } command && Run(command)) args.Handled = true;
        };
        root.AddHandler(UIElement.PointerPressedEvent, new PointerEventHandler((_, args) => {
            if (ShortcutKeys.Command(args, root) is { } command && Run(command)) args.Handled = true;
        }), true);
    }

    private bool Run(string command)
    {
        if (ShortcutKeys.RunPlayback(model, command)) return true;
        switch (command)
        {
            case "big-picture": if (model.Current == null) return false; openPlayer("fullscreen"); return true;
            case "queue": if (toggleQueuePanel == null) return false; toggleQueuePanel(); return true;
            case "lyrics": if (model.Current == null || toggleLyricsPanel == null) return false; toggleLyricsPanel(); return true;
            case "search": search.Focus(FocusState.Keyboard); search.SelectAll(); return true;
            case "back": return Replay(history.Back());
            case "forward": return Replay(history.Forward());
            default: return false;
        }
    }

    /// <summary>The Ajustes list, the same as the web's ShortcutGuide.</summary>
    private void ShortcutSettings()
    {
        var section = SettingsSection("Atajos de teclado");
        var note = Ui.Muted("Funcionan mientras Openfy está activo y no estás escribiendo.", 12); note.Margin = new(0, 0, 0, 8); section.Children.Add(note);
        foreach (var (keys, label) in Shortcuts.Guide)
        {
            var row = new Grid { Padding = new(0, 10, 0, 10), ColumnSpacing = 16, BorderBrush = Ui.Brush("#FFFFFF0D"), BorderThickness = new(0, 0, 0, 1) };
            row.ColumnDefinitions.Add(new() { Width = new(1, GridUnitType.Star) }); row.ColumnDefinitions.Add(new() { Width = GridLength.Auto });
            var name = Ui.Text(label, 13); name.VerticalAlignment = VerticalAlignment.Center; row.Children.Add(name);
            var caps = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 6, VerticalAlignment = VerticalAlignment.Center };
            var groups = keys.Split(" · ");
            for (int group = 0; group < groups.Length; group++)
            {
                if (group > 0) caps.Children.Add(KeyText("o"));
                var parts = groups[group].Split(" + ");
                for (int part = 0; part < parts.Length; part++)
                {
                    if (part > 0) caps.Children.Add(KeyText("+"));
                    caps.Children.Add(new Border { Padding = new(7, 3, 7, 3), MinWidth = 24, CornerRadius = new(6), BorderThickness = new(1, 1, 1, 2), BorderBrush = Ui.Brush("#FFFFFF1F"), Background = Ui.Brush("#FFFFFF0F"), Child = new TextBlock { Text = parts[part], FontSize = 11, FontWeight = Microsoft.UI.Text.FontWeights.SemiBold, Foreground = Ui.Brush("#E4E4E7"), HorizontalAlignment = HorizontalAlignment.Center } });
                }
            }
            AutomationProperties.SetName(row, label + ": " + keys.Replace(" · ", " o "));
            Grid.SetColumn(caps, 1); row.Children.Add(caps); section.Children.Add(row);
        }
        static TextBlock KeyText(string text) { var block = Ui.Muted(text, 11); block.VerticalAlignment = VerticalAlignment.Center; return block; }
    }

    private bool Replay(string? route)
    {
        if (route == null) return false;
        _ = model.RunAsync(() => model.NavigateRouteAsync(route));
        return true;
    }
}
