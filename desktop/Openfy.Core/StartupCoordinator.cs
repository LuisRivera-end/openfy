namespace Openfy.Core;

public enum StartupPhase { Loading, Revealing, Ready, Error }

/// <summary>One attempt at a time; cancellation never publishes a late ready state.</summary>
public sealed class StartupCoordinator : IDisposable
{
    public static readonly TimeSpan EssentialTimeout = TimeSpan.FromSeconds(30);
    public static readonly TimeSpan ContentTimeout = TimeSpan.FromSeconds(5);
    private CancellationTokenSource? lifetime;
    private Task? running;
    private int generation;
    public StartupPhase Phase { get; private set; } = StartupPhase.Loading;
    public Exception? Error { get; private set; }
    public event Action? Changed;
    public Task StartAsync(Func<CancellationToken, Task> essential, Func<CancellationToken, Task> content,
        TimeSpan? essentialTimeout = null, TimeSpan? contentTimeout = null)
    {
        if (running is { IsCompleted: false }) return running;
        lifetime?.Dispose(); lifetime = new();
        return running = RunAsync(++generation, lifetime.Token, essential, content, essentialTimeout ?? EssentialTimeout, contentTimeout ?? ContentTimeout);
    }
    private async Task RunAsync(int own, CancellationToken cancellation, Func<CancellationToken, Task> essential,
        Func<CancellationToken, Task> content, TimeSpan essentialTimeout, TimeSpan contentTimeout)
    {
        var clock = System.Diagnostics.Stopwatch.StartNew();
        Error = null; Phase = StartupPhase.Loading; Changed?.Invoke();
        SessionLog.Write("startup", "started");
        try {
            using (var deadline = CancellationTokenSource.CreateLinkedTokenSource(cancellation)) {
                deadline.CancelAfter(essentialTimeout);
                var task = essential(deadline.Token);
                try { await task.WaitAsync(deadline.Token); }
                catch { _ = ObserveAsync(task, "startup.essential"); throw; }
                deadline.Token.ThrowIfCancellationRequested();
            }
            SessionLog.Write("startup.essential", "completed", elapsedMs: clock.Elapsed.TotalMilliseconds);
            var optional = content(cancellation);
            try { await optional.WaitAsync(contentTimeout, cancellation); }
            catch (TimeoutException) { SessionLog.Write("startup.content", "deferred", elapsedMs: clock.Elapsed.TotalMilliseconds); _ = ObserveAsync(optional); }
            catch (OperationCanceledException) when (cancellation.IsCancellationRequested) { _ = ObserveAsync(optional); throw; }
            catch (Exception error) when (!cancellation.IsCancellationRequested) { SessionLog.Write("startup.content", "failed", error: error); }
            cancellation.ThrowIfCancellationRequested();
            if (own != generation) return;
            Phase = StartupPhase.Revealing; Changed?.Invoke();
            SessionLog.Write("startup", "prepared", elapsedMs: clock.Elapsed.TotalMilliseconds);
        }
        catch (Exception failure) {
            if (own != generation || cancellation.IsCancellationRequested) return;
            Error = failure is OperationCanceledException ? new TimeoutException("Openfy está tardando demasiado en abrirse. Vuelve a intentarlo.", failure) : failure;
            Phase = StartupPhase.Error; Changed?.Invoke();
            SessionLog.Write("startup", "failed", elapsedMs: clock.Elapsed.TotalMilliseconds, error: Error);
        }
    }
    private static async Task ObserveAsync(Task task, string operation = "startup.content") { try { await task; } catch (Exception error) { SessionLog.Write(operation, "failed", error: error); } }
    public void Complete() { if (Phase == StartupPhase.Revealing) { Phase = StartupPhase.Ready; Changed?.Invoke(); SessionLog.Write("startup", "revealed"); } }
    public void Cancel() { generation++; lifetime?.Cancel(); }
    public void Dispose() { Cancel(); lifetime?.Dispose(); }
}
