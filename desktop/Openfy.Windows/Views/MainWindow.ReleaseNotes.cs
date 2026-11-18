using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Documents;
using Microsoft.UI.Xaml.Media;
using Openfy.Core;

namespace Openfy.Windows.Views;

/// <summary>"Novedades": once after an update, one section per version installed since the last one this device saw (shared/release-notes.json).</summary>
public sealed partial class MainWindow
{
    private const string ReleaseNotesFile = "release-notes";

    public async Task ShowPendingReleaseNotesAsync()
    {
        string current = ReleaseInfo.Current.Version;
        var state = await model.Store.ReadAsync<ReleaseNotesState>(ReleaseNotesFile);
        var pending = ReleaseNotes.Since(ReleaseNotes.Bundled, state?.LastSeen, current);
        if (pending.Count == 0) { if (state?.LastSeen != current) await model.Store.WriteAsync(ReleaseNotesFile, new ReleaseNotesState(current)); return; }
        string? since = pending.Count > 1 && ReleaseNotes.Parse(state?.LastSeen) != null ? state!.LastSeen : null;
        // Recorded only once the dialog was actually closed, so a crash or exit before that shows it again.
        if (await ShowReleaseNotesAsync(pending, since)) await model.Store.WriteAsync(ReleaseNotesFile, new ReleaseNotesState(current));
    }

    private async Task ShowReleaseNotesHistoryAsync() => await ShowReleaseNotesAsync(ReleaseNotes.Since(ReleaseNotes.Bundled, "0.0.0", ReleaseInfo.Current.Version), null);

    private async Task<bool> ShowReleaseNotesAsync(IReadOnlyList<ReleaseNote> releases, string? since)
    {
        // WinUI allows a single open ContentDialog; another dialog or flyout postpones the notes to the next launch.
        if (releases.Count == 0 || root.XamlRoot == null || VisualTreeHelper.GetOpenPopupsForXamlRoot(root.XamlRoot).Count > 0) return false;
        var body = new StackPanel { Spacing = 0 };
        if (since != null) { var intro = Ui.Muted($"Esto es lo nuevo desde la {since}.", 13); intro.Margin = new(0, 0, 0, 4); body.Children.Add(intro); }
        for (int index = 0; index < releases.Count; index++) body.Children.Add(ReleaseSection(releases[index], index > 0));
        var dialog = new ContentDialog
        {
            XamlRoot = root.XamlRoot, Title = "Novedades", CloseButtonText = "Entendido", DefaultButton = ContentDialogButton.Close, RequestedTheme = ElementTheme.Dark,
            Content = new ScrollViewer { Content = body, MaxHeight = 460, MaxWidth = 470, Padding = new(0, 0, 12, 0), VerticalScrollBarVisibility = ScrollBarVisibility.Auto }
        };
        // "Entendido" is the green primary action, as in the PWA (scoped to this dialog's own button).
        foreach (var (key, color) in new[] { ("AccentButtonBackground", "#1ED760"), ("AccentButtonBackgroundPointerOver", "#4AE37F"), ("AccentButtonBackgroundPressed", "#19BD54"), ("AccentButtonForeground", "#07160B"), ("AccentButtonForegroundPointerOver", "#07160B"), ("AccentButtonForegroundPressed", "#07160B") }) dialog.Resources[key] = Ui.Brush(color);
        try { await dialog.ShowAsync(); return true; }
        catch (Exception error) when (error is InvalidOperationException or System.Runtime.InteropServices.COMException) { SessionLog.Write("release-notes", "skipped", error: error); return false; }
    }

    private static FrameworkElement ReleaseSection(ReleaseNote release, bool separated)
    {
        var section = new StackPanel { Spacing = 6, Padding = new(0, 16, 0, 16), BorderBrush = Ui.Brush("#FFFFFF12"), BorderThickness = new(0, separated ? 1 : 0, 0, 0) };
        var heading = new TextBlock { TextWrapping = TextWrapping.Wrap };
        heading.Inlines.Add(new Run { Text = $"Versión {release.Version} ", FontSize = 15, FontWeight = Microsoft.UI.Text.FontWeights.SemiBold, Foreground = Ui.Brush("#F4F4F5") });
        heading.Inlines.Add(new Run { Text = "· " + ReleaseNotes.FormatDate(release.Date), FontSize = 12, Foreground = Ui.Brush("#8F8F99") });
        section.Children.Add(heading);
        if (!string.IsNullOrWhiteSpace(release.Summary)) { var summary = Ui.Text(release.Summary, 13); summary.Foreground = Ui.Brush("#B5B5BF"); summary.LineHeight = 21; section.Children.Add(summary); }
        var items = new StackPanel { Spacing = 10, Margin = new(0, 6, 0, 0) };
        foreach (var item in release.Items) items.Children.Add(ReleaseItem(item));
        section.Children.Add(items);
        return section;
    }

    private static FrameworkElement ReleaseItem(ReleaseNoteItem item)
    {
        var (foreground, background) = item.Type switch { "improved" => ("#9CC4FF", "#6AA2FF18"), "fixed" => ("#F2C27B", "#F2A93B18"), _ => ("#7BEA9F", "#1ED76018") };
        var label = Ui.Text(ReleaseNotes.Labels.GetValueOrDefault(item.Type, "Nuevo").ToUpperInvariant(), 10, true); label.Foreground = Ui.Brush(foreground); label.HorizontalAlignment = HorizontalAlignment.Center; label.CharacterSpacing = 20;
        var tag = new Border { CornerRadius = new(9), Background = Ui.Brush(background), Padding = new(8, 2, 8, 2), MinWidth = 62, VerticalAlignment = VerticalAlignment.Top, Margin = new(0, 2, 0, 0), Child = label };
        var text = Ui.Text(item.Text, 13); text.Foreground = Ui.Brush("#DCDCE2"); text.LineHeight = 20;
        var row = new Grid { ColumnSpacing = 10 }; row.ColumnDefinitions.Add(new() { Width = GridLength.Auto }); row.ColumnDefinitions.Add(new() { Width = new(1, GridUnitType.Star) });
        row.Children.Add(tag); Grid.SetColumn(text, 1); row.Children.Add(text);
        return row;
    }
}
