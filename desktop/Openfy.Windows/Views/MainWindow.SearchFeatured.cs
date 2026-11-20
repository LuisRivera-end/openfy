using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Media;
using Openfy.Core;
using Openfy.Windows.Services;
using Openfy.Windows.ViewModels;

namespace Openfy.Windows.Views;

/// <summary>
/// "Resultado más relevante": a panel tinted base → deep with the result's own palette, the same rule as the artist page
/// (web twin: app/components/SearchFeatured.vue). An artist already opened this session keeps the colours of its page.
/// </summary>
public sealed partial class MainWindow
{
    private FrameworkElement SearchFeatured(YouTubeArtist? artist = null, SongRow? song = null, YouTubeAlbum? album = null)
    {
        string title = artist?.Name ?? song?.Title ?? album!.Title;
        string kind = artist != null ? "Artista" : song != null ? "Canción · " + song.Artist : "Álbum · " + string.Join(", ", album!.Artists.Select(item => item.Name));
        string? artwork = artist != null ? artist.Artwork : song != null ? song.Artwork : album!.Artwork;
        string? key = artist != null ? "youtube:" + artist.Id : null;

        var background = ArtistThemes.Panel(ArtistThemes.Cached(key) ?? PendingArtistTheme);
        var ink = new SolidColorBrush(ArtistThemes.Color((ArtistThemes.Cached(key) ?? PendingArtistTheme).Deep));
        void Paint(ArtistThemeColors theme)
        {
            background.GradientStops[0].Color = ArtistThemes.Color(theme.Base);
            background.GradientStops[1].Color = ArtistThemes.Color(theme.Deep);
            ink.Color = ArtistThemes.Color(theme.Deep);
        }
        var host = new Grid { MinHeight = 236 };
        bool released = false; Ui.OnRelease(host, () => released = true);
        _ = Theme();
        // Reads the artist page's palette when it exists, but never stores the portrait sample under the artist id.
        async Task Theme() { var theme = ArtistThemes.Cached(key) ?? await ArtistThemes.LoadAsync(model.Artwork, artwork); if (!released) Paint(theme); }

        var content = new StackPanel { Spacing = 4 };
        var art = CatalogArtworkView(artwork, 120, round: artist != null); art.HorizontalAlignment = HorizontalAlignment.Left; art.Margin = new(0, 0, 0, 18);
        if (artist == null) art.CornerRadius = new(8);
        content.Children.Add(art);
        var name = Ui.Text(title, 32, true); name.Foreground = Ui.Brush("#FFFFFF"); name.FontWeight = Microsoft.UI.Text.FontWeights.Bold; name.MaxLines = 2; name.TextWrapping = TextWrapping.Wrap; name.TextTrimming = TextTrimming.CharacterEllipsis; name.Tag = "display"; name.Margin = new(0, 0, 64, 0);
        content.Children.Add(name);
        var line = Ui.Text(kind, 13); line.Foreground = Ui.Brush(ArtistSecondaryText); line.TextTrimming = TextTrimming.CharacterEllipsis; line.Margin = new(0, 0, 64, 0);
        content.Children.Add(line);

        Action open = artist != null ? () => _ = model.RunAsync(() => model.ArtistAsync(artist.Id))
            : album != null ? () => _ = model.RunAsync(() => model.AlbumAsync(album.Id))
            : () => _ = model.RunAsync(() => model.PlayAsync(song!, model.Songs.ToArray(), new("song")));
        var card = Ui.Button(title, open, (song != null ? "Reproducir " : "Abrir ") + title);
        card.Content = content; card.Padding = new(22, 22, 22, 20); card.CornerRadius = new(12); card.BorderThickness = new(0);
        card.HorizontalAlignment = HorizontalAlignment.Stretch; card.VerticalAlignment = VerticalAlignment.Stretch; card.HorizontalContentAlignment = HorizontalAlignment.Stretch; card.VerticalContentAlignment = VerticalAlignment.Top;
        card.Background = background;
        foreach (var state in new[] { "ButtonBackgroundPointerOver", "ButtonBackgroundPressed" }) card.Resources[state] = background;
        foreach (var state in new[] { "ButtonForegroundPointerOver", "ButtonForegroundPressed" }) card.Resources[state] = Ui.Brush("#FFFFFF");
        ArtistFocus(card);
        host.Children.Add(card);

        Func<Task> playFeatured = song != null ? () => model.PlayAsync(song, model.Songs.ToArray(), new("song"))
            : artist != null ? () => model.PlayFeaturedArtistAsync(artist.Id) : () => model.PlayFeaturedAlbumAsync(album!.Id);
        var play = Ui.PlayButton(() => _ = model.RunAsync(playFeatured), 48);
        play.Background = Ui.Brush("#FFFFFF"); play.Foreground = ink;
        play.Resources["ButtonBackgroundPointerOver"] = Ui.Brush("#F4F4F5"); play.Resources["ButtonForegroundPointerOver"] = ink;
        play.Resources["ButtonBackgroundPressed"] = Ui.Brush("#E4E4E7"); play.Resources["ButtonForegroundPressed"] = ink;
        Ui.SetIcon(play, "play", 22);
        ArtistFocus(play); play.FocusVisualSecondaryBrush = ink;
        AutomationProperties.SetName(play, "Reproducir " + title);
        play.HorizontalAlignment = HorizontalAlignment.Right; play.VerticalAlignment = VerticalAlignment.Bottom; play.Margin = new(0, 0, 20, 20);
        // Revealed on hover or keyboard focus; always shown without a mouse, and without animations it simply appears.
        bool revealOnHover = new global::Windows.Devices.Input.MouseCapabilities().MousePresent != 0 && new global::Windows.Devices.Input.TouchCapabilities().TouchPresent == 0;
        if (model.Settings.Effects && WindowsIntegration.AnimationsEnabled) play.OpacityTransition = new ScalarTransition { Duration = TimeSpan.FromMilliseconds(160) };
        bool hovered = false, focused = false;
        void Reveal() { bool visible = !revealOnHover || hovered || focused; play.Opacity = visible ? 1 : 0; play.IsHitTestVisible = visible; }
        Reveal();
        PointerEventHandler entered = (_, _) => { hovered = true; Reveal(); }, exited = (_, _) => { hovered = false; Reveal(); };
        RoutedEventHandler gotFocus = (_, _) => { focused = true; Reveal(); }, lostFocus = (_, _) => { focused = false; Reveal(); };
        host.PointerEntered += entered; host.PointerExited += exited; host.GotFocus += gotFocus; host.LostFocus += lostFocus;
        Ui.OnRelease(host, () => { host.PointerEntered -= entered; host.PointerExited -= exited; host.GotFocus -= gotFocus; host.LostFocus -= lostFocus; });
        host.Children.Add(play);
        return host;
    }
}
