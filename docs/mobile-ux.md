# Experiencia móvil (iPhone, PWA)

La búsqueda actual sigue [Búsqueda integrada](search-design.md): campo compartido en la cabecera, cuatro categorías y scroll automático. Sustituye el buscador interior y sus pestañas de fuente descritos en esta revisión anterior; Buscar permanece en la barra inferior.

Revisión del 15 de noviembre de 2026 (versión 0.4.0). La PWA se recorrió en una vista de iPhone de 390 × 844 px, contra una biblioteca aislada. El objetivo es un iPhone con iOS 27, usado como app instalada en la pantalla de inicio.

## Alcance

Todo vive en la sección «Teléfono» de `app/assets/main.css`, que se aplica en dos casos:

- `max-width: 760px`;
- pantallas táctiles en horizontal: `(pointer: coarse) and (max-height: 500px)`.

La ventana nativa de Windows mide al menos 780 px, así que no cambia. La regla compartida del reproductor ampliado (`shared/utils/immersive.ts`) y su contrato siguen iguales: en el teléfono el componente deja de forzar la letra y usa el diseño `cover`, que ya existía.

## Decisiones

- **Geometría:** los tokens `--safe-top/right/bottom/left` (`env(safe-area-inset-*)`) y `--gutter` (20 px) rigen toda la sección. Las pruebas los sobrescriben para simular la Dynamic Island, porque los emuladores informan 0 px.
- **Cabecera:** solo logo (enlace a Inicio) y ajustes, con área táctil de 44 px, bajo `--safe-top`. «Importar música» se mueve a Tu biblioteca (icono de subir) y a Ajustes.
- **Barra de estado en iOS 26/27:** `.status-backdrop` es una franja fija y sólida de `max(6px, --safe-top)` en la parte superior. Una prueba independiente indica que así iOS pinta la barra de estado opaca en lugar del difuminado de las apps instaladas; Apple no lo documenta. Se conservan `black-translucent` y `viewport-fit=cover`.
  - Con el reproductor ampliado abierto (también en Big Picture) la franja se oculta: aunque el `<dialog>` está en la capa superior, iOS seguía tiñendo la barra de estado con el color de la página o del artista.
  - En la página de artista, arriba del todo, la franja es transparente (la sombra superior del banner mantiene legible la barra) para que el banner o el vídeo lleguen al borde; al desplazarse (140–280 px, animación vinculada al scroll) recupera el color del artista. Sin animaciones vinculadas al scroll queda sólida. En esa página el campo de búsqueda de la cabecera se oculta en el teléfono; Buscar sigue en la barra inferior.
- **Barra de pestañas:** cápsula flotante de cristal (estilo de iOS 26/27), con el mini reproductor acoplado encima.
  - Al desplazarse hacia abajo se reduce a la pestaña actual y el mini reproductor pasa a su lado; al subir vuelve a su tamaño.
  - La pestaña activa se recuerda en las páginas de detalle, como las pilas de navegación de iOS.
  - Tocar otra vez la pestaña activa sube al inicio de la página.
- **Mini reproductor:** solo aparece con música en la cola. Tiene una línea de progreso, toda su superficie abre el reproductor ampliado, y deslizarlo hacia arriba también.
- **Filas:** tocar cualquier parte de la fila reproduce la canción. Duración, favorito y «+ cola» pasan al menú de opciones. La reproducción o los minutos solo aparecen al ordenar por ellos.
- **Menús y diálogos:** en el teléfono, todos los `AppDialog` son hojas inferiores con asa, que se cierran arrastrando hacia abajo. Un toque en el relleno del diálogo ya no lo cierra.
- **Opciones de canción:** `SongActionsSheet` es el único menú de canción para listas, tarjetas y reproductor, siempre con el mismo orden: Favoritos, Cola, Descarga, Ir al álbum, Ir al artista, acciones de la playlist y Añadir a playlist. También se abre con una pulsación larga.
- **Reproductor ampliado (pantallas estrechas):** abre con la portada. El botón de letra cambia a la vista con letra y la elección queda guardada en `openfy-immersive-lyrics`.
  - Tiene botón «…» con las opciones de la canción.
  - La cola se abre como hoja encima del reproductor, con «Sonando ahora».
  - Se cierra arrastrando la cabecera o la portada hacia abajo.
  - Tiene su propia entrada de historial (`?overlay=player`), así que el gesto Atrás lo cierra sin salir de la página. Navegar desde sus opciones sustituye esa entrada.
  - Las pantallas anchas no cambian.
