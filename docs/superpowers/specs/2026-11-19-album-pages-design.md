# Openfy · Detalle de álbum

Esta especificación cubre álbumes locales y de YouTube Music en Windows nativo, web, PWA instalada en iPhone y Android nativo. La referencia visual para las implementaciones nativas es el detalle web de Openfy.

## Principios

- La portada presenta el álbum. Su color ocupa toda la página y su vídeo, cuando está disponible, se limita al cuadrado de la portada.
- El título, el artista y las canciones conservan la jerarquía de Openfy. El verde identifica la acción principal y los estados que ya lo usan.
- La información aparece donde sirve. El año acompaña al artista. La cantidad de canciones y la duración resumen la lista. La descripción ocupa hasta tres líneas junto a los créditos.
- El vídeo y el cambio de tinte concentran el movimiento. La portada fija, los controles y las pistas están disponibles mientras se consulta la presentación.

## Tinte y contraste

Elegir la primera fuente disponible en este orden.

1. `artwork.bgColor` válido del álbum verificado en Apple Music.
2. Color dominante de la portada estática que muestra Openfy.
3. Base neutra `#09090B`.

Para el color dominante, reutilizar la portada decodificada y su recorte cuadrado centrado. Muestrear 64 × 64 puntos en el centro de cada celda, tomando el píxel que contiene el punto en el recorte. Leer RGB en sRGB de 8 bits, descartar alfa menor de 128 y agrupar por los cuatro bits altos de cada canal. Gana el grupo con más muestras. En empate, gana el menor índice `(R >> 4) * 256 + (G >> 4) * 16 + (B >> 4)`. Promediar los canales originales del grupo ganador, con `floor(x + 0.5)`. Si faltan píxeles útiles, usar la base. Guardar el resultado por identidad y revisión de la portada.

### Contrato `albumTint`

Revisado el 2026-11-20 tras medir 23 álbumes en Apple Music para la web (modo claro y oscuro). Apple toma el `bgColor` de la portada y, en modo oscuro, solo baja su luminosidad perceptual y limita el croma: **conserva el tono y la saturación**. La regla anterior mezclaba hacia `#09090B` en sRGB y apagaba el color (SATURNO quedaba en `#40434E`, gris, en lugar de `#242D45`). La regla nueva reproduce los 22 pares verificables byte a byte salvo uno, que difiere en 1/255.

La función acepta seis dígitos hexadecimales, con o sin `#`, en cualquier combinación de mayúsculas y minúsculas y tras quitar espacios exteriores. Ausencia o formato inválido equivalen a `#09090B`. Devuelve cuatro colores opacos `#RRGGBB` en mayúsculas. Usar `number` o `Double` y el mismo redondeo explícito en los tres lenguajes.

```text
q(x) = floor(x + 0.5)
mix(a, b, w)[i] = q(((100 - w) * a[i] + w * b[i]) / 100)

background:
  (L, a, b) = OKLab(input)            # sRGB → lineal → OKLab (constantes de Björn Ottosson)
  C = hypot(a, b); si C > 0.125, escalar (a, b) a C = 0.125
  L = min(L, 0.30)
  rgb = sRGB(OKLab⁻¹(L, a, b))        # recorte por canal a [0, 1] antes de codificar, q(255 · x)

surface = mix(background, white, 8)
muted   = background + (161, 161, 166), recortado por canal
          mientras contraste WCAG(muted, surface) < 4.5: mix(lifted, white, 10, 20, … 100)
edge    = mix(background, black, 28)
```

`muted` es el texto secundario «vibrante» de Apple: lleva el tono del álbum en lugar de un gris fijo. Los colores ya oscuros (L ≤ 0,30) no cambian de luminosidad. Las entradas de referencia de Apple Music (SATURNO, VICE VERSA, *Un Verano Sin Ti*, *Cosa Nuestra*, etc.) están en `tests/fixtures/album-tint-contract.json`, compartido por Vitest, xUnit y Android.

