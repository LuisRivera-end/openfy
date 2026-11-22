namespace Openfy.Core;

/// <summary>
/// Where Windows keeps a per-user sign-in entry: the HKCU Run value and the Task Manager
/// approval that can switch it off without removing it (Explorer\StartupApproved\Run).
/// </summary>
public interface IStartupEntryStore
{
    string? ReadCommand();
    void WriteCommand(string command);
    void DeleteCommand();
    byte[]? ReadApproval();
    void WriteApproval(byte[] approval);
    void DeleteApproval();
}

public enum LaunchAtLoginState { Off, On, DisabledBySystem }

/// <summary>
/// "Start with Windows" for the installed app, like Discord or Spotify: a Run entry that opens
/// Openfy in the tray at sign-in. The registry is the only source of truth, so a change made in
/// Task Manager or Settings > Apps > Startup is what the toggle shows.
/// </summary>
public sealed class LaunchAtLogin(IStartupEntryStore store, string launcher)
{
    public const string EntryName = "Openfy";
    public const string BackgroundFlag = "--background";

    /// <summary>What Task Manager itself writes when it enables an entry: 02 followed by a zeroed FILETIME.</summary>
    public static byte[] EnabledApproval => [2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];

    /// <summary>
    /// The entry runs the installer's launcher, like the Start menu shortcut: it recovers an
    /// interrupted update and passes the saved profile (state, library, port) to Openfy.exe, so the
    /// sign-in instance is the same one the shortcut opens.
    /// </summary>
    public static string CommandFor(string launcher) => "\"" + launcher + "\" --launch " + BackgroundFlag;

    /// <summary>StartupApproved values start with an even byte (02, 06) when enabled and an odd one (03, 07) when the user disabled the entry.</summary>
    public static bool Approved(byte[]? approval) => approval is not { Length: > 0 } || (approval[0] & 1) == 0;

    public LaunchAtLoginState State
    {
        get
        {
            if (string.IsNullOrWhiteSpace(store.ReadCommand())) return LaunchAtLoginState.Off;
            return Approved(store.ReadApproval()) ? LaunchAtLoginState.On : LaunchAtLoginState.DisabledBySystem;
        }
    }

    /// <summary>Turning it on inside Openfy is an explicit choice, so it also lifts a Task Manager disable.</summary>
    public void Enable()
    {
        store.WriteCommand(CommandFor(launcher));
        if (!Approved(store.ReadApproval())) store.WriteApproval(EnabledApproval);
    }

    public void Disable()
    {
        store.DeleteCommand();
        store.DeleteApproval();
    }

    public void Set(bool enabled) { if (enabled) Enable(); else Disable(); }

    /// <summary>
    /// Keeps an existing entry pointing at the current launcher (an older build or another layout
    /// may have written another command). Never creates an entry and never touches the user's approval.
    /// Returns true when the entry was rewritten.
    /// </summary>
    public bool Repair()
    {
        string? current = store.ReadCommand();
        if (string.IsNullOrWhiteSpace(current)) return false;
        string expected = CommandFor(launcher);
        if (string.Equals(current.Trim(), expected, StringComparison.OrdinalIgnoreCase)) return false;
        store.WriteCommand(expected);
        return true;
    }

    /// <summary>True when Openfy was started by its sign-in entry.</summary>
    public static bool StartedAtLogin(IEnumerable<string> arguments) => arguments.Contains(BackgroundFlag, StringComparer.OrdinalIgnoreCase);
}
