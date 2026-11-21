# Auditoría de memoria y rendimiento — Windows, backend y Android

Auditoría del 19 de noviembre de 2026, zona America/Mexico_City. Solo diagnóstico: no se modificó código del producto. Se auditó el árbol de trabajo de `dev` tal como estaba, con muchos cambios Android y de reproductor sin commit.

Participaron tres revisores. Gemini (`agy`, `gemini-3.8-flash-high`) hizo los barridos estáticos de Windows, Android y backend. GPT (Codex, una sola llamada) revisó de forma adversarial la lista final de candidatos. Claude leyó el código de riesgo, ejecutó todas las mediciones y verificó cada punto. Ningún hallazgo figura aquí sin haber comprobado el código citado.

## Resumen

El código ya libera con cuidado los recursos caros: swap chain y texturas Direct3D, WASAPI y Media Foundation en cada pista, ExoPlayer de las portadas animadas y el motor del fondo animado. Las pruebas de resistencia no mostraron crecimiento en Activities, contextos, descriptores, objetos GDI/USER ni hilos. Hay **una fuga real** en Windows, y el resto del coste es trabajo periódico que escala con el historial o con el hardware:

1. **Windows: la pantalla completa dibuja el fondo a la frecuencia del monitor, sin tope.** En este PC (239 Hz) cuesta un 35,7 % de un núcleo frente al 2,6 % con la ventana principal; la app instalada promedió un 24 % durante 15 minutos en pantalla completa. Android ya lo limita a 30 FPS. *Confirmado (medido).*
2. **Windows: cada apertura del panel Cola filtra el `ListView` anterior.** Se crea uno nuevo enlazado a `model.Upcoming`, una colección que vive toda la sesión, y nunca se desconecta. Alternar el panel deja unos 0,4 MB y 2 handles por apertura que no se recuperan; combinado con cambios de pista, la memoria privada subió 110 MB en 8 minutos. *Confirmado (medido dos veces y causa en el código).*
3. **Android: la escucha se escribe en Room cada segundo y cada escritura vuelve a leer dos veces la tabla `listening` completa**, también en segundo plano y con la pantalla apagada. Cada lectura recompone la raíz de la interfaz y recalcula estadísticas, filtros y orden sobre todo el historial. *Confirmado (medido).*
4. **Windows y backend: cada envío de escucha (cada ~10 s sonando) dispara 3 consultas de telemetría que recorren todo el historial.** Con un año de historial sintético, `/api/telemetry/recent` tarda 116 ms síncronos y cada par de consultas deja ~2 MB de basura en Node. *Confirmado (medido).*
5. **Windows: `playback.json` (282 KB en la instalación real) y `settings.json` se reescriben cada 2,5 s mientras suena música.** Cada escritura crea un string de más de 85 KB en el Large Object Heap. *Confirmado (medido en la instalación, solo metadatos del archivo).*

También es relevante el punto N2: un PWA que iOS cierra mientras reproduce queda registrado como «reproduciendo» para siempre. Eso pausa las conversiones FLAC→AAC y bloquea la preparación de actualizaciones.

## Correcciones aplicadas (19–20 de noviembre)

Se corrigió todo salvo W1 (frecuencia del fondo de la pantalla completa), que el propietario pidió no tocar, y W8 (barrido por palabra a cada fotograma), que pertenece a la misma cadencia de render de la pantalla completa. El trabajo se repartió así: Claude hizo Windows (W2–W7) y revisó todos los diffs; Gemini hizo Android (A1–A6) y el backend (N2–N7); GPT hizo N1.

