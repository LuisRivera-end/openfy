using System.Text.Json;
using Openfy.Core;

namespace Openfy.Windows;

public partial class App
{
    private async Task OfflineSmokeAsync(string videoId)
    {
        var report = Path.Combine(model!.Store.Root, "offline-smoke.json");
        try
        {
            var saved = model.Library.SavedSongs.FirstOrDefault(saved => saved.Song.VideoId == videoId)
                ?? throw new InvalidOperationException("La canción no está guardada en la biblioteca de prueba.");
            if (saved.LocalAudio == null) throw new InvalidOperationException("La canción no tiene una copia local verificada.");
            var entry = model.Library.EntryForId("youtube:" + videoId)!;
            model.Volume = 0;
            await model.PlayAsync(model.Describe(entry));
            await Task.Delay(700); model.Tick();
            if (model.Position <= .1 || model.Error.Length > 0) throw new InvalidOperationException("La copia local no inició la reproducción: " + model.Error);
            double seek = Math.Min(saved.LocalAudio.Duration * .6, saved.LocalAudio.Duration - 1);
            await model.SeekAsync(seek); await Task.Delay(400); model.Tick();
            if (model.Position < seek || model.Error.Length > 0) throw new InvalidOperationException("Seek de la copia local falló: " + model.Error);
            model.Engine.Pause(); await model.SeekAsync(1);
            if (model.Playing) throw new InvalidOperationException("El seek pausado inició la reproducción.");
            model.ShowLocal("downloads");
            // Downloads renders its jobs directly; the ordinary song list is
            // intentionally empty on this page after virtualization.
            if (entry.Source != "youtube" || !model.Library.IsDownloaded(entry)
                || model.Downloads.All(job => job.VideoId != videoId || job.State != "ready"))
                throw new InvalidOperationException("La descarga perdió su identidad de YouTube.");
            await File.WriteAllTextAsync(report, JsonSerializer.Serialize(new { passed = true, key = entry.Key, source = entry.Source,
                duration = saved.LocalAudio.Duration, seek, favorite = model.Library.IsFavorite(entry), windowsAudio = true }, Contracts.Json));
        }
        catch (Exception failure) { await File.WriteAllTextAsync(report, JsonSerializer.Serialize(new { passed = false, error = failure.ToString() }, Contracts.Json)); }
        finally { await ShutdownAsync(); }
    }
}
