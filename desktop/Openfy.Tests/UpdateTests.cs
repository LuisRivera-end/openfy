using System.Net;
using System.Security.Cryptography;
using System.Text.Json;
using Openfy.Core;
using Xunit;

namespace Openfy.Tests;
public class UpdateTests
{
    private sealed class Handler(Func<Uri, byte[]> reply) : HttpMessageHandler
    {
        protected override Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken token) =>
            Task.FromResult(new HttpResponseMessage(HttpStatusCode.OK) { Content = new ByteArrayContent(reply(request.RequestUri!)) });
    }
    [Fact]
    public async Task StableGithubReleaseRequiresBothDigestsAndPrefersTheIdenticalLocalCopy()
    {
        string root = Path.Combine(Path.GetTempPath(), "openfy-update-test-" + Guid.NewGuid());
        byte[] bytes = [7, 42, 1];
        string Hash(byte[] data) => Convert.ToHexString(SHA256.HashData(data)).ToLowerInvariant();
        var manifest = new UpdateManifest("99.1.0", 7, "win-x64", "Openfy-Setup-99.1.0-7-x64.exe", bytes.Length, Hash(bytes), 1, 1, 4);
        var descriptor = JsonSerializer.SerializeToUtf8Bytes(manifest, Contracts.Json);
        bool invalid = false;
        object Asset(string name, byte[] data) => new { name, size = data.Length, digest = "sha256:" + (invalid ? new string('0', 64) : Hash(data)), browser_download_url = "https://github.com/LuisRivera-end/openfy/releases/download/v99/" + name };
        using var client = new HttpClient(new Handler(uri => uri.Host == "api.github.com" ? JsonSerializer.SerializeToUtf8Bytes(new[] {
            new { draft = true, prerelease = false, assets = Array.Empty<object>() },
            new { draft = false, prerelease = true, assets = Array.Empty<object>() },
            new { draft = false, prerelease = false, assets = new[] { Asset("openfy-update.json", descriptor), Asset(manifest.File, bytes) } }
        }) : uri.AbsolutePath.EndsWith(".json") ? descriptor : bytes));
        try {
            var feed = new UpdateFeed(root, client);
            Assert.Equal("GitHub", (await feed.FindAsync(true, default))!.Origin);
            var local = Directory.CreateDirectory(Path.Combine(root, "feed")).FullName;
            await File.WriteAllTextAsync(Path.Combine(local, "latest.json"), JsonSerializer.Serialize(manifest, Contracts.Json));
            await File.WriteAllBytesAsync(Path.Combine(local, manifest.File), bytes);
            Assert.Equal("Este PC", (await feed.FindAsync(false, default))!.Origin);
            await File.WriteAllBytesAsync(Path.Combine(local, manifest.File), [8, 9]);
            Assert.Equal("GitHub", (await feed.FindAsync(false, default))!.Origin);
            invalid = true; File.Delete(Path.Combine(local, "latest.json"));
            Assert.Null(await feed.FindAsync(true, default));
        } finally { if (Directory.Exists(root)) Directory.Delete(root, true); }
    }
    [Fact]
    public async Task RejectsCorruptPartialAndIncompatiblePackages()
    {
        byte[] data = [1,2,3];
        var m = new UpdateManifest("1.2.3", 4, "win-x64", "Openfy-Setup-1.2.3-4-x64.exe", 3, Convert.ToHexString(SHA256.HashData(data)), 1, 1, 4);
        var path = Path.GetTempFileName();
        try {
            await File.WriteAllBytesAsync(path, data); await m.VerifyAsync(path);
            await File.WriteAllBytesAsync(path, [3,2,1]); await Assert.ThrowsAsync<InvalidDataException>(() => m.VerifyAsync(path));
            await File.WriteAllBytesAsync(path, [1,2]); await Assert.ThrowsAsync<InvalidDataException>(() => m.VerifyAsync(path));
            Assert.Throws<InvalidDataException>(() => UpdateManifest.Parse(JsonSerializer.Serialize(m with { Protocol = 2 })));
            Assert.True(m.Release.CompareTo(new("1.2.3", 3)) > 0);
        } finally { File.Delete(path); }
    }
}
