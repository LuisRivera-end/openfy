using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Openfy.Core;
using Openfy.Windows.Services;
using global::Windows.Networking.Connectivity;
using Color = global::Windows.UI.Color;

namespace Openfy.Windows.Views;

/// <summary>
/// YouTube Music artist profile, washed in the artist's own colour (docs/superpowers/specs/2026-11-19-artist-identity-design.md;
/// web twin: app/pages/music/artist/[id].vue). The header media (Apple Music's editorial video when it exists, else the banner,
/// else the portrait) fades into <c>base</c>; behind the scroll area one wash follows the sections: base, then secondary for the
/// discography, then deep for the biography and related artists, ending in the panel colour.
/// </summary>
public sealed partial class MainWindow
{
    // Until the artwork is sampled, the header shades into the panel colour instead of flashing a guessed hue.
    private static readonly ArtistThemeColors PendingArtistTheme = new("#17191b", "#17191b", "#101012", "#2a2c2e", true);
    private const string ArtistSecondaryText = "#EDEDF0";
    private static readonly Dictionary<string, (string? Url, long RetryAt)> ArtistMotionKnown = [];
    private readonly HashSet<string> artistMotionPending = [];
    private readonly LinearGradientBrush artistWashBrush = new() { StartPoint = new(0, 0), EndPoint = new(0, 1) };
    private readonly List<Action<ArtistThemeColors>> artistRepaints = [];
    private Border? artistWash;
    private StackPanel? artistPagePanel;
    private ArtistThemeColors? artistTheme;
    private string? artistThemeKey, artistVideoKey;
    private string? artistVideoUrl;
    private ArtistMotionEntry? artistMotionEntry;
    private FrameworkElement? artistDeepAnchor, artistHeroStage;
    private LoopingVideo? artistVideo;

    private bool ArtistSurfacePage => model.Page is "artist" or "localartist";
    private string? ArtistThemeKey => model.Page == "artist" ? model.PageContext?.Id : model.Page == "localartist" && model.PageContext?.Id is { } name ? "local:" + name : null;
    internal bool ArtistVideoVisible => artistVideo?.Visible == true;
    internal ArtistThemeColors? CurrentArtistTheme => ArtistSurfacePage ? artistTheme : null;

    private void AttachArtistWash(Grid main, StackPanel page)
    {
        artistPagePanel = page;
        for (int i = 0; i < 7; i++) artistWashBrush.GradientStops.Add(new() { Offset = i / 6.0, Color = ArtistThemes.Color("#101012") });
        // Tagged so Appearance keeps its colour and radius; it never takes input.
        artistWash = new Border { Tag = "home-artwork", CornerRadius = new(11), IsHitTestVisible = false, Opacity = 0, Background = artistWashBrush };
        Grid.SetRowSpan(artistWash, 3); main.Children.Insert(0, artistWash);
        pageScroll.ViewChanged += (_, _) => UpdateArtistWash();
        pageScroll.SizeChanged += (_, _) => UpdateArtistWash();
        page.SizeChanged += (_, _) => UpdateArtistWash();
        VisibilityChanged += (_, _) => SyncArtistVideo();
        NetworkStatusChangedEventHandler networkChanged = _ => DispatcherQueue.TryEnqueue(() => { meteredNetwork = null; SyncArtistVideo(); });
        NetworkInformation.NetworkStatusChanged += networkChanged;
        Closed += (_, _) => { NetworkInformation.NetworkStatusChanged -= networkChanged; artistVideo?.Release(); };
    }

    /// <summary>Runs before every catalog build: forgets the previous page's surfaces and keeps the video only for the same artist.</summary>
    private void SyncArtistSurface()
    {
        string? key = ArtistSurfacePage ? ArtistThemeKey : null;
        artistRepaints.Clear(); artistDeepAnchor = null; artistHeroStage = null;
        if (key != artistThemeKey) {
            ReleaseArtistVideo();
            artistThemeKey = key;
            artistTheme = ArtistThemes.Cached(key);
        }
        ApplyArtistTrackContrast();
        UpdateArtistWash();
    }

    private void PaintArtist(Action<ArtistThemeColors> repaint) { artistRepaints.Add(repaint); repaint(artistTheme ?? PendingArtistTheme); }

