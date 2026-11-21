# Identidad visual de artista

Fecha: 19 de noviembre de 2026. Alcance: Windows nativo, web/PWA y Android nativo.

## Problema

La página de artista era una tarjeta oscura con el banner y una sombra negra, seguida del catálogo sobre el gris de siempre. Todos los artistas se veían iguales. El «Resultado más relevante» de la búsqueda era una tarjeta neutra de 180 px.

## Idea

**El color del artista es el dueño de la página.** La imagen que se dibuja (banner, o retrato si no hay banner) da una paleta; toda la página se pinta con ella y el tono cambia por secciones. Si Apple Music tiene un vídeo editorial del artista, sustituye al banner en la cabecera.

Es la versión de Openfy, no una copia de Apple Music: el nombre se queda abajo a la izquierda, alineado con la retícula del contenido, en la tipografía display actual (bold, tracking negativo, 40–88 px).

## Tokens

La regla `artistTheme` (más abajo) devuelve:

| Token | Uso |
| --- | --- |
| `base` | Fondo de la cabecera y de «Canciones populares». Color al que se funde el medio de la cabecera. |
| `secondary` | Fondo de «Último lanzamiento», «Álbumes» y «Singles y EPs». |
| `deep` | Fondo de «Fans también escuchan»; icono del botón de reproducir. |
| `surface` | Filas de la tabla en hover/selección y botones de cristal. |
| `neutral` | `true` cuando la imagen es casi gris (por ejemplo, retratos en blanco y negro). |

- El texto principal es blanco (`#FFFFFF`) y el secundario usa `#EDEDF0` opaco.
- `base`, `secondary`, `deep` y `surface` mantienen la luminancia de diseño en 0,14 como máximo antes de redondear. El texto secundario conserva al menos 4,5:1, incluso en filas seleccionadas.
- El final de la página se funde en el fondo de la app (`#09090B` en web y Android, el fondo de la ventana en Windows).

## Composición

```
┌──────────────────────────────────────────────────────────────┐
│  vídeo / banner a todo el ancho del área de contenido        │
│  (recorte que conserva el tercio superior)                   │
│                                                              │
│  ░░░░ degradado: transparente → base ░░░░░░░░░░░░░░░░░░░░░░  │
│  Artista                                                     │
│  NOMBRE DEL ARTISTA (display, abajo a la izquierda)          │
├──────────────────────────────────────────────────────────────┤ base
│  (●▶)  [Aleatorio]  [Volver a buscar]*                       │
│  Canciones populares                       Ver todas         │
│  1  ▣ Título ……………………………………………… álbum ………… 3:57         │
├──────────────────────────────────────────────────────────────┤ base → secondary
│  Último lanzamiento · Álbumes · Singles y EPs                │
├──────────────────────────────────────────────────────────────┤ secondary → deep
│  Fans también escuchan                                       │
└──────────────────────────────────────────────────────────────┘ deep → fondo de la app
* «Volver a buscar» solo existe en Windows.
```

- La cabecera ocupa todo el ancho del área de contenido. En la web, la foto o vídeo se extiende desde el buscador y la barra de regreso hasta el nombre y los controles. El fundido protege la lectura sobre fotogramas claros y conecta la cabecera con las canciones. La navegación lateral, el buscador, el perfil y el reproductor toman tonos del mismo artista mientras la ficha está abierta.
- El botón circular de información de la cabecera abre un diálogo con el retrato y la biografía, en la web, Windows y Android. Desde el 2026-11-20 no hay sección «Acerca de» en el cuerpo de la página (como en Apple Music): la biografía solo se repite en ese diálogo. Los controles y la biografía conservan su propio foco y destino al cerrar.
- Las canciones y el último lanzamiento quedan en dos columnas únicamente cuando el panel de contenido mide al menos 700 px. En paneles compactos, como el Fold 2 desplegado con barra lateral, el lanzamiento queda debajo de la lista.
- Sin banner: el retrato redondo (210 px, 140 px en estrecho) queda a la izquierda del nombre, sobre `base`. Ya no se usa el retrato desenfocado.
- El fondo de la página es un único degradado vertical con paradas ancladas a las secciones. La barra superior (DetailBar en web, la barra del catálogo en Windows y la barra de Android) toma el color de la sección que pasa por debajo; el cambio se interpola a medida que se desplaza la página.
- Botón de reproducir: un disco blanco de 56 px con el icono en `deep`. «Aleatorio» y «Volver a buscar» usan una superficie con blanco al 12 % sobre `deep`, y al 18 % al pasar el puntero.
- El foco de teclado es un anillo blanco de 2 px con un separador de 2 px de `base`.

## Vídeo de la cabecera

