# Rediseño visual de Openfy Android, orquestado con GPT (Codex)

## Contexto

La app Android nativa (`android/`, Kotlin + Jetpack Compose) funciona, pero se ve básica. El inicio abre con «Tu música, contigo / Inicio», luego «0 minutos escuchados / 0 reproducciones» con chips de período, y después filas de tarjetas de 144 dp. El usuario quiere que el inicio se sienta como Spotify, Apple Music o el inicio de Windows; las métricas de minutos no le gustan. También quiere mejorar el resto de la interfaz, aprovechar las portadas animadas e investigar la pantalla de bloqueo animada. Claude orquesta los agentes GPT 6.2 (Codex CLI) e itera con ellos.

Lo que hay hoy (verificado en el código):
- Toda la UI vive en tres archivos densos: `ui/OpenfyApp.kt` (521 líneas, 47 KB: tema, scaffold, pestañas, detalle, hojas, ajustes), `ui/FullPlayer.kt` y `ui/OpenfyViewModel.kt`. La navegación es estado propio, sin NavHost: un único `LazyColumn` pinta todas las pantallas.
- El tema son cinco colores sueltos (`Ink #09090B`, `Surface #151518`, `Muted`, `Green #1ED760`, `TextColor`) más la tipografía por defecto de Material3. Los tamaños y radios están escritos a mano en cada sitio. Hay un error: `RoundedCornerShape(12)` es un **porcentaje**, no 12 dp.
- No se extrae ningún color de las portadas. El fondo del reproductor ampliado es un degradado radial verde fijo, no la iluminación de portada de web/Windows (`shared/utils/ambient.ts`).
- **Las portadas animadas ya existen en Android**, pero solo en el modo «Portada» del reproductor ampliado. `ui/MotionRepository.kt` resuelve el vídeo de Apple desde el propio teléfono y un `ExoPlayer` silenciado lo reproduce, solo con Wi-Fi. La caché y el token se pierden cada vez que se cierra el reproductor, y no hay caché en disco.
- El provider QuickJS ya expone `recommendations` (canciones y álbumes). No existe botón de actualizar, ni caché, ni estado de carga. Además, `discover()` se vuelve a ejecutar cada vez que se regresa a Inicio.
- La MediaSession solo publica `artworkUri`. La pantalla de bloqueo muestra la tarjeta multimedia estándar.
- **Portadas en baja resolución** (lo detectó el usuario). Android guarda y muestra la URL tal como llega del proveedor (`musicArtwork`), que suele ser `=w120-h120` o una miniatura pequeña de `ytimg`, también en el reproductor ampliado y en las cabeceras. La web la pasa por `largeArtworkUrl` (`shared/utils/artwork.ts`) y pide 1024 px. Además, `downloads/Downloads.kt:70-82` (`cacheArtwork`) descarga esa versión pequeña y sustituye la URL por la ruta local, así que las canciones descargadas quedan con portada pequeña para siempre.

Una captura del teléfono real del usuario («EN DONDE E$TA$», Junior H) muestra los dos problemas del reproductor: la portada pixelada y el fondo verde genérico.

## Decisiones

Del usuario:
1. **Inicio:** el de Windows/web más una cuadrícula de acceso rápido estilo Spotify arriba.
2. **Pantalla de bloqueo:** en esta ronda solo se investiga y se documenta.
3. **Respaldo:** commit base del estado actual en `main`, sin push.

Mías, corregibles:
- Las métricas pasan a «Más reproducidas», igual que en web/Windows (`docs/home-design.md`).
- Los commits de punto de control se hacen al final de cada ronda, en local y sin push. Aprobar este plan los autoriza.
- No se sube la versión ni se publica en GitHub sin preguntar. Al final se entrega el APK local.
- La cuadrícula de acceso rápido es solo para Android. Llevarla a web/Windows queda como seguimiento.

## Dirección visual

La identidad de Openfy se mantiene: base oscura, verde y las portadas como fuente de color. La referencia visual es `app/assets/main.css` (`docs/native-design-parity.md`).

