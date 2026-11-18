using System.Reflection;
using System.Security.Cryptography;
using System.Text.Json;
using System.Text.RegularExpressions;

namespace Openfy.Core;

public record ReleaseInfo(string Version, long Build)
{
    public static ReleaseInfo Current { get; } = ReadCurrent();
    private static ReleaseInfo ReadCurrent()
    {
        var text = typeof(ReleaseInfo).Assembly.GetCustomAttribute<AssemblyInformationalVersionAttribute>()?.InformationalVersion ?? "0.0.0+0";
        var parts = text.Split('+', 2);
        return new(parts[0], parts.Length == 2 && long.TryParse(parts[1], out var build) ? build : 0);
    }
    public int CompareTo(ReleaseInfo other)
    {
        int comparison = System.Version.Parse(Version).CompareTo(System.Version.Parse(other.Version));
        return comparison != 0 ? comparison : Build.CompareTo(other.Build);
    }
}
public record UpdateManifest(string Version, long Build, string Platform, string File, long Size, string Sha256, int Protocol, int MinLibrarySchema, int MaxLibrarySchema)
{
    public ReleaseInfo Release => new(Version, Build);
    public string Id => $"{Version}+{Build}";
    public static UpdateManifest Parse(string json)
    {
        var manifest = JsonSerializer.Deserialize<UpdateManifest>(json, Contracts.Json) ?? throw new InvalidDataException("Manifiesto vacío.");
        if (!Regex.IsMatch(manifest.Version ?? "", @"^\d{1,5}\.\d{1,5}\.\d{1,5}$") || manifest.Build < 1 || manifest.Platform != "win-x64" || manifest.Protocol != 1 || manifest.Size <= 0 || manifest.Size > 2L * 1024 * 1024 * 1024 || !Regex.IsMatch(manifest.Sha256 ?? "", "^[a-fA-F0-9]{64}$") || manifest.File != $"Openfy-Setup-{manifest.Version}-{manifest.Build}-x64.exe" || manifest.MinLibrarySchema < 0 || manifest.MaxLibrarySchema < manifest.MinLibrarySchema) throw new InvalidDataException("Actualización incompatible o incompleta.");
        return manifest;
    }
    public async Task VerifyAsync(string path, CancellationToken token = default)
    {
        var info = new FileInfo(path);
        if (!info.Exists || info.Length != Size) throw new InvalidDataException("El paquete está incompleto.");
        await using var stream = info.OpenRead();
        var hash = Convert.ToHexString(await SHA256.HashDataAsync(stream, token));
        if (!hash.Equals(Sha256, StringComparison.OrdinalIgnoreCase)) throw new InvalidDataException("El paquete no pasó la verificación SHA-256.");
    }
}