    private async Task LoadArtistThemeAsync(string? key, string? url, string? fallback = null)
    {
        var theme = await ArtistThemes.LoadAsync(model.Artwork, url, key);
        if (!string.IsNullOrWhiteSpace(fallback) && fallback != url && ArtistThemes.Cached(key) == null)
            theme = await ArtistThemes.LoadAsync(model.Artwork, fallback);
        if (key == null || key != artistThemeKey) return;
        artistTheme = theme;
        foreach (var repaint in artistRepaints.ToArray()) repaint(theme);
        artistTrackSurface.Color = ArtistThemes.Color(theme.Surface);
        UpdateArtistWash();
    }

    private void UpdateArtistWash()
    {
        if (artistWash == null || artistPagePanel == null) return;
        bool visible = ArtistSurfacePage && artistTheme != null && pageScroll.Visibility == Visibility.Visible;
        bool animate = model.Settings.Effects && WindowsIntegration.AnimationsEnabled;
        if (!animate) artistWash.OpacityTransition = null;
        else artistWash.OpacityTransition ??= new ScalarTransition { Duration = TimeSpan.FromMilliseconds(320) };
        artistWash.Opacity = visible ? 1 : 0;
        SyncArtistVideo();
        if (!visible) return;
        double offset = pageScroll.VerticalOffset, viewport = Math.Max(1, pageScroll.ViewportHeight), height = Math.Max(1, artistWash.ActualHeight);
        double top = Math.Max(0, height - viewport);
        try { top = Math.Clamp(pageScroll.TransformToVisual(artistWash).TransformPoint(new(0, 0)).Y, 0, height); } catch (ArgumentException) { }

        double Position(FrameworkElement element) { try { return element.TransformToVisual(artistPagePanel).TransformPoint(new(0, 0)).Y; } catch (ArgumentException) { return double.NaN; } }
        double end = Math.Max(1, artistPagePanel.ActualHeight);
        double heroEnd = artistHeroStage is { } hero ? Position(hero) + hero.ActualHeight : 0;
        if (!double.IsFinite(heroEnd)) heroEnd = 0;
        double tail = catalogTail.Children.Count > 0 ? Position(catalogTail) : end;
        if (!double.IsFinite(tail)) tail = end;
        double deep = artistDeepAnchor is { } anchor ? Position(anchor) : end;
        if (!double.IsFinite(deep)) deep = end;
        double discographyHeight = Math.Max(0, deep - tail);
        bool local = model.Page == "localartist";
        var theme = artistTheme!;
        var baseColor = ArtistThemes.Color(theme.Base);
        var secondaryColor = ArtistThemes.Color(theme.Secondary);
        var deepColor = ArtistThemes.Color(theme.Deep);
        var appColor = ArtistThemes.Color("#101012");

        var stops = artistWashBrush.GradientStops;
        // The bar above the scroll area takes the colour of the section passing under it.
        stops[0].Offset = 0; stops[0].Color = ArtistColorAt(offset);
        for (int i = 1; i < 7; i++) {
            double along = (i - 1) / 5.0;
            stops[i].Offset = Math.Clamp((top + along * viewport) / height, 0, 1);
            stops[i].Color = ArtistColorAt(offset + along * viewport);
        }

        Color ArtistColorAt(double y)
        {
            var color = baseColor;
            if (local) {
                double spread = Math.Max(1, (end - heroEnd) * .65);
                color = ArtistThemes.Mix(color, deepColor, (y - heroEnd) / spread);
            } else {
                if (discographyHeight > 1) color = ArtistThemes.Mix(color, secondaryColor, (y - tail) / Math.Min(240, discographyHeight * .6));
                if (artistDeepAnchor != null) {
                    double spread = Math.Clamp(discographyHeight * .25, 80, 180);
                    color = ArtistThemes.Mix(color, deepColor, (y - Math.Max(tail, deep - spread)) / spread);
                }
            }
            double fade = Math.Max(42, Math.Min(240, (end - heroEnd) * .2));
            return ArtistThemes.Mix(color, appColor, (y - (end - fade)) / fade);
        }
    }

