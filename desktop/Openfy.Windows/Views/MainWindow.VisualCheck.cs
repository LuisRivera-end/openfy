using System.Runtime.InteropServices.WindowsRuntime;
using System.Text.Json;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media.Imaging;
using Openfy.Core;
using Openfy.Windows.Services;
using Windows.Graphics.Imaging;
using Windows.Storage;

namespace Openfy.Windows.Views;

public sealed partial class MainWindow
{
    // Opt-in component rendering for isolated desktop QA; never reads the desktop.
    public async Task VisualCheckAsync(string directory)
    {
        directory = Path.GetFullPath(directory); Directory.CreateDirectory(directory);
        var arguments = Environment.GetCommandLineArgs();
        var steps = new Dictionary<string, object>();
        void Require(bool condition, string message) { if (!condition) throw new InvalidOperationException(message); }
        async Task Capture(string name)
        {
            await Task.Delay(450); root.UpdateLayout();
            var bitmap = new RenderTargetBitmap(); await bitmap.RenderAsync(root);
            var pixels = (await bitmap.GetPixelsAsync()).ToArray();
            var folder = await StorageFolder.GetFolderFromPathAsync(directory);
            var file = await folder.CreateFileAsync(name + ".png", CreationCollisionOption.ReplaceExisting);
            using var stream = await file.OpenAsync(FileAccessMode.ReadWrite);
            var encoder = await BitmapEncoder.CreateAsync(BitmapEncoder.PngEncoderId, stream);
            encoder.SetPixelData(BitmapPixelFormat.Bgra8, BitmapAlphaMode.Premultiplied, (uint)bitmap.PixelWidth, (uint)bitmap.PixelHeight, 96, 96, pixels); await encoder.FlushAsync();
            Require(bitmap.PixelWidth > 0 && bitmap.PixelHeight > 0, "La vista no produjo píxeles.");
            steps[name] = new { width = bitmap.PixelWidth, height = bitmap.PixelHeight, page = model.Page, songs = model.Songs.Count };
        }
        try
        {
            if (arguments.Contains("--visual-collections-only")) {
                await CheckCollectionsAsync(Capture, steps);
                await File.WriteAllTextAsync(Path.Combine(directory, "visual-check.json"), JsonSerializer.Serialize(new { passed = true, dpi = WindowsIntegration.Dpi(this), steps }, Contracts.Json));
                return;
            }
            if (arguments.Contains("--visual-home-only"))
            {
                for (int i = 0; i < 300 && model.RecommendationsBusy; i++) await Task.Delay(100);
                AppWindow.Resize(WindowsIntegration.Scaled(this, 1360, 940)); model.ShowLocal("home"); await Capture("home-desktop");
                Require(HomeLibrarySongs().Count > 0, "La revisión poblada necesita una colección de prueba.");
                Require(!catalog.Children.OfType<TextBlock>().Any(text => text.Text.Contains("Dale play") || text.Text.Contains("Tu música en números")), "El inicio conserva bloques promocionales o métricas.");
                var shelf = catalog.Children.OfType<Microsoft.UI.Xaml.Controls.StackPanel>().FirstOrDefault(panel => Microsoft.UI.Xaml.Automation.AutomationProperties.GetName(panel) == "Sugerencias para ti");
                if (shelf?.Children.OfType<Microsoft.UI.Xaml.Controls.ScrollViewer>().FirstOrDefault() is { } rail && rail.ScrollableWidth > 200)
                {
                    rail.ChangeView(200, null, null, true); await Task.Delay(100);
                    var first = model.Recommendations.Songs[1]; var focusName = "Sugerencias para ti:youtube:" + first.VideoId;
                    FindHomeFocus(catalog, focusName)?.Focus(Microsoft.UI.Xaml.FocusState.Programmatic);
                    renderedHomeKey = ""; await model.RefreshListeningAsync(); await Task.Delay(150);
                    var restoredShelf = catalog.Children.OfType<Microsoft.UI.Xaml.Controls.StackPanel>().First(panel => Microsoft.UI.Xaml.Automation.AutomationProperties.GetName(panel) == "Sugerencias para ti");
                    var restoredRail = restoredShelf.Children.OfType<Microsoft.UI.Xaml.Controls.ScrollViewer>().First();
                    Require(Math.Abs(restoredRail.HorizontalOffset - 200) < 2, "La actualización perdió el desplazamiento horizontal.");
                    Require(Microsoft.UI.Xaml.Input.FocusManager.GetFocusedElement(root.XamlRoot) is Microsoft.UI.Xaml.Controls.Button focused && Microsoft.UI.Xaml.Automation.AutomationProperties.GetAutomationId(focused) == focusName, "La actualización perdió el foco.");
                    steps["home-refresh-preserved"] = true; restoredRail.ChangeView(0, null, null, true);
                }
                AppWindow.Resize(WindowsIntegration.Scaled(this, 960, 760)); await Capture("home-compact");
                AppWindow.Resize(WindowsIntegration.Scaled(this, 780, 720)); await Capture("home-narrow");
                await model.ShowMostPlayedAsync(); await Capture("home-listening");
                await File.WriteAllTextAsync(Path.Combine(directory, "visual-check.json"), JsonSerializer.Serialize(new { passed = true, steps }, Contracts.Json));
                return;
            }
            if (!arguments.Contains("--visual-catalog-only"))
            {
            AppWindow.Resize(WindowsIntegration.Scaled(this, 1360, 940)); model.ShowLocal("home"); await Capture("01-home-empty");
            int fixture = Array.IndexOf(arguments, "--visual-fixtures");
            if (fixture >= 0 && fixture + 1 < arguments.Length)
            {
                string[] files = Directory.GetFiles(Path.GetFullPath(arguments[fixture + 1]), "*.mp3");
                await model.Host.CallAsync<JsonElement>("importPaths", new { paths = files });
                for (int i = 0; i < 120; i++) { await model.RefreshAsync(); if (model.Library.Tracks.Count >= files.Length) break; await Task.Delay(100); }
                Require(model.Library.Tracks.Count >= files.Length && files.Length > 0, "No se importaron las muestras de diseño.");
            }
            model.ShowLocal("home"); await Capture("02-home");
            model.ShowLocal("library"); await Capture("03-library-songs");
            libraryTab = "albums"; BuildCatalog(); await Capture("04-library-albums");
            libraryTab = "artists"; BuildCatalog(); await Capture("05-library-artists");
            model.FilterLibrary("NO-MATCH-OPENFY"); Require(model.Songs.Count == 0, "El filtro no se aplicó."); await Capture("06-filter-empty"); model.FilterLibrary("");
            if (model.Library.Tracks.FirstOrDefault() is { } first)
            {
                model.ShowLocalAlbum(first.AlbumId); Require(model.Songs.All(song => song.Album == first.Album), "El álbum mezcló canciones."); await Capture("07-album");
                var song = model.Describe(new("local", first.Id)); await model.FavoriteAsync(song); model.ShowLocal("favorites"); Require(model.Songs.Any(row => row.Key == song.Key), "No se guardó el favorito."); await Capture("08-favorites");
                await model.CreatePlaylistAsync("Para el camino"); var playlist = model.Library.Playlists.First(list => list.Name == "Para el camino"); await model.AddToPlaylistAsync(song, playlist); model.ShowLocal("playlist", playlist.Id); Require(model.Songs.Count == 1, "La playlist no contiene su canción."); await Capture("09-playlist");
                model.Volume = 0; await model.PlayAsync(song, model.Library.Tracks.Select(track => model.Describe(new("local", track.Id)))); await Task.Delay(300); model.Engine.Pause(); model.Tick();
                model.Shuffle(); Require(model.ShuffleEnabled, "El modo aleatorio no se activó."); model.CycleRepeat(); Require(model.RepeatMode == "all", "El modo repetir no se activó.");
                queueVisible = true; BuildSide(); await Capture("10-queue");
                if (Ui.Find<ListView>(side) is { Items.Count: > 1 } queueRows) { queueRows.SelectedIndex = 1; await Capture("10-queue-selected"); }
                if (song.Artwork != null && tracks.ContainerFromIndex(0) is Microsoft.UI.Xaml.Controls.ListViewItem row && row.ContentTemplateRoot != null) {
                    var art = Ui.Find<TrackArtwork>(row.ContentTemplateRoot);
                    Require(art != null && Ui.Find<Microsoft.UI.Xaml.Controls.Image>(art)?.Source != null, "Falta la portada de la fila después de iniciar la canción.");
                }
                queueVisible = false; lyricsVisible = true; model.LyricsVisible = true; await model.LoadLyricsAsync(); BuildSide(); await Capture("11-lyrics"); lyricsVisible = model.LyricsVisible = false; BuildSide();
            }
            model.EmptySearch(); await Capture("12-search"); model.ShowLocal("settings"); await Capture("13-settings");
            AppWindow.Resize(WindowsIntegration.Scaled(this, 960, 760)); model.ShowLocal("home"); await Capture("14-home-compact"); model.ShowLocal("library"); await Capture("15-library-compact"); model.ShowLocal("settings"); await Capture("16-settings-compact");
            AppWindow.Resize(WindowsIntegration.Scaled(this, 780, 720)); model.ShowLocal("library"); await Capture("17-library-narrow");
            AppWindow.Resize(WindowsIntegration.Scaled(this, 1360, 940)); await model.ShowMostPlayedAsync(); await Capture("21-most-played");
            }
            if (arguments.Contains("--visual-online"))
            {
                AppWindow.Resize(WindowsIntegration.Scaled(this, 1360, 940)); model.EmptySearch(); restoringSearch = true; search.Text = model.Query = "Daft Punk"; restoringSearch = false;
                await model.SearchAsync(); Require(model.Songs.Count > 0 && model.Artists.Count > 0, $"La búsqueda real no produjo canciones y artistas (canciones={model.Songs.Count}, artistas={model.Artists.Count}, página={model.Page}). " + model.Error); await Capture("18-search-results");
                SelectSearchCategory("song"); await Task.Delay(150); ActiveSearchScroll()?.ChangeView(null, 200, null, true); await Task.Delay(150);
                double expectedTrack = ActiveSearchScroll()?.VerticalOffset ?? 0;
                var found = model.Artists[0]; int songs = model.Songs.Count; await model.ArtistAsync(found.Id); Require(model.Page == "artist", "No se abrió el artista."); await Capture("19-artist");
                if (model.Albums.FirstOrDefault() is { } album) { await model.AlbumAsync(album.Id); Require(model.Page == "album" && model.Songs.Count > 0, "No se abrió el álbum."); await Capture("20-catalog-album"); }
                ReturnToSearch(); await Task.Delay(450); Require(model.Page == "search" && model.Query == "Daft Punk" && model.Songs.Count == songs, "No se restauró la búsqueda tras visitar el catálogo.");
                double actualTrack = ActiveSearchScroll()?.VerticalOffset ?? 0;
                Require(searchCategory == "song" && Math.Abs(actualTrack - expectedTrack) < 2, $"No se restauró el desplazamiento de canciones ({actualTrack}/{expectedTrack})."); steps["search-restoration"] = new { actualTrack, expectedTrack, category = searchCategory };

            }
            Require(string.IsNullOrEmpty(model.Error), model.Error);
            await File.WriteAllTextAsync(Path.Combine(directory, "visual-check.json"), JsonSerializer.Serialize(new { passed = true, steps }, Contracts.Json));
        }
        catch (Exception error) { await File.WriteAllTextAsync(Path.Combine(directory, "visual-check.json"), JsonSerializer.Serialize(new { passed = false, error = error.ToString(), steps }, Contracts.Json)); }
    }
}