| # | Qué se cambió | Verificación |
|---|---|---|
| W2 | La vista de Cola se crea una sola vez y se reutiliza (`MainWindow.Queue.cs`, `MainWindow.cs`). Primero se probó a desconectar `ItemsSource` al cerrar, como en las otras listas: la fuga siguió igual (+8,9 y +10,2 MB en dos rondas con un driver que no retiene referencias de UI Automation), así que la retención no venía solo de esa suscripción. | Medido con la vista reutilizada, mismo protocolo (60 pulsaciones por ronda, driver que fuerza GC en el cliente): +1,8 y −1,6 MB, frente a +8,9 y +10,2 MB antes. Los handles siguen subiendo despacio (~+180 en 15 min) en todas las fases, también con Letras: queda como observación abierta, no atribuible a la Cola. |
| W3 | `AtomicStore` serializa directamente a `FileStream` (sin string en el LOH). El punto de control periódico pasa de 2,5 a 10 s y se omite si la cola, el índice, la posición, la repetición, el aleatorio y el volumen no cambiaron; los cambios de transporte siguen guardando al momento. `settings.json` solo se escribe si su contenido cambió. | `Openfy.Tests` 101/101. |
| W4 | `telemetryChanged` se agrupa: como mucho un refresco de estadísticas por minuto (`MainViewModel.Listening.cs`). La parte de biblioteca de `HomeContentKey()` se memoriza por instantánea de `model.Library`. | Compilación y pruebas. |
| W5 | Al cerrar un reproductor, `ReactiveSurface.Suspend()` detiene el temporizador de política y quita los ganchos WinEvent; la ventana deja de reconstruir letras y portada mientras está oculta y se pone al día en `ShowView`. No cambia la política de FPS. | Compilación y pruebas; no se midió de nuevo. |
| W6 | Cada `MediaSource` de la portada animada se libera al sustituirla o soltarla. | Compilación. |
| W7 | El bucle de Discord espera un semáforo mientras está desactivado en lugar de despertar cada 50 ms. | Compilación y pruebas. |
| Latido | La app de Windows informa su actividad cada 30 s mientras suena, necesario para la caducidad de clientes de N2. | — |
| N1 | `recentlyPlayed()` lee la biblioteca y las sesiones una vez y solo comprueba en disco los archivos que necesitan las tarjetas elegidas (`telemetry.ts`, `library.ts`). | Vitest 258/258; pruebas nuevas de equivalencia y de lecturas únicas. |
| N2 | Los clientes de actividad caducan tras 90 s sin informe y se despiertan los workers al soltar uno que reproducía; el beacon de cierre del PWA se envía también reproduciendo. Gemini había sustituido el latido de 10 s del PWA por otro de 30 s solo durante la reproducción; se restauró el de 10 s, porque los PWA en reposo deben seguir confirmando las actualizaciones. | Vitest; `update-maintenance.test.ts` y `workers-and-backfill.test.ts`. |
| N3 | LRU de 200 artistas y 200 listas de álbumes en `ITunesGenres`. | Vitest. |
| N4 | El relleno de letras recorre una consulta con `LEFT JOIN` de forma perezosa y se detiene en el primer candidato. | Vitest. |
| N5 | `nextSong()` filtra con `json_type(song, '$.genres') IS NOT 'array'` y `LIMIT 1`. | Vitest. |
| N6 | `latestSignatures` se borra al terminar la resolución si conserva la misma intención; `retries` se poda. | Vitest. |
| N7 | El progreso de FFmpeg solo escribe y notifica cuando cambia el porcentaje. | Vitest. |
| A1 | La escucha se acumula en memoria y se escribe como mucho cada 15 s, al pausar, al cambiar de pista o saltar, al calificar una reproducción y al cerrar el servicio. Los flujos de biblioteca, recomendaciones y lanzamientos usan `WhileSubscribed(5_000)`. Caché de géneros en `Filters.apply` y memorización en `OpenfyApp`. | Medido en el emulador: lecturas completas de `listening` cada 30 s, de ~60 a 2 en primer plano, 1 en segundo plano y 0 con la pantalla apagada; una escritura cada ~15 s. 27/27 pruebas unitarias Android. |
| A2 | La instantánea de la cola se omite si nada cambió y reutiliza los contextos ya parseados. | Pruebas unitarias. |
| A3 | El token de Apple se busca por bloques de 16 KiB con solape y se detiene al encontrarlo. | Prueba unitaria de token partido entre bloques. |
| A4 | Tope de 2 000 resultados de portadas animadas, conservando los que están en uso. | Pruebas unitarias. |
| A5 | `returned` se limpia en `finally`. | Compilación. |
| A6 | El fondo animado reutiliza `Outline`, rectángulos y la clave de fotograma. | Compilación. |

Pendiente: probar en un teléfono físico y en la app de Windows instalada (requiere `scripts/package-desktop.ps1`). Las correcciones de Windows, backend y PWA están en un commit de `dev`. Las de Android (A1–A6) quedan sin commit porque modifican archivos que también contienen trabajo de Android aún sin commit (fondo animado, reproductor), y deben ir con él.

## Método

