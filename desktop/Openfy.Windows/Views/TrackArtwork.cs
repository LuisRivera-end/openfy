using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Openfy.Windows.Services;

namespace Openfy.Windows.Views;

// XAML updates the bound source even when a virtualized container is prepared
// before its template exists. A recycled row owns its own request generation.
public sealed class TrackArtwork : Grid
{
    public static ArtworkService? Service { get; set; }
    public static readonly DependencyProperty ArtworkUrlProperty = DependencyProperty.Register(
        nameof(ArtworkUrl), typeof(string), typeof(TrackArtwork), new PropertyMetadata(null, (sender, _) => ((TrackArtwork)sender).Update()));
    public string? ArtworkUrl { get => (string?)GetValue(ArtworkUrlProperty); set => SetValue(ArtworkUrlProperty, value); }
    private readonly Image image = Ui.Image(44);
    private readonly TextBlock fallback = Ui.Muted("♫", 19);
    private string? shown;
    private long generation;
    public TrackArtwork()
    {
        Width = Height = 44; Background = Ui.Brush("#25252A"); CornerRadius = new(5);
        fallback.HorizontalAlignment = HorizontalAlignment.Center; fallback.VerticalAlignment = VerticalAlignment.Center;
        Children.Add(fallback); Children.Add(image);
        Loaded += (_, _) => Update();
        Unloaded += (_, _) => generation++;
    }
    private async void Update()
    {
        long own = ++generation;
        var url = ArtworkUrl;
        if (string.Equals(shown, url) && image.Source != null) return;
        if (string.IsNullOrEmpty(url)) { image.Source = null; shown = null; fallback.Visibility = Visibility.Visible; return; }
        if (!IsLoaded || Service == null) return;
        var work = Service.GetAsync(url, 128);
        if (!work.IsCompletedSuccessfully) { image.Source = null; shown = null; fallback.Visibility = Visibility.Visible; }
        for (int attempt = 0; attempt < 3; attempt++) {
            try {
                var result = await work;
                if (own != generation || !IsLoaded) return;
                Ui.Cover(image, result.Path); shown = url; fallback.Visibility = Visibility.Collapsed; return;
            } catch {
                if (attempt == 2 || own != generation) return;
                await Task.Delay(1000 << attempt);
                if (own != generation || !IsLoaded) return;
                work = Service.GetAsync(url, 128);
            }
        }
    }
}
