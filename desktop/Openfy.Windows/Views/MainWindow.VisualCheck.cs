using System.Runtime.InteropServices.WindowsRuntime;
using System.Runtime.InteropServices;
using System.Text.Json;
using Microsoft.Graphics.Canvas;
using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
using Microsoft.UI.Xaml.Automation.Provider;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Media;
using Microsoft.UI.Xaml.Media.Imaging;
using Openfy.Core;
using Openfy.Windows.Services;
using Windows.Graphics.Capture;
using Windows.Graphics.DirectX;
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
        void CheckPlaybackBrushes(bool glass)
        {
            Require(glass
                ? playerPill.Background is GlassBrush && sidePanel.Background is GlassBrush
                : playerPill.Background is SolidColorBrush && sidePanel.Background is SolidColorBrush,
                "El fondo del reproductor o del panel no coincide con la opción de transparencia.");
        }
        void SetTransparency(string mode, bool glass)
        {
            model.Settings.Transparency = mode;
            UpdatePlaybackTransparency();
            CheckPlaybackBrushes(glass);
        }
        async Task SelectTransparency(ComboBox selector, string mode, bool glass)
        {
            int operations = model.Operations;
            selector.SelectedIndex = Array.IndexOf(TransparencyModes, mode);
            Require(model.Settings.Transparency == mode, "El selector no aplicó la opción de transparencia.");
            CheckPlaybackBrushes(glass);
            for (int attempt = 0; attempt < 40 && model.Operations > operations; attempt++)
                await Task.Delay(50);
            Require(string.IsNullOrEmpty(model.Error), model.Error);
            Require((await model.Store.ReadAsync<DesktopSettings>("settings"))?.Transparency == mode,
                "No se guardó la opción de transparencia.");
        }

        Task Capture(string name) => CaptureElement(name, root);
        async Task CaptureElement(string name, UIElement element)
        {
            await Task.Delay(450); root.UpdateLayout();
            var bitmap = new RenderTargetBitmap(); await bitmap.RenderAsync(element);
            var pixels = (await bitmap.GetPixelsAsync()).ToArray();
            var folder = await StorageFolder.GetFolderFromPathAsync(directory);
            var file = await folder.CreateFileAsync(name + ".png", CreationCollisionOption.ReplaceExisting);
            using var stream = await file.OpenAsync(FileAccessMode.ReadWrite);
            var encoder = await BitmapEncoder.CreateAsync(BitmapEncoder.PngEncoderId, stream);
            encoder.SetPixelData(BitmapPixelFormat.Bgra8, BitmapAlphaMode.Premultiplied, (uint)bitmap.PixelWidth, (uint)bitmap.PixelHeight, 96, 96, pixels); await encoder.FlushAsync();
            Require(bitmap.PixelWidth > 0 && bitmap.PixelHeight > 0, "La vista no produjo píxeles.");
            steps[name] = new { width = bitmap.PixelWidth, height = bitmap.PixelHeight, page = model.Page, songs = model.Songs.Count };
        }
        async Task CaptureComposedWindow(string name)
        {
            await Task.Delay(450);
            root.UpdateLayout();
            // RenderTargetBitmap omits backdrop effects. Capture only this window after composition.
            var item = CaptureItemForWindow(WindowsIntegration.Handle(this));
            var device = CanvasDevice.GetSharedDevice();
            using var frames = Direct3D11CaptureFramePool.CreateFreeThreaded(device,
                DirectXPixelFormat.B8G8R8A8UIntNormalized, 1, item.Size);
            using var session = frames.CreateCaptureSession(item);
            session.IsCursorCaptureEnabled = false;
            session.StartCapture();
            var deadline = Environment.TickCount64 + 5000;
            while (Environment.TickCount64 < deadline)
            {
                using var frame = frames.TryGetNextFrame();
                if (frame != null)
                {
                    using var bitmap = CanvasBitmap.CreateFromDirect3D11Surface(device, frame.Surface);
                    await bitmap.SaveAsync(Path.Combine(directory, name + ".png"), CanvasBitmapFileFormat.Png);
                    steps[name] = new { width = frame.ContentSize.Width, height = frame.ContentSize.Height,
                        page = model.Page, mode = model.Settings.Transparency, transparencySettings.AdvancedEffectsEnabled,
                        tint = playbackFallback.Color.ToString() };
                    return;
                }
                await Task.Delay(50);
            }
            throw new TimeoutException("No se recibió un fotograma de la ventana compuesta.");
        }
        static IEnumerable<FrameworkElement> Elements(DependencyObject element)
        {
            if (element is FrameworkElement view) yield return view;
            for (int i = 0; i < VisualTreeHelper.GetChildrenCount(element); i++)
                foreach (var child in Elements(VisualTreeHelper.GetChild(element, i))) yield return child;
        }
        static void Invoke(Button button) => ((IInvokeProvider)new ButtonAutomationPeer(button)
            .GetPattern(PatternInterface.Invoke)).Invoke();

        async Task CheckArtistLayout(string slug)
        {
            var buttons = Elements(catalog).OfType<Button>();
            var info = buttons.FirstOrDefault(button => AutomationProperties.GetName(button) == $"Acerca de {model.Heading}");
            Require((info != null) == !string.IsNullOrWhiteSpace(model.Description), "El botón de información no coincide con la biografía.");
            Require(!Elements(catalogTail).OfType<TextBlock>().Any(text => text.Text == "Acerca de"), "La biografía sigue en la página.");
            Require((artistDeepAnchor != null) == (model.SimilarArtists.Count > 0), "El lavado profundo no sigue a los artistas similares.");
            if (info != null)
            {
                Invoke(info);
                await Task.Delay(450);
                var dialogElements = VisualTreeHelper.GetOpenPopupsForXamlRoot(root.XamlRoot)
                    .SelectMany(popup => popup.Child is { } child ? Elements(child) : []).ToArray();
                var dialog = dialogElements.OfType<Border>().FirstOrDefault(view => view.Name == "BackgroundElement"
                    && view.Background is SolidColorBrush brush && brush.Color == ArtistThemes.Color((artistTheme ?? PendingArtistTheme).Deep));
                var close = dialogElements.OfType<Button>().FirstOrDefault(button => button.Name == "CloseButton");
                Require(dialog != null && close != null, $"Falta el diálogo de artista con su color profundo ({dialogElements.Length} elementos).");
                Require(close!.Foreground is SolidColorBrush ink && ink.Color == frameWhite.Color, "El botón Cerrar no usa texto blanco.");
                Require(dialogElements.OfType<TextBlock>().Any(text => text.Text == model.Description), "El diálogo no muestra la biografía completa.");
                await CaptureElement(slug + "-about", dialog!);
                Invoke(close);
                await Task.Delay(250);
                Require(ReferenceEquals(FocusManager.GetFocusedElement(root.XamlRoot), info), "El diálogo no devolvió el foco al botón de información.");
            }
            if (artistLatestRelease.Children.Count > 0)
            {
                var list = tracks;
                var cover = Elements(artistLatestRelease).First(view => AutomationProperties.GetAutomationId(view) == "ArtistLatestReleaseCover");
                Require(Grid.GetColumn(artistLatestRelease) == 1 && trackScroll.ActualWidth >= 480 && cover.ActualWidth == 160,
                    "El lanzamiento no está al lado de las canciones en la vista ancha.");
                AppWindow.Resize(WindowsIntegration.Scaled(this, 860, 850));
                await Task.Delay(450);
                Require(Grid.GetRow(artistLatestRelease) == 1 && cover.ActualWidth == 76 && ReferenceEquals(list, tracks),
                    $"El lanzamiento estrecho no es una fila compacta o se recreó la lista (fila={Grid.GetRow(artistLatestRelease)}, portada={cover.ActualWidth}, ancho de página={pageScroll.ActualWidth}).");
                double offset = artistLatestRelease.TransformToVisual(pagePanel).TransformPoint(new(0, 0)).Y;
                pageScroll.ChangeView(null, Math.Max(0, offset - 200), null, true);
                await Capture(slug + "-compact-release");
                AppWindow.Resize(WindowsIntegration.Scaled(this, 1360, 940));
                pageScroll.ChangeView(null, 0, null, true);
                await Task.Delay(450);
            }
            if (Elements(catalogTail).OfType<Button>().LastOrDefault(button => button.IsTabStop && button.ActualHeight > 0) is { } last)
            {
                double y = last.TransformToVisual(pagePanel).TransformPoint(new(0, last.ActualHeight)).Y;
                pageScroll.ChangeView(null, Math.Max(0, y - pageScroll.ViewportHeight + 24), null, true);
                await Task.Delay(200);
                last.Focus(FocusState.Keyboard);
                last.StartBringIntoView(new BringIntoViewOptions { AnimationDesired = false });
                await Task.Delay(300);
                double bottom = last.TransformToVisual(pageScroll).TransformPoint(new(0, last.ActualHeight)).Y;
                Require(bottom <= pageScroll.ViewportHeight - PlayerInset + 2, $"El foco de la última tarjeta quedó bajo la cápsula ({bottom:0}/{pageScroll.ViewportHeight - PlayerInset:0}).");
                steps[slug + "-focus-inset"] = true;
                pageScroll.ChangeView(null, 0, null, true);
            }
        }
        async Task CheckArtists()
        {
            int artistsArg = Array.IndexOf(arguments, "--visual-artists");
            if (artistsArg >= 0 && artistsArg + 1 < arguments.Length)
            {
                // Opt-in artist identity review with real search results: featured result, header and the section tones.
                AppWindow.Resize(WindowsIntegration.Scaled(this, 1360, 940));
                var artistStates = new List<object>(); int index = 0;
                foreach (var name in arguments[artistsArg + 1].Split(';', StringSplitOptions.RemoveEmptyEntries | StringSplitOptions.TrimEntries))
                {
                    string slug = "artist-" + (++index).ToString("00");
                    model.EmptySearch(); restoringSearch = true; search.Text = model.Query = name; restoringSearch = false;
                    await model.SearchAsync();
                    for (int wait = 0; wait < 60 && !model.SearchSettled; wait++) await Task.Delay(100);
                    await Task.Delay(1500); await Capture(slug + "-search");
                    var found = model.Artists.FirstOrDefault(artist => string.Equals(artist.Name, name, StringComparison.OrdinalIgnoreCase)) ?? model.Artists.FirstOrDefault();
                    Require(found != null, "La búsqueda de " + name + " no devolvió artistas.");
                    await model.ArtistAsync(found!.Id); Require(model.Page == "artist", "No se abrió el artista " + name + ".");
                    for (int wait = 0; wait < 80 && CurrentArtistTheme == null; wait++) await Task.Delay(100);
                    await Task.Delay(2500); await Capture(slug + "-hero");
                    await CheckArtistLayout(slug);
                    pageScroll.ChangeView(null, pageScroll.ScrollableHeight * .5, null, true); await Task.Delay(700); await Capture(slug + "-middle");
                    pageScroll.ChangeView(null, pageScroll.ScrollableHeight, null, true); await Task.Delay(700); await Capture(slug + "-end");
                    pageScroll.ChangeView(null, 0, null, true);
                    var theme = CurrentArtistTheme;
                    artistStates.Add(new { name, artist = found.Name, banner = model.CatalogBanner != null, theme, video = ArtistVideoVisible });
                }
                steps["artists"] = artistStates;
            }
        }
        try
        {
            if (arguments.Contains("--visual-artists-only")) {
                await CheckArtists();
                await File.WriteAllTextAsync(Path.Combine(directory, "visual-check.json"), JsonSerializer.Serialize(new { passed = true, steps }, Contracts.Json));
                return;
            }
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
            Require(playerPill.ActualWidth == EmptyPlayerWidth && playerPill.ActualHeight == EmptyPlayerHeight && playerPill.CornerRadius.TopLeft == 32,
                "El reproductor sin canción no es una cápsula compacta.");
            bool systemTransparency = transparencySettings.AdvancedEffectsEnabled;
            string originalTransparency = model.Settings.Transparency;
            SetTransparency("default", systemTransparency);
            steps["transparency-default"] = new { advancedEffectsEnabled = systemTransparency, glass = systemTransparency };
            Require(pagePanel?.Padding.Bottom == PlayerInset, "Falta el espacio inferior de la página.");
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
                await model.NavigateLocalAlbumAsync(first.AlbumId);
                Require(model.Songs.All(song => song.Album == first.Album), "El álbum mezcló canciones.");
                for (int wait = 0; wait < 20 && model.CatalogArtwork != null && albumDominant == null; wait++) await Task.Delay(100);
                await Capture("07-album");
                Require(albumCover?.ActualWidth == 224 && root.Background == frameBackground &&
                    frameBackground.Color == ArtistThemes.Color(albumTintTarget.Background) &&
                    frameMuted.Color == ArtistThemes.Color(albumTintTarget.Muted), "Falta la portada o el tinte del álbum.");
                AppWindow.Resize(WindowsIntegration.Scaled(this, 900, 760));
                await Capture("07-album-medium");
                Require(albumCover?.ActualWidth == 168, "La portada de álbum mediana no mide 168.");
                AppWindow.Resize(WindowsIntegration.Scaled(this, 740, 760));
                await Capture("07-album-compact");
                Require(CompactAlbum, "El álbum estrecho no usa la composición compacta.");
                AppWindow.Resize(WindowsIntegration.Scaled(this, 1360, 940));
                var song = model.Describe(new("local", first.Id)); await model.FavoriteAsync(song); model.ShowLocal("favorites"); Require(model.Songs.Any(row => row.Key == song.Key), "No se guardó el favorito."); await Capture("08-favorites");
                await model.CreatePlaylistAsync("Para el camino"); var playlist = model.Library.Playlists.First(list => list.Name == "Para el camino"); await model.AddToPlaylistAsync(song, playlist); model.ShowLocal("playlist", playlist.Id); Require(model.Songs.Count == 1, "La playlist no contiene su canción."); await Capture("09-playlist");
                model.Volume = 0; await model.PlayAsync(song, model.Library.Tracks.Select(track => model.Describe(new("local", track.Id)))); await Task.Delay(300); model.Engine.Pause(); model.Tick();
                model.Shuffle(); Require(model.ShuffleEnabled, "El modo aleatorio no se activó."); model.CycleRepeat(); Require(model.RepeatMode == "all", "El modo repetir no se activó.");
                Require(model.Duration > 0, "La canción de prueba no tiene duración.");
                await model.SeekAsync(Math.Min(25, model.Duration * .35));
                await Capture("09-player");
                var seek = Elements(playerPill).OfType<Slider>().Single(slider => slider.Name == "PillSeek");
                var elapsed = Elements(playerPill).OfType<TextBlock>().Single(text => text.Name == "PillElapsed");
                var remaining = Elements(playerPill).OfType<TextBlock>().Single(text => text.Name == "PillRemaining");
                var timing = (FrameworkElement)elapsed.Parent;
                var track = Elements(seek).OfType<Microsoft.UI.Xaml.Shapes.Rectangle>().Single(line => line.Name == "HorizontalTrackRect");
                var fill = Elements(seek).OfType<Microsoft.UI.Xaml.Shapes.Rectangle>().Single(line => line.Name == "HorizontalDecreaseRect");
                var thickness = (ScaleTransform)track.RenderTransform;
                Require(seek.ActualHeight == 22 && timing.Opacity == 0 && track.Height * thickness.ScaleY == 3 &&
                    Math.Abs(fill.ActualWidth / track.ActualWidth - seek.Value / seek.Maximum) < .02,
                    "La pista en reposo no coincide con la posición o el tamaño esperado.");
                Require(seek.Focus(FocusState.Keyboard), "No se pudo enfocar la posición de reproducción.");
                // The blurred song details are a composition visual, which RenderTargetBitmap omits.
                await CaptureComposedWindow("09-player-scrub");
                Require(timing.Opacity == 1 && remaining.Text.StartsWith('−') && track.Height * thickness.ScaleY == 6,
                    "Al enfocar la pista no se mostraron los tiempos o el grosor esperado.");
                search.Focus(FocusState.Programmatic);
                await Task.Delay(200);
                Require(timing.Opacity == 0 && track.Height * thickness.ScaleY == 3, "La pista no volvió al reposo al perder el foco.");
                queueVisible = true; BuildSide(); await Capture("10-queue");
                Require(playerPill.ActualWidth == PlayerMaxWidth && playerPill.ActualHeight == PlayerHeight &&
                    playerPill.CornerRadius.TopLeft == 36 && playerPill.Margin.Bottom == PlayerMargin && sidePanel.Margin.Bottom == PlayerInset &&
                    Grid.GetColumn(playerPill) == 1, "El reproductor o la cola invaden el espacio de la otra columna.");
                if (Ui.Find<ListView>(side) is { Items.Count: > 1 } queueRows)
                {
                    queueRows.SelectedIndex = 1;
                    if (queueRows.ContainerFromIndex(1) is ListViewItem queued && queued.ContentTemplateRoot is Grid rowTemplate && rowTemplate.Children[0] is TextBlock grip)
                    {
                        Require(queued.Focus(FocusState.Keyboard), "No se pudo enfocar una fila de la cola.");
                        await Capture("10-queue-selected");
                        Require(grip.Opacity == 1, "El agarre de la cola no se resaltó con el foco.");
                        search.Focus(FocusState.Programmatic);
                    }
                }
                if (song.Artwork != null && tracks.ContainerFromIndex(0) is Microsoft.UI.Xaml.Controls.ListViewItem row && row.ContentTemplateRoot != null) {
                    var art = Ui.Find<TrackArtwork>(row.ContentTemplateRoot);
                    Require(art != null && Ui.Find<Microsoft.UI.Xaml.Controls.Image>(art)?.Source != null, "Falta la portada de la fila después de iniciar la canción.");
                }
                var glassAlbum = model.Library.Tracks.FirstOrDefault(track => track.AlbumId != first.AlbumId && track.Artwork != null) ?? first;
                await model.NavigateLocalAlbumAsync(glassAlbum.AlbumId);
                for (int wait = 0; wait < 30 && glassAlbum.Artwork != null && albumTintInput == null; wait++) await Task.Delay(100);
                await Capture("10-queue-tinted");
                Require(sidePanel.CornerRadius.TopLeft == 20 && playbackFallback.Color == playerGlass.TintColor &&
                    sidePanelGlass.TintColor == playerGlass.TintColor && sidePanelGlass.FallbackColor == sidePanelGlass.TintColor &&
                    (glassAlbum.Artwork == null || albumTintInput != null), "El cristal de la cola perdió el tinte del álbum.");

                // Put the cover behind each glass surface so the blur is visible in the paired captures.
                queueVisible = false; BuildSide();
                AppWindow.Resize(WindowsIntegration.Scaled(this, 1360, 460));
                SetTransparency("off", false);
                await CaptureComposedWindow("09-player-solid");
                SetTransparency("on", true);
                await CaptureComposedWindow("09-player-glass");
                AppWindow.Resize(WindowsIntegration.Scaled(this, 740, 760));
                queueVisible = true; BuildSide();
                await CaptureComposedWindow("10-queue-glass");
                SetTransparency("off", false);
                await CaptureComposedWindow("10-queue-solid");
                steps["transparency-forced"] = new { on = nameof(GlassBrush), off = nameof(SolidColorBrush) };

                AppWindow.Resize(WindowsIntegration.Scaled(this, 1360, 940));
                SetTransparency("on", true);
                queueVisible = false; lyricsVisible = true; model.LyricsVisible = true; await model.LoadLyricsAsync(); BuildSide();
                CheckPlaybackBrushes(true);
                await Capture("11-lyrics");
                lyricsVisible = model.LyricsVisible = false; BuildSide();
            }
            model.Settings.Transparency = originalTransparency;
            UpdatePlaybackTransparency();
            model.EmptySearch(); await Capture("12-search"); model.ShowLocal("settings"); await Capture("13-settings");
            var transparencySelector = Elements(catalog).OfType<ComboBox>()
                .Single(combo => AutomationProperties.GetName(combo) == TransparencyLabel);
            Require(transparencySelector.SelectedIndex == Array.IndexOf(TransparencyModes, originalTransparency),
                "El selector no muestra la opción de transparencia guardada.");
            await SelectTransparency(transparencySelector, "on", true);
            await SelectTransparency(transparencySelector, "off", false);
            await SelectTransparency(transparencySelector, "default", systemTransparency);
            await SelectTransparency(transparencySelector, originalTransparency,
                originalTransparency == "on" || (originalTransparency == "default" && systemTransparency));
            transparencySelector.StartBringIntoView(new BringIntoViewOptions { AnimationDesired = false });
            await Capture("13-settings-transparency");
            steps["transparency-settings"] = true;
            AppWindow.Resize(WindowsIntegration.Scaled(this, 960, 760)); model.ShowLocal("home"); await Capture("14-home-compact"); model.ShowLocal("library"); await Capture("15-library-compact"); model.ShowLocal("settings"); await Capture("16-settings-compact");
            AppWindow.Resize(WindowsIntegration.Scaled(this, 780, 720)); model.ShowLocal("library"); await Capture("17-library-narrow");
            if (model.Current != null)
            {
                AppWindow.Resize(WindowsIntegration.Scaled(this, 650, 720)); await Capture("17-player-overflow");
                var more = Elements(playerPill).OfType<Button>().Single(button => AutomationProperties.GetName(button) == "Más opciones de reproducción");
                Require(more.ActualWidth == 40 && more.Visibility == Visibility.Visible && more.Flyout is MenuFlyout overflow &&
                    overflow.Items.OfType<MenuFlyoutItem>().Any(item => item.Text == "Cola de reproducción" && item.Visibility == Visibility.Visible),
                    "El menú del reproductor no conserva el acceso a la cola en una ventana estrecha.");
            }
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
            await CheckArtists();
            Require(string.IsNullOrEmpty(model.Error), model.Error);
            await File.WriteAllTextAsync(Path.Combine(directory, "visual-check.json"), JsonSerializer.Serialize(new { passed = true, steps }, Contracts.Json));
        }
        catch (Exception error) { await File.WriteAllTextAsync(Path.Combine(directory, "visual-check.json"), JsonSerializer.Serialize(new { passed = false, error = error.ToString(), steps }, Contracts.Json)); }
    }

    [ComImport, Guid("3628E81B-3CAC-4C60-B7F4-23CE0E0C3356"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    private interface IGraphicsCaptureItemInterop
    {
        nint CreateForWindow(nint window, in Guid iid);
    }

    private static GraphicsCaptureItem CaptureItemForWindow(nint window)
    {
        var interop = GraphicsCaptureItem.As<IGraphicsCaptureItemInterop>();
        var item = interop.CreateForWindow(window, new Guid("79C3F95B-31F7-4EC2-A464-632EF5D30760"));
        try { return GraphicsCaptureItem.FromAbi(item); }
        finally { Marshal.Release(item); }
    }
}
