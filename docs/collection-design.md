# Cabeceras de colección

Biblioteca, Favoritas, playlists, álbumes y artistas guardados comparten una cabecera compacta en Windows y web. Portada, título, duración total y acciones se agrupan antes de la búsqueda. La duración se presenta en horas y minutos. Buscar y activar «Solo descargadas» cambia la lista y su contador, conservando la portada y los metadatos de la colección completa.

Reproducir inicia el resultado actual en orden. Aleatorio mezcla todas sus apariciones antes de abrir el audio, incluida la primera; conserva el orden original para restaurar las pendientes desde el reproductor. Se incluyen todas las coincidencias aunque solo se hayan renderizado las primeras cien filas. Una colección vacía no reemplaza una cola existente.

Los controles retirados de las colecciones no se restauran desde preferencias antiguas: se limpian artista, álbum, género, origen y favoritas, conservando búsqueda, descargas y ordenación. El ranking mantiene sus filtros y preferencias independientes. Las columnas siguen permitiendo ordenar las canciones.

En WinUI la plantilla predeterminada de TextBox no enlaza `VerticalContentAlignment` a su ScrollViewer ni al placeholder. `CollectionSearchBox` centra esas dos partes al aplicar la plantilla y conserva el botón nativo para borrar la búsqueda. La escritura actualiza los resultados sin reconstruir el campo. Los grupos de acciones se ajustan al ancho disponible.

## Validación

- `npm run typecheck` y `npm run build`.
- `npm test`: 166 pruebas correctas, incluidas migración de filtros, mezcla desde la primera posición, identidad de apariciones y restauración del orden.
- `dotnet test desktop/Openfy.Tests`: 41 pruebas correctas.
- Compilación Release de Windows en `output/collections-build`: sin errores ni advertencias.
- Los 18 recorridos E2E de colecciones, telemetría, descargas y cola pasan en Chromium y WebKit móvil. La prueba de descargas utiliza un archivo AAC generado, su asociación local de YouTube y la descarga verificada en el dispositivo.

Se hicieron tres pasadas de revisión visual: composición inicial; centrado y estados con 500 canciones; y adaptación final con texto escrito, títulos largos, colecciones vacías, descargas, reproducción y ranking. La revisión web incluye anchos de 1440, 960, 780, 700, 390 y 320 px.

Capturas web: `output/playwright/collections/`. Capturas e informe nativos finales: `output/collection-review-pass3/screenshots/visual-check.json`. El recorrido nativo revisó ventanas de 1360, 960 y 780 px y los dos monitores disponibles. Ambos informaron 96 DPI (100 %); la comprobación real con escalado de Windows al 150 % y 200 % queda pendiente. No se cambiaron los ajustes de pantalla del usuario.

## Repetir la revisión nativa

Preparar una biblioteca sintética con el recorrido descrito en [Fidelidad visual nativa](native-design-parity.md#repetir-la-revisión). Usar un directorio de datos y estado exclusivo de QA y un puerto libre. Sobre esa biblioteca ya poblada:

```powershell
& 'E:\openfy\output\collections-build\Openfy.exe' --workspace E:\openfy --data-dir E:\openfy\output\collection-qa\data --state-dir E:\openfy\output\collection-qa\state --port 4198 --visual-check E:\openfy\output\collection-qa\screenshots --visual-collections-only
```

El modo comprueba alineación del placeholder y texto escrito, conservación del campo, resultados filtrados, cola aleatoria y normal, una canción, colección vacía y filtros del ranking. Produce PNG e informe JSON y termina la instancia de QA. No utiliza la biblioteca habitual.

## Publicación del 15 de noviembre de 2026

Se publicó [Openfy 0.3.0, compilación 1794728419](https://github.com/LuisRivera-end/openfy/releases/tag/v0.3.0-build.1794728419) y se actualizó el canal local. Favoritas tiene un botón visible **Descargar favoritas** en Windows y web. Solicita toda la colección actual aunque la búsqueda o Solo descargadas oculten canciones; Windows omite los archivos ya disponibles y envía hasta cien canciones de YouTube por petición.

La entrega pasó comprobación de tipos, 171 pruebas TypeScript, 44 de núcleo .NET, 10 de audio/backend y 54 escenarios E2E sobre el backend empaquetado. El caso nuevo de Favoritas descarga dos canciones con ambos filtros activos y comprueba que una canción sin marcar no se descarga. La revisión visual nativa verificó el botón con 500 favoritas.

La prueba de instalación final confirmó audio local y remoto, recuperación de Node, instancia única, cierre del backend, desinstalación, conservación de la biblioteca y reinstalación. Informe: `output/installation-qa/555a1f76769e400ba4cfe38700f2707f/installation-validation.json`. En una ejecución anterior falló el umbral de handles de los ciclos de ventanas (delta 12); la ejecución final pasó con delta 0, manteniendo los tres reproductores. Ambos informes se conservan.

El primer arranque del empaquetado encontró el puerto 4296 ocupado (EADDRINUSE en el log). Se conservaron sus registros y se repitió la misma aplicación con un puerto libre; abrió la ventana y conectó el backend. Evidencias, capturas e informe de publicación: `output/collection-release-1794728419/`. El SHA-256 del instalador y del manifiesto público coinciden con los digests de GitHub.
