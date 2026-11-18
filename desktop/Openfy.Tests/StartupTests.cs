using Openfy.Core;
using Xunit;

namespace Openfy.Tests;

public class StartupTests
{
    [Fact]
    public async Task SharesTheAttemptAndNeverRevealsBeforeEssentialData()
    {
        using var startup = new StartupCoordinator();
        var gate = new TaskCompletionSource(); int calls = 0;
        Task Essential(CancellationToken cancellation) { calls++; return gate.Task.WaitAsync(cancellation); }
        var attempt = startup.StartAsync(Essential, _ => Task.CompletedTask);
        Assert.Same(attempt, startup.StartAsync(Essential, _ => Task.CompletedTask));
        Assert.Equal(StartupPhase.Loading, startup.Phase);
        gate.SetResult(); await attempt;
        Assert.Equal(1, calls); Assert.Equal(StartupPhase.Revealing, startup.Phase);
        startup.Complete(); Assert.Equal(StartupPhase.Ready, startup.Phase);
    }
    [Fact]
    public async Task OptionalContentContinuesAfterBudgetExpires()
    {
        using var startup = new StartupCoordinator();
        var content = new TaskCompletionSource();
        await startup.StartAsync(_ => Task.CompletedTask, _ => content.Task, contentTimeout: TimeSpan.FromMilliseconds(10));
        Assert.Equal(StartupPhase.Revealing, startup.Phase); Assert.False(content.Task.IsCompleted);
        content.SetResult();
    }
    [Fact]
    public async Task DeadlineProducesARecoverableErrorEvenIfWorkIgnoresCancellation()
    {
        using var startup = new StartupCoordinator();
        var hung = new TaskCompletionSource();
        await startup.StartAsync(_ => hung.Task, _ => Task.CompletedTask, essentialTimeout: TimeSpan.FromMilliseconds(10));
        Assert.Equal(StartupPhase.Error, startup.Phase); Assert.IsType<TimeoutException>(startup.Error);
        hung.SetResult();
        await startup.StartAsync(_ => Task.CompletedTask, _ => Task.CompletedTask);
        Assert.Equal(StartupPhase.Revealing, startup.Phase); Assert.Null(startup.Error);
    }
    [Fact]
    public async Task OptionalFailureStillRevealsTheApplication()
    {
        using var startup = new StartupCoordinator();
        await startup.StartAsync(_ => Task.CompletedTask, _ => Task.FromException(new IOException("offline")));
        Assert.Equal(StartupPhase.Revealing, startup.Phase); Assert.Null(startup.Error);
    }
    [Fact]
    public async Task ClosingCannotPublishALateReadyState()
    {
        using var startup = new StartupCoordinator();
        var hung = new TaskCompletionSource();
        var attempt = startup.StartAsync(_ => hung.Task, _ => Task.CompletedTask);
        startup.Cancel(); await attempt;
        hung.SetResult();
        Assert.Equal(StartupPhase.Loading, startup.Phase);
    }
}