| Plataforma | Qué se ejecutó | Aislamiento |
|---|---|---|
| Windows instalado | Muestreo pasivo cada 10 s durante 15 min de `Openfy.exe` y su Node: memoria privada, working set, handles, GDI/USER, hilos y CPU. La app estaba en «Pantalla completa». | Solo lectura de contadores del proceso y de la fecha y el tamaño de `playback.json`. |
| Windows (build del árbol) | `Openfy.exe --workspace` Release con `--data-dir`/`--state-dir` temporales, puerto 4191, `OPENFY_MOTION_ART=off` y 10 pistas sintéticas de 40 s, en repetición de cola. Manejado con UI Automation: 2 min en reposo, 8 min saltando pista cada 3 s, 8 min abriendo y cerrando mini, widget y pantalla completa, 8 min navegando entre seis secciones, 8 min alternando Letras y Cola con salto de pista y 3 min en reposo. Después, dos rondas de 3 min de solo Cola y dos de solo Letras, y sondas de CPU de 45 s. Muestreo cada 5 s. | Biblioteca y estado en `%TEMP%\openfy-soak`. |
| Backend Node | Servidor del paquete instalado (0.5.4, con el mismo código de telemetría que `dev`) con `OPENFY_DATA_DIR` temporal en el puerto 4193. Se sembraron 15 000 sesiones sintéticas (1 500 canciones en 365 días) por la API pública y se midieron `recent`/`stats` y la memoria tras 100 pares de consultas. | Biblioteca en `%TEMP%\openfy-node-scale`. |
| Android | Paquete debug `app.openfy.android.debug` en el emulador `Medium_Phone_API_37.0`. Registro de sentencias SQLite (`log.tag.SQLiteStatements`), CPU desde `/proc`, `dumpsys meminfo` y `gfxinfo`. 12 min de ciclos: saltar pista, abrir el reproductor, cerrarlo y recorrer las cuatro pestañas (48 ciclos). Para medir el escalado, la tabla `listening` del paquete debug se amplió a 14 605 filas sintéticas y luego se restauró. | Datos del paquete debug del emulador. |

Durante los escenarios de Windows, UI Automation recorre el árbol de controles de Openfy en cada acción. Su CPU y algo de memoria se suman a las de la app, así que esas cifras solo sirven para comparar fases entre sí. Alternar Letras, que también crea y destruye controles, sirve de control frente a la Cola.

## Windows nativo