- **Navegación:** `DetailBar` vuelve con el historial propio de Openfy, o a la raíz de la pestaña tras un arranque en frío. En el teléfono es una barra fija cuyo título compacto aparece al desplazarse (animación vinculada al scroll, si el navegador la admite).
- **Transiciones:** View Transitions entre páginas. Al avanzar, la página nueva entra desde la derecha; al volver, sale hacia la derecha; entre pestañas hay un fundido. En escritorio el cambio es instantáneo. Si iOS ya anima el gesto Atrás, Nuxt omite la transición propia.
- **Biblioteca:** pestaña Playlists, accesos a Tus favoritas y Más reproducidas, y una hoja «Ordenar». En el teléfono no había forma de ordenar.
- **Colecciones:** héroe centrado y una fila de acciones (aleatorio, descarga, «…» y reproducir). La fila de búsqueda y filtros se mantiene también en colecciones cortas: «Solo descargadas» es lo más útil sin conexión, y ocultarla hacía desaparecer el campo al borrar la búsqueda.
- **Buscar:** el campo va arriba y queda fijo. Después vienen las cinco primeras canciones, los carruseles de artistas y álbumes, y el resto de canciones con carga continua. No se enfoca solo: iOS no abre el teclado si el foco no viene de un toque.
- **Campos:** todos tienen al menos 16 px en pantallas táctiles, para que iOS no amplíe la página. La búsqueda desactiva mayúsculas y autocorrección, y la tecla Buscar cierra el teclado.
- **Ajustes:** el orden es Actualizaciones, Biblioteca, Reproducción, Aplicación para Windows y Diagnóstico, este último plegado. «Movimiento ambiental» usa el interruptor nativo de iOS (`<input type="checkbox" switch>`).
- **Descargas:** borrar una descarga terminada pide confirmación. La tarjeta de almacenamiento indica si el sistema protege las descargas.

## Rendimiento y temperatura (0.4.1)

En el iPhone, el fondo ambiental del reproductor ampliado redibujaba a la frecuencia de la pantalla, a 1,5 píxeles por píxel CSS, y el análisis de audio escribía tres variables CSS en `<html>` en cada fotograma, lo que obligaba a recalcular el estilo de toda la página. El teléfono se notaba tibio.

- En pantallas táctiles: 30 FPS como máximo, con una cadencia uniforme en 60 y 120 Hz (24 FPS se alternaría entre 2 y 3 refrescos). El movimiento va al 70 % para que el ritmo menor no se sienta trabado, y se renderiza a 0,75 píxeles por píxel CSS. Ver `PHONE_AMBIENT` en `app/lib/ambient-gl.ts`.
- El análisis de audio también muestrea a 30 FPS en táctiles. Sus variables CSS solo se escriben en el fondo CSS de respaldo, nunca en `<html>`.
- El escritorio conserva la frecuencia completa. La app de Windows ya limita su Direct3D a 24 FPS.
- Pendiente en el dispositivo: comprobar la temperatura tras 10–15 minutos con el reproductor ampliado abierto.
- Validación (15 de noviembre de 2026):
  - `tests/e2e/mobile.spec.ts` cuenta los dibujos WebGL: en WebKit iPhone 13, como máximo 66 en 2 s.
  - `immersive.spec.ts` comprueba que nada de la columna de letra llegue a la barra de posición.
  - Suite completa: 166 correctas. Las 2 de Novedades fallaron porque otra sesión añadió su arreglo a la 0.4.1 después de compilar, y pasan tras recompilar.
  - Vitest: 194/194.

## iOS 27 y Safari 27