**Tokens** (nuevo `ui/Theme.kt`):
- **Color:** fondo `#09090B`, superficies del inicio `#202024`, separadores `#303034`, texto `#F4F4F5`, secundarios `#A1A1AA`, verde `#1ED760`. El tinte de tarjeta es `palette[0]` mezclado al 32 % con `#09090B`, la misma fórmula que `HomeSongCard.vue`, con contraste AA para texto blanco.
- **Tipografía:** la del sistema (Roboto), sin fuentes empaquetadas, igual que web. Escala `Typography`:

  | Uso | Tamaño |
  |---|---|
  | Títulos de pestaña / saludo | 30 sp Bold, tracking −0,5 |
  | Secciones | 22 sp SemiBold |
  | Título de tarjeta | 15 sp Medium |
  | Cuerpo | 14 sp |
  | Meta | 12 sp |
  | Etiquetas | 11 sp |

- **Formas:** 6 dp en mosaicos de acceso rápido, 8 dp en filas, 12 dp en tarjetas, 16 dp en destacadas y cabeceras, 18 dp en el reproductor, círculo para artistas.
- **Principios:**
  - La audacia se gasta en un solo sitio: las tarjetas «Sugerencias para ti» teñidas con su portada y la iluminación de portada del reproductor (también el minirreproductor teñido).
  - Todo lo demás es sobrio.
  - Nada de animaciones de entrada por tarjeta.
  - Se respeta el movimiento reducido (escala de animación 0).
  - Las filas horizontales llegan de borde a borde con margen de 20 dp.

**Inicio objetivo:**
```text
Buenas tardes                      [ajustes]
[▢ Tus favoritas ] [▢ Playlist X   ]   acceso rápido: 2 col, ≤ 8 mosaicos de 56 dp
[▢ Álbum Y       ] [▢ Artista Z    ]   (favoritas + contextos recientes + playlists)
Sugerencias para ti                  (↻)
[ PORTADA 260 ][ PORTADA ][ ...         tarjetas de 260×325 dp, franja inferior
[▓ título/art ▓][▓      ▓]              con el color de la portada
Lanzamientos de 2026     [□156][□][□]→   solo álbumes con año == año actual
Escuchado recientemente  [□][□][□]→
Tus favoritas y playlists [□][□][□]→
```
- El saludo depende de la hora en America/Mexico_City: «Buenos días», «Buenas tardes» o «Buenas noches».
- Se muestran las sugerencias en caché antes de actualizar, persistidas en DataStore. Se refrescan con ↻ o cuando tienen más de una hora.
- Mientras cargan aparecen marcadores. Las secciones vacías se ocultan.
- El estado totalmente vacío es un bloque breve con «Buscar música» e «Importar archivos».

## Orquestación con GPT (Codex)

- **Binario:** `(Get-AppxPackage OpenAI.Codex).InstallLocation + '\app\resources\codex.exe'` (hoy es la versión 0.169). Se fija el modelo de forma explícita: `-m gpt-6.2-sol -c model_reasoning_effort="xhigh"`.
- **Trabajador:** `codex exec -C E:\openfy -s workspace-write --json -o <scratchpad>\codex\<tarea>.md - < <prompt>.md`, lanzado en segundo plano. Las correcciones (errores de compilación, crítica de capturas) se envían con `codex exec resume <id>`.
- **Crítico de diseño:** `codex exec -s read-only -i <capturas...>`. Recibe las capturas y los documentos de diseño, y devuelve hallazgos priorizados con especificaciones Compose concretas.
- **Reglas de cada prompt** (archivos en el scratchpad):
  - Alcance y archivos propios. Los archivos congelados no se tocan.
  - Textos de UI en español y código en inglés.
  - Prohibido ejecutar Gradle, git o el emulador.
  - Criterios de aceptación e informe final: cambios, riesgos y pendientes.