| Entrada | `background` | `surface` | `muted` | `edge` |
| --- | --- | --- | --- | --- |
| `#CBD8F7` · SATURNO | `#242D45` | `#363E54` | `#C5CEEB` | `#1A2032` |
| `#330076` · VICE VERSA (tope de croma) | `#301864` | `#412A70` | `#D1B9FF` | `#231148` |
| `#FB959F` · *Un Verano Sin Ti* | `#5C001A` | `#69142C` | `#FDA1C0` | `#420013` |
| `#A6771F` · *Cosa Nuestra* (recorte de gama) | `#4B2100` | `#593314` | `#ECC2A6` | `#361800` |
| `#FFFFFF` · blanco puro | `#2E2E2E` | `#3F3F3F` | `#CFCFD4` | `#212121` |
| `#0F1921` · *Tremendo Desastre* (se conserva) | `#0F1921` | `#222B33` | `#B0BAC7` | `#0B1218` |

- `background` cubre la página **y el marco** (ver «Composición»). `surface` pinta separadores de 1 unidad, filas bajo el puntero, la fila activa y los fondos de controles secundarios, también los de la barra superior. `edge` es la junta de 1 unidad del borde del sidebar.
- Usar `#F4F4F5` para título, texto principal y acciones de texto; `muted` para descripción, año, tiempos, créditos secundarios y cabeceras de la tabla. El verde `#1ED760` con texto `#09090B` queda para la acción principal. El foco usa un contorno visible de 2 unidades `#6DED9A` con 2 de separación. [WCAG 2.2 · Contraste mínimo](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum)
- Interpolar en **sRGB**, por canal, durante **240 ms** con `cubic-bezier(0.2, 0, 0.2, 1)`. Si cambia el destino, partir del color en pantalla. Con movimiento reducido o efectos apagados, aplicar el destino al instante.

## Composición

El tinte es **plano** desde la cabecera hasta el final del área desplazable. Llena también el espacio libre debajo de álbumes cortos y el relleno final de álbumes largos. Así las pistas siguen perteneciendo visualmente al mismo álbum hasta la última fila. Revisado el 2026-11-20: el color del álbum **también llega al marco**, como en Apple Music. En escritorio la ventana entera toma `background`, el sidebar es translúcido sobre él, la barra superior usa `surface` en sus controles y el reproductor flotante es un cristal teñido. En teléfono el color llega de borde a borde (barra de estado incluida) y la barra de pestañas y el mini reproductor son cristal teñido. Al salir de la página, el marco vuelve al neutro. Web: `app/assets/page-chrome.css` y `usePageChrome`.

Quitar las etiquetas visibles «Álbum» y «YouTube Music» encima del título. La portada y la lista ya identifican el tipo de página. Conservar el artista en una línea propia, con enlace cuando exista uno, y el año debajo. En álbumes locales, mostrar año cuando los valores válidos de las pistas coincidan. Omitir el año desconocido. Junto a la lista, mostrar su cantidad de canciones y la duración si todas las pistas del conjunto tienen duración válida. Usar el conjunto sin filtrar y, si solo hay una copia sin conexión, el conjunto disponible en esa copia.

### Escritorio · web y Windows

Medir el ancho **del panel de contenido**. A partir de 720 px CSS o DIP, usar márgenes laterales de 32, portada de **224 × 224**, radio 12 y separación entre columnas de 28. Alinear el comienzo del título con la parte superior de la portada. Título 44/48, artista 17/23, año 13/18 y descripción 14/21. Permitir que el título ocupe las líneas necesarias. Colocar la fila de acciones 20 unidades debajo de la cabecera y el resumen de pistas 24 debajo de las acciones.

Entre 560 y 719 unidades, usar portada de 168, separación de 20, margen de 24 y título 34/40. Por debajo de 560, usar la composición compacta. La web en modo teléfono usa la composición compacta aunque el ancho disponible sea mayor.