| # | Hallazgo | Código | Evidencia | Severidad | Corrección recomendada | Esfuerzo |
|---|---|---|---|---|---|---|
| W1 | El fondo de la pantalla completa se dibuja a la frecuencia del monitor | `Openfy.Core/AtomicStore.cs:35-37` (`RenderPolicy.Target`), `Graphics/ReactiveSurface.cs:186-222` | Medido en la sesión aislada, sonando y sin letras: 35,7 % de un núcleo con la pantalla completa abierta frente a 2,6 % cerrada. El monitor va a 239 Hz y `Target` devuelve esa frecuencia, salvo que esté activo el límite de 24 FPS o haya otra app a pantalla completa. La instalación real gastó 215 s de CPU en 890 s (~24 %) en pantalla completa. | Alta | Limitar el objetivo a 60 FPS (o 30, como Android) aunque el monitor sea más rápido; el fondo es un degradado lento y no gana nada por encima de eso. | Bajo |
| W2 | Cada apertura del panel Cola filtra el `ListView` anterior | `Views/MainWindow.Queue.cs:16-17,70`, `Views/MainWindow.cs:69-80` | Medido dos veces: 59 y 58 pulsaciones (~29 aperturas cada vez) dejaron +13,1 y +9,4 MB y +59/+45 handles, sin recuperación en reposo. Las mismas pulsaciones sobre Letras dejaron +4,2 y +4,4 MB sin crecer en handles. Con salto de pista en cada ciclo, la fase combinada subió de 234 a 344 MB en 8 min y no bajó en 3 min de reposo. En el código, `ItemsSource = model.Upcoming` nunca se pone a `null`; las demás listas enlazadas al modelo (`MainWindow.Cards.cs:44`, `MainWindow.Downloads.cs:81`, `MainWindow.TrackLists.cs:40`) sí lo hacen en `Ui.OnRelease`. | Alta | Registrar `Ui.OnRelease(rows, () => rows.ItemsSource = null)` igual que en las otras listas, o conservar una sola vista de cola y mostrarla u ocultarla. | Bajo |
| W3 | Cola y ajustes se reescriben cada 2,5 s mientras suena música | `ViewModels/MainViewModel.cs:614-621`, `Openfy.Core/AtomicStore.cs:16-27` | Medido: el `playback.json` de la instalación real pesa 282 KB y su fecha cambia cada 2,5–5 s durante la reproducción. Serializar a string supera el umbral de 85 KB del LOH en cada escritura. | Media | Guardar la posición en un archivo pequeño con esa frecuencia y la cola completa solo cuando cambie (por revisión o firma). Serializar directamente a `FileStream`. Escribir `settings.json` solo cuando cambie. | Bajo |
| W4 | Cascada de telemetría cada ~10 s | `ViewModels/MainViewModel.cs:165`, `ViewModels/MainViewModel.Listening.cs:43-60`, `server/api/telemetry/listening.post.ts:7`, `Views/MainWindow.Home.cs:17-25` | Medido: en la sesión aislada, 52 POST de escucha produjeron 53 GET de `recent` y 106 de `stats`. En Inicio, `HomeContentKey()` concatena toda la biblioteca en un string en cada refresco. Con «Más reproducidas» abierta se añade una cuarta consulta (aportado por GPT). | Media | Emitir `telemetryChanged` solo cuando cambie algo visible (una canción calificada o un contexto reciente nuevo) o como mucho cada 60 s. Calcular la firma de Inicio con revisiones en lugar de concatenar la biblioteca. | Bajo |
| W5 | Los reproductores cerrados siguen suscritos | `Views/PlayerWindow.cs:357,397-403,409-457`, `App.xaml.cs:183-205`, `Graphics/ReactiveSurface.cs:110-124`, `Services/WindowsIntegration.cs:27-33,114-134` | En el código, `Close()` solo oculta la ventana. Siguen activos `ArtworkChanged`, `LyricsChanged` (la pantalla completa reconstruye todas las filas de letra en cada canción), `PropertyChanged`, el temporizador de política de 1 s con `EnumWindows` y los ganchos WinEvent globales; el bucle de render sí se detiene. Medido: con los tres reproductores ocultos, una tormenta de ~60 movimientos de ventana por segundo solo subió la CPU de 2,6 % a 3,6 %. | Baja | Al ocultar, detener `policyTimer`, llamar a `UnwatchPresentation` y desuscribir letras y posición; reconstruir al volver a mostrar (`ShowView`). | Medio |
| W6 | `MediaSource` de la portada animada sin `Dispose` explícito | `Views/PlayerWindow.Motion.cs:124,141,212` | En el código, se asigna `Source = null` y la liberación nativa queda al finalizador. No se midió: motion art estaba desactivado en las pruebas. | Baja | Conservar la referencia y llamar a `Dispose()` al cambiar o soltar la fuente. | Bajo |
| W7 | Bucle de Discord a 20 Hz aunque esté desactivado | `Openfy.Core/DiscordPresence.cs:166-175` | En el código, despierta cada 50 ms y vuelve enseguida cuando está apagado. La CPU es despreciable; solo son despertares. | Baja | Esperar en un `Channel` o semáforo hasta que llegue un snapshot o se active. | Bajo |
| W8 | Barrido por palabra en cada fotograma | `Views/PlayerWindow.cs:534-542` | En el código, con letras sincronizadas por palabra se engancha a `CompositionTarget.Rendering`, que obliga a XAML a componer cada fotograma (239 por segundo en este monitor), además de W1. No se midió porque las pistas sintéticas no tienen letra. | Media | Animar el relleno con una animación de composición o con un temporizador de 30–60 Hz. | Medio |

Navegación: 162 cambios de sección subieron la memoria de 200 a 232 MB. Los primeros 1,5 min aportaron +15 MB y después la subida bajó a 2–3 MB/min. No se repitió la prueba, así que queda como **no concluyente**. Con 16 minutos solo reproduciendo y el panel de letras abierto se vio una subida parecida (+22 MB), que puede ser la telemetría de W4 o recolección diferida.

Descartados en Windows tras verificarlos: las cachés `ArtworkService.ready` y `MotionKnown` no tienen límite, pero guardan rutas y paletas de pocos bytes; la caché de bitmaps de `Ui.Cover` está acotada a 64 MB; `AudioEngine` libera decodificador, red, WASAPI y token en cada pista (147 saltos subieron la memoria +18 MB y se estabilizó); `ReactiveSurface.Dispose` libera todo y el render espera mientras la ventana está oculta. Mini, widget y pantalla completa abiertos y cerrados 81 veces subieron la memoria +8 MB, sin tendencia clara.