    private void BuildArtistCatalog()
    {
        string? key = ArtistThemeKey;
        catalog.Children.Add(ArtistHero(key));
        if (model.Songs.Count > 0) catalog.Children.Add(CatalogSectionHeading("Canciones populares", model.MoreSongsAvailable ? "Ver todas las canciones" : null, () => _ = model.RunAsync(model.MoreAsync)));
        else catalog.Children.Add(CatalogEmptyState("music", "Este artista todavía no tiene canciones disponibles.", "Vuelve a buscarlo más tarde para actualizar su perfil."));

        var latest = model.Albums.Select(album => (Album: album, Kind: "Álbum")).Concat(model.Singles.Select(album => (Album: album, Kind: "Single / EP")))
            .Aggregate<(YouTubeAlbum Album, string Kind), (YouTubeAlbum Album, string Kind)?>(null, (best, item) => best is null || (item.Album.Year ?? 0) > (best.Value.Album.Year ?? 0) ? item : best);
        if (latest is { } release) catalogTail.Children.Add(ArtistLatestRelease(release.Album, release.Kind));
        CatalogReleases("Álbumes", model.Albums, false);
        CatalogReleases("Singles y EPs", model.Singles, true);
        if (model.Description.Length > 0) { var about = ArtistAbout(); artistDeepAnchor = about; catalogTail.Children.Add(about); }
        if (model.SimilarArtists.Count > 0)
        {
            var heading = CatalogSectionHeading("Fans también escuchan"); artistDeepAnchor ??= heading;
            catalogTail.Children.Add(heading);
            catalogTail.Children.Add(CatalogCards(model.SimilarArtists.Select(artist => new CatalogTile(artist.Name, "Artista", artist.Artwork, () => _ = model.RunAsync(() => model.ArtistAsync(artist.Id)), true))));
        }
        _ = string.IsNullOrWhiteSpace(model.CatalogBanner) ? LoadArtistThemeAsync(key, model.CatalogArtwork)
            : LoadArtistThemeAsync(key, model.CatalogBanner, model.CatalogArtwork);
    }

