# Openfy nativo para Windows 11

La aplicación de `desktop/Openfy.slnx` usa .NET 10, WinUI 3, MVVM, NAudio/WASAPI y Direct3D 11. No contiene un navegador ni WebView. Node/Nitro sigue siendo el único propietario de SQLite y sirve la PWA del iPhone. Arranca automáticamente al abrir Openfy.

La interfaz comparte con la web la paleta, tipografía, navegación, portadas, héroes y proporciones del reproductor. Inicio, biblioteca por canciones/álbumes/artistas y Ajustes son páginas nativas; sidebar, reproductor y paneles usan acrílico con respaldo sólido. Consulta [criterios de fidelidad y revisión visual](native-design-parity.md).

## Instalación y uso

Ejecuta el archivo indicado por el campo `file` de `output/desktop/openfy-update.json`. Las siguientes compilaciones publicadas por `scripts/package-desktop.ps1` aparecen en la aplicación. **Actualizar y reiniciar** guarda la sesión y **Posponer** aplaza el reinicio automático dos horas. La instalación es por usuario en `%LOCALAPPDATA%\Programs\Openfy`, incluye los runtimes y crea un acceso en Inicio. No requiere Node, .NET ni Windows App SDK globales. El inicio automático con Windows está desactivado.

Cerrar la ventana principal la oculta en la bandeja. La música, el widget y el acceso del iPhone continúan. **Salir**, en el menú de la bandeja, guarda la sesión y cierra el audio, FFmpeg, SQLite y Node. La segunda apertura activa la instancia existente.

La navegación mantiene biblioteca, búsqueda local y de YouTube Music, artistas, álbumes, favoritos y playlists mixtas de archivos locales y referencias de YouTube Music. El menú contextual de una canción permite añadirla a una cola mixta, abrir artista/álbum y editar sus colecciones. Las playlists conservan sus revisiones; un conflicto se informa al usuario. Importar admite archivos o carpetas mediante selectores de Windows.