## Backend Node (corre dentro de la app de Windows)

| # | Hallazgo | Código | Evidencia | Severidad | Corrección recomendada | Esfuerzo |
|---|---|---|---|---|---|---|
| N1 | `recent` y `stats` recorren todo el historial | `server/utils/telemetry.ts:84-131`, `server/utils/library.ts:16-20` | Medido con 15 000 sesiones: la mediana de `recent` pasó de 5 ms a 116 ms (síncrono, bloquea el event loop); `stats?period=all` tardó 14,5 ms y devolvió 127 KB. 100 pares de consultas subieron la memoria privada de 75 a 279 MB, que volvió a 77 MB en reposo: es basura transitoria, no fuga, y explica el pico de 377 MB del Node instalado. En el código, `recentlyPlayed()` lee todas las sesiones dos veces y llama dos veces a `readLibrary()`, que hace `statSync` de cada descarga. `listening_sessions` nunca se poda. | Media | Mantener un agregado de recientes por contexto que se actualice en `ingestListening`, leer la biblioteca una vez por petición y cachear la verificación de archivos por revisión de la biblioteca. | Medio |
| N2 | Un cliente «reproduciendo» nunca caduca | `server/utils/workers.ts:25-34`, `server/utils/update-maintenance.ts:9-24`, `server/api/activity.post.ts`, `app/stores/player.ts:57,529` | En el código no hay TTL. El PWA crea un `activityId` nuevo en cada carga y solo envía el beacon de cierre cuando **no** está reproduciendo; iOS suele matar el PWA en segundo plano mientras suena. Las conversiones siguen pausadas hasta `POST /api/conversions` (reintento manual, según GPT) y la preparación de actualizaciones sigue bloqueada hasta reiniciar Node. | Media | Caducar los clientes sin latido en ~60 s (con un barrido en `conversionPaused()`/`updateReadiness()`) y enviar el beacon de cierre también durante la reproducción. | Bajo |
| N3 | Caché de iTunes sin límite | `server/utils/youtube-metadata.ts:34-76,110` | En el código, guarda para siempre cada búsqueda de artista y cada lista de hasta 200 álbumes; solo borra los fallos. Crece con el número de artistas distintos completados. | Media | LRU acotada (por ejemplo, 200 artistas) o soltar las promesas resueltas al terminar cada canción. | Bajo |
| N4 | El relleno de letras recorre toda la tabla en cada paso | `server/utils/downloaded-lyrics.ts:18-44` | En el código, cada paso carga todas las letras (en JSON) y la unión completa de descargas para elegir una sola. Se repite cada 1 s mientras hay trabajo y cada 60 s en reposo. | Media | Consultar solo las descargas sin letra válida, con un índice o una columna de estado. | Medio |
| N5 | El relleno de metadatos decodifica todas las canciones guardadas | `server/utils/youtube-metadata.ts:114-123`, `server/utils/workers.ts:155-166` | En el código (aportado por GPT y verificado), `nextSong()` carga y decodifica todas las canciones para encontrar una sin completar, también en cada programación del worker. | Baja | Consulta filtrada, como en N4. | Bajo |
| N6 | Mapas que solo crecen | `server/utils/lyrics.ts:50,60`, `server/utils/downloaded-lyrics.ts:12` | En el código, guardan una entrada por canción distinta (≈0,5–1 KB y unos pocos bytes, respectivamente). | Baja | Borrar la firma al terminar la resolución y podar los reintentos vencidos. | Bajo |
| N7 | El progreso de FFmpeg escribe en SQLite a ~2 Hz | `server/utils/workers.ts:54-65` | En el código, escribe y notifica aunque el porcentaje no cambie. | Baja | Escribir solo cuando cambie el porcentaje. | Bajo |

Descartados en el backend: el proxy de streaming cancela la petición a YouTube al cerrarse la conexión (`pipeline` con `AbortSignal`), y el evaluador QuickJS libera contexto y runtime en `finally`. La suscripción del pipe (`desktop-bridge.ts`) no se quita al cerrarse el socket, pero el pipe dura lo mismo que el proceso nativo, que termina Node mediante el Job Object, así que no tiene impacto práctico.

## Android nativo

