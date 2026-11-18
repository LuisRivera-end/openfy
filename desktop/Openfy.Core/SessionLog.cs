using System.Text.Json;
using System.Text.RegularExpressions;

namespace Openfy.Core;

public static class SessionLog
{
    private static readonly object Gate = new();
    public static string? DirectoryPath { get; private set; }
    public static string SessionId { get; private set; } = "";
    public static void Begin(string directory)
    {
        lock (Gate)
        {
            DirectoryPath = null;
            try {
                Directory.CreateDirectory(directory);
                // Reset only these additional diagnostic files, once per real app launch.
                foreach (string name in new[] { "native.jsonl", "backend.jsonl" }) File.WriteAllText(Path.Combine(directory, name), "");
                DirectoryPath = directory; SessionId = Guid.NewGuid().ToString("N");
            } catch { /* Diagnostics must never prevent startup. */ }
        }
        Write("session", "started", SessionId);
    }
    public static string Clean(string value) => Regex.Replace(value, @"https?://[^\s""<>]+", match => {
        return Uri.TryCreate(match.Value, UriKind.Absolute, out var uri) ? uri.GetComponents(UriComponents.SchemeAndServer | UriComponents.Path, UriFormat.UriEscaped) : "[url]";
    });
    public static void Write(string operation, string outcome, string? target = null, double? elapsedMs = null, int? status = null, Exception? error = null)
    {
        lock (Gate)
        {
            if (DirectoryPath == null) return;
            try {
                var entry = new { at = DateTimeOffset.UtcNow, session = SessionId, operation, outcome,
                    target = target == null ? null : Clean(target), elapsedMs,
                    status = status ?? (error is HttpRequestException { StatusCode: { } code } ? (int?)code : null),
                    errorType = error?.GetType().Name, error = error == null ? null : Clean(error.Message) };
                File.AppendAllText(Path.Combine(DirectoryPath, "native.jsonl"), JsonSerializer.Serialize(entry, Contracts.Json) + Environment.NewLine);
            } catch { /* Keep the original operation working if the disk is unavailable. */ }
        }
    }
}
