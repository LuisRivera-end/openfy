using System.Globalization;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace Openfy.Core;

public record ReleaseNoteItem(string Type, string Text);
public record ReleaseNote(string Version, string Date, string? Summary, ReleaseNoteItem[] Items);
/// <summary>Per-device record of the last version whose "Novedades" were closed (state file release-notes.json).</summary>
public record ReleaseNotesState(string? LastSeen);

/// <summary>Twin of shared/utils/release-notes.ts (tests/fixtures/release-notes-contract.json). The notes are shared/release-notes.json, embedded in this assembly.</summary>
public static partial class ReleaseNotes
{
    private sealed record Catalog(ReleaseNote[]? Releases);
    public static IReadOnlyDictionary<string, string> Labels { get; } = new Dictionary<string, string> { ["new"] = "Nuevo", ["improved"] = "Mejora", ["fixed"] = "Arreglo" };
    private static readonly Lazy<IReadOnlyList<ReleaseNote>> bundled = new(Load);
    public static IReadOnlyList<ReleaseNote> Bundled => bundled.Value;

    private static IReadOnlyList<ReleaseNote> Load()
    {
        try
        {
            using var stream = typeof(ReleaseNotes).Assembly.GetManifestResourceStream("Openfy.ReleaseNotes.json");
            return stream == null ? [] : JsonSerializer.Deserialize<Catalog>(stream, Contracts.Json)?.Releases ?? [];
        }
        catch (JsonException) { return []; }
    }

    [GeneratedRegex(@"^\d{1,5}\.\d{1,5}\.\d{1,5}$")]
    private static partial Regex VersionPattern();
    public static Version? Parse(string? value)
    {
        string text = value?.Trim() ?? "";
        return VersionPattern().IsMatch(text) ? Version.Parse(text) : null;
    }

    /// <summary>Every release in (lastSeen, current], newest first; only <paramref name="current"/> when there is no valid history. Build numbers are ignored.</summary>
    public static IReadOnlyList<T> Since<T>(IEnumerable<T> releases, Func<T, string> version, string? lastSeen, string current)
    {
        if (Parse(current) is not { } now) return [];
        var seen = Parse(lastSeen);
        return releases
            .Select(release => (release, version: Parse(version(release))))
            .Where(item => item.version is { } v && (seen == null ? v == now : v > seen && v <= now))
            .OrderByDescending(item => item.version)
            .Select(item => item.release)
            .ToList();
    }
    public static IReadOnlyList<ReleaseNote> Since(IEnumerable<ReleaseNote> releases, string? lastSeen, string current) => Since(releases, release => release.Version, lastSeen, current);

    private static readonly CultureInfo spanish = CultureInfo.GetCultureInfo("es");
    public static string FormatDate(string date) => DateTime.TryParseExact(date, "yyyy-MM-dd", CultureInfo.InvariantCulture, DateTimeStyles.None, out var parsed) ? parsed.ToString("d 'de' MMMM 'de' yyyy", spanish) : date;
}