| # | Hallazgo | Código | Evidencia | Severidad | Corrección recomendada | Esfuerzo |
|---|---|---|---|---|---|---|
| A1 | La escucha a 1 Hz relee toda la tabla y recompone la raíz | `playback/PlaybackService.kt:90-121`, `data/LibraryDatabase.kt:44`, `ui/OpenfyViewModel.kt:86-91`, `ui/OpenfyApp.kt:52,105-119`, `ui/Sheets.kt:98-107` | Medido: una escritura por segundo y **dos** `SELECT * FROM listening` por escritura (20 en 10 s). Siguen igual en segundo plano y con la pantalla apagada (~60 cada 30 s), porque el flujo usa `stateIn(Eagerly)`; la causa de la lectura doble no se identificó, ya que el código tiene un solo colector. Con 14 605 filas, la CPU del proceso sonando en Inicio fue de 3,94 s cada 30 s, frente a 3,18 s con 5 filas; la del hilo principal, 0,80 s frente a 0,71 s; en pausa, ≈0. Un teléfono es varias veces más lento que el emulador y la tabla gana una fila por canción y día. Con un filtro de género activo, `Filters.apply` parsea el JSON de cada canción en cada recomposición. | Alta | Acumular la escucha en memoria y escribir cada 15–30 s o al pausar o cambiar de pista. Exponer estadísticas agregadas desde SQL (`GROUP BY` por período) en lugar de la tabla completa. Usar `WhileSubscribed` para no calcular nada sin interfaz y sacar `stats`/`filters.apply` de la composición. | Medio |
| A2 | Instantánea de la cola cada 5 s, también en pausa | `playback/PlaybackService.kt:90-98,123-134` | En el código, serializa la cola y vuelve a parsear el contexto de cada elemento cada 5 s mientras vive el servicio. GPT verificó que DataStore 1.2.0 no escribe en disco si el valor no cambió: en pausa el coste es CPU; sonando sí escribe cada 5 s. | Baja | Guardar solo si cambiaron la cola o el índice, o si la posición avanzó, con la posición en una clave aparte. | Bajo |
| A3 | Pico de memoria al renovar el token de Apple | `ui/MotionRepository.kt:522-540` | En el código, lee cada bundle (con un tope de 32 MiB) en un `ByteArray` y lo decodifica a `String`. No se midió el tamaño real del bundle; el pico es temporal y el token se cachea. | Media en gama baja | Buscar el token por bloques o ajustar el tope al tamaño real del bundle. | Medio |
| A4 | Los resultados de motion `READY` no caducan | `ui/MotionRepository.kt:89-99,173-176,364-373` | En el código, el mapa crece con cada álbum resuelto y se reescribe entero en cada guardado. | Baja | Tope de entradas por antigüedad de uso. | Bajo |
| A5 | Se retiene el último resultado del runtime | `provider/YouTubeRuntime.kt:46,95-97` | En el código, `returned` conserva el JSON de la última llamada en cada uno de los dos runtimes hasta la siguiente llamada. | Baja | Limpiarlo en `finally`. | Bajo |
| A6 | Asignaciones por fotograma del fondo animado | `WallpaperScene.kt:147-195` | En el código, crea `Outline`, `RectF`, `Rect` y una lista nuevos en cada fotograma (máximo 30 FPS). No se probó el fondo animado. | Baja | Reutilizar los objetos de dibujo como campos. | Bajo |

Prueba de resistencia de Android (12 min, 48 ciclos y 240 cambios de pestaña), comparando el primer y el último cuarto: PSS de 184 a 181 MB, heap Java de 27 a 25 MB, heap nativo de 39 a 36 MB, siempre 1 Activity y 6 AppContexts, descriptores de 231 a 226 e hilos de 61 a 60. Sin fuga. La cola terminó a mitad de la prueba, así que buena parte transcurrió en pausa; las aperturas del reproductor y la navegación sí se ejercitaron.

## Series medidas en Windows