- Fuente: el vídeo editorial del artista en Apple Music (`motionArtistWide16x9`, y si no existe `motionArtistFullscreen16x9`). Se usa el mismo endpoint no oficial que las portadas animadas (`docs/motion-art.md`).
- Se resuelve en el servidor (web y Windows) con `POST /api/motion/resolve` y `{ entry: { source: 'artist', artistId, name, albums } }`. Android lo resuelve en el teléfono con `MotionRepository`.
- Coincidencia estricta: el mismo nombre de artista (`metadataKey`) y al menos uno de los títulos de álbumes o singles que ofrece YouTube Music en el catálogo de ese artista en Apple. Si hay duda, no se muestra vídeo.
- Se reproduce silenciado y en bucle, con un fundido al primer fotograma, y se pausa al salir de la vista o al ocultar la ventana.
- Respaldo: el banner fijo de YouTube Music, sin mensajes de error.
- Lo desactivan «Portadas animadas» apagado, «Movimiento ambiental» apagado, el movimiento reducido del sistema, el ahorro de datos o la red medida, y `OPENFY_MOTION_ART=off`.
- Caché: `motion-cache/` usa una clave SHA-256 que incluye el identificador de origen, el nombre normalizado y los lanzamientos que respaldan la coincidencia. Nunca se fija y entra en la expulsión por encima de 1 GB. La variante elegida es H.264 de hasta 1920 px de ancho.

## «Resultado más relevante»

```
┌───────────────────────────────┐
│ ◯ retrato 120 px              │  degradado base → deep
│                               │  de la paleta del resultado
│ Rauw Alejandro (32 px bold)   │
│ Artista                (●▶)   │  ← el botón aparece con hover o foco;
└───────────────────────────────┘    siempre visible en táctil
```

- Ocupa toda la columna de 1 fr; el límite de 180 px se elimina.
- La paleta se calcula con la misma regla sobre la imagen del resultado: el retrato del artista, la portada del álbum o la miniatura de la canción. Si el artista ya se abrió en esta sesión, se reutiliza la paleta de su página (caché en memoria por `youtube:<id>`) para que la búsqueda y la página coincidan.
- La línea de tipo dice «Artista», «Canción · <artista>» o «Álbum · <artista>».
- Pulsar la tarjeta abre el artista o el álbum, o reproduce la canción. El botón de reproducir reproduce las canciones populares del artista, el álbum o la canción.

## Artista de la biblioteca

«Artista en tu biblioteca» usa la misma regla sobre su retrato: la cabecera y el fondo toman `base` y `deep`. No lleva vídeo.

## Regla `artistTheme`

Las implementaciones gemelas son `shared/utils/artist-theme.ts`, `desktop/Openfy.Core/ArtistTheme.cs` y `android/app/src/main/java/app/openfy/android/ui/ArtistTheme.kt`. La fijación es `tests/fixtures/artist-theme-contract.json`, con una tolerancia de ±2 por canal en las salidas hex.

Entrada: una muestra de 16 × 16 píxeles RGB de la imagen (256 píxeles). Cada plataforma reduce la imagen con su API y convierte a RGB. Si falta la imagen, se devuelve el tema neutro.

1. Para cada píxel con canales en 0..1: `max`, `min` y `croma = max − min`. Se calcula también el tono HSL en grados.
2. Los píxeles con `max < 0.08` o `min > 0.92` (casi negros o casi blancos) no votan tono, pero sí cuentan para el croma medio.
3. Hay 12 cubetas de tono de 30° (la cubeta 0 cubre [0°, 30°)). Cada píxel que vota suma su `croma` como peso y suma `croma × (r, g, b)` al color de la cubeta.
4. `cromaMedio` es la suma de los cromas entre los 256 píxeles. Si `cromaMedio < 0.08` o el peso total votado es 0, el tema es **neutro**: `base` = HSL(215°, 0.18, 0.30), `secondary` = HSL(230°, 0.14, 0.26) y `neutral = true`.
5. Si no, la cubeta de mayor peso es la dominante (con empate gana el índice menor). Su color medio ponderado se pasa a HSL; la saturación se ajusta a [0.45, 0.85] y la luminosidad HSL a [0.22, 0.60]. El resultado es `base`.
6. `secondary`: la cubeta de mayor peso cuya distancia circular a la dominante sea ≥ 2 cubetas y cuyo peso sea ≥ 0.15 × el peso de la dominante (con empate gana el índice menor). Se le aplican los mismos ajustes que a `base`. Si no existe, es `base` con el tono girado +20°.
7. Ajuste de contraste para `base` y `secondary`: si la luminancia relativa WCAG de HSL(h, s, l) supera 0.14, se busca por bisección (24 iteraciones sobre [0, l]) la mayor `l` que dé luminancia ≤ 0.14.
8. `deep` = HSL(base.h, base.s, base.l × 0.45).
9. `surface` mezcla `base` con blanco al 10 % si la luminancia se mantiene en 0.14 o menos. Cuando la mezcla supera ese valor, oscurece cada canal multiplicándolo por 0.82.
10. Las salidas son `#rrggbb` en minúsculas, con cada canal redondeado (`Math.round`, *round half away from zero* en C# y Kotlin, `MidpointRounding.AwayFromZero`).

La luminancia relativa WCAG: cada canal sRGB se linealiza con `c ≤ 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ^ 2.4`, y luego `0.2126 R + 0.7152 G + 0.0722 B`.

## Calidad mínima

- Movimiento reducido: no hay vídeo y la barra cambia de color sin transición.
- El foco de teclado es visible sobre cualquier color.
- El contraste AA lo garantiza la regla.
- El diseño se adapta hasta 360 px de ancho.
- Ningún log incluye URL firmadas ni consultas del proveedor.