- **Concurrencia:** como máximo tres trabajadores a la vez, nunca dos sobre el mismo archivo. `Theme.kt` y `Components.kt` quedan congelados durante la fase paralela; si un trabajador necesita cambiarlos, lo pide en su informe y Claude aplica el cambio.
- **Claude:**
  - Escribe los briefs e integra los cambios.
  - Compila: `gradlew -p android :app:compileDebugKotlin`, luego `assembleDebug` y las pruebas unitarias.
  - Instala en el emulador, saca las capturas y las revisa con frontend-design.
  - Decide la siguiente ronda y comparte con el usuario las capturas de cada hito.

## Fases

### 0. Preparación (Claude)
1. Commit base: todo lo no ignorado, después de revisar que no entren secretos (`artifacts/` pesa 0,2 MB; `.env`, `local.properties` y las claves ya están ignorados).
2. Guardar este diseño en `docs/superpowers/specs/2026-11-17-android-ui-redesign-design.md`.
3. Emulador `Pixel_7_Pro` o `Medium_Phone_API_37` con DNS explícito (lo exige `docs/android-validation.md`), más `Openfy_API29` para el mínimo. Se usa el paquete debug `app.openfy.android.debug`, con datos aislados.
4. **Datos reales, no fixtures** (pedido del usuario). El emulador trabaja con el contenido real del usuario:
   - **Copia de la biblioteca real.** Se hace una copia consistente con la API de backup de SQLite, en solo lectura sobre el origen, en `%TEMP%\Openfy\design-qa\data`. La biblioteca personal nunca se escribe ni se abre en modo escritura; esto sigue la regla de `docs/home-design.md` («copia consistente de la biblioteca»).
   - **Host de diseño.** Nuevo `scripts/android-design-host.ts`, derivado de `android-sync-host.ts` pero **sin sembrar canciones**:
     - Abre solo esa copia y se niega a arrancar si el directorio es `%LOCALAPPDATA%\Openfy\data`.
     - Escucha en loopback y emite el código de vinculación.
     - Con `adb reverse`, la app debug se vincula como «Vincular con Windows» y recibe las favoritas y playlists reales de YouTube, con sus portadas reales.
   - **Historial real.** El host exporta el historial de escucha de la copia (`listening`: canción, día, ms, reproducciones). Un paso de QA solo de debug lo importa en Room del emulador, así inicio, recientes y «Más reproducidas» muestran la escucha real del usuario. Este historial no se sincroniza en producción; la importación es solo una herramienta de QA y no entra en el APK de release.
   - **Reproducción real.** Durante la fase paralela, el emulador reproduce de verdad una playlist real, lo que genera contextos recientes, letras sincronizadas y portadas animadas reales. Los álbumes con Motion conocidos de la biblioteca, como «Un Verano Sin Ti», sirven para validar el vídeo.
   - **Privacidad.** Las capturas de la biblioteca real se envían al crítico GPT (Codex, la cuenta del usuario). La copia y las capturas se quedan en el PC (`%TEMP%` y `output/android-design/`), y la copia se borra al terminar.
   - **Opcional, teléfono físico.** Si el usuario conecta su teléfono por depuración USB o inalámbrica, se instala allí también el paquete debug (independiente de su Openfy de producción) y se sacan capturas en el dispositivo real.
5. Nueva prueba instrumentada `androidTest/.../DesignQaTest.kt`:
   - Navega y captura, sin crear contenido: inicio (arriba y desplazado), buscar (búsqueda real), biblioteca, un álbum y un artista reales, Más reproducidas, reproductor (portada, letras, cola) y minirreproductor.
   - Guarda las capturas en `filesDir/qa` con el patrón de `UiSmokeTest.kt`, y `adb pull` las copia a `output/android-design/<ronda>/`.
6. Capturas de partida («ronda 0») con la biblioteca real.

### 1. Crítica inicial
El crítico GPT recibe las capturas de la ronda 0 junto con `docs/design.md`, `home-design.md`, `mobile-ux.md`, `native-design-parity.md` y la sección «Teléfono» de `main.css`. Claude añade su propia crítica y fusiona ambas en el spec: lista de cambios por pantalla con criterios.

