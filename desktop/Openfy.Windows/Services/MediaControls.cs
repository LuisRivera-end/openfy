using Microsoft.UI.Xaml;
using Openfy.Windows.ViewModels;
using Windows.Media;
using Windows.Storage;
using Windows.Storage.Streams;

namespace Openfy.Windows.Services;

public sealed class MediaControls
{
    private readonly SystemMediaTransportControls controls;
    private readonly MainViewModel model;
    public MediaControls(Window window, MainViewModel state)
    {
        model = state;
        controls = SystemMediaTransportControlsInterop.GetForWindow(WindowsIntegration.Handle(window));
        controls.IsEnabled = true; controls.IsPlayEnabled = controls.IsPauseEnabled = controls.IsNextEnabled = controls.IsPreviousEnabled = true;
        controls.ButtonPressed += (sender, args) => window.DispatcherQueue.TryEnqueue(() => _ = model.RunAsync(async () => {
            switch (args.Button)
            {
                case SystemMediaTransportControlsButton.Play: if (!model.Playing) await model.ToggleAsync(); break;
                case SystemMediaTransportControlsButton.Pause: if (model.Playing) await model.ToggleAsync(); break;
                case SystemMediaTransportControlsButton.Next: await model.AdvanceAsync(1); break;
                case SystemMediaTransportControlsButton.Previous: await model.AdvanceAsync(-1); break;
            }
        }));
        controls.PlaybackPositionChangeRequested += (sender, args) => window.DispatcherQueue.TryEnqueue(() => _ = model.RunAsync(() => model.SeekAsync(args.RequestedPlaybackPosition.TotalSeconds)));
        model.PropertyChanged += (_, args) => {
            if (args.PropertyName is nameof(model.Title) or nameof(model.Artist) or nameof(model.Playing)) Update();
        };
        model.ArtworkChanged += async () => {
            try { controls.DisplayUpdater.Thumbnail = RandomAccessStreamReference.CreateFromFile(await StorageFile.GetFileFromPathAsync(model.Cover)); controls.DisplayUpdater.Update(); } catch { }
        };
    }
    private void Update()
    {
        controls.PlaybackStatus = model.Playing ? MediaPlaybackStatus.Playing : MediaPlaybackStatus.Paused;
        var updater = controls.DisplayUpdater; updater.Type = MediaPlaybackType.Music;
        updater.MusicProperties.Title = model.Title; updater.MusicProperties.Artist = model.Artist; updater.MusicProperties.AlbumTitle = model.Album; updater.Update();
        controls.UpdateTimelineProperties(new SystemMediaTransportControlsTimelineProperties { StartTime = TimeSpan.Zero, EndTime = TimeSpan.FromSeconds(model.Duration), Position = TimeSpan.FromSeconds(model.Position), MinSeekTime = TimeSpan.Zero, MaxSeekTime = TimeSpan.FromSeconds(model.Duration) });
    }
}
