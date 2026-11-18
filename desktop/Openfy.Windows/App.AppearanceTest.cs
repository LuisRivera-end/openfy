using System.Text.Json;
using System.Text.Json.Nodes;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Openfy.Core;
using Openfy.Windows.Views;

namespace Openfy.Windows;

public partial class App
{
    // Runs only inside the existing opt-in smoke, using its isolated data and state.
    private async Task AppearanceSmokeAsync(Dictionary<string, object> steps)
    {
        void Require(bool condition, string message) { if (!condition) throw new InvalidOperationException(message); }
        static string Style(DependencyObject node)
        {
            var values = new List<string>();
            void Walk(DependencyObject item) {
                if (item is TextBlock text) values.Add($"text:{text.FontSize}");
                if (item is Border border) values.Add($"border:{border.CornerRadius}:{border.Background switch { AcrylicBrush glass => $"{glass.TintColor}:{glass.TintOpacity}", SolidColorBrush solid => solid.Color.ToString(), _ => "other" }}");
                if (item is Button button) values.Add($"button:{button.CornerRadius}");
                if (item is Grid grid) values.Add($"grid:{grid.Padding}");
                for (int i = 0; i < VisualTreeHelper.GetChildrenCount(item); i++) Walk(VisualTreeHelper.GetChild(item, i));
            }
            Walk(node); return string.Join(";", values);
        }
        var root = (FrameworkElement)main!.Content;
        Appearance.Apply(root);
        string first = Style(root);
        Appearance.Apply(root); Appearance.Apply(root);
        Require(first == Style(root), "La aplicación repetida de apariencia alteró sus medidas.");
        var display = new TextBlock { FontSize = 80, Tag = "display" };
        Appearance.Apply(display); Require(display.FontSize == 80, "El título de artista perdió su escala.");
        var artwork = new Border { CornerRadius = new(24), Tag = "home-artwork" };
        Appearance.Apply(artwork); Require(artwork.CornerRadius.TopLeft == 24, "La portada perdió su geometría.");
        steps["appearanceIdempotent"] = true;

        var song = new YouTubeSong("abcdefghijk", "Actual", ["Openfy"], null, null, 120);
        var selected = song with { VideoId = "12345678901", Title = "Seleccionada" };
        var playback = new PlaybackSnapshot(3, [new("youtube", Song: song, QueueId: "appearance-0"), new("youtube", Song: selected, QueueId: "appearance-1"), new("youtube", Song: song, QueueId: "appearance-2")], 1, 27.25, "all", true, .42, ["appearance-2", "appearance-1", "appearance-0"]);
        var arguments = Environment.GetCommandLineArgs();
        int external = Array.IndexOf(arguments, "--appearance-session");
        string sessionPath = Path.Combine(model!.Store.Root, "appearance-import.json");
        foreach (bool? previous in new bool?[] { null, false, true }) {
            var preferences = new JsonObject { ["effects"] = false };
            if (previous.HasValue) preferences["newDesign"] = previous.Value;
            await File.WriteAllTextAsync(sessionPath, new JsonObject { ["version"] = 1, ["preferences"] = preferences, ["playback"] = JsonSerializer.SerializeToNode(playback, Contracts.Json) }.ToJsonString());
            await model.ImportSessionAsync(sessionPath);
            Require(!model.Playing && model.CurrentIndex == 1 && model.Position == 27.25 && model.Volume == .42 && model.ShuffleEnabled && model.RepeatMode == "all" && !model.Settings.Effects, "La importación antigua cambió la reproducción o los efectos.");
            Require(model.Queue.Select(row => row.Entry.QueueId).SequenceEqual(playback.Queue.Select(entry => entry.QueueId)), "Se perdieron apariciones de la cola.");
        }
        if (external >= 0 && external + 1 < arguments.Length) await model.ImportSessionAsync(arguments[external + 1]);
        string exportPath = Path.Combine(model.Store.Root, "appearance-export.json");
        await model.ExportSessionAsync(exportPath);
        var exported = JsonNode.Parse(await File.ReadAllTextAsync(exportPath))!;
        Require(JsonNode.DeepEquals(exported["playback"], JsonSerializer.SerializeToNode(playback, Contracts.Json)), "La sesión intercambiada cambió la cola o el orden original.");
        Require(exported["preferences"]!.AsObject().Count == 1 && exported["preferences"]!["effects"]!.GetValue<bool>() == false, "La exportación conserva preferencias de diseño retiradas.");
        await model.ImportSessionAsync(exportPath);
        steps["appearanceSessionCompatibility"] = true;
        steps["appearanceWebSessionImported"] = external >= 0;
        // Leave the normal audio/rendering smoke with an empty queue and its own settings.
        await File.WriteAllTextAsync(sessionPath, JsonSerializer.Serialize(PlaybackSnapshot.Empty, Contracts.Json));
        await model.ImportSessionAsync(sessionPath);
    }
}
