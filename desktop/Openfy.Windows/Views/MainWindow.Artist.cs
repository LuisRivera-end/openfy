using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Automation.Peers;
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
/// discography, then deep for related artists, ending in the panel colour.
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
    private Border? pageWash;
    private readonly Canvas artistMediaLayer = new() { IsHitTestVisible = false, Visibility = Visibility.Collapsed };
    private readonly RectangleGeometry artistMediaClip = new();
    private Grid? artistMedia;
    private StackPanel? pagePanel;
    private Microsoft.UI.Dispatching.DispatcherQueueTimer? albumHeaderTimer;
    private readonly global::Windows.UI.ViewManagement.UISettings albumAccessibility = new();
    private ArtistThemeColors? artistTheme;
    private string? artistThemeKey, artistVideoKey;
    private string? artistVideoUrl;
    private ArtistMotionEntry? artistMotionEntry;
    private FrameworkElement? artistDeepAnchor, artistHeroStage;
    private LoopingVideo? artistVideo;
    private Action<double, bool>? layoutLatestRelease;

    private bool ArtistSurfacePage => model.Page is "artist" or "localartist";
    private string? ArtistThemeKey => model.Page == "artist" ? model.PageContext?.Id : model.Page == "localartist" && model.PageContext?.Id is { } name ? "local:" + name : null;
    internal bool ArtistVideoVisible => artistVideo?.Visible == true;
    internal ArtistThemeColors? CurrentArtistTheme => ArtistSurfacePage ? artistTheme : null;

    private void AttachPageWash(Grid body, StackPanel page)
    {
        pagePanel = page;
        for (int i = 0; i < 7; i++) artistWashBrush.GradientStops.Add(new() { Offset = i / 6.0, Color = ArtistThemes.Color("#101012") });
        pageWash = new Border { IsHitTestVisible = false, Opacity = 0, Background = artistWashBrush };
        Grid.SetColumnSpan(pageWash, 2);
        Grid.SetColumnSpan(artistMediaLayer, 2);
        artistMediaLayer.Clip = artistMediaClip;
        body.Children.Insert(0, pageWash);
        body.Children.Insert(1, artistMediaLayer);
        artistMediaLayer.SizeChanged += (_, _) => LayoutArtistMedia();
        pageScroll.ViewChanged += (_, _) => UpdatePageWash();
        pageScroll.SizeChanged += (_, _) => { LayoutPageInsets(); UpdatePageWash(); };
        page.SizeChanged += (_, _) => UpdatePageWash();
        VisibilityChanged += (_, _) => { SyncArtistVideo(); SyncAlbumVideo(); };
        AppWindow.Changed += (_, _) => SyncAlbumVideo();
        NetworkStatusChangedEventHandler networkChanged = _ => DispatcherQueue.TryEnqueue(() => {
            networkCost = null; SyncArtistVideo(); SyncAlbumVideo();
        });
        NetworkInformation.NetworkStatusChanged += networkChanged;
        albumHeaderTimer = DispatcherQueue.CreateTimer();
        albumHeaderTimer.Interval = TimeSpan.FromMilliseconds(200);
        albumHeaderTimer.Tick += (_, _) => { UpdateAlbumTint(); SyncAlbumVideo(); };
        model.AlbumPresentationChanged += AlbumPresentationChanged;
        albumAccessibility.AnimationsEnabledChanged += AnimationsChanged;
        Closed += (_, _) => {
            NetworkInformation.NetworkStatusChanged -= networkChanged;
            model.AlbumPresentationChanged -= AlbumPresentationChanged;
            albumAccessibility.AnimationsEnabledChanged -= AnimationsChanged;
            albumHeaderTimer.Stop();
            artistVideo?.Release();
            ReleaseAlbumVideo();
            albumCover = null;
            if (frameTintAnimating) EndFrameTint();
        };

        void AnimationsChanged(global::Windows.UI.ViewManagement.UISettings sender, object args)
            => DispatcherQueue.TryEnqueue(() => { UpdateAlbumTint(); UpdateFrameTint(); UpdatePageWash(); });
    }

    private void AlbumPresentationChanged()
    {
        refreshAlbumDescription?.Invoke();
        UpdateAlbumTint();
        SyncAlbumVideo();
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
        LayoutPageInsets();
        ApplyPageTrackStyle();
        UpdateFrameTint();
        UpdatePageWash();
        if (ArtistSurfacePage) PaintArtist(theme => UpdateTopBarGlassColors(theme));
        UpdateTopBar();
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
        StateBrushes.Refresh();
        UpdateFrameTint();
        UpdatePageWash();
    }

    private void UpdatePageWash()
    {
        if (pageWash == null || pagePanel == null) return;
        LayoutArtistMedia();
        bool visible = ArtistSurfacePage && artistTheme != null && pageScroll.Visibility == Visibility.Visible;
        if (!PageEffects) pageWash.OpacityTransition = null;
        else pageWash.OpacityTransition ??= new ScalarTransition { Duration = TimeSpan.FromMilliseconds(240) };
        pageWash.Opacity = visible ? 1 : 0;
        if (AlbumSurfacePage) SyncAlbumVideo();
        SyncArtistVideo();
        if (!visible) return;
        double offset = pageScroll.VerticalOffset, viewport = Math.Max(1, pageScroll.ViewportHeight), height = Math.Max(1, pageWash.ActualHeight);
        double top = Math.Max(0, height - viewport);
        try { top = Math.Clamp(pageScroll.TransformToVisual(pageWash).TransformPoint(new(0, 0)).Y, 0, height); } catch (ArgumentException) { }

        double Position(FrameworkElement element) { try { return element.TransformToVisual(pagePanel).TransformPoint(new(0, 0)).Y; } catch (ArgumentException) { return double.NaN; } }
        double end = Math.Max(1, pagePanel.ActualHeight - pagePanel.Padding.Bottom);
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
        var appColor = ArtistThemes.Color(NeutralFrame.Background);

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

    private void LayoutArtistMedia()
    {
        if (artistMedia == null || artistHeroStage is not { IsLoaded: true } stage || !ArtistSurfacePage)
        {
            artistMediaLayer.Visibility = Visibility.Collapsed;
            return;
        }
        artistMediaLayer.Visibility = Visibility.Visible;
        double width = artistMediaLayer.ActualWidth, height = artistMediaLayer.ActualHeight;
        if (width <= 0 || height <= 0) return;
        double viewportTop = pageScroll.TransformToVisual(artistMediaLayer).TransformPoint(new(0, 0)).Y;
        double stageTop = stage.TransformToVisual(artistMediaLayer).TransformPoint(new(0, 0)).Y;
        double bleed = Math.Max(0, viewportTop);
        // Header media bleeds behind the transparent top bar like the web artist page.
        artistMediaClip.Rect = new(0, 0, width, height);
        artistMedia.Width = width;
        artistMedia.Height = stage.ActualHeight + bleed;
        Canvas.SetTop(artistMedia, stageTop - bleed);
    }

    private void BuildArtistCatalog()
    {
        string? key = ArtistThemeKey;
        catalog.Children.Add(ArtistHero(key));
        artistPopularHeading.Children.Add(model.Songs.Count > 0
            ? CatalogSectionHeading("Canciones populares", model.MoreSongsAvailable ? "Ver todas las canciones" : null, () => _ = model.RunAsync(model.MoreAsync))
            : CatalogEmptyState("music", "Este artista todavía no tiene canciones disponibles.", "Vuelve a buscarlo más tarde para actualizar su perfil."));

        var latest = model.Albums.Select(album => (Album: album, Kind: "Álbum")).Concat(model.Singles.Select(album => (Album: album, Kind: "Single / EP")))
            .Aggregate<(YouTubeAlbum Album, string Kind), (YouTubeAlbum Album, string Kind)?>(null, (best, item) => best is null || (item.Album.Year ?? 0) > (best.Value.Album.Year ?? 0) ? item : best);
        if (latest is { } release) artistLatestRelease.Children.Add(ArtistLatestRelease(release.Album, release.Kind));
        LayoutArtistReleases();
        CatalogReleases("Álbumes", model.Albums, false);
        CatalogReleases("Singles y EPs", model.Singles, true);
        if (model.SimilarArtists.Count > 0)
        {
            var heading = CatalogSectionHeading("Fans también escuchan"); artistDeepAnchor = heading;
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
        var stage = new Border { Child = layers };
        var media = new Grid();
        artistHeroStage = stage;
        artistMedia = media;
        artistMediaLayer.Children.Add(media);
        stage.Loaded += (_, _) => LayoutArtistMedia();
        Ui.OnRelease(stage, () => {
            Ui.ReleaseTree(media);
            artistMediaLayer.Children.Remove(media);
            artistMedia = null;
            artistMediaLayer.Visibility = Visibility.Collapsed;
        });
        AutomationProperties.SetName(stage, model.Heading);
        var stageColor = new SolidColorBrush(); media.Background = stageColor;
        PaintArtist(theme => stageColor.Color = ArtistThemes.Color(theme.Base));

        var copy = new StackPanel { Spacing = 2, VerticalAlignment = VerticalAlignment.Bottom };
        var kind = Ui.Text("Artista", 13, true); kind.Foreground = Ui.Brush(ArtistSecondaryText); copy.Children.Add(kind);
        var name = Ui.Text(model.Heading, 72, true); name.Foreground = Ui.Brush("#FFFFFF"); name.FontWeight = Microsoft.UI.Text.FontWeights.Bold; name.CharacterSpacing = -45; name.MaxLines = 2; name.TextTrimming = TextTrimming.CharacterEllipsis; name.Tag = "display";
        copy.Children.Add(name);
        var row = new Grid { ColumnSpacing = 30, VerticalAlignment = VerticalAlignment.Bottom };
        row.ColumnDefinitions.Add(new() { Width = GridLength.Auto }); row.ColumnDefinitions.Add(new() { Width = new(1, GridUnitType.Star) });
        Grid.SetColumn(copy, 1); row.Children.Add(copy);
        var portrait = CatalogArtworkView(model.CatalogArtwork, 210, round: true);
        Appearance.SetStyle(portrait, () => portrait.CornerRadius = new(1000));
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
            var frame = new Canvas(); frame.Children.Add(image); media.Children.Add(frame);
            double sourceWidth = 0, sourceHeight = 0;
            void Place()
            {
                double width = media.ActualWidth, height = media.ActualHeight;
                if (width <= 0 || height <= 0) return;
                media.Clip = new RectangleGeometry { Rect = new(0, 0, width, height) };
                if (sourceWidth <= 0) return;
                double scale = Math.Max(width / sourceWidth, height / sourceHeight);
                image.Width = sourceWidth * scale; image.Height = sourceHeight * scale;
                Canvas.SetLeft(image, (width - image.Width) / 2); Canvas.SetTop(image, (height - image.Height) * .32);
            }
            SizeChangedEventHandler place = (_, _) => Place(); media.SizeChanged += place; Ui.OnRelease(media, () => media.SizeChanged -= place);
            bool released = false; Ui.OnRelease(image, () => released = true);
            image.ImageOpened += (_, _) => { imagePending = false; hasImage = true; UpdateMedia(); };
            image.ImageFailed += (_, _) => { imagePending = false; hasImage = false; UpdateMedia(); };
            async Task Load()
            {
                try
                {
                    var result = await model.Artwork.GetAsync(model.CatalogBanner!, 2048); if (released) return;
                    sourceWidth = Math.Max(1, result.Width); sourceHeight = Math.Max(1, result.Height); Place();
                    Ui.Cover(image, result.Path, Math.Max(media.ActualWidth, 900), Math.Max(media.ActualHeight, 300), result.Width, result.Height);
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
        AttachArtistVideo(media, key, visible => { hasVideo = visible; UpdateMedia(); });
        media.Children.Add(scrim); media.Children.Add(shadeLayer); layers.Children.Add(row);
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
            double total = media.ActualHeight > 0 ? media.ActualHeight : layers.ActualHeight;
            double end = Math.Clamp(1 - (copy.ActualHeight + row.Margin.Bottom + 8) / total, 0, 1);
            contrast.GradientStops[0].Offset = Math.Max(0, end - .26);
            contrast.GradientStops[1].Offset = end;
        }
        SizeChangedEventHandler updateScrim = (_, _) => UpdateScrim();
        copy.SizeChanged += updateScrim;
        Ui.OnRelease(copy, () => copy.SizeChanged -= updateScrim);
        media.SizeChanged += updateScrim;
        Ui.OnRelease(media, () => media.SizeChanged -= updateScrim);
        UpdateMedia();

        // Bleed over the page padding, which follows the window width; the copy keeps the content's left edge.
        SizeChangedEventHandler scale = (_, args) => {
            double inset = pagePanel?.Padding.Left ?? 36, top = pagePanel?.Padding.Top ?? 18;
            if (stage.Margin.Left != -inset || stage.Margin.Top != -top) stage.Margin = new(-inset, -top, -inset, 0);
            var edge = new Thickness(inset, 0, inset, 16);
            if (row.Margin != edge) row.Margin = edge;
            layers.Height = Math.Clamp(args.NewSize.Width * .3, 260, 400);
            name.FontSize = Math.Clamp(args.NewSize.Width * .075, 40, 88);
            portrait.Width = portrait.Height = args.NewSize.Width < 700 ? 140 : 210;
            LayoutArtistMedia(); UpdateMedia(); UpdateScrim();
        };
        stage.SizeChanged += scale; Ui.OnRelease(stage, () => stage.SizeChanged -= scale);
        hero.Children.Add(stage);

        var actions = Ui.Row(); actions.Spacing = 16;
        var play = ArtistPlayButton(() => { if (model.Songs.Count > 0) _ = model.RunAsync(() => model.PlayAsync(model.Songs[0], model.Songs.ToArray(), model.PageContext)); });
        AutomationProperties.SetName(play, "Reproducir " + model.Heading); play.IsEnabled = model.Songs.Count > 0; actions.Children.Add(play);
        var shuffle = Ui.Button("Aleatorio", () => _ = model.RunAsync(() => model.PlayCollectionAsync(model.Songs.ToArray(), true, model.PageContext)), "Reproducir en orden aleatorio");
        var shuffleIcon = Ui.Icon("shuffle", 20); Ui.Tint(shuffleIcon, Ui.Brush("#FFFFFF"));
        shuffle.Content = shuffleIcon;
        shuffle.Width = 48; shuffle.Height = 48; shuffle.CornerRadius = new(24); shuffle.Padding = new(0);
        shuffle.HorizontalContentAlignment = HorizontalAlignment.Center; shuffle.VerticalContentAlignment = VerticalAlignment.Center;
        ToolTipService.SetToolTip(shuffle, "Aleatorio");
        shuffle.IsEnabled = model.Songs.Count > 1; ArtistLiquidGlass(shuffle); actions.Children.Add(shuffle);
        if (!string.IsNullOrWhiteSpace(model.Description))
        {
            string artistName = model.Heading, description = model.Description, artwork = model.CatalogArtwork ?? "";
            var info = new Button { Width = 48, Height = 48, CornerRadius = new(24), Padding = new(0),
                HorizontalContentAlignment = HorizontalAlignment.Center, VerticalContentAlignment = VerticalAlignment.Center,
                Content = new FontIcon { FontFamily = new("Segoe Fluent Icons"), Glyph = "\uE946", FontSize = 20 } };
            ArtistLiquidGlass(info);
            AutomationProperties.SetName(info, $"Acerca de {artistName}");
            ToolTipService.SetToolTip(info, "Acerca de");
            RoutedEventHandler show = (_, _) => _ = model.RunAsync(() => ShowArtistAboutAsync(info, artistName, artwork, description));
            info.Click += show;
            Ui.OnRelease(info, () => info.Click -= show);
            actions.Children.Add(info);
        }
        hero.Children.Add(actions);
        return hero;
    }

    private async Task ShowArtistAboutAsync(Button source, string name, string artwork, string description)
    {
        var portrait = CatalogArtworkView(artwork, 116, round: true);
        Appearance.SetStyle(portrait, () => portrait.CornerRadius = new(58));
        portrait.HorizontalAlignment = HorizontalAlignment.Center;
        var title = Ui.Text(name, 28, true);
        title.TextAlignment = TextAlignment.Center;
        title.Tag = "display";
        var heading = Ui.Text("Acerca de", 19, true);
        AutomationProperties.SetHeadingLevel(title, AutomationHeadingLevel.Level1);
        AutomationProperties.SetHeadingLevel(heading, AutomationHeadingLevel.Level2);
        var biography = Ui.Text(description, 14);
        biography.LineHeight = 22;
        biography.IsTextSelectionEnabled = true;
        foreach (var text in new[] { title, heading, biography }) text.Foreground = frameWhite;
        var content = new StackPanel { Spacing = 14, Children = { portrait, title, heading, biography } };
        var scroll = new ScrollViewer { Content = content, HorizontalScrollBarVisibility = ScrollBarVisibility.Disabled,
            VerticalScrollBarVisibility = ScrollBarVisibility.Auto, MaxHeight = Math.Clamp(root.ActualHeight - 168, 120, 540), MaxWidth = 512 };
        var deep = Ui.Brush((artistTheme ?? PendingArtistTheme).Deep);
        var closeStyle = new Style(typeof(Button));
        closeStyle.Setters.Add(new Setter(Control.ForegroundProperty, frameWhite));
        closeStyle.Setters.Add(new Setter(Control.BackgroundProperty, Ui.Brush("#FFFFFF18")));
        closeStyle.Setters.Add(new Setter(Control.BorderBrushProperty, Ui.Brush("#FFFFFF40")));
        var dialog = new ContentDialog { XamlRoot = root.XamlRoot, Content = scroll,
            CloseButtonText = "Cerrar", CloseButtonStyle = closeStyle };
        AutomationProperties.SetName(dialog, $"Acerca de {name}");
        dialog.Resources["ContentDialogBackground"] = deep;
        dialog.Resources["ContentDialogMaxWidth"] = 560d;
        Appearance.SetStyle(dialog, () => {
            dialog.Background = deep;
            dialog.Foreground = frameWhite;
            dialog.CornerRadius = new(16);
        });
        Appearance.Apply(content);
        try { await dialog.ShowAsync(); }
        finally
        {
            Ui.ReleaseTree(content);
            if (source.IsLoaded) source.Focus(FocusState.Programmatic);
        }
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

    // Liquid glass for the icon-only artist header buttons, matching .artist-glass-button on the web: a translucent
    // tint of the artist colour with a diagonal specular sheen and a rim that is brighter on the top edge.
    private void ArtistLiquidGlass(Button button)
    {
        static LinearGradientBrush Sheen() => new()
        {
            StartPoint = new(0.2, 0), EndPoint = new(0.8, 1),
            GradientStops = { new GradientStop { Offset = 0 }, new GradientStop { Offset = .42 }, new GradientStop { Offset = .58 }, new GradientStop { Offset = 1 } },
        };
        var fill = Sheen(); var hover = Sheen(); var pressed = Sheen();
        var rim = new LinearGradientBrush
        {
            StartPoint = new(0.5, 0), EndPoint = new(0.5, 1),
            GradientStops = { new GradientStop { Offset = 0, Color = Color.FromArgb(0x73, 255, 255, 255) }, new GradientStop { Offset = 1, Color = Color.FromArgb(0x1A, 255, 255, 255) } },
        };
        button.Background = fill; button.Foreground = Ui.Brush("#FFFFFF");
        button.BorderBrush = rim; button.BorderThickness = new(1);
        button.Resources["ButtonBackgroundPointerOver"] = hover;
        button.Resources["ButtonBackgroundPressed"] = pressed;
        button.Resources["ButtonBorderBrushPointerOver"] = rim;
        button.Resources["ButtonBorderBrushPressed"] = rim;
        button.Resources["ButtonForegroundPointerOver"] = button.Foreground;
        button.Resources["ButtonForegroundPressed"] = button.Foreground;
        ArtistFocus(button);
        PaintArtist(theme => {
            var deep = ArtistThemes.Color(theme.Deep);
            var white = ArtistThemes.Color("#FFFFFF");
            void Paint(LinearGradientBrush brush, double lift)
            {
                double[] sheen = [.30, .10, .06, .18];
                for (var i = 0; i < sheen.Length; i++)
                {
                    var color = ArtistThemes.Mix(deep, white, sheen[i] + lift);
                    color.A = 0xD9;
                    brush.GradientStops[i].Color = color;
                }
            }
            Paint(fill, 0); Paint(hover, .08); Paint(pressed, -.04);
        });
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
    private static (bool Metered, bool Strict)? networkCost;
    private static bool MeteredNetwork(bool requireUnrestricted = false)
    {
        if (networkCost == null)
        {
            try {
                var cost = NetworkInformation.GetInternetConnectionProfile()?.GetConnectionCost();
                bool restricted = cost?.Roaming == true || cost?.OverDataLimit == true;
                networkCost = (restricted || cost?.NetworkCostType is NetworkCostType.Fixed or NetworkCostType.Variable,
                    restricted || cost?.NetworkCostType != NetworkCostType.Unrestricted);
            } catch { networkCost = (false, true); }
        }
        return requireUnrestricted ? networkCost.Value.Strict : networkCost.Value.Metered;
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
        var heading = CatalogSectionHeading("Último lanzamiento");
        section.Children.Add(heading);
        var row = new Grid { ColumnSpacing = 14, RowSpacing = 8 };
        row.ColumnDefinitions.Add(new() { Width = GridLength.Auto }); row.ColumnDefinitions.Add(new() { Width = new(1, GridUnitType.Star) });
        row.RowDefinitions.Add(new() { Height = GridLength.Auto }); row.RowDefinitions.Add(new() { Height = GridLength.Auto });
        var cover = CatalogArtworkView(album.Artwork, 160); cover.CornerRadius = new(8);
        cover.HorizontalAlignment = HorizontalAlignment.Left; row.Children.Add(cover);
        AutomationProperties.SetAutomationId(cover, "ArtistLatestReleaseCover");
        var copy = new StackPanel { Spacing = 6, VerticalAlignment = VerticalAlignment.Center };
        var title = Ui.Text(album.Title, 16, true); title.Tag = "display"; title.MaxLines = 2; title.TextTrimming = TextTrimming.CharacterEllipsis; copy.Children.Add(title);
        var meta = Ui.Text(string.Join(" · ", new[] { album.Year?.ToString() ?? "", kind }.Where(part => part.Length > 0)), 13); meta.Foreground = Ui.Brush(ArtistSecondaryText); copy.Children.Add(meta);
        row.Children.Add(copy);
        var button = Ui.Button(album.Title, () => _ = model.RunAsync(() => model.AlbumAsync(album.Id)), "Abrir " + album.Title);
        button.Content = row; HomeCardChrome(button); StyleArtistCatalogButton(button); button.HorizontalAlignment = HorizontalAlignment.Stretch; button.HorizontalContentAlignment = HorizontalAlignment.Stretch; button.Margin = new(-8, 0, -8, 0);
        section.Children.Add(button);
        layoutLatestRelease = (width, wide) => {
            row.ColumnSpacing = wide ? 0 : 14;
            heading.MinHeight = wide && model.MoreSongsAvailable ? 44 : 0;
            cover.Width = cover.Height = wide ? Math.Min(160, width) : 76;
            Grid.SetColumnSpan(cover, wide ? 2 : 1);
            Grid.SetColumnSpan(copy, wide ? 2 : 1);
            Grid.SetColumn(copy, wide ? 0 : 1);
            Grid.SetRow(copy, wide ? 1 : 0);
        };
        return section;
    }

    private void LayoutArtistReleases()
    {
        const double minSongs = 480, gap = 24;
        double width = pagePanel is { } page ? pageScroll.ActualWidth - page.Padding.Left - page.Padding.Right : 0;
        bool hasRelease = layoutLatestRelease != null;
        bool wide = hasRelease && width >= 700;
        double releaseWidth = wide ? Math.Min(Math.Clamp(width * .28, 196, 300), width - minSongs - gap) : 0;
        trackLayout.ColumnSpacing = wide ? gap : 0;
        trackLayout.RowSpacing = hasRelease && !wide ? 16 : 0;
        trackLayout.ColumnDefinitions[0].MinWidth = wide ? minSongs : 0;
        trackLayout.ColumnDefinitions[1].Width = new(releaseWidth);
        Grid.SetRow(artistLatestRelease, wide ? 0 : 1);
        Grid.SetColumn(artistLatestRelease, wide ? 1 : 0);
        artistLatestRelease.Visibility = hasRelease ? Visibility.Visible : Visibility.Collapsed;
        layoutLatestRelease?.Invoke(releaseWidth, wide);
    }
}