### 2. Base estructural (un trabajador, secuencial)
- Dividir `OpenfyApp.kt` sin cambiar el comportamiento, en funciones `LazyListScope.homeItems(...)` y equivalentes:

  | Archivo | Contenido |
  |---|---|
  | `Theme.kt` | tokens |
  | `Components.kt` | Cover, SongRow, tarjetas, SectionTitle, Empty, ActionIcon |
  | `OpenfyApp.kt` | scaffold, barra superior, navegación, enrutado |
  | `HomeScreen.kt`, `SearchScreen.kt`, `LibraryScreen.kt`, `DownloadsScreen.kt`, `DetailScreen.kt` | una pantalla cada uno |
  | `MiniPlayer.kt`, `Sheets.kt`, `SettingsScreen.kt` | piezas compartidas y ajustes |

- Aplicar los tokens nuevos y corregir los radios en porcentaje.
- En las pestañas raíz, la barra superior muestra un título grande (saludo, «Buscar», «Tu biblioteca», «Descargas») y el icono de ajustes. Desaparecen la fila «Openfy» y los subtítulos duplicados.
- Nuevo `CoverPalette.kt`: Coil carga la portada a 64 px, `androidx.palette` extrae el color (dependencia nueva en `libs.versions.toml`) y una caché LRU guarda el resultado por URL. Lo usan inicio, minirreproductor y cabeceras.
- **Portadas en su resolución adecuada:**
  - Nuevo `ui/ArtworkUrls.kt`, gemelo de `largeArtworkUrl` / `artworkIdentity`:
    - Google (`googleusercontent` / `ggpht`): cambia `=wN-hN` / `=sN` por el tamaño pedido. Los banners anchos llegan a 2048 de ancho.
    - `ytimg`: pide `maxresdefault` y, si devuelve 404, vuelve a `hqdefault`.
  - `Cover` recibe el tamaño de uso. Las filas piden unos 256 px según la densidad, las tarjetas 512 y el reproductor, las cabeceras y la MediaSession 1024. Coil guarda cada tamaño en caché por separado.
  - Contrato TS↔Kotlin `tests/fixtures/artwork-contract.json`, cargado por Vitest y por `ContractTests.kt`, como los demás contratos del proyecto.
  - `Downloads.kt` guarda la portada grande. Un repaso único en segundo plano vuelve a descargar las portadas de descargas existentes que midan menos de 512 px. La URL original se recupera por el provider con el ID de la canción, o se conserva en una columna nueva si Room necesita la migración 2→3. No toca el audio, y un fallo conserva la portada actual.
- Verificación: compilación, `UiSmokeTest` y capturas comparadas con la ronda 0.

### 3. Trabajo en paralelo (tres trabajadores, archivos disjuntos)

**H, Inicio.** Archivos: `HomeScreen.kt`, nuevo `HomeCards.kt`, `OpenfyViewModel.kt`.
- El diseño de inicio descrito arriba.
- Se quitan del inicio las métricas, los períodos y el top 5.
- Caché y frecuencia de refresco de las recomendaciones; filtro de lanzamientos del año actual.
- Tocar una sugerencia reproduce la fila desde esa canción; la pulsación larga abre las acciones.
- Pruebas unitarias del saludo por hora, la selección del acceso rápido (sin duplicados, ≤ 8) y el filtro de año.