Minirreproductor, widget y fullscreen comparten una sesión. El mini permanece encima; el widget puede quedar detrás de otras aplicaciones y bloquearse. `Esc` cierra fullscreen y recupera la principal. Con letra sincronizada, fullscreen la muestra junto a la canción: portada grande y título a la izquierda, letra a la derecha y una barra inferior con posición, transporte y volumen; las ventanas estrechas usan el diseño apilado. Sin letra sincronizada (texto sin tiempos, instrumental, no encontrada o error) la portada, el título y los artistas quedan centrados sobre la misma barra (ver [Big Picture](big-picture.md#sin-letra-sincronizada)). Con la opción **Letra en minirreproductor y widget** (activa por defecto), el mini muestra el verso actual y el widget también el siguiente. Las posiciones se ajustan al área visible al restaurar una pantalla desconectada. En Ajustes se pueden desactivar efectos, forzar 24 FPS, reintentar el backend y exportar diagnóstico.

Las tres ventanas adicionales se crean una vez y se reutilizan durante la sesión. Cerrarlas las oculta y detiene su renderizado; **Salir** destruye sus superficies y ventanas. Así, las aperturas repetidas mantienen un número acotado de recursos de composición.

## Datos y compatibilidad

| Ruta | Contenido |
|---|---|
| `%LOCALAPPDATA%\Openfy\data` | Biblioteca SQLite v5, estadísticas de escucha, originales y versiones móviles existentes |
| `%LOCALAPPDATA%\Openfy\desktop` | Sesión pausada, preferencias y letras en JSON con escritura atómica |
| `%LOCALAPPDATA%\Openfy\configuration.env` | Puerto, origen Tailscale y ruta de datos para la instalación |
| `%LOCALAPPDATA%\Openfy\logs` | Registros de Node y errores nativos |

El empaquetado copia la `.env` existente a `configuration.env` únicamente si esta no existe. No distribuye tu configuración en el instalador. Mantén los valores de `NITRO_PORT`, `OPENFY_ORIGIN` y `OPENFY_DATA_DIR` de la instalación anterior. El servicio escucha exclusivamente en `127.0.0.1`; Tailscale conserva su origen HTTPS. La app no cambia el puerto automáticamente cuando está ocupado.

En la PWA de Windows, **Ajustes → Aplicación para Windows → Exportar** descarga cola y preferencias. Impórtalas desde Ajustes de la aplicación nativa. La sesión y las descargas del iPhone permanecen en ese dispositivo. Las rutas HTTP e identificadores existentes se conservan. SQLite migra a v5 y la PWA a IndexedDB v4, conservando biblioteca, snapshots y descargas.

## Comunicación y recuperación

El host crea una named pipe aleatoria con `PipeOptions.CurrentUserOnly`. El protocolo 1 intercambia JSON por líneas con identificadores de petición. Permite resolver archivos locales, importar rutas, preparar portadas, suscribirse a cambios y cerrar el backend. Las rutas absolutas no se añaden a las API HTTP.

Al conectar o recuperar la conexión se recarga la biblioteca y se anuncia de nuevo la actividad de reproducción. Los eventos con identificadores de pistas actualizan esas pistas; las invalidaciones generales recargan el catálogo. Las importaciones y conversiones despiertan el trabajador cuando hay trabajo; no existe el sondeo permanente anterior.

Un bloqueo `.openfy-library.lock` impide dos servidores sobre los mismos datos. Node y sus hijos pertenecen a un Job Object con terminación al cerrar su handle. El host espera el saludo y verifica su identificador mediante HTTP, con un máximo de 30 segundos. Una caída limpia el árbol y admite tres intentos con esperas de 1, 2 y 5 segundos; después ofrece reintento manual. El cierre dispone de cinco segundos para el backend antes de terminar los procesos propios restantes.

## Audio y gráficos

Los originales se abren directamente mediante la ruta de la pipe; AAC móvil sirve como respaldo. La red y la decodificación se ejecutan fuera del hilo de salida WASAPI compartida. El audio remoto usa HTTP con rangos, ocho bloques de 512 KiB y unos dos segundos de PCM. Las canciones de YouTube descargadas se abren como archivos locales, conservando su identidad y estadísticas. Consulta [descargas y actualización automática de playlists](downloads.md).

Algunas respuestas de YouTube son AAC en MP4 fragmentado. `FragmentedMp4Stream` reconstruye las tablas de muestras y expone un M4A virtual seekable a Media Foundation. Conserva los bytes AAC originales y mantiene únicamente metadatos y el caché limitado de rangos. Esto corrige la finalización prematura que se reprodujo con “Bad Romance”. La fuente MPEG-4 de Windows y sus limitaciones están descritas en [Microsoft Learn](https://learn.microsoft.com/en-us/windows/win32/medfound/mpeg-4-file-source).

El proxy renueva una vez la URL ante fallos de conexión y rechazos HTTP temporales, también al pedir un fragmento posterior. Los timeouts de cabeceras y esperas de nuevos bytes son de 15 segundos y no corren mientras la contrapresión detiene la lectura. Los registros incluyen códigos de red sin URLs firmadas. YouTube sigue siendo un proveedor externo: restricciones de una pista o cambios del servicio pueden impedir reproducirla.

Un único analizador FFT de 2048 muestras publica hasta 30 actualizaciones por segundo, con historial alineado al reloj audible. Cada vista interpola la señal y presenta mediante una superficie DXGI; el dispositivo Direct3D es compartido. El fondo limita su resolución interna a 1280×720. El objetivo corresponde a los Hz activos del monitor, con VSync y temporizador de alta resolución para limitar la entrega de frames. Otra aplicación fullscreen/borderless en cualquier monitor aplica 24 FPS globales; se usan eventos de ventanas y comprobaciones periódicas. Openfy se excluye por proceso. Tras desaparecer la condición se mantiene un margen de dos segundos.

Ocultar/minimizar, bloquear la sesión o pausar detiene el renderizado continuo. Movimiento reducido y efectos desactivados dejan un fondo estático. El analizador se desactiva cuando no hay vistas reactivas visibles. El diagnóstico muestra monitor, Hz, objetivo, FPS medidos y causa del límite.

El fondo muestrea la portada preparada (64×64 BGRA, con mipmaps) y la funde con la anterior al cambiar de pista. La marca palabra por palabra lee el reloj audible en cada frame (`CompositionTarget.Rendering`), solo mientras suena un verso con tiempos por palabra en una vista visible. `--visual-players <dir> --visual-fixtures <dir>` captura fullscreen (portada, letras y apilado), mini y widget, con el fondo Direct3D compuesto bajo la capa XAML.

## Desarrollo y distribución

```powershell
.\scripts\setup-desktop.ps1
.\scripts\start-desktop.ps1
.\scripts\package-desktop.ps1
```

El SDK privado queda en `%LOCALAPPDATA%\Openfy\development\dotnet`. El empaquetado publica el cliente autocontenido y reúne Node, backend compilado, FFmpeg, SQLite/Sharp nativos, QuickJS WASM y avisos de terceros. Los temporales nativos viven en `%TEMP%\Openfy\builds`; los temporales web permanecen en el volumen del workspace por compatibilidad con Nuxt. Ambos se retiran al terminar. `output/desktop` conserva el instalador actual, su manifiesto y los informes pequeños. El instalador es código del repositorio (`desktop/Openfy.Setup`), sin depender de un compilador de instaladores externo.

Al publicar en el canal local habitual, el script actualiza la instalación existente: conserva los logs de sesión, solicita un cierre ordenado, ejecuta el instalador y comprueba que el backend anuncie la compilación nueva. Después elimina los empaquetados anteriores y los instaladores obsoletos. El instalador conserva la versión anterior durante la transacción y la retira al validar la nueva; mantiene hasta tres respaldos completados de SQLite y estado. La desinstalación elimina únicamente la instalación identificada, accesos y registro por usuario; conserva `%LOCALAPPDATA%\Openfy` y sus datos.

Para generar un paquete de prueba sin actualizar la instalación personal, utiliza `-FeedRoot <canal-aislado> -NoInstall`. `scripts/cleanup-builds.ps1` muestra el plan de limpieza; `-Apply` lo aplica y `-IncludeLegacyTests` incluye los entornos grandes de pruebas anteriores. La limpieza verifica el SHA-256 del instalador actual y omite carpetas activas o que contengan enlaces/junctions. Consulta [rendimiento y mantenimiento de compilaciones](performance-and-builds.md).

## Verificación reproducible

```powershell
npm test
npm run typecheck
npm run test:e2e
& "$env:LOCALAPPDATA\Openfy\development\dotnet\dotnet.exe" test desktop/Openfy.Tests -c Release
& "$env:LOCALAPPDATA\Openfy\development\dotnet\dotnet.exe" test desktop/Openfy.Audio.Tests -c Release
.\scripts\measure-desktop.ps1 -Runs 3 -Seconds 12
```

Las pruebas del host y audio necesitan Windows, una salida de audio y el backend de producción compilado. Utilizan carpetas temporales. Para pruebas de interfaz sin tocar la biblioteca real, el ejecutable admite `--data-dir`, `--state-dir` y `--port`. `--smoke-test <archivo>` importa una muestra local, comprueba audio, letras, recuperación de Node y gráficos, escribe `native-smoke.json` y sale. `--youtube-test J2kPH11Z4cM` prueba la pista remota real, seek y pausa, escribe `youtube-smoke.json` y sale. Las pruebas de audio silencian su propia sesión.

`scripts/check-youtube-playback.mjs <origen> <id>` comprueba reproducción y seek reales en Chromium, sin escribir audio. Los resultados van a `output/playwright/youtube-real.json`. Las fixtures no sustituyen esta comprobación.

Consulta [la validación de Windows](windows-validation.md) para los resultados medidos y las verificaciones físicas pendientes.
