using System.Runtime.InteropServices;
using Microsoft.UI.Xaml;

namespace Openfy.Windows.Services;

public sealed class TrayIcon : IDisposable
{
    private readonly nint hwnd;
    private readonly Subclass callback;
    private IconData data;
    private readonly Action<int> command;
    private readonly uint taskbarCreated = RegisterWindowMessage("TaskbarCreated");
    public TrayIcon(Window window, Action<int> action)
    {
        hwnd = WindowsIntegration.Handle(window); command = action; callback = WndProc;
        SetWindowSubclass(hwnd, callback, 1, 0);
        data = new IconData { Size = (uint)Marshal.SizeOf<IconData>(), Window = hwnd, Id = 1, Flags = 7, Callback = 0x8001,
            Icon = LoadImage(0, Path.Combine(AppContext.BaseDirectory, "Assets", "Openfy.ico"), 1, 32, 32, 0x10), Tip = "Openfy · Tu música, contigo", Info = "", InfoTitle = "" };
        if (data.Icon == 0) data.Icon = LoadIcon(0, 32512);
        Shell_NotifyIcon(0, ref data);
    }
    private nint WndProc(nint window, uint message, nint wparam, nint lparam, nuint id, nuint reference)
    {
        if (message is 0x7E or 0x2E0) WindowsIntegration.InvalidateDisplays();
        if (message == taskbarCreated) Shell_NotifyIcon(0, ref data);
        if (message == 0x8001)
        {
            if ((int)lparam == 0x0203) command(1);
            if ((int)lparam == 0x0205)
            {
                var menu = CreatePopupMenu();
                AppendMenu(menu, 0, 1, "Abrir Openfy"); AppendMenu(menu, 0, 2, "Minirreproductor"); AppendMenu(menu, 0, 3, "Widget de escritorio"); AppendMenu(menu, 0, 4, "Salir");
                GetCursorPos(out var point); SetForegroundWindow(hwnd);
                int selected = TrackPopupMenuEx(menu, 0x100 | 0x2, point.X, point.Y, hwnd, 0);
                DestroyMenu(menu); if (selected != 0) command(selected);
            }
        }
        return DefSubclassProc(window, message, wparam, lparam);
    }
    public void Dispose() { Shell_NotifyIcon(2, ref data); RemoveWindowSubclass(hwnd, callback, 1); }
    [StructLayout(LayoutKind.Sequential)] private struct Point { public int X, Y; }
    [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)] private struct IconData
    {
        public uint Size; public nint Window; public uint Id, Flags, Callback; public nint Icon;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 128)] public string Tip;
        public uint State, StateMask;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 256)] public string Info;
        public uint Timeout;
        [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 64)] public string InfoTitle;
        public uint InfoFlags; public Guid Guid; public nint BalloonIcon;
    }
    private delegate nint Subclass(nint hwnd, uint message, nint wparam, nint lparam, nuint id, nuint reference);
    [DllImport("comctl32.dll")] private static extern bool SetWindowSubclass(nint hwnd, Subclass callback, nuint id, nuint data);
    [DllImport("comctl32.dll")] private static extern bool RemoveWindowSubclass(nint hwnd, Subclass callback, nuint id);
    [DllImport("comctl32.dll")] private static extern nint DefSubclassProc(nint hwnd, uint message, nint wparam, nint lparam);
    [DllImport("shell32.dll", CharSet = CharSet.Unicode)] private static extern bool Shell_NotifyIcon(uint action, ref IconData data);
    [DllImport("user32.dll")] private static extern nint LoadIcon(nint instance, nint resource);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern nint LoadImage(nint instance, string name, uint type, int width, int height, uint flags);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern uint RegisterWindowMessage(string name);
    [DllImport("user32.dll")] private static extern nint CreatePopupMenu();
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern bool AppendMenu(nint menu, uint flags, nuint id, string text);
    [DllImport("user32.dll")] private static extern bool GetCursorPos(out Point point);
    [DllImport("user32.dll")] private static extern bool SetForegroundWindow(nint hwnd);
    [DllImport("user32.dll")] private static extern int TrackPopupMenuEx(nint menu, uint flags, int x, int y, nint hwnd, nint parameters);
    [DllImport("user32.dll")] private static extern bool DestroyMenu(nint menu);
}
