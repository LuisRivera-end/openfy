using System.Diagnostics;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Openfy.Core;

namespace Openfy.Windows.Views;

public sealed partial class MainWindow
{
    internal async Task<object> CheckDownloadsPerformanceAsync()
    {
        // This mode runs only with a separate --state-dir/--data-dir. The fixture
        // is in memory: no requests to YouTube and no changes to the user's songs.
        model.Downloads.Clear();
        for (int i = 0; i < 500; i++) {
            var song = new YouTubeSong($"perf{i:0000000}", $"Canción de rendimiento {i}", ["Openfy"], null, null, 180);
            model.Downloads.Add(new($"performance-{i}", song.VideoId, song, "queued", 0, 100, 0, null, null, true, i, i));
        }
        var opening = Stopwatch.StartNew();
        model.ShowLocal("downloads"); root.UpdateLayout();
        await Task.Delay(250); root.UpdateLayout();
        var openingMs = opening.Elapsed.TotalMilliseconds;
        var rows = downloadRows ?? throw new IOException("No se creó la lista de descargas.");
        int Realized() => Enumerable.Range(0, rows.Items.Count).Count(i => rows.ContainerFromIndex(i) != null);
        var initialRealized = Realized();
        if (initialRealized is <= 0 or >= 100) throw new IOException($"La lista no virtualiza las 500 canciones: {initialRealized} contenedores.");
        var initial = model.Downloads[0];
        model.Downloads[0] = initial with { State = "downloading", Bytes = 77, UpdatedAt = 1000 };
        await Task.Delay(100); root.UpdateLayout();
        bool progressVisible = rows.ContainerFromIndex(0) is DependencyObject first && DownloadText(first).Any(text => text.Contains("77 %"));
        if (!progressVisible) throw new IOException("La fila visible no refleja el progreso recibido.");
        rows.ScrollIntoView(model.Downloads[^1]);
        await Task.Delay(250); root.UpdateLayout();
        bool lastVisible = rows.ContainerFromIndex(499) is DependencyObject last && DownloadText(last).Contains(model.Downloads[^1].Song.Title);
        if (!lastVisible) throw new IOException("No se puede recorrer la lista hasta la canción 500.");
        int endRealized = Realized(), builtBefore = downloadRowsBuilt;
        var updates = Stopwatch.StartNew();
        for (int i = 0; i < 100; i++) model.Downloads[i] = model.Downloads[i] with { Bytes = 50, UpdatedAt = 2000 };
        root.UpdateLayout();
        var offscreenUpdatesMs = updates.Elapsed.TotalMilliseconds;
        int offscreenRowsBuilt = downloadRowsBuilt - builtBefore;
        if (offscreenRowsBuilt >= 100) throw new IOException("El progreso fuera de pantalla reconstruye las filas ocultas.");
        var scroll = Ui.Find<ScrollViewer>(rows);
        double offset = scroll?.VerticalOffset ?? 0;
        model.ShowLocal("downloads"); root.UpdateLayout();
        bool retained = ReferenceEquals(rows, downloadRows) && Math.Abs((scroll?.VerticalOffset ?? 0) - offset) < 1;
        if (!retained) throw new IOException("Actualizar la biblioteca recrea la lista o pierde su desplazamiento.");
        return new { passed = true, songs = 500, openingMs, initialRealized, endRealized, progressVisible, lastVisible, offscreenUpdatesMs, offscreenRowsBuilt, retained };
    }
    private static IEnumerable<string> DownloadText(DependencyObject parent)
    {
        if (parent is TextBlock text) yield return text.Text;
        for (int i = 0; i < VisualTreeHelper.GetChildrenCount(parent); i++)
            foreach (var value in DownloadText(VisualTreeHelper.GetChild(parent, i))) yield return value;
    }
}
