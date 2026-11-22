using System.Diagnostics;
using System.IO.Compression;
using System.Reflection;
using System.Runtime.InteropServices;
using Microsoft.Win32;
using Openfy.Core;
using System.Text.Json;

namespace Openfy.Setup;

internal static partial class Program
{
    private const string Identity = "548FAE2A-A651-4C67-AAF0-639331AC451F";
    private static readonly string Local = ResolveLocal();
    private static bool Isolated => Environment.GetEnvironmentVariable("OPENFY_INSTALL_TEST_ROOT") != null;
    private static string ResolveLocal() {
        if (Environment.GetEnvironmentVariable("OPENFY_INSTALL_TEST_ROOT") is not { } root) return Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData);
        if (!Path.IsPathFullyQualified(root) || !File.Exists(Path.Combine(root, ".openfy-qa"))) throw new IOException("Se requiere una instalación aislada marcada para pruebas.");
        return Path.GetFullPath(root);
    }
    private static readonly string Programs = Path.Combine(Local, "Programs");
    private static readonly string Destination = Path.Combine(Programs, "Openfy");
    private static readonly string Shortcut = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.StartMenu), "Programs", "Openfy.lnk");
    private static readonly string Maintenance = Path.Combine(Local, "Openfy", "installer", "Openfy.Setup.exe");
    [STAThread]
    private static int Main(string[] args)
    {
        bool silent = args.Contains("--silent");
        try
        {
            Directory.CreateDirectory(Control);
            // A Windows process holds its current directory open. A helper
            // launched from Openfy must release that directory before swapping it.
            Directory.SetCurrentDirectory(Control);
            using var gate = new FileStream(Path.Combine(Control, "setup.lock"), FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None);
            Recover();
            if (args.Contains("--recover") && Isolated) return 0;
            if (args.Contains("--launch")) { Launch(background: args.Contains(LaunchAtLogin.BackgroundFlag)); return 0; }
            if (args.Contains("--uninstall")) Uninstall(); else InstallTransaction(args);
            if (!silent) MessageBox(0, args.Contains("--uninstall") ? "Openfy se ha desinstalado. Tu biblioteca y configuración se conservan." : "Openfy está instalado. Ábrelo desde el menú Inicio.", "Openfy", 0x40);
            return 0;
        }
        catch (Exception error)
        {
            string logs = Path.Combine(Local, "Openfy", "logs");
            Directory.CreateDirectory(logs); File.AppendAllText(Path.Combine(logs, "setup.log"), DateTimeOffset.Now + " " + error + Environment.NewLine);
            if (!silent) MessageBox(0, "No se pudo completar la operación. " + error.Message, "Openfy", 0x10);
            return 1;
        }
    }
    private static void Register(bool desktopIcon)
    {
        if (Isolated) return;
            CreateShortcut(Shortcut);
            if (desktopIcon || File.Exists(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), "Openfy.lnk"))) CreateShortcut(Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), "Openfy.lnk"));
            using var key = Registry.CurrentUser.CreateSubKey(@"Software\Microsoft\Windows\CurrentVersion\Uninstall\Openfy");
            key.SetValue("DisplayName", "Openfy"); key.SetValue("DisplayVersion", ReleaseInfo.Current.Version); key.SetValue("Publisher", "Luis Eliezer Rivera Gamez");
            key.SetValue("InstallLocation", Destination); key.SetValue("DisplayIcon", Path.Combine(Destination, "Openfy.exe"));
            key.SetValue("UninstallString", '"' + Maintenance + "\" --uninstall"); key.SetValue("QuietUninstallString", '"' + Maintenance + "\" --uninstall --silent");
            key.SetValue("NoModify", 1); key.SetValue("NoRepair", 1);
    }
    private static void Uninstall()
    {
        if (Directory.Exists(Destination))
        {
            if (!Owned()) throw new IOException("La carpeta de instalación no se reconoce. No se eliminará.");
            StopApplication(ReadProfile().StateRoot);
            if (Path.GetFullPath(Destination) != Path.Combine(Path.GetFullPath(Programs), "Openfy")) throw new IOException("Destino no válido.");
            Directory.Delete(Destination, true);
        }
        if (Isolated) return;
        if (File.Exists(Shortcut)) File.Delete(Shortcut);
        string desktop = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory), "Openfy.lnk");
        if (File.Exists(desktop)) File.Delete(desktop);
        Registry.CurrentUser.DeleteSubKeyTree(@"Software\Microsoft\Windows\CurrentVersion\Uninstall\Openfy", false);
        // "Start with Windows" entry and its Task Manager approval.
        using (var run = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Run", true)) run?.DeleteValue(LaunchAtLogin.EntryName, false);
        using (var approval = Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run", true)) approval?.DeleteValue(LaunchAtLogin.EntryName, false);
    }
    private static bool Owned() => File.Exists(Path.Combine(Destination, ".openfy-installation")) && File.ReadAllText(Path.Combine(Destination, ".openfy-installation")) == Identity;
    private static void StopApplication(string stateRoot)
    {
        string executable = Path.Combine(Destination, "Openfy.exe"); if (!File.Exists(executable)) return;
        using var request = Process.Start(StartInfo(executable, "--state-dir", stateRoot, "--shutdown")); request?.WaitForExit(3000);
        foreach (var process in Process.GetProcessesByName("Openfy"))
        {
            try { if (process.MainModule?.FileName?.Equals(executable, StringComparison.OrdinalIgnoreCase) == true && !process.WaitForExit(8000)) throw new IOException("Cierra Openfy desde la bandeja y vuelve a intentarlo."); }
            finally { process.Dispose(); }
        }
    }
    private static void DeleteOwnedTemporary(string path)
    {
        string absolute = Path.GetFullPath(path);
        if (!absolute.StartsWith(Path.GetFullPath(Programs) + Path.DirectorySeparatorChar + "Openfy.", StringComparison.OrdinalIgnoreCase)) throw new IOException("Ruta temporal no válida.");
        if (Directory.Exists(absolute)) Directory.Delete(absolute, true);
    }
    private static void CreateShortcut(string path)
    {
        Directory.CreateDirectory(Path.GetDirectoryName(path)!);
        dynamic shell = Activator.CreateInstance(Type.GetTypeFromProgID("WScript.Shell")!)!;
        try { dynamic link = shell.CreateShortcut(path); link.TargetPath = Maintenance; link.Arguments = "--launch"; link.IconLocation = Path.Combine(Destination, "Openfy.exe"); link.WorkingDirectory = Destination; link.Description = "Openfy · Tu música, contigo"; link.Save(); Marshal.FinalReleaseComObject(link); }
        finally { Marshal.FinalReleaseComObject(shell); }
    }
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int MessageBox(nint hwnd, string text, string caption, uint type);
}
