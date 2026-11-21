using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Openfy.Core;
using Color = global::Windows.UI.Color;
using UISettings = global::Windows.UI.ViewManagement.UISettings;

namespace Openfy.Windows.Views;

public sealed partial class MainWindow
{
    private static readonly AlbumTint NeutralFrame = new("#101012", "#202024", "#A1A1AA", "#FFFFFF0B");
    private static readonly Color NeutralSidebarGlass = ArtistThemes.Color("#151517");
    private static readonly Color NeutralPlayerGlass = ArtistThemes.Color("#18181C");
    private const string PanelMutedColor = "#C9C9D2";
    private readonly SolidColorBrush frameBackground = Ui.Brush(NeutralFrame.Background);
    private readonly SolidColorBrush frameSurface = Ui.Brush(NeutralFrame.Surface);
    private readonly SolidColorBrush frameMuted = Ui.Brush(NeutralFrame.Muted);
    private readonly SolidColorBrush frameEdge = Ui.Brush(NeutralFrame.Edge);
    private readonly SolidColorBrush frameWhite = Ui.Brush("#FFFFFF");
    private readonly SolidColorBrush frameSelection = Ui.Brush("#FFFFFF0C");
    private readonly SolidColorBrush panelMuted = Ui.Brush(PanelMutedColor);
    private readonly AcrylicBrush sidebarGlass = Ui.Glass("#151517", .60);
    private readonly GlassBrush playerGlass;
    private readonly GlassBrush sidePanelGlass;
    private readonly SolidColorBrush playbackFallback = new(NeutralPlayerGlass);
    private readonly UISettings transparencySettings = new();
    private bool frameTintAnimating;
    private long frameTintStarted;
    private (AlbumTint Tint, bool Tinted)? frameTintTarget;
    private FrameColors frameTintStart, frameTintEnd;

    private readonly record struct FrameColors(Color Background, Color Surface, Color Muted, Color Edge,
        Color Selection, Color Sidebar, Color Player);

    private bool PlaybackGlassEnabled => model.Settings.Transparency switch
    {
        "on" => true,
        "off" => false,
        _ => transparencySettings.AdvancedEffectsEnabled
    };

    private Brush PlaybackBackground(GlassBrush glass) => PlaybackGlassEnabled ? glass : playbackFallback;

    private void ObserveTransparency()
    {
        var dispatcher = DispatcherQueue;
        transparencySettings.AdvancedEffectsEnabledChanged += SystemTransparencyChanged;
        Closed += (_, _) => transparencySettings.AdvancedEffectsEnabledChanged -= SystemTransparencyChanged;
        UpdatePlaybackTransparency();

        void SystemTransparencyChanged(UISettings sender, object args)
            => dispatcher.TryEnqueue(UpdatePlaybackTransparency);
    }

    private void UpdatePlaybackTransparency()
    {
        playerPill.Background = PlaybackBackground(playerGlass);
        sidePanel.Background = PlaybackBackground(sidePanelGlass);
        ApplyTopBarStyle();
    }

    /// <summary>Artist pages show their header art through the top bar, unless transparency is off (setting or system).</summary>
    private bool TopBarGlass => ArtistSurfacePage && PlaybackGlassEnabled;

    private void UpdateFrameTint()
    {
        var tint = NeutralFrame;
        if (AlbumSurfacePage) tint = albumTintTarget;
        else if (ArtistSurfacePage)
        {
            var theme = artistTheme ?? PendingArtistTheme;
            tint = new(theme.Base, theme.Surface, ArtistSecondaryText, theme.Deep);
        }
        bool tinted = AlbumSurfacePage || ArtistSurfacePage;
        if (frameTintTarget == (tint, tinted))
        {
            if (!PageEffects && frameTintAnimating) EndFrameTint();
            return;
        }
        frameTintTarget = (tint, tinted);

        var background = ArtistThemes.Color(tint.Background);
        var surface = ArtistThemes.Color(tint.Surface);
        frameTintEnd = new(background, surface, ArtistThemes.Color(tint.Muted), ArtistThemes.Color(tint.Edge),
            tinted ? surface : ArtistThemes.Color("#FFFFFF0C"),
            tinted ? background : NeutralSidebarGlass,
            tinted ? ArtistThemes.Mix(NeutralPlayerGlass, background, .70) : NeutralPlayerGlass);
        frameTintStart = new(frameBackground.Color, frameSurface.Color, frameMuted.Color, frameEdge.Color,
            frameSelection.Color, sidebarGlass.TintColor, playerGlass.TintColor);
        frameTintStarted = Environment.TickCount64;
        if (!PageEffects || frameTintStart == frameTintEnd)
        {
            EndFrameTint();
            return;
        }
        if (!frameTintAnimating) CompositionTarget.Rendering += AnimateFrameTint;
        frameTintAnimating = true;
    }

