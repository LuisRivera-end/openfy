namespace Openfy.Core;

/// <summary>Canonical keyboard/mouse input, independent of the UI framework. Keys use the names of shared/utils/shortcuts.ts.</summary>
public sealed record ShortcutInput(string Key, bool Ctrl = false, bool Shift = false, bool Alt = false, bool Meta = false, bool Editable = false);

/// <summary>
/// App-scoped shortcuts shared with the web (shared/utils/shortcuts.ts); tests/fixtures/shortcuts-contract.json pins both.
/// They only act while an Openfy window has focus.
/// </summary>
public static class Shortcuts
{
    public const double SeekSeconds = 10;
    public const double VolumeStep = 0.1;

    private sealed record Binding(string Key, bool Ctrl = false, bool Shift = false, bool Alt = false);

    private static readonly (string Command, Binding[] Bindings)[] Map = [
        ("toggle-playback", [new("Space"), new("K")]),
        ("next", [new("ArrowRight", Ctrl: true)]),
        ("previous", [new("ArrowLeft", Ctrl: true)]),
        ("seek-forward", [new("ArrowRight", Shift: true)]),
        ("seek-backward", [new("ArrowLeft", Shift: true)]),
        ("volume-up", [new("ArrowUp", Ctrl: true)]),
        ("volume-down", [new("ArrowDown", Ctrl: true)]),
        ("mute", [new("M")]),
        ("shuffle", [new("A")]),
        ("repeat", [new("R")]),
        ("favorite", [new("F")]),
        ("big-picture", [new("B"), new("F11")]),
        ("queue", [new("C")]),
        ("lyrics", [new("L")]),
        ("search", [new("K", Ctrl: true)]),
        ("back", [new("ArrowLeft", Alt: true), new("BrowserBack"), new("MouseBack")]),
        ("forward", [new("ArrowRight", Alt: true), new("BrowserForward"), new("MouseForward")]),
        ("close", [new("Escape")]),
    ];

    /// <summary>Keys that still act while typing: they never produce text and a text field gives them no meaning.</summary>
    private static readonly HashSet<string> WhileTyping = ["F11", "BrowserBack", "BrowserForward", "MouseBack", "MouseForward"];

    public static string? Command(ShortcutInput input)
    {
        if (input.Meta) return null;
        if (input.Editable && !WhileTyping.Contains(input.Key)) return null;
        foreach (var (command, bindings) in Map)
            if (bindings.Any(binding => binding.Key == input.Key && binding.Ctrl == input.Ctrl && binding.Shift == input.Shift && binding.Alt == input.Alt)) return command;
        return null;
    }

    /// <summary>The list shown in Ajustes, in this order, on both clients.</summary>
    public static readonly (string Keys, string Label)[] Guide = [
        ("Espacio · K", "Reproducir o pausar"),
        ("Ctrl + → · Ctrl + ←", "Siguiente o anterior canción"),
        ("Mayús + → · Mayús + ←", $"Avanzar o retroceder {SeekSeconds} s"),
        ("Ctrl + ↑ · Ctrl + ↓", "Subir o bajar el volumen"),
        ("M", "Silenciar o reactivar el sonido"),
        ("A", "Activar o desactivar el aleatorio"),
        ("R", "Cambiar la repetición"),
        ("F", "Añadir o quitar de favoritos"),
        ("B · F11", "Abrir o cerrar Big Picture"),
        ("C", "Mostrar u ocultar la cola"),
        ("L", "Mostrar u ocultar la letra"),
        ("Ctrl + K", "Buscar"),
        ("Alt + ← · botón lateral trasero", "Volver a la página anterior"),
        ("Alt + → · botón lateral delantero", "Ir a la página siguiente"),
        ("Esc", "Salir de Big Picture o cerrar el panel"),
    ];
}

/// <summary>
/// Back/forward history of the main window's pages (the browser keeps its own on the web). Routes are opaque keys.
/// Consecutive search routes collapse into one entry, so typing a query does not fill the history.
/// </summary>
public sealed class NavigationHistory
{
    private readonly List<string> entries = [];
    private int index = -1;
    private string? replaying;
    public int Capacity { get; init; } = 50;
    public bool CanGoBack => index > 0;
    public bool CanGoForward => index >= 0 && index < entries.Count - 1;
    public string? Current => index >= 0 ? entries[index] : null;

    public void Visit(string route)
    {
        if (replaying != null) { bool own = replaying == route; replaying = null; if (own) return; }
        if (Current == route) return;
        if (Current != null && IsSearch(Current) && IsSearch(route)) { entries[index] = route; return; }
        if (index < entries.Count - 1) entries.RemoveRange(index + 1, entries.Count - index - 1);
        entries.Add(route); index = entries.Count - 1;
        if (entries.Count > Capacity) { entries.RemoveAt(0); index--; }
    }

    /// <summary>The route to show, or null at the start; the caller navigates to it and the resulting Visit is ignored.</summary>
    public string? Back() => CanGoBack ? replaying = entries[--index] : null;
    public string? Forward() => CanGoForward ? replaying = entries[++index] : null;

    private static bool IsSearch(string route) => route == "search" || route.StartsWith("search:", StringComparison.Ordinal);
}
