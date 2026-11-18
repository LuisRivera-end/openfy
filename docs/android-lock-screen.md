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

## Pendiente

- Comprobar en el emulador API 37 qué opciones ofrece el selector del sistema para un fondo animado (inicio, bloqueo o ambos).
- Revisar la referencia de `WallpaperInstance` antes de implementar.