**P, Reproductor y portadas animadas.** Archivos: `FullPlayer.kt`, `MiniPlayer.kt`, `MotionRepository.kt`, nuevos `Ambient.kt` y `MotionArtwork.kt`, `OpenfyApplication.kt`, `playback/PlaybackService.kt`.
- Iluminación de portada:
  - `Ambient.kt` es el gemelo Kotlin de `shared/utils/ambient.ts` (gradación, scrim y fundido de 1,2 s), con una prueba contra `tests/fixtures/ambient-contract.json` en `ContractTests.kt`.
  - En API 33+ dibuja con un `RuntimeShader` AGSL portado del GLSL de `app/lib/ambient-gl.ts`. En API 29–32 usa dos capas giratorias de la textura graduada de 64×64.
  - Como `PHONE_AMBIENT`: 30 FPS y movimiento al 70 %. Se detiene en pausa, con la vista oculta, con movimiento reducido o con «Movimiento ambiental» apagado.
  - No reacciona al audio: `Visualizer` exige permiso de micrófono.
- Pulido del reproductor:
  - Portada con sombra suave.
  - Barra de progreso fina, cuyo control aparece al arrastrar.
  - Selector «Portada / Letras / Cola» en forma de píldora, conservando esos textos que usan las pruebas.
- Minirreproductor:
  - Teñido con el color de la portada, con una línea de progreso de 2 dp.
  - Se abre deslizando hacia arriba.
  - Conserva la descripción «Abrir reproductor».
- Portadas animadas:
  - `MotionRepository` pasa a vivir en la aplicación, así que la caché y el token sobreviven al cerrar el reproductor.
  - Los resultados se guardan en disco con los TTL del servidor: `none` 30 días, `unmatched` 1 día.
  - `SimpleCache` de Media3 acotado a unos 300 MB con LRU: el bucle no vuelve a descargar, y lo ya guardado se reproduce también con datos móviles.
  - Nuevo composable reutilizable `MotionArtwork`.
- `PlaybackService`: portada en alta resolución en `artworkUri`, para la tarjeta multimedia del bloqueo y la notificación.

**L, Biblioteca, Buscar, Detalle y Más reproducidas.** Archivos: `LibraryScreen.kt`, `SearchScreen.kt`, `DetailScreen.kt`, `DownloadsScreen.kt`.
- «Más reproducidas» recibe la cabecera con minutos escuchados, reproducciones y chips de período.
- La cabecera de detalle lleva un degradado del color de la portada que se funde con el fondo, siguiendo el héroe y la fila de acciones de web.
- El campo de búsqueda pasa a ser una píldora fija.
- Biblioteca: acciones de importar y crear agrupadas sin perder accesibilidad, y filas pulidas.
- Si cambia algún texto que comprueba `UiSmokeTest`, la prueba se actualiza.
- En la ronda 2, cuando P haya terminado, la cabecera de álbum usa `MotionArtwork`, como en Apple Music.

### 4. Rondas de iteración (2–3)
En cada ronda:
1. Claude compila, instala, ejecuta `DesignQaTest` y recoge las capturas de API 37 y API 29.
2. Claude y el crítico GPT revisan.
3. Claude envía las correcciones a los trabajadores con `resume`.
4. Commit de punto de control.

Se para cuando ninguna de las dos revisiones encuentra problemas de prioridad alta y las pruebas pasan. Las capturas de cada ronda se comparten con el usuario.

### 5. Investigación de la pantalla de bloqueo (Claude, durante la fase 3)
Nuevo `docs/android-lock-screen.md`, en español. Cubre:
- Android 11 quitó la portada del bloqueo; lo que queda es la tarjeta multimedia.
- Fondo animado propio (`WallpaperService`):
  - En la mayoría de dispositivos aplica a inicio y bloqueo a la vez.
  - Android 14+ en Pixel permite elegir solo bloqueo desde el selector.
  - Android 16 añade `WallpaperDescription` / `WallpaperInstance`.
  - Hay que comprobar Android 17.
- `setBitmap(FLAG_LOCK)`: estático e intrusivo.
- Actividad `showWhenLocked`: bloqueada por las restricciones de arranque en segundo plano y de intención a pantalla completa en Android 14+.
- Batería, compatibilidad por fabricante y un diseño propuesto de «Fondo animado de Openfy» como siguiente ronda.
- Comprobación en el emulador de qué ofrece el selector del sistema.

### 6. Importar desde Spotify (pedido del usuario; después de la fase 3, con un trabajador propio)

