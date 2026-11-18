using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Media;
using Openfy.Core;

namespace Openfy.Windows.Views;

/// <summary>
/// YouTube Music artist profile. The hero is the one expressive surface (banner, or the
/// portrait over its own colour); popular songs reuse the shared track table, and the
/// discography, biography and related artists follow in the quiet catalogue language.
/// </summary>
public sealed partial class MainWindow
{
    private void BuildArtistCatalog()
    {
        catalog.Children.Add(ArtistHero());
        if (model.Songs.Count > 0) catalog.Children.Add(CatalogSectionHeading("Canciones populares", model.MoreSongsAvailable ? "Ver todas las canciones" : null, () => _ = model.RunAsync(model.MoreAsync)));
        else catalog.Children.Add(CatalogEmptyState("music", "Este artista todavía no tiene canciones disponibles.", "Vuelve a buscarlo más tarde para actualizar su perfil."));

        var latest = model.Albums.Select(album => (Album: album, Kind: "Álbum")).Concat(model.Singles.Select(album => (Album: album, Kind: "Single / EP")))
            .Aggregate<(YouTubeAlbum Album, string Kind), (YouTubeAlbum Album, string Kind)?>(null, (best, item) => best is null || (item.Album.Year ?? 0) > (best.Value.Album.Year ?? 0) ? item : best);
        if (latest is { } release) catalogTail.Children.Add(ArtistLatestRelease(release.Album, release.Kind));
        CatalogReleases("Álbumes", model.Albums, false);
        CatalogReleases("Singles y EPs", model.Singles, true);
        if (model.Description.Length > 0) catalogTail.Children.Add(ArtistAbout());
        if (model.SimilarArtists.Count > 0)
        {
            catalogTail.Children.Add(CatalogSectionHeading("Fans también escuchan"));
            catalogTail.Children.Add(CatalogCards(model.SimilarArtists.Select(artist => new CatalogTile(artist.Name, "Artista", artist.Artwork, () => _ = model.RunAsync(() => model.ArtistAsync(artist.Id)), true))));
        }
    }

