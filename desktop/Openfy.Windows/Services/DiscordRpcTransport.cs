using DiscordRPC;
using DiscordRPC.Message;
using Openfy.Core;

namespace Openfy.Windows.Services;

public sealed class DiscordRpcTransport : IDiscordPresenceTransport
{
    private readonly DiscordRpcClient client = new(DiscordPresencePolicy.ApplicationId, autoEvents: false) { SkipIdenticalPresence = false };
    private int status = (int)DiscordPresenceStatus.Waiting;
    public DiscordPresenceStatus Status { get => (DiscordPresenceStatus)Volatile.Read(ref status); private set => Volatile.Write(ref status, (int)value); }
    public event Action<DiscordTransportError>? Error;
    private long acceptedUpdates;
    internal long AcceptedUpdates => Interlocked.Read(ref acceptedUpdates);
    internal bool AcceptedListening { get; private set; }
    private DiscordActivity? acceptedActivity;
    internal DiscordActivity? AcceptedActivity => Volatile.Read(ref acceptedActivity);
    private DiscordActivity? desiredActivity;
    public DiscordRpcTransport()
    {
        // 1.6.1.70 dereferences both image keys in Assets.Merge, although Discord can omit either.
        // The numeric sentinel only represents an absent image ID in an incoming ACK; it is never sent.
        client.OnRpcMessage += (_, message) => {
            if (message is PresenceMessage { Presence.Assets: { } assets }) NormalizeAssets(assets);
            if (message is ReadyMessage or CloseMessage or ConnectionFailedMessage) Status = DiscordPresenceStatus.Waiting;
        };
        client.OnReady += (_, _) => Status = DiscordPresenceStatus.Connected;
        client.OnClose += (_, _) => Status = DiscordPresenceStatus.Waiting;
        client.OnConnectionFailed += (_, _) => Status = DiscordPresenceStatus.Waiting;
        client.OnPresenceUpdate += (_, message) => {
            Status = DiscordPresenceStatus.Connected;
            AcceptedListening = message.Presence?.Type == ActivityType.Listening;
            var presence = message.Presence;
            Volatile.Write(ref acceptedActivity, presence == null ? null : new(presence.Details ?? "", presence.State ?? "",
                presence.Assets?.LargeImageKey ?? "", presence.Assets?.LargeImageText ?? "", presence.Timestamps?.Start, presence.Timestamps?.End));
            Interlocked.Increment(ref acceptedUpdates);
            if (presence != null && desiredActivity is { } desired && desired.LargeImage != DiscordPresencePolicy.LogoAsset
                && (presence.Assets == null || presence.Assets.LargeImageID == "0")) Error?.Invoke(new(4000, true));
        };
        client.OnError += (_, error) => {
            Status = DiscordPresenceStatus.Error;
            bool image = error.Message?.Contains("image", StringComparison.OrdinalIgnoreCase) == true || error.Message?.Contains("asset", StringComparison.OrdinalIgnoreCase) == true;
            Error?.Invoke(new((int)error.Code, image));
        };
    }
    internal static void NormalizeAssets(Assets assets)
    {
        if (assets.LargeImageKey == null) assets.LargeImageKey = "0";
        if (assets.SmallImageKey == null) assets.SmallImageKey = "0";
    }
    public void Start() { if (!client.Initialize()) throw new IOException("No se pudo iniciar Discord RPC."); }
    public void Pump()
    {
        RestoreDesiredCache();
        client.Invoke();
        RestoreDesiredCache();
    }
    private void RestoreDesiredCache()
    {
        // ACKs can arrive after a newer publication and overwrite the SDK's cache. Repair it without
        // sending another frame; READY must replay the desired activity rather than an old ACK.
        if (desiredActivity == null) { if (client.CurrentPresence != null) client.ClearPresence(); }
        else if (client.CurrentPresence is { } cached) ApplyActivity(cached, desiredActivity);
        else client.SetPresence(CreatePresence(desiredActivity));
    }
    public void SetActivity(DiscordActivity? activity)
    {
        desiredActivity = activity;
        if (activity == null) { client.ClearPresence(); return; }
        client.SetPresence(CreatePresence(activity));
    }
    private static RichPresence CreatePresence(DiscordActivity activity) { var result = new RichPresence(); ApplyActivity(result, activity); return result; }
    internal static void ApplyActivity(RichPresence result, DiscordActivity activity)
    {
        result.Type = ActivityType.Listening; result.Details = activity.Details; result.State = activity.State;
        result.Assets = new Assets { LargeImageKey = activity.LargeImage, LargeImageText = activity.LargeText };
        result.Timestamps = activity.Start.HasValue && activity.End.HasValue ? new Timestamps(activity.Start.Value.UtcDateTime, activity.End.Value.UtcDateTime) : null;
    }
    public void Dispose() => client.Dispose();
}
