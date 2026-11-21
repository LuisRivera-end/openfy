# Pantalla de bloqueo animada en Android

Investigación del 17 de noviembre de 2026. Pregunta: ¿puede Openfy mostrar en Android la portada (o su vídeo Motion) en la pantalla de bloqueo, como Apple Music en iOS?

## Conclusión

Android no ofrece a las apps una forma de pintar la pantalla de bloqueo mientras suena música. La vía viable es un **fondo de pantalla animado propio de Openfy** (`WallpaperService`) que el usuario elige una vez. Mientras suena música, pinta la portada actual con la iluminación del reproductor y, si existe, el vídeo Motion. En pausa vuelve a una imagen fija. No es idéntico a iOS: en muchos teléfonos el fondo animado se aplica a inicio y bloqueo a la vez, y el usuario debe activarlo él mismo.

## Qué hay hoy en Android

- **Android 11 retiró la portada a pantalla completa del bloqueo.** Antes, `METADATA_KEY_ART` de la sesión multimedia llenaba el fondo; desde Android 11 solo queda la tarjeta multimedia del sistema ([9to5Google](https://9to5google.com/2020/08/02/android-11-lockscreen-art/)).
- **La tarjeta multimedia del bloqueo** toma título, artista y portada de la `MediaSession`. Es lo único que Openfy controla sin permisos especiales. Desde esta revisión, `PlaybackService` publica la portada a 1024 px para que la tarjeta se vea nítida.
- **Android 17** rediseñó la tarjeta con Material 3, y una beta de QPR3 muestra una opción «media» en la personalización del bloqueo, todavía sin función conocida ([Android Authority](https://androidauthority.com/google-wallpaper-style-app-lock-screen-customization-teardown-3718877), [Android Headlines](https://www.androidheadlines.com/2026/05/android-17-media-player-card-switcher-redesign.html)). No hay API pública para que una app pinte ese espacio.

## Opciones evaluadas

| Opción | Animado | Solo en bloqueo | Intrusión | Veredicto |
|---|---|---|---|---|
| Fondo animado propio (`WallpaperService`) | Sí | Depende del dispositivo | Baja: lo elige el usuario | **Recomendada** |
| `WallpaperManager.setBitmap(..., FLAG_LOCK)` por canción | No | Sí | Alta: sustituye el fondo del usuario en cada canción | Descartada |
| Actividad `showWhenLocked` sobre el bloqueo | Sí | Sí | Muy alta | Descartada |
| Tarjeta multimedia de la sesión | No | Sí | Ninguna | Ya en uso; portada mejorada |

### Fondo animado propio

- El usuario lo activa desde Ajustes de Openfy con `ACTION_CHANGE_LIVE_WALLPAPER`, que abre el selector del sistema con el servicio de Openfy preseleccionado. La app no puede fijarlo por su cuenta.
- **Inicio y bloqueo:** el método para fijar un fondo animado solo en el bloqueo es API de sistema. Según desarrolladores de terceros, antes de Android 14 un fondo animado no podía ir solo al bloqueo ([issue](https://github.com/BenoitMarchand/Micro_Review_for_AnkiDroid/issues/105)). En Pixel con Android 14+ el selector del sistema permite elegir la pantalla; en otros fabricantes depende de su selector.
- **Android 16** añade `WallpaperDescription` y `WallpaperInstance`, con los que el servicio distingue sus instancias de inicio y bloqueo y puede pintar contenido distinto en cada una ([Android 16](https://developer.android.com/about/versions/16/features)). Esto permitiría, por ejemplo, la portada en el bloqueo y una versión atenuada en el inicio.
- **Batería:** el motor solo dibuja cuando el sistema lo marca visible (`onVisibilityChanged`) y hay reproducción. El vídeo Motion ya se limita a 720 px y 30 FPS en la app. En pausa se conserva el último fotograma sin bucle de dibujo. La animación respeta el movimiento reducido.
- **Datos:** el fondo lee el estado de reproducción de la propia app (sesión de Media3 o un flujo compartido del proceso), y el vídeo de la caché de portadas animadas. No hace peticiones propias.
- **Fondo del usuario:** una app no puede leer el fondo actual sin permisos amplios, así que en reposo el fondo de Openfy muestra una imagen elegida dentro de Openfy o una base oscura con la última portada.

### Por qué no las otras

- `setBitmap(FLAG_LOCK)` reescribe el fondo del sistema en cada cambio de canción. Es estático, pierde el fondo del usuario y genera escrituras constantes.
- Una actividad sobre el bloqueo necesita arrancar desde segundo plano al encender la pantalla. Android 10+ restringe esos arranques, y desde Android 14 la intención a pantalla completa queda reservada a llamadas y alarmas salvo permiso manual. El proyecto [Album Art Lock Screen](https://github.com/Carmonavirus/album-art-lockscreen) demuestra que puede hacerse con acceso a notificaciones y batería sin restricciones, pero es frágil y depende del fabricante.

## Propuesta para la siguiente ronda

1. `OpenfyWallpaperService` con un motor Compose-free (Canvas o `RuntimeShader` en API 33+) que reutilice la iluminación de portada (`Ambient.kt`) y, si hay vídeo Motion en caché, lo decodifique con un `ExoPlayer` silenciado sobre la superficie del motor.
2. Ajustes → «Fondo animado de Openfy» con una vista previa y el botón que abre el selector del sistema.
3. En Android 16+, usar `WallpaperInstance` para pintar la portada completa en el bloqueo y una versión atenuada en el inicio.
4. Validar en emulador (selector del sistema, visibilidad, batería con `dumpsys batterystats`) y en el teléfono físico del usuario, que es donde importa el comportamiento del fabricante.

## Prototipo: «Fondo animado de Openfy»

Implementado el 17–18 de noviembre de 2026 en `android/app/src/main/java/app/openfy/android/`. Se activa desde Ajustes → «Fondo animado de Openfy», que muestra una vista previa con la misma luz, velo y proporciones, el estado actual (bloqueo, inicio o ambos, en API 34+) y el botón que abre `ACTION_CHANGE_LIVE_WALLPAPER` con el servicio de Openfy preseleccionado. Si ese selector no existe, abre la lista de fondos animados.

- **Motor sin Compose.** `OpenfyWallpaperService` dibuja con `HardwareRenderer` y `RenderNode` sobre la superficie del motor (`WallpaperScene.kt`). La iluminación sale de `ui/AmbientArtwork.kt`, donde ahora viven las piezas sin Compose que antes estaban en `AmbientBackground.kt`: gradación de `Ambient.kt`, texturas mip, velo de contraste, AGSL en API 33+ y las dos capas suavizadas en 29–32. El reproductor ampliado usa exactamente esas funciones, así que fondo y reproductor no pueden divergir.
- **Composición.** Bloqueo: luz animada, velo y la portada completa (cuadrada, con esquinas de 16 dp y sombra), un poco por encima del centro. Inicio: lo mismo con un velo negro del 45 % para que iconos y widgets se lean. Al cambiar de canción, luz y portada se funden en 1,2 s mientras la luz se mueve; si no, el cambio es inmediato.
- **Portada animada.** Solo en la pantalla de bloqueo, con música sonando y con «Movimiento ambiental» y «Portadas animadas» activos. Usa `MotionRepository.resolve(allowNetwork = false)` y la fábrica de caché sin red: solo vale un vídeo completo en la caché. Un `ExoPlayer` silenciado y sin pista de audio decodifica sobre la superficie del motor. Antes de conectarlo, `WallpaperScene.release()` destruye el renderizador de forma síncrona, porque una superficie solo admite un productor; al terminar, el renderizador vuelve a conectarse y redibuja. El vídeo cuadrado se recorta a pantalla completa (`VIDEO_SCALING_MODE_SCALE_TO_FIT_WITH_CROPPING`), como la portada de pantalla completa de iOS. El fondo pide el decodificador con la prioridad más baja de `MotionPlaybackCoordinator`, así que cualquier portada animada de la app se lo quita, y lo libera en cuanto deja de verse. Si el decodificador falla, prueba otro con la política de `MotionRepository`; si no queda ninguno, se queda con la portada fija para esa canción.
- **Energía.** Solo hay bucle de dibujo con el motor visible, música sonando y una portada cargada, a unos 30 FPS alineados con vsync mediante `Choreographer`. En pausa no se redibuja y queda el último fotograma (el vídeo, pausado). Con el motor oculto no hay bucle ni decodificador. Con movimiento reducido o «Movimiento ambiental» apagado se pinta una imagen fija y no hay vídeo.
- **Estado de reproducción.** `PlaybackService` publica `OpenfyApplication.nowPlaying` (canción y si suena) en el proceso. El fondo no conecta un `MediaController`, que arrancaría el servicio. Si el servicio no está vivo, usa la última canción de la cola guardada.
- **Sin red.** Las portadas se leen de archivos locales o de la caché de disco de Coil, que se comprueba antes de pedir nada; la petición va además con la red desactivada (`only-if-cached`). Si la portada no está en caché, el fondo queda en la base oscura.
- **Inicio y bloqueo.** En API 34+ el motor lee `getWallpaperFlags()`: si pinta solo el bloqueo o solo el inicio, usa esa versión. Si pinta ambos, sigue al bloqueo del teclado (`ACTION_SCREEN_OFF`, `ACTION_USER_PRESENT` y `KeyguardManager`). En API 36+ `onApplyWallpaper(which)` devuelve un `WallpaperDescription` con id `openfy-lock`, `openfy-home` u `openfy-both` y el destino en el contenido, y `onCreateEngine(WallpaperDescription)` lo recupera. Las flags vivas mandan sobre la descripción guardada.
- **`WallpaperInstance`.** Revisada la referencia en las fuentes del SDK 37: la clase es pública, pero solo se obtiene con `WallpaperManager.getWallpaperInstance`, que es `@SystemApi` y exige `READ_WALLPAPER_INTERNAL`. Una app no puede leerla; lo que sí recibe es su `WallpaperDescription`, y eso es lo que usa Openfy.
- **Colores del sistema.** `onComputeColors()` devuelve colores neutros fijos. Derivarlos de cada portada cambiaría el tema de todo el teléfono en cada canción.
- **Diagnóstico.** `adb shell dumpsys activity service <paquete>/app.openfy.android.OpenfyWallpaperService` imprime las llamadas recibidas a `onApplyWallpaper` y, por motor, la descripción recibida, el destino, la versión que pinta, visibilidad, reproducción, modo (`IDLE`, `STILL`, `AMBIENT`, `VIDEO`), fotogramas dibujados y fotogramas de vídeo. No incluye títulos ni rutas.

La política (destino, versión y modo) está en `WallpaperPolicy.kt` y la cubre `WallpaperPolicyTest`. `WallpaperSmokeTest` comprueba que el sistema puede leer el servicio como fondo animado. `WallpaperQaTest`, solo con `-e wallpaperSeed cover|motion`, importa una canción sintética con portada incrustada y, con `motion`, guarda en la caché un vídeo HLS sintético bajo una URL de Apple para probar el vídeo sin red.

Validación en los emuladores API 37 y API 29 (selector, versiones de bloqueo e inicio, animación solo con música, vídeo sin red, respaldo sin AGSL y CPU): [Validación de Android nativo](android-validation.md#fondo-animado-de-openfy-18-de-noviembre-de-2026). El selector AOSP del emulador ofrece inicio, bloqueo o ambos, pero no llama a `onApplyWallpaper`, así que la vía de `WallpaperDescription` sigue sin probarse en un selector que la use.

## Pendiente

- Teléfono físico del usuario: selector del fabricante (si permite elegir solo el bloqueo), cambio entre bloqueo e inicio con un bloqueo real, batería real con `batterystats` y decodificador por hardware.
- En el emulador el fondo animado gasta unos 6,8 s de CPU por minuto mientras se ve y suena. Si en el teléfono se nota en la batería, bajar el fondo a 15–20 FPS, que con una luz tan lenta apenas se distingue.
- El vídeo cuadrado recortado a pantalla completa pierde los laterales. Mostrarlo entero sobre la luz necesitaría componer el vídeo con OpenGL (`SurfaceTexture`), o que la app guardara también el vídeo vertical 3:4 de Apple.
- Con el proceso iniciado solo por el fondo, `OpenfyApplication.onCreate` sigue preparando el proveedor de YouTube. Es trabajo local, pero ocupa memoria en un proceso que el sistema mantiene vivo mientras el fondo esté elegido.
