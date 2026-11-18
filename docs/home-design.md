# Inicio centrado en la música

## Iteración de descubrimiento

El algoritmo v2 sustituye el radio de tres canciones por seis fuentes de gustos: tres anclas de escucha y tres artistas que rotan entre las siguientes preferencias. Combina canciones relacionadas, artistas similares y sus discografías. Excluye toda la biblioteca y el historial, por ID y por título/artista normalizados para no reintroducir vídeos oficiales, remasterizaciones o ediciones equivalentes.

La selección intenta reservar dos de cada tres lugares a artistas que no figuran en la colección ni el historial, limita cada artista y álbum a dos canciones y prioriza material del año actual o anterior. Para artistas nuevos consulta sus álbumes recientes y rota pistas de esos álbumes; no depende únicamente de sus éxitos principales. Los contadores persistidos de exposición reducen la repetición al pulsar «Actualizar». Si no hay suficientes alternativas, conserva una selección más corta sin rellenarla con música conocida.

«Lanzamientos de [año]» reemplaza «Añadido recientemente». Solo muestra álbumes/singles cuyo año de publicación consta en el catálogo y coincide con el año actual; descarta discos ya conocidos, reediciones identificables, años futuros y datos sin fecha. Un año confirmado no demuestra el día o mes de publicación: la interfaz muestra el año, no afirma que algo haya salido esta semana.

La caché del servidor usa `home-discovery-v2` y dura una hora; se filtra de nuevo contra la biblioteca/historial en cada lectura. Los candidatos y contadores son internos y no se incluyen en la respuesta HTTP. Los clientes usan `listening-discovery-v2`, rechazan versiones antiguas y retiran canciones cuando pasan a estar escuchadas o guardadas. El contrato de recomendaciones añade `releases` y `algorithmVersion` sin migrar SQLite. Las consultas del generador tienen un límite global de veinte segundos; una caída conserva únicamente sugerencias en caché que sigan siendo desconocidas.

La regresión se comprueba con `tests/unit/discovery.test.ts`, además de telemetría y los recorridos de inicio en la apariencia única de Windows y web/PWA. La validación real se realiza sobre una copia consistente de la biblioteca, sin escribir en el historial habitual.

El inicio de Windows y web comparte desde el 14 de noviembre de 2026 una jerarquía inspirada en Apple Music, conservando la identidad de Openfy. La estructura se aplica a la apariencia única de la aplicación.

## Dirección visual

Fondo `#141416`, superficies `#202024`, texto `#F4F4F5`, secundarios `#A1A1AA`, verde `#1ED760` y separadores `#303034`. Segoe UI Variable en Windows y fuentes del sistema en web. Títulos alineados a la izquierda; las portadas aportan el color principal.

La primera fila, «Sugerencias para ti», utiliza tarjetas verticales de 280 × 350 px. La portada se muestra completa y cuadrada en la parte superior; la franja inferior continúa en el color dominante de la portada (oscurecido para mantener contraste AA) y contiene el título y el artista. Así la portada nunca se recorta para llenar una tarjeta vertical. Las siguientes filas utilizan portadas cuadradas de 180 px. En móvil web se reducen a 260 × 325 y 156 px. Cada fila contiene como máximo doce elementos, permite desplazamiento independiente y dispone de botones anterior/siguiente con ratón o trackpad; en pantallas táctiles las filas se deslizan con el dedo, llegan de borde a borde y se ajustan al margen de la página. En el teléfono, «Actualizar» es un icono para que el título de la fila quepa en una línea. Las flechas del teclado y las teclas Inicio/Fin desplazan el foco entre tarjetas.

El resto del inicio muestra lanzamientos del año, «Escuchado recientemente» y «Tus favoritas y playlists». No hay promoción grande de importación, disco decorativo ni pasos de bienvenida. Las métricas, el período de escucha y los avisos de sincronización están en «Más reproducidas». El estado completamente vacío ofrece búsqueda e importación en un bloque breve.

## Datos y acciones

- Las recomendaciones usan `/api/music/recommendations` con el algoritmo v2 descrito arriba. Se usan las portadas reales y no se crean estaciones ficticias.
- `GET /api/telemetry/recent?limit=12` devuelve `{ items: RankedTrack[] }`. Acepta límites enteros de 1 a 24. Ordena canciones únicas con escucha positiva por `lastPlayedAt` descendente y por ID para desempatar. Conserva las referencias de YouTube no guardadas y omite archivos locales eliminados; no exige alcanzar el 90 % de una canción.
- La colección comprende archivos locales y canciones guardadas de YouTube. Los álbumes recomendados se seleccionan por su año de publicación y afinidad; la fecha de guardado no se interpreta como fecha de lanzamiento.
- Seleccionar una canción reproduce esa fila desde la selección. El menú conserva favoritos, cola y playlists. Las tarjetas de colecciones abren sus vistas existentes.
- Los clientes muestran caché antes de actualizar. Un fallo al actualizar sugerencias conserva las portadas disponibles. Las actualizaciones de Windows conservan foco y desplazamiento; una renovación del tiempo escuchado no reconstruye filas idénticas.

## Revisión

Las pruebas de `home.spec.ts` cubren una colección de YouTube sin archivos locales, reproducción y cola, navegación a playlists, teclado, desplazamiento horizontal, caché, fallos del proveedor y estado vacío. Se ejecutan con Chromium y WebKit móvil. Las pruebas de telemetría comprueban escucha parcial, deduplicación, límites y archivos eliminados.

La revisión nativa usa `--visual-check <directorio> --visual-home-only` con datos y estado aislados. Genera capturas a 1360, 960 y 780 px y comprueba conservación de foco y desplazamiento tras actualizar el historial. La biblioteca de revisión debe estar poblada. Las capturas no modifican la biblioteca habitual.
