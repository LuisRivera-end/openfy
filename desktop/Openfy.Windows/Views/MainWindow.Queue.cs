using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Automation;
using Microsoft.UI.Xaml.Controls;
using Microsoft.UI.Xaml.Controls.Primitives;
using Microsoft.UI.Xaml.Input;
using Microsoft.UI.Xaml.Markup;
using Openfy.Windows.ViewModels;

namespace Openfy.Windows.Views;
public sealed partial class MainWindow
{
    // One queue view for the window's lifetime: a ListView built per opening was never collected
    // (measured ~0.3 MB and ~2 handles per opening), so the panel is reused instead of rebuilt.
    private Grid? queuePanel;
    private Action? queueRefresh;
    private FrameworkElement QueueView()
    {
        if (queuePanel != null) { queueRefresh?.Invoke(); return queuePanel; }
        var panel = new Grid { RowSpacing = 8 };
        panel.RowDefinitions.Add(new() { Height = GridLength.Auto }); panel.RowDefinitions.Add(new() { Height = new(1, GridUnitType.Star) });
        var count = Ui.Text("", 12); count.Foreground = panelMuted; panel.Children.Add(count);
        var rows = new ListView {
            ItemsSource = model.Upcoming, IsItemClickEnabled = true, CanDragItems = true, CanReorderItems = true, AllowDrop = true,
            SelectionMode = ListViewSelectionMode.Single, HorizontalContentAlignment = HorizontalAlignment.Stretch,
            // The right inset keeps the overlay scrollbar off the rows, so hover and selection boxes are never cut.
            Padding = new(0, 0, 14, 0)
        };
        QueueStates(rows);
        rows.ItemContainerStyle = (Style)XamlReader.Load("""
        <Style xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation" TargetType="ListViewItem"><Setter Property="Padding" Value="8,0,4,0"/><Setter Property="Margin" Value="0,1"/><Setter Property="CornerRadius" Value="8"/><Setter Property="HorizontalContentAlignment" Value="Stretch"/><Setter Property="MinHeight" Value="64"/></Style>
        """);
        rows.ItemTemplate = (DataTemplate)XamlReader.Load($$"""
        <DataTemplate xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation"><Grid Padding="0,8" ColumnSpacing="8"><Grid.ColumnDefinitions><ColumnDefinition Width="16"/><ColumnDefinition Width="44"/><ColumnDefinition Width="*"/><ColumnDefinition Width="30"/><ColumnDefinition Width="30"/></Grid.ColumnDefinitions>
        <TextBlock Text="⠿" Foreground="{{PanelMutedColor}}" Opacity="0.45" VerticalAlignment="Center" FontSize="20"/>
        <ContentControl Grid.Column="1" Content="{Binding}" ContentTemplate="{StaticResource TrackCoverTemplate}" IsTabStop="False"/>
        <StackPanel Grid.Column="2" Spacing="4" VerticalAlignment="Center"><TextBlock Text="{Binding Title}" FontSize="13" FontWeight="SemiBold" TextTrimming="CharacterEllipsis"/><TextBlock Text="{Binding Artist}" FontSize="11" Foreground="{{PanelMutedColor}}" TextTrimming="CharacterEllipsis"/></StackPanel>
        <TextBlock Grid.Column="3" Text="{Binding Length}" FontSize="10" Foreground="{{PanelMutedColor}}" VerticalAlignment="Center"/>
        <Button Grid.Column="4" Content="⋯" Width="30" Height="44" MinWidth="0" Padding="0" Background="Transparent" BorderThickness="0"/>
        </Grid></DataTemplate>
        """);
        void Menu(SongRow row, FrameworkElement anchor) {
            var menu = new MenuFlyout();
            void Add(string label, Action action, bool enabled = true) { var item = new MenuFlyoutItem { Text = label, IsEnabled = enabled }; item.Click += (_, _) => action(); menu.Items.Add(item); }
            int i = model.Upcoming.IndexOf(row);
            Add("Mover arriba", () => model.MoveUpcoming(row.Entry.QueueId!, -1), i > 0);
            Add("Mover abajo", () => model.MoveUpcoming(row.Entry.QueueId!, 1), i < model.Upcoming.Count - 1);
            Add("Quitar de la cola", () => model.RemoveQueue(model.Queue.ToList().FindIndex(item => item.Entry.QueueId == row.Entry.QueueId)));
            menu.ShowAt(anchor);
        }
        rows.ContainerContentChanging += (_, args) => {
            if (args.ItemContainer.ContentTemplateRoot is not Grid template) return;
            if (args.InRecycleQueue) { Ui.ReleaseTree(template); return; }
            if (args.Item is not SongRow song) return;
            if (Ui.Find<ListViewItemPresenter>(args.ItemContainer) is { } presenter) presenter.CornerRadius = new(8);
            if (template.Children[0] is TextBlock grip) StyleQueueGrip(args.ItemContainer, grip);
            if (template.Children.OfType<Button>().FirstOrDefault() is { } options) {
                Ui.ReleaseTree(options); AutomationProperties.SetName(options, "Opciones de " + song.Title);
                RoutedEventHandler click = (_, _) => Menu(song, options); options.Click += click; Ui.OnRelease(options, () => options.Click -= click);
            }

        };
        rows.ItemClick += (_, args) => { if (args.ClickedItem is SongRow row) _ = model.RunAsync(() => model.JumpAsync(model.Queue.ToList().FindIndex(item => item.Entry.QueueId == row.Entry.QueueId))); };
        string? draggedId = null;
        rows.DragItemsStarting += (_, args) => { draggedId = (args.Items.FirstOrDefault() as SongRow)?.Entry.QueueId; count.Text = "Suelta la canción donde quieras escucharla"; };
        rows.DragItemsCompleted += (_, args) => {
            if (args.DropResult == global::Windows.ApplicationModel.DataTransfer.DataPackageOperation.None) { draggedId = null; Refresh(); return; }
            model.ReorderUpcoming(model.Upcoming.Select(row => row.Entry.QueueId!));
            // Land on the moved row: it stays selected (green tint) so the new position is obvious.
            if (draggedId != null && model.Upcoming.FirstOrDefault(row => row.Entry.QueueId == draggedId) is { } moved) { rows.SelectedItem = moved; rows.ScrollIntoView(moved); AutomationProperties.SetName(rows, "Cola de reproducción: " + moved.Title + " movida a la posición " + (model.Upcoming.IndexOf(moved) + 1)); }
            draggedId = null; Refresh();
        };
        rows.ContextRequested += (_, args) => { var row = (args.OriginalSource as FrameworkElement)?.DataContext as SongRow ?? rows.SelectedItem as SongRow; if (row != null) { Menu(row, rows); args.Handled = true; } };
        rows.KeyDown += (_, args) => {
            bool alt = Microsoft.UI.Input.InputKeyboardSource.GetKeyStateForCurrentThread(global::Windows.System.VirtualKey.Menu).HasFlag(global::Windows.UI.Core.CoreVirtualKeyStates.Down);
            if (alt && rows.SelectedItem is SongRow row && args.Key is global::Windows.System.VirtualKey.Up or global::Windows.System.VirtualKey.Down) { model.MoveUpcoming(row.Entry.QueueId!, args.Key == global::Windows.System.VirtualKey.Up ? -1 : 1); args.Handled = true; }
        };
        void Refresh() { if (draggedId != null) return; count.Text = model.Upcoming.Count == 0 ? "No hay más canciones en la cola." : model.Upcoming.Count + " canciones pendientes"; }
        model.QueueChanged += Refresh; Refresh();
        Grid.SetRow(rows, 1); panel.Children.Add(rows);
        queuePanel = panel; queueRefresh = Refresh;
        return panel;
    }