- `overflow-anchor: none` en la letra y la cola, porque Safari 27 activa el anclaje de desplazamiento por defecto.
- `<meta name="color-scheme" content="dark">`: Openfy ya es oscuro y debe quedar fuera del modo oscuro adaptativo (Safari 27.3 beta).
- Media Session envía portadas de 512 y 1024 px con `sizes` y `type`.
- El service worker registra rutas estáticas (`InstallEvent.addRoutes`, Safari 27.0 y Chromium) para que el audio en streaming no despierte al worker. Sin soporte, todo sigue como antes.
- El umbral 701–760 px, donde el mini reproductor se montaba sobre la barra de pestañas (iPad en Split View y pantallas plegables), ahora usa el diseño del teléfono.
- El diagnóstico exportado incluye `startupMs` y la geometría de la pantalla, para medir en el iPhone si el arranque necesita una pantalla de carga más ligera. La pantalla de arranque no se ha cambiado.

## Validación (15 de noviembre de 2026)

- `nuxt typecheck` sin errores, Vitest 194/194 y `nuxt build` correctos.
- Suite Playwright completa (Chromium a 1440 px y WebKit iPhone 13): 166 correctas, 9 omitidas por proyecto y 1 fallo. El fallo era la propia prueba, que esperaba la cola lateral de escritorio en el teléfono. Tras corregirla, las specs afectadas pasan (31 en WebKit móvil y `youtube.spec` en Chromium). La suite no se volvió a ejecutar entera después de esa corrección.
- Una primera pasada detectó dos problemas del teléfono, ya corregidos. Primero, con `content-visibility: auto` en las filas, en la suite completa algunos toques en WebKit sobre filas recién desplazadas no tenían efecto; sin esa propiedad pasan. No se aisló la causa exacta, así que se retiró. Segundo, la fila de filtros oculta en colecciones cortas: desaparecía al borrar la búsqueda, así que se mantiene.
- Playwright: `tests/e2e/mobile.spec.ts` comprueba en WebKit móvil:
  - la franja de estado, la cabecera bajo una Dynamic Island simulada, la ausencia de desbordamiento horizontal, los campos de 16 px y las áreas táctiles de 44 px;
  - la hoja inferior, la pulsación larga, el arrastre para cerrar y la hoja de ordenar;
  - los accesos de la biblioteca, el botón Atrás y la pestaña activa;
  - el reproductor con la portada primero, la letra recordada, la cola encima y el cierre con Atrás;
  - el orden de Ajustes.
  
  En Chromium a 740 px comprueba que el mini reproductor queda por encima de la barra de pestañas. Las pruebas existentes se ajustaron donde el teléfono cambió de camino.
- Recorrido manual en el navegador integrado a 390 × 844 con insets simulados: Inicio, Biblioteca, playlist, Buscar, reproductor ampliado, opciones, «Ir al álbum» y Atrás.

## Pendiente en un iPhone físico con iOS 27

Ni la vista de dispositivo de Edge ni WebKit emulado reproducen estos puntos:

- [ ] Barra de estado sólida, sin difuminado sobre el contenido, y fondo ambiental visible bajo la barra en el reproductor ampliado.
- [ ] Página de artista: la foto o el vídeo bajo la barra de estado sin velo de iOS arriba del todo, y la franja de color al desplazarse.
- [ ] Cabecera, barra de pestañas y mini reproductor dentro de las zonas seguras reales, en vertical y en horizontal.
- [ ] Ningún campo amplía la página al tocarlo.
- [ ] Arrastrar hacia abajo (hojas y reproductor) y la pulsación larga, sin conflicto con el gesto Atrás desde el borde.
- [ ] El gesto Atrás cierra el reproductor ampliado.
- [ ] Transiciones de página fluidas, sin doble animación con el gesto Atrás de iOS.
- [ ] Respuesta háptica del interruptor de «Movimiento ambiental».
- [ ] Portada y controles en la pantalla de bloqueo y en el Centro de control.
- [ ] La letra sincronizada no salta con el anclaje de desplazamiento.
- [ ] Estado de almacenamiento protegido en Descargas tras la primera descarga.
- [ ] `startupMs` del diagnóstico en arranques en frío.