**Investigación** (noviembre de 2026):

**A. Archivo de datos de Spotify (vía recomendada).** El usuario lo pide en Spotify → Privacidad → «Descargar tus datos» → Datos de la cuenta.
- Llega en unos días como `my_spotify_data.zip`, con `YourLibrary.json` (canciones guardadas: artista, álbum, canción, URI) y `Playlist1.json` (playlists propias con sus canciones).
- No hace falta Premium, ni app de desarrollador, ni OAuth. Son los datos del propio usuario.
- No trae duración ni ISRC, así que la coincidencia se hace por título, artista y álbum.

**B. Web API de Spotify (opcional, inmediata).** Tras los cambios de febrero de 2026:
- El modo desarrollo exige que el dueño de la app tenga **Premium** y admite como máximo **5 usuarios**.
- Siguen disponibles `GET /me/tracks` (Me gusta) y `GET /me/playlists`. Las canciones de una playlist (`GET /playlists/{id}/items`) solo se leen si el usuario la creó o colabora; las seguidas o editoriales llegan sin canciones.
- `external_ids.isrc` y `duration_ms` siguen presentes, lo que mejora la coincidencia.
- Admite PKCE con redirección loopback `http://127.0.0.1:<puerto>/callback`.
- El usuario tendría que registrar su propia app de desarrollador. Los scopes y los límites numéricos se verifican al implementarla.

**Diseño propuesto** (primero Android, la app que más usa el usuario):
- **Coincidencia compartida.** Nuevo `server/utils/music-spotify-match.ts`. Por su nombre `music-*.ts` se empaqueta automáticamente en el provider QuickJS de Android, así que el mismo código servirá luego al servidor para web/Windows.
  - Busca `título + artista` con `searchYouTubeMusic` y prefiere resultados de tipo canción.
  - Puntúa por título normalizado (sin «feat.», «Remastered» ni paréntesis de versión, con `metadataKey`), solapamiento de artistas y álbum. Con la API suma la duración (±3 s).
  - Si la confianza es baja, devuelve los tres mejores candidatos para revisión.
  - Lleva pruebas Vitest.
- **Android.** Ajustes → «Importar desde Spotify».
  - Se elige el ZIP o los JSON con el selector del sistema; `java.util.zip` lee el ZIP.
  - Vista previa de recuentos.
  - Un trabajo de WorkManager reanudable, secuencial y con esperas ante errores, con notificación de progreso.
  - Resultado: importadas, «por revisar» (eligiendo entre candidatos u omitiendo) y no encontradas.
  - Las guardadas pasan a favoritas de YouTube y las playlists a playlists con referencias `youtube:`, sin duplicar lo que ya está en la biblioteca.
  - Si el teléfono está vinculado, todo llega a Windows por la sincronización existente.
- **Sin migración de SQLite en el servidor.** El estado del trabajo vive en Room o DataStore de Android.
- **Prueba con datos reales.** Se usa el export real del usuario, que conviene pedir ya porque tarda días. Mientras llega, se prueba la coincidencia con canciones reales de su biblioteca.
- **Seguimiento.** La entrada de web/Windows (subir ZIP al servidor) y la vía API van después. El historial de reproducción del export (`StreamingHistory_music_*.json`) podría alimentar las sugerencias, pero queda fuera.

### 7. Cierre
- Actualizar en español `docs/android-native.md` (interfaz), `docs/home-design.md` (sección Android), `docs/motion-art.md` (cliente Android) y añadir el registro fechado en `docs/android-validation.md`.
- `scripts/package-android.ps1`: pruebas, lint, compilación, firma y APK en `output/android/`.
- Sin subida de versión ni publicación en GitHub salvo que el usuario lo pida. Si se publica, hace falta la entrada en `shared/release-notes.json`.

## Archivos críticos

