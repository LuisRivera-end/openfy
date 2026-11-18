using System.Text.Json;
using Openfy.Core;

namespace Openfy.Windows;

public partial class App
{
    // Explicit QA mode. Call with isolated --data-dir and --state-dir.
    private async Task ListeningSmokeAsync(string fixture)
    {
        var steps = new Dictionary<string, object>();
        try
        {
            void Require(bool condition, string message) { if (!condition) throw new InvalidOperationException(message); }
            await model!.Host.CallAsync<JsonElement>("importPaths", new { paths = new[] { Path.GetFullPath(fixture) } });
            for (int i = 0; i < 100; i++) { await model.RefreshAsync(); if (model.Library.Tracks.Count > 0) break; await Task.Delay(100); }
            var track = model.Library.Tracks.First(); var song = model.Describe(new("local", track.Id)); model.Volume = 0;
            await model.PlayAsync(song); main!.AppWindow.Hide();
            await Task.Delay(TimeSpan.FromSeconds(track.Duration + 1)); model.Tick();
            await model.Listening.CheckpointAsync(); await model.Listening.FlushAsync();
            var statistics = await model.Api.GetAsync<ListeningStats>("api/telemetry/stats?period=all"); var stats = statistics.ByTrack.GetValueOrDefault(track.Id) ?? throw new InvalidOperationException("No se guardó la escucha nativa.");
            Require(stats.Plays == 1, "La escucha completa en bandeja no produjo exactamente una reproducción.");
            Require(stats.ListenedMs >= track.Duration * 900, "No se guardaron los minutos reales de escucha."); steps["backgroundPlayback"] = stats;
            await model.PlayAsync(song); await Task.Delay(250); await model.SeekAsync(track.Duration - .2); await Task.Delay(600); model.Tick();
            await model.Listening.CheckpointAsync(); await model.Listening.FlushAsync();
            statistics = await model.Api.GetAsync<ListeningStats>("api/telemetry/stats?period=all"); Require(statistics.ByTrack[track.Id].Plays == 1, "Saltar al final sumó una reproducción."); steps["seekExcluded"] = true;
            await model.Listening.FlushAsync();
            Require((await model.Api.GetAsync<ListeningStats>("api/telemetry/stats?period=all")).ByTrack[track.Id].Plays == 1, "Reintentar la sincronización duplicó la reproducción."); steps["idempotentSync"] = true;
            model.ShowLocal("library"); model.UpdateFilters(filter => filter.Genre = "Sin género"); Require(model.Songs.Count == 1, "El filtro por género no conservó la canción sin etiquetas.");
            model.UpdateFilters(filter => filter.Source = "youtube"); Require(model.Songs.Count == 0, "El filtro de origen mezcló canciones locales."); model.ResetFilters(); Require(model.Songs.Count == 1, "Limpiar filtros no restauró la biblioteca."); steps["filters"] = true;
            await model.ShowMostPlayedAsync(); Require(model.Songs.Count == 1 && model.Songs[0].Plays == 1, "El ranking nativo no reflejó la escucha."); steps["ranking"] = true;
            await File.WriteAllTextAsync(Path.Combine(model.Store.Root, "listening-smoke.json"), JsonSerializer.Serialize(new { passed = true, steps }, Contracts.Json));
        }
        catch (Exception error) { await File.WriteAllTextAsync(Path.Combine(model!.Store.Root, "listening-smoke.json"), JsonSerializer.Serialize(new { passed = false, error = error.ToString(), steps }, Contracts.Json)); }
        finally { await ShutdownAsync(); }
    }
}
