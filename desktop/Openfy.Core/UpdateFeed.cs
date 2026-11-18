using System.Net.Http.Json;
using System.Security.Cryptography;
using System.Text.Json;

namespace Openfy.Core;

public record UpdatePackage(UpdateManifest Manifest, string Path, string Origin);
public sealed class UpdateFeed(string root, HttpClient http)
{
    private const string Repo = "LuisRivera-end/openfy";
    private UpdatePackage? remote;
    private (string Path, string Hash, long Bytes, long Modified)? verified;
    public async Task<UpdatePackage?> FindAsync(bool checkRemote, CancellationToken token)
    {
        Directory.CreateDirectory(root);
        var candidates = new List<UpdatePackage>();
        var localManifest = Path.Combine(root, "feed", "latest.json");
        Exception? invalid = null;
        if (File.Exists(localManifest)) {
            try {
                var manifest = UpdateManifest.Parse(await File.ReadAllTextAsync(localManifest, token));
                if (manifest.Release.CompareTo(ReleaseInfo.Current) > 0) candidates.Add(new(manifest, Path.Combine(root, "feed", manifest.File), "Este PC"));
            } catch (Exception error) when (error is InvalidDataException or JsonException or IOException) { invalid = error; }
        }
        if (checkRemote) {
            try { remote = await RemoteAsync(token); }
            catch (Exception error) when (!token.IsCancellationRequested && error is HttpRequestException or TaskCanceledException or IOException or JsonException or InvalidDataException) {
                SessionLog.Write("update.feed", "unavailable", error: error);
                invalid ??= error;
            }
        }
        if (remote != null) candidates.Add(remote);
        foreach (var option in candidates.OrderByDescending(item => System.Version.Parse(item.Manifest.Version)).ThenByDescending(item => item.Manifest.Build)) {
            try {
                var file = new FileInfo(option.Path);
                var stamp = (option.Path, option.Manifest.Sha256, file.Length, file.LastWriteTimeUtc.Ticks);
                if (stamp != verified) { await option.Manifest.VerifyAsync(option.Path, token); verified = stamp; }
                return option;
            } catch (Exception error) when (error is IOException or InvalidDataException) { invalid = error; }
        }
        if (invalid != null) throw invalid;
        return null;
    }
    private static bool OfficialAsset(Uri uri) => uri.Scheme == "https" && uri.Host == "github.com" && uri.AbsolutePath.StartsWith("/" + Repo + "/releases/download/", StringComparison.OrdinalIgnoreCase);
    private async Task<UpdatePackage?> RemoteAsync(CancellationToken token)
    {
        using var response = await http.GetAsync($"https://api.github.com/repos/{Repo}/releases?per_page=30", token);
        response.EnsureSuccessStatusCode();
        var releases = await response.Content.ReadFromJsonAsync<JsonElement>(cancellationToken: token);
        var choices = new List<(UpdateManifest Manifest, Uri Uri)>();
        foreach (var release in releases.EnumerateArray()) {
            if (release.GetProperty("draft").GetBoolean() || release.GetProperty("prerelease").GetBoolean()) continue;
            var assets = release.GetProperty("assets").EnumerateArray().ToArray();
            var descriptor = assets.FirstOrDefault(item => item.GetProperty("name").GetString() == "openfy-update.json");
            if (descriptor.ValueKind != JsonValueKind.Object || descriptor.GetProperty("size").GetInt64() > 32768) continue;
            var descriptorUrl = new Uri(descriptor.GetProperty("browser_download_url").GetString()!);
            if (!OfficialAsset(descriptorUrl)) continue;
            var bytes = await http.GetByteArrayAsync(descriptorUrl, token);
            if (!MatchesDigest(descriptor, Convert.ToHexString(SHA256.HashData(bytes)))) continue;
            var manifest = UpdateManifest.Parse(System.Text.Encoding.UTF8.GetString(bytes));
            if (manifest.Release.CompareTo(ReleaseInfo.Current) <= 0) continue;
            var package = assets.FirstOrDefault(item => item.GetProperty("name").GetString() == manifest.File);
            if (package.ValueKind != JsonValueKind.Object || package.GetProperty("size").GetInt64() != manifest.Size || !MatchesDigest(package, manifest.Sha256)) continue;
            var uri = new Uri(package.GetProperty("browser_download_url").GetString()!);
            if (OfficialAsset(uri)) choices.Add((manifest, uri));
        }
        var choice = choices.OrderByDescending(item => System.Version.Parse(item.Manifest.Version)).ThenByDescending(item => item.Manifest.Build).FirstOrDefault();
        if (choice.Manifest == null) return null;
        var directory = Path.Combine(root, "downloads"); Directory.CreateDirectory(directory);
        string path = Path.Combine(directory, choice.Manifest.File);
        if (File.Exists(path)) { try { await choice.Manifest.VerifyAsync(path, token); return new(choice.Manifest, path, "GitHub"); } catch (InvalidDataException) {} }
        string temp = path + "." + Guid.NewGuid().ToString("N") + ".part";
        try {
            using var download = await http.GetAsync(choice.Uri, HttpCompletionOption.ResponseHeadersRead, token); download.EnsureSuccessStatusCode();
            await using var input = await download.Content.ReadAsStreamAsync(token);
            await using (var output = new FileStream(temp, FileMode.CreateNew, FileAccess.Write, FileShare.None)) {
                byte[] buffer = new byte[128 * 1024]; int read;
                while ((read = await input.ReadAsync(buffer, token)) > 0) {
                    if (output.Position + read > choice.Manifest.Size) throw new InvalidDataException("El paquete supera el tamaño anunciado.");
                    await output.WriteAsync(buffer.AsMemory(0, read), token);
                }
            }
            await choice.Manifest.VerifyAsync(temp, token); File.Move(temp, path, true);
            return new(choice.Manifest, path, "GitHub");
        } finally { if (File.Exists(temp)) File.Delete(temp); }
    }
    private static bool MatchesDigest(JsonElement asset, string hash) => asset.TryGetProperty("digest", out var digest) && string.Equals(digest.GetString(), "sha256:" + hash, StringComparison.OrdinalIgnoreCase);
}
public record UpdateReadiness(bool Ready, string Reason);
public record MaintenanceReceipt(string Transaction, string DataRoot);
public record UpdateRequest(UpdateManifest Manifest, string DataRoot, string StateRoot, int Port, string Transaction, int ParentPid);
