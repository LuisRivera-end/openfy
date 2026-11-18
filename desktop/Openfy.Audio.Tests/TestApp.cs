// BackendHost is compiled into this isolated test assembly without the WinUI application.
// Match self-exiting native checks: optional remote motion-art work stays disabled.
namespace Openfy.Windows;
internal static class App
{
    public const bool CheckRun = true;
}
