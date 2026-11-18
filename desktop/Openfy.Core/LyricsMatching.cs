using System.Text;
using System.Text.RegularExpressions;

namespace Openfy.Core;

public static partial class LyricsMatching
{
    public static string Normalize(string value) => Spaces().Replace(Punctuation().Replace(value.Normalize(NormalizationForm.FormKC).ToLowerInvariant(), " "), " ").Trim();
    public static bool Same(LyricsSignature left, LyricsSignature right) => Normalize(left.Title) == Normalize(right.Title)
        && left.Artists.Select(Normalize).SequenceEqual(right.Artists.Select(Normalize))
        && Normalize(left.Album ?? "") == Normalize(right.Album ?? "")
        && (left.Duration == null && right.Duration == null || left.Duration != null && right.Duration != null && Math.Abs(left.Duration.Value - right.Duration.Value) <= 2);
    [GeneratedRegex(@"[\p{P}\p{S}]+")] private static partial Regex Punctuation();
    [GeneratedRegex(@"\s+")] private static partial Regex Spaces();
}