```text
+--------------+----------------------------------------------------------+
| Navegación   | Barra global                                             |
|              +----------------------------------------------------------+
|              | [ Volver ]                  inicio del panel tintado    |
|              | +---------------+  Un Verano Sin Ti                      |
|              | |               |  Bad Bunny                             |
|              | | Portada 224   |  2022                                  |
|              | | x 224         |  Descripción de hasta tres líneas...   |
|              | |               |  Más                                   |
|              | +---------------+                                        |
|              | [ Reproducir ] [ Descargar en este PC ]                  |
|              | 23 canciones   1 h 21 min     [ Filtros si aplican ]     |
|              | #  Título                  Artista      Duración      ...|
|              | -------------------------------------------------------- |
|              | 1  Moscow Mule             Bad Bunny        4:05      ...|
|              | -------------------------------------------------------- |
|              | 2  Después de la Playa     Bad Bunny        3:51      ...|
|              |                        ... hasta el final con el tinte   |
+--------------+----------------------------------------------------------+
| Reproductor persistente                                                 |
+-------------------------------------------------------------------------+
```

Usar cabecera de tabla de 36 y filas de al menos 48. Alinear tiempos a la derecha con dígitos tabulares. Mantener los controles y la ordenación que ofrece cada lista. El modo de álbum puede retirar la columna «Álbum» cuando repite el título de la página, y la miniatura de fila cuando repite la portada. El número y el título conservan el acceso a reproducir. Mantener accesibles las acciones y estadísticas existentes al compactar columnas. Identificar la pista activa con un icono y su estado semántico además del fondo.

### Teléfono · web, PWA y Android

Usar márgenes laterales de 20 y portada centrada de `min(216, floor(0.56 × ancho del panel), ancho del panel − 40)` px CSS o dp. A 390 unidades la portada mide **216 × 216**. Debajo, dejar 16 unidades y alinear título, créditos, descripción y acciones a la izquierda. Usar título 28/32, artista 16/22, año 13/18 y descripción 14/21, con escala de texto del sistema. Las acciones pueden pasar a otra línea. Sus objetivos táctiles miden al menos 48 × 48.

Omitir la cabecera de columnas en teléfono. Cada fila de al menos 56 unidades muestra número, título, duración cuando se conoce y menú. Mostrar el crédito secundario debajo del título si aporta artistas distintos a los de la cabecera. Colocar las acciones de fila que pierdan espacio en el menú existente. El último objetivo queda por encima del reproductor, la navegación y el área segura.

```text
+----------------------------------+
| [ Volver ]                       |
|         +--------------+         |
|         | Portada 216  |         |
|         | x 216        |         |
|         +--------------+         |
| Un Verano Sin Ti                 |
| Bad Bunny                        |
| 2022                             |
| Descripción del álbum de hasta   |
| tres líneas...                   |
| Más                              |
| [ Reproducir ] [ Descargar ... ] |
| 23 canciones   1 h 21 min        |
| -------------------------------- |
| 1  Moscow Mule          4:05 ... |
| -------------------------------- |
| 2  Después de la Playa  3:51 ... |
| ...                              |
+----------------------------------+
| Minirreproductor y navegación    |
+----------------------------------+
```

Usar «Reproducir» y el nombre de descarga según su destino, «Descargar en este dispositivo» o «Descargar en este PC». Conservar los estados y acciones de descarga actuales.

## Descripción y «Más»

- Mostrar el texto tras los créditos, separado por 12 unidades, con un ancho de **65ch** como máximo. En nativo, limitarlo al ancho del avance de 65 ceros de la fuente de cuerpo, o al espacio disponible si es menor.
- Conservar párrafos y saltos de línea. Limitar a tres líneas visuales con elipsis. Mostrar **«Más»** en su propia línea solo si hay desbordamiento real. Medir de nuevo al cambiar ancho, texto o escala tipográfica.
- «Más» abre el texto completo en un diálogo o una hoja desplazable. El título es el nombre del álbum. La atribución aparece al final del texto, como «Texto de Apple Music» o «Texto de YouTube Music». El disparador anuncia que abre un diálogo. Al cerrar, recuperar foco y posición de desplazamiento.
- Reutilizar `AppDialog` en web. En Windows, usar el tratamiento de enlace de «Más información» y abrir un `ContentDialog` con contenido desplazable. En Android, reutilizar la medición de `ExpandableBiography` y dirigir su acción al diálogo de álbum.
- Si no hay texto, retirar todo el bloque y su margen. Si llega tarde mientras el usuario está en las pistas, mantener anclada la fila visible.