    private FrameworkElement ArtistHero(string? key)
    {
        var hero = new StackPanel { Spacing = 22, Margin = new(0, 0, 0, 6) };
        bool banner = !string.IsNullOrWhiteSpace(model.CatalogBanner);
        var layers = new Grid { Height = 360 };
        var stage = new Border { Child = layers, Tag = "home-artwork" };
        artistHeroStage = stage;
        AutomationProperties.SetName(stage, model.Heading);
        var stageColor = new SolidColorBrush(); stage.Background = stageColor;
        PaintArtist(theme => stageColor.Color = ArtistThemes.Color(theme.Base));

        var copy = new StackPanel { Spacing = 2, VerticalAlignment = VerticalAlignment.Bottom };
        var kind = Ui.Text("Artista", 13, true); kind.Foreground = Ui.Brush(ArtistSecondaryText); copy.Children.Add(kind);
        var name = Ui.Text(model.Heading, 72, true); name.Foreground = Ui.Brush("#FFFFFF"); name.FontWeight = Microsoft.UI.Text.FontWeights.Bold; name.CharacterSpacing = -45; name.MaxLines = 2; name.TextTrimming = TextTrimming.CharacterEllipsis; name.Tag = "display";
        copy.Children.Add(name);
        var row = new Grid { ColumnSpacing = 30, VerticalAlignment = VerticalAlignment.Bottom };
        row.ColumnDefinitions.Add(new() { Width = GridLength.Auto }); row.ColumnDefinitions.Add(new() { Width = new(1, GridUnitType.Star) });
        Grid.SetColumn(copy, 1); row.Children.Add(copy);
        var portrait = CatalogArtworkView(model.CatalogArtwork, 210, round: true);
        portrait.VerticalAlignment = VerticalAlignment.Bottom;
        row.Children.Add(portrait);
        bool hasImage = false;
        bool imagePending = banner;
        bool hasVideo = false;
        var scrim = new Border { IsHitTestVisible = false };
        var shadeLayer = new Border { IsHitTestVisible = false };

        if (banner)
        {
            // Cover-fit by hand so the crop keeps the upper third (where faces usually are) instead of the centre.
            var image = new Image { Stretch = Stretch.Fill };
            var frame = new Canvas(); frame.Children.Add(image); layers.Children.Add(frame);
            double sourceWidth = 0, sourceHeight = 0;
            void Place()
            {
                double width = layers.ActualWidth, height = layers.ActualHeight;
                if (width <= 0 || height <= 0) return;
                // Without the old rounded card nothing clips the oversized image to the stage.
                layers.Clip = new RectangleGeometry { Rect = new(0, 0, width, height) };
                if (sourceWidth <= 0) return;
                double scale = Math.Max(width / sourceWidth, height / sourceHeight);
                image.Width = sourceWidth * scale; image.Height = sourceHeight * scale;
                Canvas.SetLeft(image, (width - image.Width) / 2); Canvas.SetTop(image, (height - image.Height) * .32);
            }
            SizeChangedEventHandler place = (_, _) => Place(); layers.SizeChanged += place; Ui.OnRelease(layers, () => layers.SizeChanged -= place);
            bool released = false; Ui.OnRelease(image, () => released = true);
            image.ImageOpened += (_, _) => { imagePending = false; hasImage = true; UpdateMedia(); };
            image.ImageFailed += (_, _) => { imagePending = false; hasImage = false; UpdateMedia(); };
            async Task Load()
            {
                try
                {
                    var result = await model.Artwork.GetAsync(model.CatalogBanner!, 2048); if (released) return;
                    sourceWidth = Math.Max(1, result.Width); sourceHeight = Math.Max(1, result.Height); Place();
                    Ui.Cover(image, result.Path, Math.Max(layers.ActualWidth, 900), Math.Max(layers.ActualHeight, 300), result.Width, result.Height);
                }
                catch { if (!released) { imagePending = false; UpdateMedia(); } }
            }
            _ = Load();
        }

        // Let the art show through above the name. A 64% black scrim follows the live title height,
        // so even bright frames behind a two-line name meet the same contrast as the opaque page colours.
        var contrast = new LinearGradientBrush { StartPoint = new(0, 0), EndPoint = new(0, 1) };
        contrast.GradientStops.Add(new() { Color = ArtistThemes.Color("#00000000") });
        var darkScrim = ArtistThemes.Color("#000000A3");
        contrast.GradientStops.Add(new() { Color = darkScrim });
        contrast.GradientStops.Add(new() { Color = darkScrim, Offset = 1 });
        var shade = new LinearGradientBrush { StartPoint = new(0, 0), EndPoint = new(0, 1) };
        foreach (var offset in new[] { 0, .18, .40, .65, .85, 1 }) shade.GradientStops.Add(new() { Offset = offset });
        PaintArtist(theme => {
            var color = ArtistThemes.Color(theme.Base); byte[] alpha = [150, 0, 0, 150, 230, 255];
            for (int i = 0; i < alpha.Length; i++) shade.GradientStops[i].Color = Color.FromArgb(alpha[i], color.R, color.G, color.B);
        });
        scrim.Background = contrast;
        shadeLayer.Background = shade;
        AttachArtistVideo(layers, key, visible => { hasVideo = visible; UpdateMedia(); });
        layers.Children.Add(scrim); layers.Children.Add(shadeLayer); layers.Children.Add(row);
        void UpdateMedia()
        {
            bool hasMedia = hasImage || hasVideo;
            scrim.Visibility = shadeLayer.Visibility = hasMedia ? Visibility.Visible : Visibility.Collapsed;
            bool showPortrait = !hasMedia && !imagePending;
            portrait.Visibility = showPortrait ? Visibility.Visible : Visibility.Collapsed;
            row.ColumnSpacing = !showPortrait ? 0 : layers.ActualWidth < 700 ? 20 : 30;
        }
        void UpdateScrim()
        {
            if (layers.ActualHeight <= 0) return;
            double end = Math.Clamp(1 - (copy.ActualHeight + row.Margin.Bottom + 8) / layers.ActualHeight, 0, 1);
            contrast.GradientStops[0].Offset = Math.Max(0, end - .26);
            contrast.GradientStops[1].Offset = end;
        }
        SizeChangedEventHandler updateScrim = (_, _) => UpdateScrim();
        copy.SizeChanged += updateScrim;
        Ui.OnRelease(copy, () => copy.SizeChanged -= updateScrim);
        UpdateMedia();

        // Bleed over the page padding, which follows the window width; the copy keeps the content's left edge.
        SizeChangedEventHandler scale = (_, args) => {
            double inset = artistPagePanel?.Padding.Left ?? 36, top = artistPagePanel?.Padding.Top ?? 18;
            if (stage.Margin.Left != -inset || stage.Margin.Top != -top) stage.Margin = new(-inset, -top, -inset, 0);
            var edge = new Thickness(inset, 0, inset, 16);
            if (row.Margin != edge) row.Margin = edge;
            layers.Height = Math.Clamp(args.NewSize.Width * .3, 260, 400);
            name.FontSize = Math.Clamp(args.NewSize.Width * .075, 40, 88);
            portrait.Width = portrait.Height = args.NewSize.Width < 700 ? 140 : 210;
            UpdateMedia(); UpdateScrim();
        };
        stage.SizeChanged += scale; Ui.OnRelease(stage, () => stage.SizeChanged -= scale);
        hero.Children.Add(stage);

        var actions = Ui.Row(); actions.Spacing = 16;
        var play = ArtistPlayButton(() => { if (model.Songs.Count > 0) _ = model.RunAsync(() => model.PlayAsync(model.Songs[0], model.Songs.ToArray(), model.PageContext)); });
        AutomationProperties.SetName(play, "Reproducir " + model.Heading); play.IsEnabled = model.Songs.Count > 0; actions.Children.Add(play);
        var shuffle = Ui.Button("Aleatorio", () => _ = model.RunAsync(() => model.PlayCollectionAsync(model.Songs.ToArray(), true, model.PageContext)), "Reproducir en orden aleatorio");
        var shuffleIcon = Ui.Icon("shuffle", 18); Ui.Tint(shuffleIcon, Ui.Brush("#FFFFFF"));
        var shuffleLabel = Ui.Text("Aleatorio", 13, true); shuffleLabel.Foreground = Ui.Brush("#FFFFFF");
        shuffle.Content = Ui.Row(shuffleIcon, shuffleLabel);
        shuffle.IsEnabled = model.Songs.Count > 1; ArtistGlass(shuffle); actions.Children.Add(shuffle);
        var back = Ui.Button("Volver a buscar", ReturnToSearch); ArtistGlass(back); actions.Children.Add(back);
        hero.Children.Add(actions);
        return hero;
    }

