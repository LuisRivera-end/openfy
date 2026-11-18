using System.Diagnostics;
using System.Runtime.InteropServices;
using Microsoft.UI.Xaml;
using Openfy.Core;

namespace Openfy.Windows.Services;

public static class WindowsIntegration
{
    private static readonly global::Windows.UI.ViewManagement.UISettings accessibility = new();
    public static bool AnimationsEnabled => accessibility.AnimationsEnabled;
    public static bool PointerButtonsDown => GetAsyncKeyState(1) < 0 || GetAsyncKeyState(2) < 0 || GetAsyncKeyState(4) < 0 || GetAsyncKeyState(5) < 0 || GetAsyncKeyState(6) < 0;
    private static readonly Dictionary<nint, nint> lastDisplays = [];
    private static readonly Dictionary<string, double> displayRates = [];
    private static long lastPresentationEvent;
    private static readonly WinEventProc desktopEvent = (_, _, hwnd, objectId, childId, _, _) => {
        // WinEvent also reports thousands of changes inside other applications.
        // Only top-level window events can change the fullscreen decision.
        if (hwnd == 0 || objectId != 0 || childId != 0) return;
        long now = Stopwatch.GetTimestamp();
        if (now - lastPresentationEvent < Stopwatch.Frequency / 5) return;
        lastPresentationEvent = now; PresentationChanged?.Invoke();
    };
    private static readonly List<nint> eventHooks = [];
    private static int watchers;
    public static event Action? PresentationChanged;
    public static void WatchPresentation()
    {
        if (++watchers != 1) return;
        eventHooks.Add(SetWinEventHook(3, 3, 0, desktopEvent, 0, 0, 2)); // foreground, skip our process
        eventHooks.Add(SetWinEventHook(0x8000, 0x800B, 0, desktopEvent, 0, 0, 2)); // show/hide/location/cloaking
        eventHooks.Add(SetWinEventHook(0x16, 0x17, 0, desktopEvent, 0, 0, 2)); // minimize
    }
    public static void UnwatchPresentation()
    {
        if (--watchers != 0) return;
        foreach (nint hook in eventHooks) if (hook != 0) UnhookWinEvent(hook);
        eventHooks.Clear();
    }
    [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left, Top, Right, Bottom; public int Width => Right - Left; public int Height => Bottom - Top; }
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] private struct MonitorInfo { public uint Size; public Rect Monitor, Work; public uint Flags; [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 32)] public string Device; }
    public static nint Handle(Window window) => WinRT.Interop.WindowNative.GetWindowHandle(window);
    public static bool Visible(nint hwnd)
    {
        if (!IsWindowVisible(hwnd) || IsIconic(hwnd) || SessionLocked) return false;
        DwmGetWindowAttribute(hwnd, 14, out int cloaked, 4);
        return cloaked == 0;
    }
    public static bool SessionLocked { get { SHQueryUserNotificationState(out int state); return state == 1; } }
    public static (string Name, double Hz, Rect Work) Display(nint hwnd)
    {
        var monitor = MonitorFromWindow(hwnd, 2);
        GetWindowRect(hwnd, out var window);
        long largest = 0;
        lastDisplays.TryGetValue(hwnd, out nint previous);
        EnumDisplayMonitors(0, 0, (candidate, _, _, _) => {
            var candidateInfo = new MonitorInfo { Size = (uint)Marshal.SizeOf<MonitorInfo>(), Device = "" };
            GetMonitorInfo(candidate, ref candidateInfo);
            var rect = candidateInfo.Monitor;
            long area = (long)Math.Max(0, Math.Min(window.Right, rect.Right) - Math.Max(window.Left, rect.Left)) * Math.Max(0, Math.Min(window.Bottom, rect.Bottom) - Math.Max(window.Top, rect.Top));
            if (area > largest || area > 0 && area == largest && candidate == previous) { monitor = candidate; largest = area; }
            return true;
        }, 0);
        if (lastDisplays.Count > 64) lastDisplays.Clear();
        lastDisplays[hwnd] = monitor;
        var info = new MonitorInfo { Size = (uint)Marshal.SizeOf<MonitorInfo>(), Device = "" };
        GetMonitorInfo(monitor, ref info);
        if (!displayRates.TryGetValue(info.Device, out double hz)) displayRates[info.Device] = hz = RefreshRate(info.Device);
        return (info.Device, hz, info.Work);
    }
    public static void InvalidateDisplays() => displayRates.Clear();
    public static List<(string Name, double Hz, Rect Work)> Displays()
    {
        var displays = new List<(string, double, Rect)>();
        EnumDisplayMonitors(0, 0, (monitor, _, _, _) => {
            var info = new MonitorInfo { Size = (uint)Marshal.SizeOf<MonitorInfo>(), Device = "" };
            if (GetMonitorInfo(monitor, ref info)) displays.Add((info.Device, RefreshRate(info.Device), info.Work));
            return true;
        }, 0);
        return displays;
    }
    private static double RefreshRate(string device)
    {
        // CCD exposes the active rational rate, including 59.94 and mixed-Hz outputs.
        for (int attempt = 0; attempt < 3; attempt++)
        {
            if (GetDisplayConfigBufferSizes(2, out uint paths, out uint modes) != 0) break;
            nint pathBuffer = Marshal.AllocHGlobal(checked((int)paths * 72)), modeBuffer = Marshal.AllocHGlobal(checked((int)modes * 64));
            try
            {
                int result = QueryDisplayConfig(2, ref paths, pathBuffer, ref modes, modeBuffer, 0);
                if (result == 122) continue;
                if (result != 0) break;
                for (int i = 0; i < paths; i++)
                {
                    nint path = pathBuffer + i * 72;
                    nint name = Marshal.AllocHGlobal(84);
                    try
                    {
                        for (int b = 0; b < 84; b++) Marshal.WriteByte(name, b, 0);
                        Marshal.WriteInt32(name, 0, 1); Marshal.WriteInt32(name, 4, 84);
                        Marshal.WriteInt64(name, 8, Marshal.ReadInt64(path, 0)); Marshal.WriteInt32(name, 16, Marshal.ReadInt32(path, 8));
                        if (DisplayConfigGetDeviceInfo(name) != 0 || Marshal.PtrToStringUni(name + 20) != device) continue;
                        uint numerator = unchecked((uint)Marshal.ReadInt32(path, 48)), denominator = unchecked((uint)Marshal.ReadInt32(path, 52));
                        if (denominator > 0 && numerator > 0) return (double)numerator / denominator;
                    }
                    finally { Marshal.FreeHGlobal(name); }
                }
            }
            finally { Marshal.FreeHGlobal(pathBuffer); Marshal.FreeHGlobal(modeBuffer); }
        }
        return 60;
    }
    public static bool OtherFullscreen()
    {
        bool found = false;
        EnumWindows((hwnd, _) => {
            if (!Visible(hwnd)) return true;
            GetWindowThreadProcessId(hwnd, out uint pid);
            if (pid == Environment.ProcessId || pid == 0) return true;
            DwmGetWindowAttribute(hwnd, 14, out int cloaked, 4);
            if (cloaked != 0) return true;
            long style = GetWindowLongPtr(hwnd, -16).ToInt64(), extended = GetWindowLongPtr(hwnd, -20).ToInt64();
            if ((style & 0x00C00000) != 0 || (style & 0x00040000) != 0 || (extended & 0x80) != 0) return true;
            GetWindowRect(hwnd, out var bounds);
            if (bounds.Width <= 0 || bounds.Height <= 0) return true;
            var info = new MonitorInfo { Size = (uint)Marshal.SizeOf<MonitorInfo>(), Device = "" };
            GetMonitorInfo(MonitorFromWindow(hwnd, 2), ref info);
            if (Math.Abs(bounds.Left - info.Monitor.Left) <= 2 && Math.Abs(bounds.Top - info.Monitor.Top) <= 2 && Math.Abs(bounds.Right - info.Monitor.Right) <= 2 && Math.Abs(bounds.Bottom - info.Monitor.Bottom) <= 2)
            {
                var name = new System.Text.StringBuilder(256); GetClassName(hwnd, name, name.Capacity);
                if (name.ToString() is not ("Progman" or "WorkerW" or "Shell_TrayWnd")) { found = true; return false; }
            }
            return true;
        }, 0);
        SHQueryUserNotificationState(out int state);
        var foreground = GetForegroundWindow(); GetWindowThreadProcessId(foreground, out uint foregroundPid);
        return found || state == 3 && foregroundPid != Environment.ProcessId;
    }
    public static void Restore(Window window, WindowPlacement? placement)
    {
        if (placement == null) return;
        // Move first so the window adopts the target monitor's DPI, then size it for that DPI.
        // Sizing before the move let Windows rescale an already-scaled size on every launch.
        window.AppWindow.Move(new(placement.X, placement.Y));
        double scale = placement.Dpi > 0 ? Dpi(window) / (double)placement.Dpi : 1;
        double factor = Dpi(window) / 96.0;
        window.AppWindow.MoveAndResize(new(placement.X, placement.Y,
            Math.Clamp((int)Math.Round(placement.Width * scale), (int)(250 * factor), 7680),
            Math.Clamp((int)Math.Round(placement.Height * scale), (int)(100 * factor), 4320)));
        KeepOnScreen(window);
    }
    // First launch: design-pixel size for this monitor, kept inside its work area.
    public static void ResizeDefault(Window window, int width, int height) { window.AppWindow.Resize(Scaled(window, width, height)); KeepOnScreen(window); }
    private static void KeepOnScreen(Window window)
    {
        var work = Display(Handle(window)).Work; var bounds = window.AppWindow.Position;
        int width = Math.Min(window.AppWindow.Size.Width, work.Width), height = Math.Min(window.AppWindow.Size.Height, work.Height);
        window.AppWindow.MoveAndResize(new(Math.Clamp(bounds.X, work.Left, Math.Max(work.Left, work.Right - width)), Math.Clamp(bounds.Y, work.Top, Math.Max(work.Top, work.Bottom - height)), width, height));
    }
    public static WindowPlacement Placement(Window window)
    { var app = window.AppWindow; return new(app.Position.X, app.Position.Y, app.Size.Width, app.Size.Height, Display(Handle(window)).Name, Dpi(window)); }
    public static int Dpi(Window window) { uint dpi = GetDpiForWindow(Handle(window)); return dpi == 0 ? 96 : (int)dpi; }
    // Default window sizes are design pixels; AppWindow sizes are physical pixels.
    public static global::Windows.Graphics.SizeInt32 Scaled(Window window, int width, int height)
    {
        double factor = Dpi(window) / 96.0; var work = Display(Handle(window)).Work;
        // At 200 % a 1080p monitor is only 960x540 design pixels: never open larger than its work area.
        return new(Math.Min((int)Math.Round(width * factor), Math.Max(1, work.Width)), Math.Min((int)Math.Round(height * factor), Math.Max(1, work.Height)));
    }
    public static void ActivateExisting()
    { var hwnd = FindWindow(null, "Openfy"); if (hwnd != 0) { ShowWindow(hwnd, 9); SetForegroundWindow(hwnd); } }
    private delegate bool EnumProc(nint hwnd, nint data);
    private delegate void WinEventProc(nint hook, uint eventId, nint hwnd, int objectId, int childId, uint threadId, uint time);
    [DllImport("user32.dll")] private static extern nint SetWinEventHook(uint min, uint max, nint module, WinEventProc callback, uint processId, uint threadId, uint flags);
    [DllImport("user32.dll")] private static extern bool UnhookWinEvent(nint hook);
    private delegate bool DisplayProc(nint monitor, nint dc, nint rect, nint data);
    [DllImport("user32.dll")] private static extern bool EnumDisplayMonitors(nint dc, nint clip, DisplayProc callback, nint data);
    [DllImport("user32.dll")] private static extern bool EnumWindows(EnumProc callback, nint data);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(nint hwnd);
    [DllImport("user32.dll")] private static extern uint GetDpiForWindow(nint hwnd);
    [DllImport("user32.dll")] private static extern bool IsIconic(nint hwnd);
    [DllImport("user32.dll")] private static extern bool GetWindowRect(nint hwnd, out Rect rect);
    [DllImport("user32.dll")] private static extern nint MonitorFromWindow(nint hwnd, uint flags);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern bool GetMonitorInfo(nint monitor, ref MonitorInfo info);
    [DllImport("user32.dll")] private static extern nint GetWindowLongPtr(nint hwnd, int index);
    [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(nint hwnd, out uint pid);
    [DllImport("user32.dll")] private static extern nint GetForegroundWindow();
    [DllImport("user32.dll")] private static extern short GetAsyncKeyState(int key);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetClassName(nint hwnd, System.Text.StringBuilder name, int count);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern nint FindWindow(string? name, string title);
    [DllImport("user32.dll")] private static extern bool ShowWindow(nint hwnd, int command);
    [DllImport("user32.dll")] private static extern bool SetForegroundWindow(nint hwnd);
    [DllImport("dwmapi.dll")] private static extern int DwmGetWindowAttribute(nint hwnd, uint attribute, out int value, uint size);
    [DllImport("shell32.dll")] private static extern int SHQueryUserNotificationState(out int state);
    [DllImport("user32.dll")] private static extern int GetDisplayConfigBufferSizes(uint flags, out uint paths, out uint modes);
    [DllImport("user32.dll")] private static extern int QueryDisplayConfig(uint flags, ref uint paths, nint pathBuffer, ref uint modes, nint modeBuffer, nint topology);
    [DllImport("user32.dll")] private static extern int DisplayConfigGetDeviceInfo(nint info);
}