    private static void StyleQueueGrip(SelectorItem container, TextBlock grip)
    {
        Ui.ReleaseTree(grip);
        bool over = false, focused = container.FocusState != FocusState.Unfocused;
        void Update() => grip.Opacity = over || focused ? 1 : .45;
        PointerEventHandler entered = (_, _) => { over = true; Update(); };
        PointerEventHandler exited = (_, _) => { over = false; Update(); };
        RoutedEventHandler gotFocus = (_, _) => { focused = true; Update(); };
        RoutedEventHandler lostFocus = (_, _) => { focused = false; Update(); };
        container.PointerEntered += entered;
        container.PointerExited += exited;
        container.PointerCanceled += exited;
        container.GotFocus += gotFocus;
        container.LostFocus += lostFocus;
        Ui.OnRelease(grip, () => {
            container.PointerEntered -= entered;
            container.PointerExited -= exited;
            container.PointerCanceled -= exited;
            container.GotFocus -= gotFocus;
            container.LostFocus -= lostFocus;
        });
        Update();
    }

    /// <summary>
    /// Queue row states: a quiet box on hover, a firmer one while pressed, the brand tint for the selected or
    /// just-moved row, an elevated card while dragging and a green gap where it will land.
    /// </summary>
    private static void QueueStates(ListView rows)
    {
        var states = new Dictionary<string, string> {
            ["ListViewItemBackgroundPointerOver"] = "#FFFFFF0F", ["ListViewItemBackgroundPressed"] = "#FFFFFF17",
            ["ListViewItemBackgroundSelected"] = "#1ED7601C", ["ListViewItemBackgroundSelectedPointerOver"] = "#1ED76026", ["ListViewItemBackgroundSelectedPressed"] = "#1ED76033",
            ["ListViewItemSelectionIndicatorBrush"] = "#1ED760", ["ListViewItemSelectionIndicatorPointerOverBrush"] = "#1ED760", ["ListViewItemSelectionIndicatorPressedBrush"] = "#1ED760",
            ["ListViewItemForegroundSelected"] = "#F4F4F5", ["ListViewItemDragBackground"] = "#2C2C33", ["ListViewItemDragForeground"] = "#F4F4F5",
            ["ListViewItemPlaceholderBackground"] = "#1ED7601A", ["ListViewItemFocusBorderBrush"] = "#8AE9AA",
        };
        foreach (var (key, color) in states) rows.Resources[key] = Ui.Brush(color);
        rows.Resources["ListViewItemCornerRadius"] = new CornerRadius(8);
        rows.Resources["ListViewItemSelectionIndicatorCornerRadius"] = new CornerRadius(2);
        rows.Resources["ListViewItemDragThemeOpacity"] = 1d;
    }
}