- `android/app/src/main/java/app/openfy/android/ui/`: `OpenfyApp.kt` (se divide), `FullPlayer.kt`, `OpenfyViewModel.kt`, `MotionRepository.kt` y los archivos nuevos de las fases 2–3.
- `android/app/src/main/java/app/openfy/android/OpenfyApplication.kt`, `playback/PlaybackService.kt`, `downloads/Downloads.kt` (`cacheArtwork`), `data/LibraryRepository.kt` y `data/LibraryDatabase.kt` (solo si hace falta la columna de URL original).
- `shared/utils/artwork.ts` (`largeArtworkUrl`) y el nuevo `tests/fixtures/artwork-contract.json`.
- Importación de Spotify:
  - Nuevos `server/utils/music-spotify-match.ts` y `android/.../ui/SpotifyImport.kt` (más el trabajador de importación).
  - Entrada `spotifyMatch` en `android/provider-js/index.ts` y entrada en `SettingsScreen.kt`.
  - Se reutilizan `searchYouTubeMusic` y la normalización de `server/utils/music-normalize.ts`, y el `metadataKey` de la coincidencia de portadas animadas.
- `android/gradle/libs.versions.toml`, `android/app/build.gradle.kts` (palette).
- `android/app/src/test/.../ContractTests.kt`, `androidTest/.../UiSmokeTest.kt`, nuevo `DesignQaTest.kt`.
- Se reutilizan:
  - `shared/utils/ambient.ts` y `tests/fixtures/ambient-contract.json`.
  - El shader de `app/lib/ambient-gl.ts`.
  - Las reglas de tarjeta de `app/components/HomeSongCard.vue` y `HomePage.vue`.
  - La resolución Motion existente en `MotionRepository.kt`.
  - El provider `recommendations` de `android/provider-js/index.ts`.

## Verificación

- `.\android\gradlew.bat -p android :app:assembleDebug` y las pruebas unitarias JVM (contratos, incluido el nuevo de ambient).
- `.\scripts\test-android.ps1 -Serial emulator-5554` (UiSmokeTest y el resto) en API 37 y API 29.
- `DesignQaTest` en API 37 y API 29, con revisión visual de las capturas: iluminación con y sin AGSL, contraste de las franjas, filas de borde a borde, estados vacío y de carga, movimiento reducido (escala de animación 0) y horizontal.
- Portadas nítidas:
  - En el reproductor ampliado y las cabeceras, el tamaño real de la imagen cargada debe ser de 1024 px, comprobado en el log de Coil o en la petición.
  - Una canción descargada antes del cambio recibe la portada grande tras el repaso, y su audio y su hash no cambian.
  - Pruebas del contrato de artwork en Vitest y en JVM.
- Portadas animadas en el emulador con un álbum que tenga Motion: la caché sobrevive al cerrar y reabrir, el segundo bucle no vuelve a descargar y el modo Wi-Fi se respeta.
- Spotify:
  - Vitest de `music-spotify-match.ts`: variantes «feat.», remasterizaciones, ediciones distintas que no deben coincidir y candidatos ambiguos que van a revisión.
  - Importación en el emulador con el ZIP real del usuario, o con sus canciones reales mientras llega: recuentos, revisión, ausencia de duplicados y sincronización con la copia del host de diseño.
- `.\scripts\package-android.ps1` correcto: lint, pruebas, firma y alineación de 16 KiB.
- No se toca la biblioteca personal:
  - Solo se lee para hacer la copia consistente; el número de canciones, favoritas, playlists y sus hashes se comprueba antes y después.
  - Todo lo demás corre contra la copia y el paquete debug del emulador.
  - El único código nuevo fuera de `android/` son el host de QA y el contrato de artwork; no hay cambios de comportamiento en el servidor ni en Windows.

## Fuera de alcance y seguimiento

- Prototipo del fondo animado para el bloqueo (siguiente ronda, según el documento de la fase 5).
- Acceso rápido en web/Windows.
- Importación de Spotify en web/Windows, vía Web API e historial de reproducción.
- Subida de versión y release en GitHub.
- Validación en un teléfono físico.
