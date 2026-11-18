# Openfy → Discord: implementación de Rich Presence

Actualizado el 15 de noviembre de 2026, America/Mexico_City.

## Estado y alcance

Implementado para el cliente nativo de Windows. Discord muestra una actividad `Listening` con canción, artista/álbum, portada y timestamps de reproducción. La función está **encendida por defecto**, recuerda la elección del usuario y puede desactivarse en Ajustes → Aplicación para Windows → Mostrar lo que escucho en Discord.

Se usa la aplicación **Openfy**, ID público **1571729156608229426**, registrada en el [Developer Portal](https://discord.com/developers/applications/1571729156608229426/rich-presence/assets). El recurso gráfico de respaldo es `openfy`, cargado desde `desktop/Openfy.Windows/Assets/Openfy.png`. El ID no es una credencial. No se usan bots, tokens del usuario, OAuth ni infraestructura pública de Openfy.

Discord debe estar abierto en el mismo equipo y el usuario debe permitir compartir su actividad. El estado «Conectado» confirma IPC local, no que otro usuario vea la tarjeta. Web/PWA, iPhone, conexión de cuentas y escucha sincronizada quedan fuera de esta entrega. La tarjeta y los controles específicos de Spotify pertenecen a otra integración.

Referencias oficiales: [SET_ACTIVITY y Listening](https://docs.discord.com/developers/topics/rpc#set-activity), [barra temporal](https://docs.discord.com/developers/events/gateway-events#activity-object), [Rich Presence sin autenticación](https://docs.discord.com/developers/discord-social-sdk/development-guides/setting-rich-presence#rich-presence-without-authentication), [recursos gráficos](https://docs.discord.com/developers/discord-social-sdk/development-guides/setting-rich-presence#uploading-assets).

## Arquitectura

```text
AudioEngine: snapshot con generación, secuencia, estado y reloj audible
    ↓ eventos capturados antes de enviarlos al hilo de interfaz
MainViewModel: metadatos coherentes de esa selección
    ↓ buzón con un único estado pendiente
DiscordPresenceService: trabajador independiente de audio y ventanas
    ↓ DiscordPresenceSession: agrupación, deduplicación y reconexión
DiscordRpcTransport: DiscordRichPresence 1.6.1.70
    ↓ named pipe local
Discord de escritorio
```

- `desktop/Openfy.Core/DiscordPresence.cs` contiene los snapshots inmutables, la política de presentación, el contrato del transporte y el servicio. La sesión admite un reloj y un transporte simulados.
- `desktop/Openfy.Windows/ViewModels/MainViewModel.Discord.cs` integra las selecciones, los cambios del motor y la preferencia. Rechaza eventos antiguos, incluidas finalizaciones pendientes después de otra selección. Una cola restaurada no se publica hasta iniciar reproducción en esa sesión.
- `desktop/Openfy.Windows/Services/DiscordRpcTransport.cs` encapsula [DiscordRichPresence 1.6.1.70](https://www.nuget.org/packages/DiscordRichPresence/1.6.1.70). Sus eventos se bombean desde el trabajador. La caché de presencia se actualiza también sin conexión **antes** de procesar `READY`, porque la biblioteca la reenvía automáticamente al reconectar.

El adaptador normaliza las claves de imagen opcionales que Discord omite en algunas respuestas: la versión fijada de la biblioteca puede lanzar una excepción al fusionarlas. Un ID numérico `0` actúa como marcador local de ausencia y nunca se envía como recurso. También restaura la caché vigente después de procesar ACKs tardíos, sin reenviar actualizaciones en cada tick.

El servicio agrupa cambios durante 250 ms y no publica cada tick de posición. La carga y los estados terminales retiran la actividad. Sigue activo al cerrar a bandeja y se limpia/libera antes de detener el motor al salir. Los errores de RPC se contienen; los errores de creación o publicación se reintentan con una espera de 15 segundos. Desactivar destruye el transporte y sus reintentos; reactivar crea uno nuevo con el estado vigente.

Los modos automatizados existentes no inicializan RPC. El modo `--discord-test` usa un transporte simulado; únicamente `--discord-live-test`, solicitado explícitamente con el script de verificación, contacta a Discord real.

## Comportamiento y datos

| Situación | Actividad |
|---|---|
| Reproduciendo | Canción, artista/álbum, portada y progreso |
| Pausa del usuario | Misma canción, «En pausa», sin timestamps |
| Buffering menor de 2 segundos | Se conserva temporalmente la actividad anterior |
| Buffering desde 2 segundos | «Cargando…», sin timestamps |
| Recuperación, reanudación o seek completado | Timestamps recalculados desde la posición audible |
| Carga de otra selección, error, fin de cola | Actividad retirada |
| Ajuste apagado o salida real | Actividad retirada y conexión destruida |

Inicio = hora UTC de captura − posición; fin = inicio + duración. El adaptador usa `DateTime` UTC y la biblioteca serializa milisegundos Unix. Con duración inválida/desconocida se omiten ambos timestamps.

Para el catálogo se conserva la URL original de `PlaybackEntry.Song.Artwork`, con respaldo en los metadatos del tema guardado. No se usan `Cover`, las rutas de `StoredYouTubeAudio.Artwork` ni `SongRow.Artwork`, que pueden señalar archivos locales después de una descarga. Música local y URLs no aptas usan `openfy`.

Solo se admiten URLs HTTPS de metadatos de catálogo, de hasta 256 caracteres, sin credenciales, query ni fragmento; se rechazan localhost, IPs y sufijos locales conocidos. Esta política conservadora puede usar el logo para algunas URLs públicas. No se sirven ni suben imágenes personales. Ante un rechazo de imagen identificado por RPC se reintenta con el logo; una confirmación RPC no demuestra que Discord descargó o renderizó una imagen externa.

Los textos se limitan a 128 unidades UTF-16 conservando grafemas completos. El estado de ajustes puede ser Desactivado, Esperando Discord, Conectado o Error de conexión. `DesktopSettings.DiscordPresenceEnabled` vale `true` si no existe en un archivo antiguo; un `false` guardado se conserva.

Los eventos de diagnóstico están documentados en [session-diagnostics.md](session-diagnostics.md). No se registran payloads, cuenta de Discord, tokens, metadatos musicales ni URLs de portadas.

## Verificación reproducible

```powershell
$sdk = "$env:LOCALAPPDATA/Openfy/development/dotnet/dotnet.exe"
& $sdk test desktop/Openfy.Tests/Openfy.Tests.csproj -c Release
& $sdk test desktop/Openfy.Audio.Tests/Openfy.Audio.Tests.csproj -c Release
& $sdk build desktop/Openfy.Windows/Openfy.Windows.csproj -c Release

# No publica nada en Discord; biblioteca y estado sintéticos aislados.
.\scripts\check-discord-presence.ps1

# Publica temporalmente «Openfy - Prueba de Discord» en el Discord abierto.
# Comprueba la confirmación RPC de Listening, pausa y reanudación.
.\scripts\check-discord-presence.ps1 -Live

# Para un ejecutable publicado con su backend:
.\scripts\check-discord-presence.ps1 -Executable <Openfy.exe> -Packaged

# Paquete de prueba y canal aislados; no actualiza la instalación habitual.
.\scripts\package-desktop.ps1 -FeedRoot E:\openfy\output\discord-presence\feed -OutputDirectory E:\openfy\output\discord-presence\package -NoInstall
```

El script de comprobación genera un audio sintético silenciado y un puerto libre. Conserva `discord-smoke.json` y los logs bajo su propio directorio de informes. Valida cola restaurada, reproducción, pausa, seek pausado, reanudación, fin de cola, desactivación con publicación pendiente, reactivación y cierre.

Las pruebas de lógica cubren también reconexión sin repetir una canción anterior, buffering, generaciones/secuencias obsoletas, duración desconocida, Unicode, portadas de canciones descargadas y fallos no fatales. Las pruebas WASAPI comprueban pausa frente a fin/error y aperturas obsoletas.

La presentación desde **otra cuenta**, las imágenes externas y la prioridad frente a Spotify siguen necesitando observación manual. No se debe confundir un envío/ACK correcto con esa aceptación visual.

Para aplicar cambios a la instalación habitual se usa el flujo normal de `scripts/package-desktop.ps1` y se confirma la compilación del backend instalado, según [performance-and-builds.md](performance-and-builds.md). `npm run build` solo genera la salida del repositorio y no actualiza la instalación de Windows.

## Resultado de esta entrega

- Compilación nativa .NET 10 correcta, sin advertencias ni errores.
- 83 pruebas de lógica y 17 de audio/adaptador correctas (100 en total).
- Flujo nativo simulado correcto. Discord real confirmó Listening con timestamps, pausa sin timestamps y reanudación.
- Instalador 0.4.0+1794801156 generado con feed y salida aislados; pasó arranque y verificación de hash.
- Instalación de laboratorio desde ese instalador, con backend propio, comprobada con Discord real. Informe: `output/discord-presence/packaged-qa/discord-live/state/discord-smoke.json`.
- No se actualizó la instalación habitual del usuario. La aceptación visual desde otra cuenta permanece pendiente.
