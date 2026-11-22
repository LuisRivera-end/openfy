using Openfy.Core;
using Xunit;

namespace Openfy.Tests;

public class LaunchAtLoginTests
{
    private sealed class MemoryStore : IStartupEntryStore
    {
        public string? Command; public byte[]? Approval;
        public string? ReadCommand() => Command;
        public void WriteCommand(string command) => Command = command;
        public void DeleteCommand() => Command = null;
        public byte[]? ReadApproval() => Approval;
        public void WriteApproval(byte[] approval) => Approval = approval;
        public void DeleteApproval() => Approval = null;
    }
    private const string Exe = @"C:\Users\Test User\AppData\Local\Openfy\installer\Openfy.Setup.exe";

    [Fact]
    public void EnablesTheLauncherWithAQuotedPathAndTheBackgroundFlag()
    {
        var store = new MemoryStore(); var entry = new LaunchAtLogin(store, Exe);
        Assert.Equal(LaunchAtLoginState.Off, entry.State);
        entry.Enable();
        Assert.Equal("\"" + Exe + "\" --launch --background", store.Command);
        Assert.Equal(LaunchAtLoginState.On, entry.State);
        entry.Disable();
        Assert.Null(store.Command); Assert.Equal(LaunchAtLoginState.Off, entry.State);
    }

    [Theory]
    [InlineData(new byte[] { 2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0 }, true)]
    [InlineData(new byte[] { 6, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0 }, true)]
    [InlineData(new byte[] { 3, 0, 0, 0, 1, 2, 3, 4, 5, 6, 7, 8 }, false)]
    [InlineData(new byte[] { 7, 0, 0, 0, 1, 2, 3, 4, 5, 6, 7, 8 }, false)]
    [InlineData(new byte[0], true)]
    [InlineData(null, true)]
    public void ReadsTaskManagerApproval(byte[]? approval, bool approved) => Assert.Equal(approved, LaunchAtLogin.Approved(approval));

    [Fact]
    public void ReportsATaskManagerDisableAndLiftsItOnlyWhenTheUserEnables()
    {
        var store = new MemoryStore { Command = LaunchAtLogin.CommandFor(Exe), Approval = [3, 0, 0, 0, 1, 2, 3, 4, 5, 6, 7, 8] };
        var entry = new LaunchAtLogin(store, Exe);
        Assert.Equal(LaunchAtLoginState.DisabledBySystem, entry.State);
        Assert.False(entry.Repair());
        Assert.NotNull(store.Approval);
        entry.Enable();
        Assert.Equal(LaunchAtLogin.EnabledApproval, store.Approval); Assert.Equal(LaunchAtLoginState.On, entry.State);
    }

    [Fact]
    public void EnableKeepsAnEnabledApproval()
    {
        byte[] enabled = [2, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
        var store = new MemoryStore { Approval = enabled };
        new LaunchAtLogin(store, Exe).Enable();
        Assert.Same(enabled, store.Approval);
    }

    [Fact]
    public void RepairRewritesAStaleEntryButNeverCreatesOne()
    {
        var store = new MemoryStore(); var entry = new LaunchAtLogin(store, Exe);
        Assert.False(entry.Repair()); Assert.Null(store.Command);
        store.Command = "\"D:\\Old\\Openfy.exe\" --background";
        Assert.True(entry.Repair()); Assert.Equal(LaunchAtLogin.CommandFor(Exe), store.Command);
        Assert.False(entry.Repair());
    }

    [Fact]
    public void DetectsTheSignInLaunch()
    {
        Assert.True(LaunchAtLogin.StartedAtLogin(["Openfy.exe", "--background"]));
        Assert.False(LaunchAtLogin.StartedAtLogin(["Openfy.exe"]));
    }
}