    private FrameworkElement ArtistHero()
    {
        var hero = new StackPanel { Spacing = 20, Margin = new(0, 12, 0, 4) };
        bool banner = !string.IsNullOrWhiteSpace(model.CatalogBanner);
        // A fixed, bounded height: the banner is cropped by UniformToFill instead of dictating the stage size.
        var layers = new Grid { Height = 320 };
        // Tagged so Appearance keeps this surface's own colour and radius in both designs.
        var stage = new Border { CornerRadius = new(14), Background = Ui.Brush("#18181B"), Child = layers, Tag = "home-artwork" };
        AutomationProperties.SetName(stage, model.Heading);

        var copy = new StackPanel { Spacing = 2, VerticalAlignment = VerticalAlignment.Bottom };
        var kind = Ui.Text("Artista", 13, true); kind.Foreground = Ui.Brush("#E4E4E7"); copy.Children.Add(kind);
        var name = Ui.Text(model.Heading, 72, true); name.FontWeight = Microsoft.UI.Text.FontWeights.Bold; name.CharacterSpacing = -45; name.MaxLines = 2; name.TextTrimming = TextTrimming.CharacterEllipsis; name.Tag = "display";
        copy.Children.Add(name);

        if (banner)
        {
            // Cover-fit by hand so the crop keeps the upper third (where faces usually are) instead of the centre.
            var image = new Image { Stretch = Stretch.Fill };
            var frame = new Canvas(); frame.Children.Add(image); layers.Children.Add(frame);
            double sourceWidth = 0, sourceHeight = 0;
            void Place()
            {
                double width = layers.ActualWidth, height = layers.ActualHeight;
                if (sourceWidth <= 0 || width <= 0 || height <= 0) return;
                double scale = Math.Max(width / sourceWidth, height / sourceHeight);
                image.Width = sourceWidth * scale; image.Height = sourceHeight * scale;
                Canvas.SetLeft(image, (width - image.Width) / 2); Canvas.SetTop(image, (height - image.Height) * .3);
            }
            SizeChangedEventHandler place = (_, _) => Place(); layers.SizeChanged += place; Ui.OnRelease(layers, () => layers.SizeChanged -= place);
            bool released = false; Ui.OnRelease(image, () => released = true);
            async Task Load()
            {
                try
                {
                    var result = await model.Artwork.GetAsync(model.CatalogBanner!, 2048); if (released) return;
                    sourceWidth = Math.Max(1, result.Width); sourceHeight = Math.Max(1, result.Height); Place();
                    Ui.Cover(image, result.Path, Math.Max(layers.ActualWidth, 900), Math.Max(layers.ActualHeight, 300), result.Width, result.Height);
                }
                catch { /* The stage colour and the name stay readable without the banner. */ }
            }
            _ = Load();
            var shade = new LinearGradientBrush { StartPoint = new(0, 0), EndPoint = new(0, 1) };
            shade.GradientStops.Add(new() { Color = Ui.Brush("#00000000").Color, Offset = .25 });
            shade.GradientStops.Add(new() { Color = Ui.Brush("#000000A8").Color, Offset = .78 });
            shade.GradientStops.Add(new() { Color = Ui.Brush("#000000D9").Color, Offset = 1 });
            layers.Children.Add(new Border { Background = shade });
            copy.Margin = new(36, 0, 36, 32); layers.Children.Add(copy);
        }
        else
        {
            // Without a banner the portrait's own colour fills the stage.
            var tint = new LinearGradientBrush { StartPoint = new(0, 0), EndPoint = new(1, 1) };
            void Paint(string? hex)
            {
                var color = Tint(hex); tint.GradientStops.Clear();
                tint.GradientStops.Add(new() { Color = global::Windows.UI.Color.FromArgb(255, (byte)Math.Min(255, color.R * 2.1), (byte)Math.Min(255, color.G * 2.1), (byte)Math.Min(255, color.B * 2.1)), Offset = 0 });
                tint.GradientStops.Add(new() { Color = Ui.Brush("#18181B").Color, Offset = 1 });
            }
            Paint(null); stage.Background = tint;
            var row = new Grid { ColumnSpacing = 30, Padding = new(36, 32, 36, 32), VerticalAlignment = VerticalAlignment.Bottom };
            row.ColumnDefinitions.Add(new() { Width = GridLength.Auto }); row.ColumnDefinitions.Add(new() { Width = new(1, GridUnitType.Star) });
            var portrait = CatalogArtworkView(model.CatalogArtwork, 210, round: true, palette: colors => Paint(colors.FirstOrDefault())); portrait.VerticalAlignment = VerticalAlignment.Bottom;
            row.Children.Add(portrait); Grid.SetColumn(copy, 1); row.Children.Add(copy); layers.Children.Add(row);
            SizeChangedEventHandler compact = (_, args) => { double side = args.NewSize.Width < 700 ? 140 : 210; portrait.Width = portrait.Height = side; row.ColumnSpacing = args.NewSize.Width < 700 ? 20 : 30; };
            layers.SizeChanged += compact; Ui.OnRelease(layers, () => layers.SizeChanged -= compact);
        }
        SizeChangedEventHandler scale = (_, args) => { layers.Height = Math.Clamp(args.NewSize.Width * .3, 260, 400); name.FontSize = Math.Clamp(args.NewSize.Width * .075, 40, 88); };
        stage.SizeChanged += scale; Ui.OnRelease(stage, () => stage.SizeChanged -= scale);
        hero.Children.Add(stage);

        var actions = Ui.Row(); actions.Spacing = 16;
        var play = Ui.PlayButton(() => { if (model.Songs.Count > 0) _ = model.RunAsync(() => model.PlayAsync(model.Songs[0], model.Songs.ToArray(), model.PageContext)); }, 56, true);
        AutomationProperties.SetName(play, "Reproducir " + model.Heading); play.IsEnabled = model.Songs.Count > 0; actions.Children.Add(play);
        var shuffle = Ui.Button("Aleatorio", () => _ = model.RunAsync(async () => {
            if (model.Songs.Count < 2) return;
            var songs = model.Songs.ToArray(); await model.PlayAsync(songs[Random.Shared.Next(songs.Length)], songs, model.PageContext);
            if (!model.ShuffleEnabled) model.Shuffle();
        }), "Reproducir en orden aleatorio");
        shuffle.Content = Ui.Row(Ui.Icon("shuffle", 18), Ui.Text("Aleatorio", 13, true)); shuffle.IsEnabled = model.Songs.Count > 1; actions.Children.Add(shuffle);
        actions.Children.Add(Ui.Button("Volver a buscar", ReturnToSearch));
        hero.Children.Add(actions);
        return hero;
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
        copy.Children.Add(Ui.Muted(string.Join(" · ", new[] { album.Year?.ToString() ?? "", kind }.Where(part => part.Length > 0)), 13));
        Grid.SetColumn(copy, 1); row.Children.Add(copy);
        var button = Ui.Button(album.Title, () => _ = model.RunAsync(() => model.AlbumAsync(album.Id)), "Abrir " + album.Title);
        button.Content = row; HomeCardChrome(button); button.HorizontalAlignment = HorizontalAlignment.Stretch; button.HorizontalContentAlignment = HorizontalAlignment.Stretch; button.Margin = new(-8, 0, -8, 0);
        section.Children.Add(button);
        return section;
    }

    private FrameworkElement ArtistAbout()
    {
        var section = new StackPanel();
        section.Children.Add(CatalogSectionHeading("Acerca de"));
        var panel = new StackPanel { Spacing = 10 };
        var biography = Ui.Text(model.Description, 14); biography.Foreground = Ui.Brush("#D4D4D8"); biography.LineHeight = 24; biography.MaxWidth = 720; biography.HorizontalAlignment = HorizontalAlignment.Left; biography.MaxLines = 4; biography.TextTrimming = TextTrimming.CharacterEllipsis;
        panel.Children.Add(biography);
        if (model.Description.Length > 240)
        {
            Button? toggle = null;
            toggle = Ui.Button("Más información", () => { bool open = biography.MaxLines != 0; biography.MaxLines = open ? 0 : 4; toggle!.Content = open ? "Mostrar menos" : "Más información"; });
            toggle.Background = Ui.Brush("#00000000"); toggle.BorderThickness = new(0); toggle.Padding = new(0); toggle.HorizontalAlignment = HorizontalAlignment.Left; panel.Children.Add(toggle);
        }
        section.Children.Add(new Border { Child = panel, Padding = new(30, 26, 30, 22), CornerRadius = new(14), Background = Ui.Brush("#18181B"), BorderBrush = Ui.Brush("#FFFFFF0B"), BorderThickness = new(1) });
        return section;
    }
}
