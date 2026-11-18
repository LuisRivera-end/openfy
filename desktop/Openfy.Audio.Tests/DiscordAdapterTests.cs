using System.Reflection;
using DiscordRPC;
using Openfy.Core;
using Openfy.Windows.Services;
using Xunit;

namespace Openfy.Audio.Tests;

public class DiscordAdapterTests
{
    [Fact]
    public void LatePlayingAckCannotRestoreTheOldTrackOrTimerInTheReconnectCache()
    {
        var old = new RichPresence { Type = ActivityType.Playing, Details = "Anterior", State = "Artista anterior", Timestamps = Timestamps.Now, Assets = new() { LargeImageKey = "old" } };
        var desired = new DiscordActivity("Actual", "En pausa · Artista", "openfy", "Álbum", null, null);
        DiscordRpcTransport.ApplyActivity(old, desired);
        Assert.Equal(ActivityType.Listening, old.Type); Assert.Equal("Actual", old.Details); Assert.StartsWith("En pausa", old.State);
        Assert.Null(old.Timestamps); Assert.Equal("openfy", old.Assets.LargeImageKey);
    }
    [Theory]
    [InlineData(true, false)] [InlineData(false, true)] [InlineData(false, false)]
    public void PinnedLibraryCanMergeAcknowledgementsThatOmitOptionalImageKeys(bool large, bool small)
    {
        var desired = new RichPresence { Type = ActivityType.Listening, Details = "Tema", State = "En pausa", Assets = new() { LargeImageKey = "openfy" } };
        var response = new BaseRichPresence { Type = ActivityType.Listening, Details = "Tema", State = "En pausa", Assets = new() { LargeImageKey = large ? "1234567890" : null, SmallImageKey = small ? "2345678901" : null } };
        DiscordRpcTransport.NormalizeAssets(response.Assets);
        var merge = typeof(RichPresence).GetMethod("Merge", BindingFlags.Instance | BindingFlags.NonPublic)!;
        merge.Invoke(desired, [response]);
        Assert.Equal(ActivityType.Listening, desired.Type); Assert.Equal("En pausa", desired.State); Assert.Null(desired.Timestamps);
        Assert.Equal("openfy", desired.Assets.LargeImageKey); Assert.Null(desired.Assets.SmallImageKey);
        Assert.Equal(large ? "1234567890" : "0", desired.Assets.LargeImageID);
    }
}