## Portada animada

1. Dibujar primero la portada fija. El vídeo usa el mismo cuadrado, recorte y radio. Reproducirlo en silencio, en bucle y dentro de la página. Su avance es independiente de la reproducción musical.
2. Solicitar vídeo solo cuando coincidan «Portadas animadas» habilitada, efectos habilitados, movimiento reducido desactivado, red sin medición reportada y portada visible en una página activa. Evaluar la intersección de la **portada** con el área realmente visible, descontando las barras que la cubren.
3. Mostrar la capa de vídeo tras el **primer fotograma presentado**. Subir su opacidad de 0 a 1 en **160 ms**, con la imagen fija debajo. Si se rechaza la reproducción, falla el recurso o pasan **8 s de intento visible** sin un fotograma, volver a la imagen fija. Aplicar el plazo a la reproducción del medio, a partir de asignar la fuente, y respetar el plazo de reintento del proveedor.
4. Al salir del área visible, ocultarse la página o quedar cubierta por un diálogo o el reproductor ampliado, pausar el vídeo y el trabajo de fotogramas. Al volver, revalidar las condiciones y reanudar si se conserva el decodificador. Si la plataforma lo liberó, partir de la portada fija hasta presentar un fotograma nuevo. Al cambiar de álbum o de ruta, liberar el medio y descartar eventos de la instancia anterior.
5. Al activar movimiento reducido, apagar efectos o portadas animadas, o detectar una red medida, volver de inmediato a la imagen fija y retirar la fuente de vídeo. Esto también aplica a un vídeo en caché.

