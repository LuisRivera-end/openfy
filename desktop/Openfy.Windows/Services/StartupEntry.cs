using Microsoft.Win32;
using Openfy.Core;

namespace Openfy.Windows.Services;

/// <summary>The current user's Run entry and its Task Manager approval, both under HKCU.</summary>
public sealed class StartupEntry : IStartupEntryStore
{
    public const string RunKey = @"Software\Microsoft\Windows\CurrentVersion\Run";
    public const string ApprovalKey = @"Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run";

    private static readonly string Local = Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
    /// <summary>The installer's copy of itself that the Start menu shortcut runs with --launch.</summary>
    public static readonly string Launcher = Path.Combine(Local, "Openfy", "installer", "Openfy.Setup.exe");

    /// <summary>
    /// Only the personal installation registers itself: never a workspace build, a check run or an
    /// isolated test installation, which share this user's HKCU and must not redirect the entry.
    /// </summary>
    public static bool Available => !App.CheckRun
        && !Environment.GetCommandLineArgs().Contains("--workspace")
        && Environment.GetEnvironmentVariable("OPENFY_INSTALL_TEST_ROOT") == null
        && File.Exists(Path.Combine(AppContext.BaseDirectory, ".openfy-installation"))
        && string.Equals(Path.TrimEndingDirectorySeparator(Path.GetFullPath(AppContext.BaseDirectory)), Path.Combine(Local, "Programs", "Openfy"), StringComparison.OrdinalIgnoreCase)
        && File.Exists(Launcher);

    public static LaunchAtLogin Create() => new(new StartupEntry(), Launcher);

    public string? ReadCommand() { using var key = Registry.CurrentUser.OpenSubKey(RunKey); return key?.GetValue(LaunchAtLogin.EntryName) as string; }
    public void WriteCommand(string command) { using var key = Registry.CurrentUser.CreateSubKey(RunKey); key.SetValue(LaunchAtLogin.EntryName, command, RegistryValueKind.String); }
    public void DeleteCommand() { using var key = Registry.CurrentUser.OpenSubKey(RunKey, true); key?.DeleteValue(LaunchAtLogin.EntryName, false); }
    public byte[]? ReadApproval() { using var key = Registry.CurrentUser.OpenSubKey(ApprovalKey); return key?.GetValue(LaunchAtLogin.EntryName) as byte[]; }
    public void WriteApproval(byte[] approval) { using var key = Registry.CurrentUser.CreateSubKey(ApprovalKey); key.SetValue(LaunchAtLogin.EntryName, approval, RegistryValueKind.Binary); }
    public void DeleteApproval() { using var key = Registry.CurrentUser.OpenSubKey(ApprovalKey, true); key?.DeleteValue(LaunchAtLogin.EntryName, false); }
}
