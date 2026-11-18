# Búsqueda integrada de Openfy

Especificación e implementación del 16 de noviembre de 2026 para Windows nativa, navegador e iPhone/PWA. Sustituye la organización anterior por fuentes. Las cards, portadas, páginas de artista/álbum y funciones de reproducción conservan su diseño y comportamiento.

## Referencia y alcance

Se recorrió Spotify Web con «bad bunny» en Todo, Canciones, Artistas y Álbumes. Se comprobó que cambiar de categoría conserva la consulta, editar conserva la categoría y el scroll incorpora más resultados sin un botón de carga. Las filas renderizadas no permiten deducir el tamaño de página interno de Spotify; Openfy mantiene sus cantidades actuales.

Decisiones confirmadas: Windows y web/PWA; Todo, Canciones, Artistas y Álbumes; búsqueda vacía al limpiar; acceso Buscar conservado en la navegación inferior móvil; filtros locales en biblioteca y colecciones. No se añaden playlists públicas o propias a los resultados, podcasts, audiolibros, usuarios ni géneros. No cambia ningún endpoint, contrato, dato persistido o proveedor del catálogo.

## Dirección visual

Se reutilizan fondo `#09090B`, superficie `#151518`, campo `#202024`, texto `#F4F4F5`, secundario `#A1A1AA` y acento `#1ED760`. Segoe UI Variable en Windows y la tipografía del sistema en iPhone; títulos, metadatos, radios y controles mantienen la escala de Openfy. Alineación izquierda, sin decoración, fuentes nuevas o animaciones de aparición. La selección usa la pastilla clara existente.

```text
Escritorio
+--------------+------------------------------------------------+
| Inicio       | [ ¿Qué quieres escuchar?                   × ] |
| Biblioteca   | Todo   Canciones   Artistas   Álbumes            |
| Colecciones  |                                                |
|              | Resultado más relevante | Canciones             |
|              | [presentación existente]| [4 filas]             |
|              |                                                |
|              | Artistas                           Ver todos   |
|              | [hasta 6 cards en una fila horizontal]          |
|              | Álbumes                            Ver todos   |
|              | [hasta 6 cards en una fila horizontal]          |
+--------------+------------------------------------------------+
| Reproductor persistente                                        |
+---------------------------------------------------------------+

iPhone
openfy.                                              ajustes
[ ¿Qué quieres escuchar?                           × ]
Todo   Canciones   Artistas   Álbumes
Resultado más relevante
[presentación existente]
Canciones                                            Ver todas
[4 filas]
Artistas / Álbumes: filas horizontales de cards
[minirreproductor y navegación inferior existentes]
```

El acceso superior se convierte en el único campo editable; desaparecen el campo interior, el título grande y Buscar del lateral. En móvil, ese mismo campo ocupa una segunda fila de cabecera, sin remontarse al navegar. En resultados, cabecera y categorías permanecen accesibles al desplazar. Se respetan zonas seguras, controles táctiles de 44 px, campos de 16 px, foco visible y preferencias de movimiento reducido. La web mide la altura real de la cabecera para situar las categorías sin solapamientos.

Todo usa columnas 1:2 desde 800 px de ancho útil; por debajo se apilan destacado y canciones. Las cards no se estiran para imitar el destacado de Spotify: se usa la card actual de artista/álbum o una fila de canción. Las filas compactas reorganizan los campos conservando portada, enlaces, duración y opciones. «Ver todas/todos» cambia a la categoría correspondiente.

El destacado espera las tres respuestas iniciales; los demás bloques aparecen independientemente. Se elige una coincidencia exacta ignorando acentos y mayúsculas, priorizando artista, canción y álbum. Sin coincidencia exacta se toma la primera canción, artista o álbum disponible, en ese orden. Es una selección de presentación, sin modificar el orden del proveedor. Todo muestra cuatro canciones y hasta seis artistas/álbumes; no solicita continuaciones.

## Interacción y estado

Enfocar no navega. Editar muestra los resultados en el panel central, con debounce de 350 ms y límites de 2–200 caracteres. Enter adelanta una consulta pendiente sin duplicarla; en móvil también cierra el teclado. Cada cambio invalida las respuestas anteriores, conserva la categoría y reinicia las posiciones. Limpiar mantiene el foco, restablece Todo y muestra «¿Qué quieres escuchar?».

