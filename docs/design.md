# Dirección visual

La búsqueda actual se describe en [Búsqueda integrada](search-design.md): campo superior editable, categorías y continuaciones por scroll, conservando las cards y perfiles.

El inicio actual se describe en [Inicio centrado en la música](home-design.md): sugerencias con portadas grandes, escucha reciente y colecciones de ambas fuentes. Sustituye el héroe de importación y el disco decorativo anteriores.

Openfy es un reproductor personal para Luis, con una biblioteca local en Windows y escucha móvil en iPhone.

- Colores: fondo `#09090B`, superficie `#18181B`, texto `#F4F4F5`, secundarios `#A1A1AA`, verde `#1ED760`. Los colores ambientales salen de las portadas importadas.
- Tipografía: Segoe UI Variable en Windows y tipografía del sistema en iOS. Jerarquía clara, texto alineado a la izquierda y títulos de álbum completos cuando el espacio lo permita.
- Estructura: navegación lateral + biblioteca + reproductor persistente en PC. Barra de pestañas flotante + minirreproductor acoplado encima en iPhone (ver [Experiencia móvil](mobile-ux.md)). En pantallas anchas el reproductor ampliado muestra la letra sincronizada: a la izquierda una portada grande con título y artista debajo, a la derecha una columna de letra más corta, y todos los controles (posición, transporte y volumen) en una barra inferior. En Big Picture, sin letra sincronizada la portada, el título y los artistas quedan solos en el centro sobre la misma barra (ver [Big Picture](big-picture.md#sin-letra-sincronizada)). En pantallas estrechas (iPhone) abre con la portada grande; el botón de letra cambia a una cabecera compacta sobre la letra y la elección se recuerda en el dispositivo. No muestra la etiqueta de origen.
- Cristal en los controles superpuestos. Las listas permanecen legibles y opacas. La píldora del reproductor (72 px de alto, hasta 880 px), la cola y el panel de letras son cristal teñido con el color de la página. En la píldora, la línea de progreso fina se convierte en una barra para elegir posición al acercar el puntero: la portada y el título se desenfocan y aparecen el tiempo transcurrido y el restante (solo con puntero; en táctil los tiempos siguen en línea). «Efectos de transparencia» en Ajustes elige Predeterminado (sigue al sistema), Activados (cristal aunque Windows tenga la transparencia apagada, por ejemplo sin activar) o Desactivados (color de la página sólido). Los degradados más expresivos pertenecen al reproductor ampliado: la propia portada, deformada y en movimiento lento, llena la pantalla y conserva sus zonas negras (ver «Iluminación de portada»).
- En la PWA, el movimiento usa transformaciones y opacidad, se pausa con la página oculta y respeta movimiento reducido. La aplicación Windows incorpora fondos Direct3D reactivos en mini, widget y fullscreen, con un único análisis FFT y parada al pausar u ocultar las vistas; mantiene textos y controles nativos legibles.

## Identidad de artista (2026-11-20)

Cada página de artista toma su paleta de la imagen que dibuja (banner o retrato) y pinta con ella todo el panel de contenido, incluida la barra superior: `base` en la cabecera y las canciones, `secondary` en la discografía y `deep` en «Fans también escuchan», hasta fundirse con el fondo. La biografía solo se abre desde el botón de información de la cabecera. El tono sigue al desplazamiento. La cabecera ocupa todo el ancho y su imagen o vídeo se funde con `base`. El botón de reproducir es un disco blanco con el icono en `deep`, y los secundarios son de cristal. La regla (`shared/utils/artist-theme.ts` ↔ `Openfy.Core/ArtistTheme.cs` ↔ `ui/ArtistTheme.kt`, fijada por `tests/fixtures/artist-theme-contract.json`) limita la luminancia a 0,14 para que el texto principal y secundario cumplan AA. Las fotos casi grises dan un pizarra neutro. Detalles: [Identidad visual de artista](superpowers/specs/2026-11-19-artist-identity-design.md); vídeo: [Portadas animadas](motion-art.md#vídeo-de-cabecera-del-artista).

## Iluminación de portada (2026-11-14)

El fondo del reproductor ampliado, el mini y el widget muestrea la portada a 64×64 y la deforma con dos capas que giran en sentidos opuestos, sin una base negra. Una gradación compartida (`shared/utils/ambient.ts` ↔ `Openfy.Core/Ambient.cs`, fijada por `tests/fixtures/ambient-contract.json`) conserva los negros con una elevación mínima para mantener detalle en las sombras y contiene las portadas muy claras. El mínimo de luminancia es 0,04 (aproximadamente `#0A0A0A` antes del oscurecimiento), en lugar del 0,24 anterior que convertía el negro puro en `#3D3D3D`. El oscurecimiento depende de la luminancia media de la portada y solo es el necesario para que el texto blanco se lea; en el diseño dividido se añade un degradado detrás de la letra. Al cambiar de canción, las portadas se funden durante 1,2 s. Al pausar, el movimiento se congela en lugar de reiniciarse. Desde el 2026-11-15, la deriva y el giro van más rápido (`motionSpeed` 2,4) y el bajo deforma y acerca más la imagen. La PWA usa WebGL2 con los blobs CSS como respaldo; Windows usa el shader Direct3D gemelo. En pantallas táctiles (iPhone, iPad), la PWA dibuja como máximo 30 FPS, con el movimiento al 70 % y a 0,75 píxeles por píxel CSS, para que el teléfono no se caliente; el análisis de audio también muestrea a 30 FPS (`PHONE_AMBIENT` en `app/lib/ambient-gl.ts`). La gradación y `motionSpeed` compartidos no cambian.

La base oscura y el verde pertenecen a la identidad de Openfy. El inicio adopta la jerarquía de portadas y filas de Apple Music usando los datos reales de Openfy. Las pruebas utilizan bibliotecas aisladas; no se incluye música del usuario ni del catálogo de Apple Music como contenido de muestra.

```text
PC                                iPhone
+----------+------------------+   +-------------------+
| Openfy   | buscar / importar|   | openfy. / ajustes |
| inicio   | álbumes / pistas |   | biblioteca        |
| buscar   |                  |   |                   |
| colección|                  |   |                   |
+----------+------------------+   | minirreproductor  |
| reproductor persistente     |   | (pestañas flotan) |
+-----------------------------+   +-------------------+
```