Web y PWA detectan `navigator.connection.saveData` o `type === 'cellular'` y escuchan cambios. Cuando el navegador no expone esas señales, se conserva la decisión actual de Openfy de permitir vídeo bajo la preferencia del usuario. En la PWA de iPhone, el bloqueo de red medida solo se puede verificar donde existe una señal del navegador. [Política de WebKit sobre Network Information API](https://webkit.org/tracking-prevention/)

## Estados

| Estado | Comportamiento |
| --- | --- |
| Primera carga | Fondo neutro, portada fija y datos de álbum en cuanto estén disponibles. Aplicar el tinte al resolver la presentación. Si la consulta sigue pendiente a los 800 ms y ya hay dominante de portada, usar ese dominante. Si después llega el color de Apple, interpolar desde el color visible. |
| Navegación entre álbumes | Con un destino en caché, pasar directamente del tinte anterior al nuevo. Con un destino pendiente, iniciar el paso a neutro al cambiar de álbum y retomar desde el color visible cuando llegue el destino. Cambiar contenido, créditos y portada con su propia identidad de ruta. |
| Sin coincidencia en Apple | Usar dominante de portada y descripción de YouTube Music si se verifica el álbum. Mantener la portada fija. |
| Sin descripción | Retirar el bloque por completo. La cabecera y las acciones conservan sus separaciones normales. |
| Sin vídeo compatible | Mantener la portada fija. Aplicar el color y el texto disponibles. |
| Error de vídeo | Volver a la portada fija en la misma caja. Respetar la espera del proveedor. Ante un fallo terminal del decodificador, suprimir nuevos intentos para esa URL durante la sesión. |
| PWA sin conexión, álbum descargado | Mostrar portada y pistas disponibles. Usar color y texto de la copia de presentación, aunque haya vencido su plazo de actualización. Sin copia, calcular el dominante con la portada guardada. Sin portada legible, usar neutro. |
| Movimiento reducido | Portada fija y cambio de tinte instantáneo. |
| Portadas animadas apagadas | Portada fija. El color y la descripción se resuelven normalmente. |
| Efectos apagados | Portada fija y cambio de tinte instantáneo. El color y la descripción se resuelven normalmente. |
| Ahorro de datos, red celular o medida detectada | Portada fija, incluso con vídeo en caché. Conservar color y descripción. Revalidar al cambiar la red. |
| Fallo de presentación | Usar la última presentación válida del mismo álbum, si existe. En su defecto, dominante o neutro y texto de catálogo ya disponible. La lista sigue operativa. |

## Contrato de datos

`POST /api/albums/presentation` para web, PWA y Windows. Android obtiene los mismos campos en el dispositivo.

```ts
type AlbumPresentationRequest =
  | { source: 'local'; albumId: string }
  | { source: 'youtube'; artists: string[]; album: string }

type AlbumPresentation = {
  motion: MotionArtResult
  description?: { text: string; source: 'apple' | 'youtube' }
  colors?: {
    background: string
    text1: string | null
    text2: string | null
    text3: string | null
    text4: string | null
  }
}
```

`colors.background` contiene el color original de Apple normalizado como `#RRGGBB`. Si falta un fondo válido, omitir `colors`. Normalizar `textColor1` a `textColor4` cuando existan y usar `null` para valores ausentes o inválidos. El cliente aplica `albumTint` al fondo y usa los colores de texto de Openfy establecidos en esta especificación. `MotionArtResult` conserva sus estados, dimensiones, plazos y URL relativa a Openfy. [Apple Music API · Álbum de catálogo](https://developer.apple.com/documentation/applemusicapi/get-a-catalog-album)

### Resolución

- Validar el cuerpo. Para `local`, resolver el `albumId` en la biblioteca y usar título y artista de álbum de la colección, priorizando `albumArtist`. Para `youtube`, usar título y artistas acreditados de la ficha, con el principal primero. Reutilizar los límites de entrada y la normalización de `resolve.post.ts`. Una firma sin artista o título verificable puede usar su portada local.
- Reutilizar la búsqueda estricta de Apple de `apple-motion.ts`. Seleccionar el primer resultado verificado en el orden existente, iTunes seguido de búsqueda Apple Music. Confirmar nombre y artista en el detalle. Fijar el ID de Apple antes de consultar si existe vídeo. Usar ese ID para color, texto y carátula animada, incluso si otra edición ofrece más campos.
- Consultar `albums/{id}` con `l=es-MX`. Preferir `editorialNotes.standard`, luego `short`. Si ambos están vacíos o la tienda rechaza el idioma, repetir con `en-US` en una tienda compatible y verificar el mismo álbum. Usar el primer `bgColor` válido de ese ID. Convertir el marcado de las notas a texto plano, tratando los saltos y las entidades antes de mostrarlo. [Apple · Localización](https://developer.apple.com/documentation/applemusicapi/storefronts-and-localization), [Apple · EditorialNotes](https://developer.apple.com/documentation/applemusicapi/editorialnotes)
- Añadir `description?: string` a `YouTubeAlbumDetail`. Extraer `header.description` con `musicText` en `getYouTubeAlbum` y conservarlo en ambas rutas de carga de pistas. En la vista YouTube, el respaldo de texto viene del detalle abierto por ID. Para el endpoint por firma y para álbumes locales, reutilizar un ID de YouTube asociado y verificable si existe. En su defecto, buscar la primera página de álbumes y leer el encabezado solo si hay un único resultado con título normalizado igual y artista principal coincidente. Si hay ambigüedad, omitir el texto de respaldo. Esta consulta solo necesita el encabezado de YouTube.
- Separar la consulta de metadatos de la transferencia de vídeo mediante `X-Openfy-Album-Motion`. `0` u omitida devuelve texto y color con `motion: { status: 'none' }` como marcador de esa consulta. `1` solicita también la resolución del vídeo y se envía únicamente bajo las condiciones de reproducción. Ambas comparten coincidencia y metadatos. Un fallo transitorio del vídeo puede devolver los campos válidos con `motion: { status: 'none', retryAfterMs }`. Ese plazo es un reintento, no una ausencia confirmada. `OPENFY_MOTION_ART=off` conserva el bloqueo de nuevas consultas a Apple y permite leer resultados ya guardados.

### Caché e identidad

- Identificar el estado de la vista por origen e ID de ruta. Identificar la consulta de catálogo por firma normalizada de artista principal y título, tienda y política de idioma. Distinguir coincidencia, ausencia confirmada y fallo transitorio. Compartir solicitudes en curso por clave.
- Revalidar metadatos positivos a los **7 días** y ausencias confirmadas a las **24 h**. En un fallo transitorio conservar datos válidos y esperar **15 min** o el plazo mayor del proveedor. El endpoint devuelve `200` parcial y `Retry-After` en segundos si falló la consulta de metadatos. Los campos ausentes en una respuesta parcial no reemplazan campos válidos del mismo álbum.
- Reutilizar el almacenamiento de vídeo actual y sus plazos, con ausencia verificada de **30 días**, sin coincidencia de **24 h** y espera transitoria de **15 min** o la que indique el proveedor. El marcador de la petición `0` carece de efecto sobre esa caché. Reutilizar el archivo por ID de Apple cuando corresponda al álbum seleccionado.
- Asociar a cada álbum descargado su última copia válida de texto, colores y dominante, junto con la identidad de portada y una versión del formato. Las copias anteriores siguen siendo legibles. La PWA guarda estos datos en IndexedDB y utiliza sus descargas de portada existentes. El MP4 de cabecera queda fuera de la descarga PWA.
- Vincular cada respuesta, paleta y primer fotograma a la generación de navegación que los solicitó. La llegada de datos desactualizados puede alimentar su propia caché; solo la generación activa puede pintar o reproducir.

## Implementación por superficie

### Web y PWA

- `app/pages/[[...view]].vue` activa la presentación solo en la ruta de álbum local y toma el ID de la colección. `app/pages/music/album/[id].vue` usa el detalle de YouTube y su copia offline. Ambas rutas comparten composición y estado de presentación.
- `CollectionHeader.vue` aloja el modo de álbum. `AlbumCover.vue` conserva el marco y la imagen y recibe el vídeo en su ranura. Medir la visibilidad continuamente para animación, además de la observación inicial que ya usa la imagen.
- Actualizar `useMotionArt.ts` y `MotionArt.vue` para reutilizar elegibilidad, errores y ciclo de vida con una identidad de álbum explícita. En la cabecera, preferir `requestVideoFrameCallback` para revelar el vídeo. Mantener la semántica de pausa musical de `ImmersivePlayer.vue` en el reproductor ampliado.
- En `app/assets/main.css`, unificar las reglas de álbum de `.collection-heading`, `.collection-header`, `.catalog-album-hero` y sus variantes de teléfono cerca de la línea 1030. Aplicar los tokens a la región desplazable del álbum bajo la barra global. `CollectionTrackList.vue` y `YouTubeTrackList.vue` consumen los tokens y el modo de columnas solo en esa región.
- Tomar el tratamiento tipográfico de `.catalog-biography` y `app/pages/music/artist/[id].vue`, y alojar el texto completo en `AppDialog`. Para el dominante, reutilizar la ruta de decodificación de `AmbientCanvas.vue` y el principio de cálculo compartido de `shared/utils/ambient.ts`. `thirds()` calcula promedios por franjas para el reproductor y queda fuera del cálculo de álbum.

### Windows · WinUI

- `MainWindow.Catalog.cs` usa el modo de álbum desde `BuildCollectionCatalog` y `CatalogHeroLayout`. `MainWindow.Collection.cs` aplica la misma composición en `BuildSavedCollection` para `localalbum`. Actualizar el texto dentro de la cabecera cuando llegue y abrir el diálogo desde «Más».
- `MainViewModel.cs` carga la presentación a partir de `AlbumAsync` y de la navegación al álbum local. Usar `contentGeneration` y cancelación. Actualizar pinceles y elementos de cabecera en su sitio para conservar el foco, la lista virtualizada y su posición.
- Aplicar el pincel al viewport de `pageScroll` y a su contenido en `MainWindow.Shell.cs`, incluidos los huecos y el área horizontal de pistas. Reutilizar el flujo de portada preparada de `CatalogArtworkView` y muestrear sus píxeles. Implementar `albumTint` en `Openfy.Core`.
- Extraer de `Views/PlayerWindow.Motion.cs` el ciclo reutilizable de `MediaPlayer`, fotograma presentado y recorte Win2D. En la cabecera, conectar visibilidad con `ScrollViewer.ViewChanged`, minimización, navegación y visibilidad de ventana. Consultar el coste y el tipo WWAN del perfil de red activo y volver a consultarlos con `NetworkStatusChanged`. [Microsoft Learn · NetworkInformation](https://learn.microsoft.com/uwp/api/windows.networking.connectivity.networkinformation)

### Android · Compose

- Resolver la presentación una vez por destino en `OpenfyViewModel` y `MotionRepository.kt`. Leer `artwork`, `editorialNotes` y, cuando se habilite vídeo, `editorialVideo`, directamente de Apple. El adaptador QuickJS ya comparte `getYouTubeAlbum`. Pasar su descripción y los créditos desde el detalle por ID.
- En `DetailScreen.kt`, aplicar la composición a `album` y `localalbum`. Usar `ExpandableBiography` para medir el desbordamiento. Para álbumes locales, identificar presentación por artista de álbum y título. Si la agrupación por título de una vista local antigua reúne artistas incompatibles, usar el dominante y omitir el enriquecimiento ambiguo.
- Cambiar `artworkTint` y `collectionBackdrop` en la rama de álbum para que el fondo plano viva en el contenedor del `LazyColumn` de `OpenfyApp.kt`. `CoverPalette.kt` reutiliza la carga de portada e incorpora el muestreo de álbum. `Theme.kt` expone los cuatro tokens a cabecera, controles y filas.
- `MotionArtwork.kt` conserva el arrendamiento de un solo decodificador y el primer fotograma de Media3. Para la cabecera, intersectar con el viewport y reevaluar al cambiar el ciclo de vida. Bloquear vídeo al detectar medición, transporte celular o ahorro de datos activo, incluida la reproducción desde caché. Usar `ConnectivityManager` y observar tanto capacidades como cambios de ahorro. [Android Developers · Data Saver](https://developer.android.com/develop/connectivity/network-ops/data-saver)
- Registrar la paridad en `docs/native-design-parity.md` y la integración sin servidor en `docs/android-native.md`. Documentar en `docs/motion-art.md` la elegibilidad de cabecera y en `docs/design.md` la composición y el contrato de color.

## Criterios de aceptación

- [ ] Revisar un álbum local y uno de YouTube Music en las cuatro superficies. Capturar un tinte rojo, uno azul oscuro, una portada muy clara y un álbum sin coincidencia de Apple.
- [ ] Verificar el color hasta la última pista y debajo de una lista corta. Confirmar que navegación, barra global y reproductor conservan su tratamiento visual al navegar y desplazar.
- [ ] Ejecutar el mismo fixture de colores en TS, C# y Kotlin. Verificar 4,5:1 para texto principal y secundario sobre fondo, resaltado y transición. Revisar foco por teclado y escala de texto.
- [ ] Revisar a 390 px CSS, Android compacto y ventana Windows estrecha. Confirmar que título y acciones caben, que los menús siguen accesibles y que puede leerse y accionarse la última fila.
- [ ] Probar tres líneas exactas, cuatro líneas y ausencia de descripción. Verificar «Más», título del diálogo, texto íntegro, atribución, cierre, retorno del foco y prioridad `es-MX` → inglés → YouTube Music.
- [ ] Probar primer fotograma, bucle silencioso, error, rechazo de reproducción, salida del viewport, segundo plano, diálogo y regreso. Confirmar que pausar música deja avanzar la portada visible y que salir del álbum elimina el vídeo anterior.
- [ ] Activar en caliente movimiento reducido, efectos apagados, portadas apagadas y red medida detectable. Verificar que se retira el vídeo, incluso desde caché, y que el modo de metadatos sigue disponible. Repetir el arranque y el regreso de segundo plano en un iPhone físico con la PWA instalada.
- [ ] Abrir la PWA sin conexión con un álbum descargado, primero con copia de presentación y luego con solo portada guardada. Confirmar reproducción de pistas descargadas, tintes de respaldo y compatibilidad con copias antiguas.
- [ ] Simular navegación rápida A → B → A y respuestas invertidas. Confirmar que el color, el texto y los fotogramas siempre pertenecen al álbum activo. Verificar que un fallo transitorio conserva caché válida y que dos ediciones no comparten recursos por error.
## Ajustes de integración (prevalecen sobre las secciones anteriores)

- **Petición.** El cuerpo es `{ source: 'local'; trackId: string; motion?: boolean } | { source: 'youtube'; albumId?: string; artists: string[]; album: string; motion?: boolean }`. Para un álbum local se envía el `trackId` (uuid) de una de sus pistas locales; el servidor lee sus metadatos como `resolve.post.ts`, priorizando el artista de álbum. Los grupos de la biblioteca formados por canciones de YouTube (`youtube:…`) usan `source: 'youtube'`. `motion: true` sustituye a la cabecera `X-Openfy-Album-Motion`; sin él, `motion` vale `{ status: 'none' }`.
- **Respaldo de YouTube Music.** Solo para `source: 'youtube'` con `albumId` válido (`MPRE…`): el servidor toma `description` de `getYouTubeAlbum(albumId)`, que ya está en caché tras abrir la página. No se hacen búsquedas adicionales en YouTube para álbumes locales ni para firmas sin ID.
- **Copia sin conexión en la PWA.** La última presentación válida (texto, colores y dominante) se guarda como campo opcional `presentation` del registro `OfflineCollection` del álbum descargado. No se crean tablas ni índices nuevos, así que la versión de Dexie no cambia.
- **Windows y red medida.** Basta con consultar `NetworkInformation.GetInternetConnectionProfile()?.GetConnectionCost()` (`NetworkCostType` distinto de `Unrestricted`, o `Roaming`/`OverDataLimit`) al resolver y en `NetworkStatusChanged`.

## Reutilización de la identidad de artista

Se construye sobre `docs/superpowers/specs/2026-11-19-artist-identity-design.md` en lugar de duplicar piezas:

- **Windows.** El vídeo de cabecera usa `Views/LoopingVideo.cs` (Win2D, `Fade`), en lugar de extraer código de `PlayerWindow.Motion.cs`. El tinte de página generaliza el lavado de `MainWindow.Artist.cs` (`UpdateArtistWash`/`ArtistColorAt`) y el enganche `AttachArtistWash` de `MainWindow.Shell.cs`. El muestreo y la caché de sesión vienen de `Views/ArtistThemes.cs`.
- **Servidor.** `apple-motion.ts` y `motion-art.ts` ya distinguen firmas de álbum y de artista. El álbum añade la lectura de `editorialNotes` y `artwork.bgColor`, que la parte de artista no usa.
- **Web.** Se toma como modelo `useArtistTheme.ts`/`useArtistMotion.ts` y el tinte de `DetailBar`.
- **Android.** Se extiende la búsqueda de álbum de `MotionRepository.kt` y la rama de álbum de `DetailScreen.kt`, junto a las rutas de artista.
- **Regla de color.** `albumTint` sigue siendo una regla propia: parte de un único color (el `bgColor` de Apple o el dominante de la portada), mientras que `artistTheme` parte de una muestra de 16 × 16 píxeles y da tres fondos por sección. Las dos garantizan contraste AA para el texto blanco, aunque con límites distintos: `albumTint` es más estricto (0,085), porque también protege el texto apagado sobre `surface`.