    /// <summary>A white disc whose glyph takes the page's deep colour; green clashes with red or blue pages.</summary>
    private Button ArtistPlayButton(Action action, double size = 56)
    {
        var play = Ui.PlayButton(action, size);
        var ink = new SolidColorBrush(ArtistThemes.Color(PendingArtistTheme.Deep));
        play.Background = Ui.Brush("#FFFFFF"); play.Foreground = ink;
        play.Resources["ButtonBackgroundPointerOver"] = Ui.Brush("#F4F4F5"); play.Resources["ButtonForegroundPointerOver"] = ink;
        play.Resources["ButtonBackgroundPressed"] = Ui.Brush("#E4E4E7"); play.Resources["ButtonForegroundPressed"] = ink;
        Ui.SetIcon(play, "play", size > 50 ? 28 : 22);
        ArtistFocus(play);
        PaintArtist(theme => { ink.Color = ArtistThemes.Color(theme.Deep); play.FocusVisualSecondaryBrush = ink; });
        return play;
    }

    private static void ArtistFocus(FrameworkElement control)
    {
        control.FocusVisualPrimaryBrush = Ui.Brush("#FFFFFF");
        control.FocusVisualSecondaryBrush = Ui.Brush("#101012");
        control.FocusVisualPrimaryThickness = new(2);
        control.FocusVisualSecondaryThickness = new(2);
    }

    private static void StyleArtistCatalogButton(Button button)
    {
        button.Resources["ButtonBackgroundPointerOver"] = Ui.Brush("#00000026");
        button.Resources["ButtonBackgroundPressed"] = Ui.Brush("#00000040");
        ArtistFocus(button);
    }

    private void ArtistGlass(Button button)
    {
        var fill = new SolidColorBrush();
        var hover = new SolidColorBrush();
        var pressed = new SolidColorBrush();
        button.Background = fill; button.Foreground = Ui.Brush("#FFFFFF"); button.BorderBrush = Ui.Brush("#FFFFFF40");
        button.Resources["ButtonBackgroundPointerOver"] = hover;
        button.Resources["ButtonBackgroundPressed"] = pressed;
        button.Resources["ButtonForegroundPointerOver"] = button.Foreground;
        button.Resources["ButtonForegroundPressed"] = button.Foreground;
        ArtistFocus(button);
        PaintArtist(theme => {
            var deep = ArtistThemes.Color(theme.Deep);
            var white = ArtistThemes.Color("#FFFFFF");
            fill.Color = ArtistThemes.Mix(deep, white, .12);
            hover.Color = ArtistThemes.Mix(deep, white, .18);
            pressed.Color = ArtistThemes.Mix(deep, white, .09);
        });
    }