    private void AnimateFrameTint(object? sender, object args)
    {
        double progress = (Environment.TickCount64 - frameTintStarted) / 240.0;
        if (progress >= 1 || !PageEffects) { EndFrameTint(); return; }
        // Invert the x component of cubic-bezier(.2, 0, .2, 1) before evaluating y.
        double low = 0, high = 1;
        for (int i = 0; i < 22; i++)
        {
            double t = (low + high) / 2, u = 1 - t;
            if (.6 * u * t + t * t * t < progress) low = t; else high = t;
        }
        double parameter = (low + high) / 2;
        double weight = parameter * parameter * (3 - 2 * parameter);
        Color Blend(Color start, Color end)
        {
            byte Channel(byte a, byte b) => (byte)Math.Floor(a + (b - a) * weight + .5);
            return Color.FromArgb(Channel(start.A, end.A), Channel(start.R, end.R),
                Channel(start.G, end.G), Channel(start.B, end.B));
        }
        ApplyFrameColors(new(
            Blend(frameTintStart.Background, frameTintEnd.Background),
            Blend(frameTintStart.Surface, frameTintEnd.Surface),
            Blend(frameTintStart.Muted, frameTintEnd.Muted),
            Blend(frameTintStart.Edge, frameTintEnd.Edge),
            Blend(frameTintStart.Selection, frameTintEnd.Selection),
            Blend(frameTintStart.Sidebar, frameTintEnd.Sidebar),
            Blend(frameTintStart.Player, frameTintEnd.Player)));
    }

    private void EndFrameTint()
    {
        if (frameTintAnimating) CompositionTarget.Rendering -= AnimateFrameTint;
        frameTintAnimating = false;
        ApplyFrameColors(frameTintEnd);
    }

    private void ApplyFrameColors(FrameColors colors)
    {
        frameBackground.Color = colors.Background;
        frameSurface.Color = colors.Surface;
        frameMuted.Color = colors.Muted;
        frameEdge.Color = colors.Edge;
        frameSelection.Color = colors.Selection;
        sidebarGlass.TintColor = sidebarGlass.FallbackColor = colors.Sidebar;
        playbackFallback.Color = colors.Player;
        playerGlass.TintColor = playerGlass.FallbackColor = colors.Player;
        sidePanelGlass.TintColor = sidePanelGlass.FallbackColor = colors.Player;
        StateBrushes.Refresh();
    }

    private Button topbarBack = null!;
    private Button topbarImport = null!;
    private Button topbarAvatar = null!;
    private Grid topbarShortcut = null!;
    private readonly SolidColorBrush topbarGlassFill = new();
    private readonly SolidColorBrush topbarGlassHover = new();
    private readonly SolidColorBrush topbarGlassPressed = new();
    private readonly SolidColorBrush topbarGlassBorder = Ui.Brush("#FFFFFF38");
    private readonly SolidColorBrush topbarGlassPlaceholder = Ui.Brush("#FFFFFF99");

    private void UpdateTopBarGlassColors(ArtistThemeColors? theme = null)
    {
        theme ??= artistTheme;
        if (theme != null && theme != PendingArtistTheme)
        {
            var deep = ArtistThemes.Color(theme.Deep);
            topbarGlassFill.Color = Color.FromArgb(0x48, deep.R, deep.G, deep.B);
            topbarGlassHover.Color = Color.FromArgb(0x5C, deep.R, deep.G, deep.B);
            topbarGlassPressed.Color = Color.FromArgb(0x40, deep.R, deep.G, deep.B);
        }
        else
        {
            topbarGlassFill.Color = Color.FromArgb(0x20, 255, 255, 255);
            topbarGlassHover.Color = Color.FromArgb(0x32, 255, 255, 255);
            topbarGlassPressed.Color = Color.FromArgb(0x18, 255, 255, 255);
        }
        StateBrushes.Refresh();
    }

    private void LayoutTopBarShortcut()
    {
        if (topbarShortcut == null) return;
        bool compact = root.ActualWidth < 1100;
        double inset = compact ? 24 : root.ActualWidth >= 1400 ? 48 : 36;
        int backOffset = topbarBack?.Visibility == Visibility.Visible ? 54 : 0;
        topbarShortcut.Width = Math.Clamp(root.ActualWidth - (compact ? 210 : 244) - 2 * inset - (root.ActualWidth < 900 ? 180 : 245) - backOffset, 150, 275);
    }

