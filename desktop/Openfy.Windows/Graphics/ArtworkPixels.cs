using Openfy.Core;
using Windows.Graphics.Imaging;

namespace Openfy.Windows.Graphics;

/// <summary>Decodes prepared artwork to the small BGRA texture the ambient shader samples.</summary>
public static class ArtworkPixels
{
    public static async Task<byte[]?> LoadAsync(string path)
    {
        if (string.IsNullOrEmpty(path) || !File.Exists(path)) return null;
        await using var file = File.OpenRead(path);
        using var stream = file.AsRandomAccessStream();
        var decoder = await BitmapDecoder.CreateAsync(stream);
        var transform = new BitmapTransform { ScaledWidth = Ambient.TextureSize, ScaledHeight = Ambient.TextureSize, InterpolationMode = BitmapInterpolationMode.Fant };
        var data = await decoder.GetPixelDataAsync(BitmapPixelFormat.Bgra8, BitmapAlphaMode.Ignore, transform, ExifOrientationMode.RespectExifOrientation, ColorManagementMode.ColorManageToSRgb);
        var pixels = data.DetachPixelData();
        return pixels.Length == Ambient.TextureSize * Ambient.TextureSize * 4 ? pixels : null;
    }
}