    // Header video: Apple Music's editorial clip of the artist, resolved and cached by the backend (POST /api/motion/resolve).
    private bool ArtistMotionWanted => model.Settings.MotionArt && model.Settings.Effects && WindowsIntegration.AnimationsEnabled && !MeteredNetwork();

    // Read once and refreshed by NetworkStatusChanged: SyncArtistVideo runs on every scroll.
    private static bool? meteredNetwork;
    private static bool MeteredNetwork()
    {
        if (meteredNetwork is { } known) return known;
        try {
            var cost = NetworkInformation.GetInternetConnectionProfile()?.GetConnectionCost();
            meteredNetwork = cost != null && (cost.NetworkCostType is NetworkCostType.Fixed or NetworkCostType.Variable || cost.Roaming || cost.OverDataLimit);
        } catch { meteredNetwork = false; }
        return meteredNetwork.Value;
    }

    private void AttachArtistVideo(Grid layers, string? key, Action<bool> visibility)
    {
        if (key == null) return;
        var albums = model.Albums.Concat(model.Singles).Select(album => album.Title.Trim())
            .Where(title => title.Length > 0).Distinct(StringComparer.OrdinalIgnoreCase).Take(40).Order(StringComparer.OrdinalIgnoreCase).ToArray();
        if (albums.Length == 0) return;
        string motionKey = key + "\n" + string.Join('\u001f', albums);
        if (artistVideo == null || artistVideoKey != motionKey) {
            ReleaseArtistVideo();
            var video = new LoopingVideo(DispatcherQueue) { VerticalAnchor = .32 };
            video.Failed += () => {
                ArtistMotionKnown[motionKey] = (null, Environment.TickCount64 + 15 * 60_000);
                artistVideoUrl = null;
            };
            artistVideo = video; artistVideoKey = motionKey;
            artistMotionEntry = new(model.Heading.Trim(), albums, key.StartsWith("youtube:", StringComparison.Ordinal) ? key[8..] : key);
        }
        var currentVideo = artistVideo;
        var view = currentVideo.View;
        (view.Parent as Panel)?.Children.Remove(view);
        layers.Children.Add(view);
        // A rebuild of the same page (more songs, a refresh) moves the running video instead of restarting it.
        currentVideo.VisibilityChanged += visibility;
        visibility(currentVideo.Visible);
        Ui.OnRelease(layers, () => { currentVideo.VisibilityChanged -= visibility; layers.Children.Remove(view); });
        SyncArtistVideo();
    }

    private void ReleaseArtistVideo()
    {
        artistVideo?.Release(); artistVideo = null; artistVideoKey = artistVideoUrl = null; artistMotionEntry = null;
    }

    private async Task ResolveArtistMotionAsync(string key, ArtistMotionEntry entry)
    {
        const long maxWait = 30L * 24 * 3_600_000;
        try {
            var result = await model.Api.SendAsync<MotionArtResult>("api/motion/resolve", HttpMethod.Post, new { entry });
            string? url = result.Status == "ready" && !string.IsNullOrWhiteSpace(result.Url) ? result.Url : null;
            long wait = result.RetryAfterMs > 0 ? result.RetryAfterMs : result.Status == "none" ? maxWait : 15 * 60_000;
            ArtistMotionKnown[key] = (url, Environment.TickCount64 + (url != null ? 3_600_000 : Math.Clamp(wait, 1000, maxWait)));
        } catch (Exception error) {
            long wait = error.Data["RetryAfterMs"] is long retry ? Math.Clamp(retry, 1000, maxWait) : 15 * 60_000;
            ArtistMotionKnown[key] = (null, Environment.TickCount64 + wait);
        } finally { artistMotionPending.Remove(key); }
        if (artistVideoKey == key) SyncArtistVideo();
    }