    // Local album filter: a new box on every build, so its overrides are fixed before it is shown and keep
    // pointing at the frame brushes, whose colours already follow the album tint.
    private void StyleTintedSearchBox(TextBox input)
    {
        foreach (string state in new[] { "PointerOver", "Focused" }) {
            input.Resources["TextControlBackground" + state] = frameSurface;
            input.Resources["TextControlBorderBrush" + state] = frameEdge;
            input.Resources["TextControlForeground" + state] = frameWhite;
            input.Resources["TextControlPlaceholderForeground" + state] = frameMuted;
        }
        Appearance.SetStyle(input, () => {
            input.Background = frameSurface;
            input.BorderBrush = frameEdge;
            input.Foreground = frameWhite;
            input.PlaceholderForeground = frameMuted;
        }, preserveTemplate: true);
    }

    private static readonly string[] SearchBoxStateKeys = [
        "TextControlBackgroundPointerOver", "TextControlBackgroundFocused",
        "TextControlBorderBrushPointerOver", "TextControlBorderBrushFocused",
        "TextControlForegroundPointerOver", "TextControlForegroundFocused",
        "TextControlPlaceholderForegroundPointerOver", "TextControlPlaceholderForegroundFocused"];
    private static readonly string[] TopBarButtonStateKeys = [
        "ButtonBackgroundPointerOver", "ButtonBackgroundPressed",
        "ButtonBorderBrushPointerOver", "ButtonBorderBrushPressed",
        "ButtonForegroundPointerOver", "ButtonForegroundPressed"];

    // The search box and top bar buttons live as long as the window and are often under the pointer or focused
    // when the page changes, so their state overrides are registered once (StyleTopBar) and only recoloured here.
    private void ApplySearchBoxStyle(TextBox input)
    {
        input.CornerRadius = new(12);
        input.BorderThickness = new(1);
        bool glass = TopBarGlass;
        input.Background = glass ? topbarGlassFill : frameSurface;
        input.BorderBrush = glass ? topbarGlassBorder : frameEdge;
        input.Foreground = frameWhite;
        input.PlaceholderForeground = glass ? topbarGlassPlaceholder : frameMuted;
        StateBrushes.Of(input)?
            .Follow(glass ? topbarGlassHover : frameSurface, "TextControlBackgroundPointerOver")
            .Follow(glass ? topbarGlassFill : frameSurface, "TextControlBackgroundFocused")
            .Follow(glass ? topbarGlassBorder : frameEdge, "TextControlBorderBrushPointerOver")
            .Follow(glass ? frameWhite : frameEdge, "TextControlBorderBrushFocused")
            .Follow(frameWhite, "TextControlForegroundPointerOver", "TextControlForegroundFocused")
            .Follow(glass ? topbarGlassPlaceholder : frameMuted, "TextControlPlaceholderForegroundPointerOver", "TextControlPlaceholderForegroundFocused");
        if (glass) ArtistFocus(input);
    }

    private void ApplyTopBarButtonStyle(Button button)
    {
        button.CornerRadius = new(button == topbarAvatar ? 18 : button == topbarBack ? 22 : 12);
        button.BorderThickness = new(1);
        bool glass = TopBarGlass;
        button.Background = glass ? topbarGlassFill : frameSurface;
        button.BorderBrush = glass ? topbarGlassBorder : frameEdge;
        button.Foreground = frameWhite;
        StateBrushes.Of(button)?
            .Follow(glass ? topbarGlassHover : frameSurface, "ButtonBackgroundPointerOver")
            .Follow(glass ? topbarGlassPressed : frameSurface, "ButtonBackgroundPressed")
            .Follow(glass ? topbarGlassBorder : frameEdge, "ButtonBorderBrushPointerOver", "ButtonBorderBrushPressed")
            .Follow(frameWhite, "ButtonForegroundPointerOver", "ButtonForegroundPressed");
        if (glass) ArtistFocus(button);
    }

    private void ApplyTopBarStyle()
    {
        if (search != null) ApplySearchBoxStyle(search);
        if (topbarImport != null) ApplyTopBarButtonStyle(topbarImport);
        if (topbarAvatar != null) ApplyTopBarButtonStyle(topbarAvatar);
        if (topbarBack != null) ApplyTopBarButtonStyle(topbarBack);
    }

    private void UpdateTopBar()
    {
        if (topbarBack == null) return;
        topbarBack.Visibility = ArtistSurfacePage ? Visibility.Visible : Visibility.Collapsed;
        LayoutTopBarShortcut();
        ApplyTopBarStyle();
    }

    private void StyleTopBar(TextBox input, Button import, Button avatar, Button back)
    {
        topbarImport = import; topbarAvatar = avatar; topbarBack = back;
        StateBrushes.Register(input, SearchBoxStateKeys);
        foreach (var button in new[] { import, avatar, back }) StateBrushes.Register(button, TopBarButtonStateKeys);
        UpdateTopBarGlassColors();
        Appearance.SetStyle(input, () => ApplySearchBoxStyle(input), preserveTemplate: true);
        foreach (var button in new[] { import, avatar, back })
            Appearance.SetStyle(button, () => ApplyTopBarButtonStyle(button));
    }
}
