using Microsoft.UI.Xaml;
using Microsoft.UI.Xaml.Controls;
using Openfy.Windows.Services;
using Windows.Storage.Pickers;

namespace Openfy.Windows.Views;

public sealed partial class MainWindow
{
    private const string TransparencyLabel = "Efectos de transparencia";
    private static readonly string[] TransparencyModes = ["default", "on", "off"];

    private void BuildSettingsCatalog()
    {
        catalog.Children.Add(CatalogPageHeading("A tu manera", "Ajustes"));
        var library = SettingsSection("Tu biblioteca personal");
        library.Children.Add(SettingRow("Conexión con tu PC", "Disponible para importar, editar y escuchar.", Ui.AsyncButton("Actualizar", model, model.RefreshAsync)));
        var android = SettingsSection("Android");
        android.Children.Add(SettingRow("Vincular un teléfono", "Comparte favoritos y playlists de YouTube. Los archivos, las descargas y el historial permanecen en cada dispositivo.", Ui.AsyncButton("Generar código", model, async () => {
            var pairing = await model.Host.CallAsync<System.Text.Json.JsonElement>("createPairing");
            var text = new StackPanel { Spacing = 14 };
            text.Children.Add(new TextBlock { Text = pairing.GetProperty("origin").GetString(), IsTextSelectionEnabled = true, TextWrapping = TextWrapping.Wrap });
            text.Children.Add(new TextBlock { Text = pairing.GetProperty("code").GetString(), IsTextSelectionEnabled = true, FontSize = 28, FontWeight = Microsoft.UI.Text.FontWeights.SemiBold });
            text.Children.Add(Ui.Muted("Introduce la dirección y el código en Ajustes de Openfy para Android. El código caduca en cinco minutos y solo se puede usar una vez.", 13));
            await new ContentDialog { Title = "Vincular Android", Content = text, CloseButtonText = "Cerrar", XamlRoot = Content.XamlRoot }.ShowAsync();
        })));
        android.Children.Add(SettingRow("Teléfonos vinculados", "Puedes retirar el acceso de un dispositivo cuando lo necesites.", Ui.AsyncButton("Administrar", model, async () => {
            var devices = await model.Host.CallAsync<System.Text.Json.JsonElement>("listSyncDevices");
            var content = new StackPanel { Spacing = 12 };
            if(devices.GetArrayLength() == 0) content.Children.Add(Ui.Muted("Todavía no hay teléfonos vinculados.", 13));
            foreach(var device in devices.EnumerateArray()) {
                string id = device.GetProperty("id").GetString()!;
                var row = new StackPanel { Orientation = Orientation.Horizontal, Spacing = 18 };
                row.Children.Add(Ui.Text(device.GetProperty("name").GetString() ?? "Android", 14));
                var revoke = new Button { Content = "Retirar acceso" };
                revoke.Click += async (_, _) => { await model.RunAsync(async () => { await model.Host.CallAsync<System.Text.Json.JsonElement>("revokeSyncDevice", new { id }); revoke.IsEnabled = false; revoke.Content = "Acceso retirado"; }); };
                row.Children.Add(revoke); content.Children.Add(row);
            }
            await new ContentDialog { Title = "Teléfonos vinculados", Content = content, CloseButtonText = "Cerrar", XamlRoot = Content.XamlRoot }.ShowAsync();
        })));
        library.Children.Add(SettingRow("Añadir música", "Los originales se conservan. Los FLAC tienen una versión AAC para el iPhone.", Ui.AsyncButton("Importar", model, ShowImportAsync)));
        library.Children.Add(SettingRow("Sesión del navegador", "Importa la cola, posición y preferencias que exportaste desde Openfy web.", Ui.AsyncButton("Importar sesión", model, ImportWebSessionAsync)));
        library.Children.Add(SettingRow("Exportar sesión", "Guarda la cola, la posición y la preferencia de movimiento de este equipo.", Ui.AsyncButton("Exportar sesión", model, async () => {
            var picker = new FileSavePicker { SuggestedFileName = "openfy-sesion" }; picker.FileTypeChoices.Add("JSON", new[] { ".json" }); WinRT.Interop.InitializeWithWindow.Initialize(picker, WindowsIntegration.Handle(this));
            var file = await picker.PickSaveFileAsync(); if (file == null) return;
            await model.ExportSessionAsync(file.Path);
        })));
        var appearance = SettingsSection("Reproducción y apariencia");
        var effects = new ToggleSwitch { IsOn = model.Settings.Effects, OffContent = "", OnContent = "", MinWidth = 48 }; Microsoft.UI.Xaml.Automation.AutomationProperties.SetName(effects, "Activar movimiento ambiental");
        effects.Toggled += (_, _) => { model.Settings.Effects = effects.IsOn; _ = model.RunAsync(model.PersistAsync); };
        appearance.Children.Add(SettingRow("Movimiento ambiental", "El reproductor ampliado toma sus colores de la portada. Respeta el movimiento reducido de Windows.", effects));
        var motionArt = new ToggleSwitch { IsOn = model.Settings.MotionArt, OffContent = "", OnContent = "", MinWidth = 48 }; Microsoft.UI.Xaml.Automation.AutomationProperties.SetName(motionArt, "Activar portadas animadas");
        motionArt.Toggled += (_, _) => { model.Settings.MotionArt = motionArt.IsOn; _ = model.RunAsync(model.PersistAsync); };
        appearance.Children.Add(SettingRow("Portadas animadas", "La pantalla completa muestra la portada en movimiento cuando el álbum tiene una.", motionArt));
        var transparency = new ComboBox
        {
            ItemsSource = new[] { "Predeterminado", "Activados", "Desactivados" },
            SelectedIndex = Array.IndexOf(TransparencyModes, model.Settings.Transparency)
        };
        Microsoft.UI.Xaml.Automation.AutomationProperties.SetName(transparency, TransparencyLabel);
        SelectionChangedEventHandler transparencyChanged = (_, _) => {
            if (transparency.SelectedIndex < 0) return;
            model.Settings.Transparency = TransparencyModes[transparency.SelectedIndex];
            UpdatePlaybackTransparency();
            _ = model.RunAsync(model.PersistAsync);
        };
        transparency.SelectionChanged += transparencyChanged;
        Ui.OnRelease(transparency, () => transparency.SelectionChanged -= transparencyChanged);
        appearance.Children.Add(SettingRow(TransparencyLabel, "El reproductor, la cola y las letras dejan ver el color de la página como cristal. Predeterminado sigue el ajuste de transparencia del sistema.", transparency));
        var limit = new ToggleSwitch { IsOn = model.Settings.Force24, OffContent = "", OnContent = "", MinWidth = 48 }; Microsoft.UI.Xaml.Automation.AutomationProperties.SetName(limit, "Forzar límite de 24 FPS");
        limit.Toggled += (_, _) => { model.Settings.Force24 = limit.IsOn; _ = model.RunAsync(model.PersistAsync); };
        appearance.Children.Add(SettingRow("Reducir los efectos a 24 FPS", "Con otra aplicación a pantalla completa, Openfy aplica este límite automáticamente.", limit));
        var compactLyrics = new ToggleSwitch { IsOn = model.Settings.CompactLyrics, OffContent = "", OnContent = "", MinWidth = 48 }; Microsoft.UI.Xaml.Automation.AutomationProperties.SetName(compactLyrics, "Letra en minirreproductor y widget");
        compactLyrics.Toggled += (_, _) => { model.Settings.CompactLyrics = compactLyrics.IsOn; _ = model.RunAsync(async () => { if (model.WantsLyrics && model.Lyrics == null) await model.LoadLyricsAsync(); else model.RefreshLyricsViews(); await model.PersistAsync(); }); };
        appearance.Children.Add(SettingRow("Letra en minirreproductor y widget", "Muestra el verso que suena cuando la canción tiene letra sincronizada.", compactLyrics));
        appearance.Children.Add(SettingRow("Minirreproductor", "Escucha desde una ventana pequeña que permanece visible sobre tus aplicaciones.", Ui.Button("Abrir mini", () => openPlayer("mini"))));
        appearance.Children.Add(SettingRow("Widget de escritorio", "Una ventana para tu música que puedes colocar y bloquear donde prefieras.", Ui.Button("Abrir widget", () => openPlayer("widget"))));
        ShortcutSettings();
        var conversions = SettingsSection("Preparando para tu iPhone");
        int pending = model.Library.Tracks.Count(track => track.Conversion != "ready");
        conversions.Children.Add(SettingRow("Versiones para el iPhone", pending == 0 ? "Tu colección está preparada." : pending + " canciones pendientes o en preparación.", Ui.AsyncButton("Reanudar / reintentar", model, async () => { await model.Api.SendAsync<System.Text.Json.JsonElement>("api/conversions", HttpMethod.Post); })));
        var diagnostics = SettingsSection("Aplicación para Windows");
        var discordToggle = new ToggleSwitch { IsOn = model.Settings.DiscordPresenceEnabled, OffContent = "", OnContent = "", MinWidth = 48 };
        Microsoft.UI.Xaml.Automation.AutomationProperties.SetName(discordToggle, "Mostrar lo que escucho en Discord");
        discordToggle.Toggled += (_, _) => _ = model.RunAsync(() => model.SetDiscordPresenceAsync(discordToggle.IsOn));
        diagnostics.Children.Add(SettingRow("Mostrar lo que escucho en Discord", "Comparte la canción, su portada y el progreso. Al pausar muestra «En pausa». Requiere Discord de escritorio.", discordToggle));
        var discordStatus = Ui.Muted(model.DiscordStatus, 12);
        diagnostics.Children.Add(discordStatus);
        System.ComponentModel.PropertyChangedEventHandler discordChanged = (_, args) => { if (args.PropertyName == nameof(model.DiscordStatus)) discordStatus.Text = model.DiscordStatus; };
        model.PropertyChanged += discordChanged;
        Ui.OnRelease(discordStatus, () => model.PropertyChanged -= discordChanged);
        var version = Openfy.Core.ReleaseInfo.Current;
        var updateStatus = Ui.Muted(model.Updates?.Status ?? $"Openfy {version.Version} · {version.Build}", 12);
        diagnostics.Children.Add(SettingRow("Actualizaciones", $"Versión {version.Version} · compilación {version.Build}", Ui.Row(Ui.AsyncButton("Novedades", model, ShowReleaseNotesHistoryAsync), Ui.Button("Buscar actualizaciones", async () => {
            if (model.Updates is { } updates) { await updates.CheckAsync(); updateStatus.Text = updates.Status; }
            else updateStatus.Text = "Disponible en la aplicación instalada.";
        }))));
        diagnostics.Children.Add(updateStatus);
        diagnostics.Children.Add(SettingRow("Conexión de la biblioteca", "Reinicia la conexión local si tu biblioteca no está disponible.", Ui.AsyncButton("Reconectar", model, model.RetryBackendAsync)));
        diagnostics.Children.Add(SettingRow("Diagnóstico", "Guarda un informe local sobre la reproducción y los efectos visuales.", Ui.AsyncButton("Exportar diagnóstico", model, ExportNativeDiagnosticsAsync)));
        diagnostics.Children.Add(Ui.Muted("Al cerrar la ventana, Openfy permanece en la bandeja. Usa Salir para cerrar la aplicación y el servidor del iPhone.", 12));
        foreach (string diagnostic in model.RenderDiagnostics()) diagnostics.Children.Add(Ui.Muted(diagnostic, 11));
    }
    private StackPanel SettingsSection(string title)
    {
        var panel = new StackPanel { Spacing = 0, Margin = new(0, 12, 0, 28) }; var heading = Ui.Text(title, 19, true); heading.Margin = new(0, 0, 0, 12); panel.Children.Add(heading); catalog.Children.Add(panel); return panel;
    }
    private static FrameworkElement SettingRow(string title, string description, FrameworkElement action)
    {
        var row = new Grid { Padding = new(0, 17, 0, 17), ColumnSpacing = 26, RowSpacing = 14, BorderBrush = Ui.Brush("#FFFFFF0D"), BorderThickness = new(0, 0, 0, 1) };
        row.ColumnDefinitions.Add(new() { Width = new(1, GridUnitType.Star) }); row.ColumnDefinitions.Add(new() { Width = GridLength.Auto }); row.RowDefinitions.Add(new() { Height = GridLength.Auto }); row.RowDefinitions.Add(new() { Height = GridLength.Auto });
        var text = new StackPanel { Spacing = 6, VerticalAlignment = VerticalAlignment.Center }; text.Children.Add(Ui.Text(title, 13, true)); var detail = Ui.Muted(description, 12); detail.LineHeight = 21; detail.MaxWidth = 450; detail.HorizontalAlignment = HorizontalAlignment.Left; text.Children.Add(detail); row.Children.Add(text);
        action.VerticalAlignment = VerticalAlignment.Center; action.HorizontalAlignment = HorizontalAlignment.Right; Grid.SetColumn(action, 1); row.Children.Add(action);
        SizeChangedEventHandler resize = (_, args) => { bool narrow = args.NewSize.Width < 530; Grid.SetColumn(action, narrow ? 0 : 1); Grid.SetRow(action, narrow ? 1 : 0); Grid.SetColumnSpan(text, narrow ? 2 : 1); action.HorizontalAlignment = narrow ? HorizontalAlignment.Left : HorizontalAlignment.Right; }; row.SizeChanged += resize; Ui.OnRelease(row, () => row.SizeChanged -= resize); return row;
    }
    private async Task ImportWebSessionAsync()
    {
        var picker = new FileOpenPicker(); picker.FileTypeFilter.Add(".json"); WinRT.Interop.InitializeWithWindow.Initialize(picker, WindowsIntegration.Handle(this)); var file = await picker.PickSingleFileAsync(); if (file != null) await model.ImportSessionAsync(file.Path);
    }
    private async Task ExportNativeDiagnosticsAsync()
    {
        var picker = new FileSavePicker { SuggestedFileName = "openfy-diagnostico" }; picker.FileTypeChoices.Add("JSON", new[] { ".json" }); WinRT.Interop.InitializeWithWindow.Initialize(picker, WindowsIntegration.Handle(this)); var file = await picker.PickSaveFileAsync(); if (file != null) await model.ExportDiagnosticsAsync(file.Path);
    }
}