    /// <summary>The header video runs only on its page, in a visible window, while the header is on screen.</summary>
    private void SyncArtistVideo()
    {
        if (artistVideo is not { } video || artistVideoKey is not { } key) return;
        bool onScreen = model.Page == "artist" && Visible && AppWindow.IsVisible && pageScroll.Visibility == Visibility.Visible
            && artistHeroStage is { } stage && pageScroll.VerticalOffset < Math.Max(1, stage.ActualHeight);
        if (!ArtistMotionWanted) {
            if (artistVideoUrl != null) { video.Hide(); artistVideoUrl = null; }
            return;
        }
        if (!onScreen) { video.Pause(); return; }
        if (artistVideoUrl != null) { video.Play(); return; }
        if (!ArtistMotionKnown.TryGetValue(key, out var known) || known.RetryAt <= Environment.TickCount64) {
            if (artistMotionEntry is { } entry && artistMotionPending.Add(key)) _ = ResolveArtistMotionAsync(key, entry);
            return;
        }
        if (known.Url == null || !Uri.TryCreate(model.Api.Http.BaseAddress, known.Url, out var source)) return;
        artistVideoUrl = known.Url;
        video.Fade = WindowsIntegration.AnimationsEnabled;
        video.Show(source);
        video.Play();
    }

    private FrameworkElement ArtistLatestRelease(YouTubeAlbum album, string kind)
    {
        var section = new StackPanel();
        section.Children.Add(CatalogSectionHeading("Último lanzamiento"));
        var row = new Grid { ColumnSpacing = 24 };
        row.ColumnDefinitions.Add(new() { Width = GridLength.Auto }); row.ColumnDefinitions.Add(new() { Width = new(1, GridUnitType.Star) });
        var cover = CatalogArtworkView(album.Artwork, 168); cover.CornerRadius = new(8); row.Children.Add(cover);
        var copy = new StackPanel { Spacing = 6, VerticalAlignment = VerticalAlignment.Center };
        var title = Ui.Text(album.Title, 24, true); title.MaxLines = 2; title.TextTrimming = TextTrimming.CharacterEllipsis; copy.Children.Add(title);
        var meta = Ui.Text(string.Join(" · ", new[] { album.Year?.ToString() ?? "", kind }.Where(part => part.Length > 0)), 13); meta.Foreground = Ui.Brush(ArtistSecondaryText); copy.Children.Add(meta);
        Grid.SetColumn(copy, 1); row.Children.Add(copy);
        var button = Ui.Button(album.Title, () => _ = model.RunAsync(() => model.AlbumAsync(album.Id)), "Abrir " + album.Title);
        button.Content = row; HomeCardChrome(button); StyleArtistCatalogButton(button); button.HorizontalAlignment = HorizontalAlignment.Stretch; button.HorizontalContentAlignment = HorizontalAlignment.Stretch; button.Margin = new(-8, 0, -8, 0);
        section.Children.Add(button);
        return section;
    }

    private FrameworkElement ArtistAbout()
    {
        var section = new StackPanel();
        section.Children.Add(CatalogSectionHeading("Acerca de"));
        var panel = new StackPanel { Spacing = 10 };
        var biography = Ui.Text(model.Description, 14); biography.Foreground = Ui.Brush(ArtistSecondaryText); biography.LineHeight = 24; biography.MaxWidth = 720; biography.HorizontalAlignment = HorizontalAlignment.Left; biography.MaxLines = 4; biography.TextTrimming = TextTrimming.CharacterEllipsis;
        panel.Children.Add(biography);
        if (model.Description.Length > 240)
        {
            Button? toggle = null;
            toggle = Ui.Button("Más información", () => { bool open = biography.MaxLines != 0; biography.MaxLines = open ? 0 : 4; toggle!.Content = open ? "Mostrar menos" : "Más información"; });
            toggle.Background = Ui.Brush("#00000000"); toggle.BorderThickness = new(0); toggle.Padding = new(0); toggle.HorizontalAlignment = HorizontalAlignment.Left; ArtistFocus(toggle); panel.Children.Add(toggle);
        }
        // A translucent sheet over the deep colour rather than a grey card; tagged so Appearance keeps it.
        section.Children.Add(new Border { Child = panel, Padding = new(30, 26, 30, 22), CornerRadius = new(14), Tag = "home-artwork", Background = Ui.Brush("#00000026"), BorderBrush = Ui.Brush("#FFFFFF28"), BorderThickness = new(1) });
        return section;
    }
}