| Fase (sesión aislada) | Acciones | Memoria privada (MB) | Handles | GDI / USER | CPU media* |
|---|---|---|---|---|---|
| Reposo sonando | — | 169,5 → 171,9 | 1877 → 1888 | 76 / 81 | 4,1 % |
| Saltos de pista | 147 | 174,1 → 191,8 (máx. 196,1) | 1895 → 2047 | 80 / 86 | 9,2 % |
| Abrir y cerrar mini, widget y pantalla completa | 81 | 191,9 → 200,5 | 2056 → 2119 | 86 / 86 | 18,2 % |
| Navegación entre seis secciones | 162 | 200,2 → 232,1 | 2103 → 2150 | 86 / 83 | 8,5 % |
| Letras + Cola + salto de pista | 148 | 234,3 → 343,7 | 2163 → 2426 | 86 / 84 | 13,8 % |
| Reposo final (3 min) | — | 344,5 → 353,7 | 2437 → 2375 | 86 / 82 | 4,9 % |
| Solo Cola, ronda 1 | 59 | 380,9 → 394,0 | 2423 → 2482 | — | — |
| Solo Letras, ronda 1 | 60 | 394,2 → 398,4 | 2500 → 2470 | — | — |
| Solo Cola, ronda 2 | 58 | 398,6 → 408,0 | 2482 → 2527 | — | — |
| Solo Letras, ronda 2 | 60 | 407,8 → 412,2 | 2548 → 2529 | — | — |

\*Incluye UI Automation. Sondas de CPU de 45 s sin automatización: ventana principal sonando, 2,6 %; con tormenta de eventos de ventana, 3,6 %; pantalla completa sonando, 35,7 %.

App instalada (15 min, pantalla completa): memoria privada de 365 a 404 MB, handles de 2 506 a 2 441, GDI fijo en 64, CPU media ~24 % de un núcleo, Node entre 189 y 377 MB.

## Quién encontró qué

| Punto | Claude | Gemini | GPT | Nota |
|---|---|---|---|---|
| W1 fondo a 239 FPS | ✔ (medición) | — | — | Encontrado al medir la CPU de la pantalla completa. |
| W2 fuga del panel Cola | ✔ (medición y causa) | — | — | Ninguno de los barridos estáticos lo señaló. |
| W3 escritura cada 2,5 s | ✔ (medición real) | ✔ | Confirmado | |
| W4 cascada de telemetría | ✔ (medición) | — | Confirmado | GPT añadió la cuarta consulta de «Más reproducidas». |
| W5 reproductores ocultos | parcial | ✔ (Alta) | Confirmado (Media) | La medición lo rebaja a Baja: el render se detiene y los ganchos cuestan poco. |
| W6 `MediaSource` | — | ✔ | Rebajado | |
| W7 Discord a 20 Hz | — | ✔ | Confirmado (Baja) | |
| A1 escucha a 1 Hz | ✔ (medición) | ✔ | Confirmado | GPT señaló que el flujo `Eagerly` sigue sin interfaz; se midió después. |
| A2 instantánea cada 5 s | ✔ | ✔ | Rebajado | DataStore no escribe si nada cambia. |
| A3 token de Apple | — | ✔ (64–96 MB) | Confirmado (~64 MiB en el tope) | Ninguno midió el tamaño real del bundle. |
| A4–A6 | — | ✔ | Confirmado | Impacto bajo. |
| N1 telemetría proporcional al historial | ✔ (medición) | ✔ | Confirmado | |
| N2 cliente eterno | ✔ | ✔ (Alta) | Rebajado (Media) | El reintento manual de conversiones lo limpia en parte. |
| N3, N4, N6, N7 | — | ✔ | Confirmado | Gemini dijo que N4 corría siempre cada 1 s; en reposo es cada 60 s. |
| N5 metadatos | — | — | ✔ | Verificado por Claude. |

Exageraciones o falsos positivos descartados: la «fuga» de la suscripción del pipe de escritorio (dura lo mismo que el proceso) y el coste de crear un runtime QuickJS por descifrado (correcto y liberado).

## Limitaciones

- Un emulador no es un teléfono físico. Los tiempos absolutos de Android serán peores en un dispositivo real; el número de consultas y su proporción no dependen del hardware.
- Las pistas sintéticas de Windows no tienen letras ni portadas animadas. W6 y W8 se evaluaron por código, y la parte de letras de W5 solo por código.
- El historial de 15 000 sesiones es sintético; no se leyó la biblioteca personal para conocer su tamaño real.
- La prueba de navegación de Windows no se repitió.
- No se probaron el fondo animado de Android ni un uso prolongado de la búsqueda de YouTube.
- Durante la auditoría, otras sesiones de agentes regeneraron `.output` y reinstalaron la app de Windows (02:35). Por eso el backend aislado se ejecutó desde el paquete instalado. La app instalada que había reabierto ese proceso terminó a las 02:43, antes de que se cerrara la instancia aislada de esta auditoría.