La sesión comparte consulta, resultados, cursores, categoría y posición por vista. Los cursores del proveedor no se persisten en disco. Visitar un artista o álbum conserva la sesión; volver recupera la posición sin repetir consultas completadas. Se cancelan las solicitudes al salir y se retoman las iniciales que faltaban al volver. La ruta web sigue siendo `/search`; escribir no añade entradas al historial. Buscar en la barra móvil enfoca el campo desde el gesto del usuario.

Cada categoría tiene carga, error y vacío independientes. Una categoría fallida no oculta las otras. La desconexión muestra la indicación existente y conserva la navegación a las colecciones locales. El texto global no se aplica a los filtros de biblioteca.

En Windows, los errores generales de reproducción y los avisos de actualización ocupan una zona compartida sobre el contenido. Permanecen visibles aunque la búsqueda sustituya el panel habitual y reducen el viewport sin superponerse a los resultados.

## Scroll y rendimiento

- Canciones: 20 iniciales y continuaciones de 10. Artistas y álbumes: seis iniciales y bloques de seis.
- Solo la categoría activa solicita continuaciones, al quedar unos 280 px. Una solicitud simultánea por categoría, orden conservado y deduplicación por identificador.
- Después de cargar o redimensionar se comprueba si falta contenido para llenar la pantalla. La carga se detiene al agotar el cursor, salir de la vista o encontrar un error.
- Un error conserva las filas y ofrece Reintentar sin bucles automáticos. Un cursor caducado ofrece Actualizar búsqueda: reemplaza la categoría y vuelve al principio después de una respuesta correcta.
- Web: IntersectionObserver sobre el final y comprobación de geometría tras cambios de contenido.
- Windows: superficie independiente con pestañas fuera del viewport; ListView de canciones y GridView de artistas/álbumes acotados por el espacio disponible. Cada vista conserva un único scroll vertical y su panel virtualizado. Las tablas de biblioteca permanecen independientes.

Reproducir desde el resumen sigue usando la lista de canciones cargada y el contexto individual existente. Navegar, filtrar o cargar resultados no sustituye la cola activa.

## Validación y aplicación

Las pruebas web cubren entrada desde Inicio, debounce, Enter, limpieza, resumen, categorías, continuaciones, duplicados, errores, caducidad, cancelación, reproducción, contexto y restauración. Se ejecutan en Chromium y WebKit móvil con servicios simulados y datos aislados; capturas en `output/search-qa`.

La comprobación nativa de secciones incluye búsqueda parcial, resumen, paginación de las tres categorías, continuidad de la fuente de canciones, viewport virtualizado, retorno desde artista y limpieza. Informes y capturas quedan en el directorio aislado de cada ejecución dentro de `output/performance-check`.

Para aplicar a Windows instalado se usa `scripts/package-desktop.ps1`: verifica el instalador, actualiza y reabre la instalación existente, y confirma la compilación del backend. `npm run build` solo genera la web/backend del checkout. Los paquetes de prueba usan `-FeedRoot` aislado y `-NoInstall`; se respetan las salidas de compilaciones concurrentes. WebKit emulado no sustituye la aceptación en un iPhone físico con su teclado y zonas seguras reales.

### Resultados del 16 de noviembre de 2026

- Typecheck y compilaciones web/Windows correctos; la compilación WinUI terminó sin errores ni advertencias.
- Vitest: 211 pruebas correctas; las tres de Novedades también se repitieron después de actualizar su contenido. .NET: 98 pruebas correctas.
- Búsqueda, catálogo, reproducción y contexto: 52 E2E correctas en Chromium/WebKit (`output/search-qa/verified-regression.log`). Arranque y shell: 24 casos cubiertos correctamente, incluyendo la revisión a 740 px tras esperar a que terminara la transición del dock.
- Navegación nativa y comprobación de secciones correctas. La instalación final pasó el recorrido de búsqueda, los avisos generales, las tres continuaciones y la restauración de 200 px. Con 230 canciones, materializó 26 filas en esa ejecución; es una medición de realización, no una garantía de FPS.
- Publicación e instalación final: **0.5.0+1794823235**, confirmada por `/api/status`. Los temporales propios del empaquetado se retiraron al terminar.
- La comparación completa de la biblioteca anterior/posterior coincide: 560 canciones guardadas de YouTube, una playlist y cero archivos locales. Evidencia en `output/search-qa/after-install/verification.json`; logs previos conservados en `output/search-qa/before-install/session-logs`.

El informe de la instalación final es `output/performance-check/6311640e5b2546b0b0ee1e4d0606130d/state/sections-performance.json`; las capturas de resumen, canciones y álbumes están en ese mismo directorio. El registro de empaquetado está en `output/search-qa/package-final.log`.
