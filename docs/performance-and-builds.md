# Rendimiento y mantenimiento de compilaciones

Validación del 15 de noviembre de 2026, zona America/Mexico_City.

## Interfaz y audio

La pantalla de Descargas construía todas las filas y cada notificación de progreso recorría la lista completa. Ahora usa un ListView con viewport acotado, actualizaciones por trabajo y conservación del desplazamiento. Los snapshots HTTP no sustituyen progresos más recientes recibidos por la pipe.

El procesamiento de mensajes de Node, la serialización HTTP y la transición completa de Media Foundation/WASAPI se ejecutan fuera de WinUI. El monitor de audio tampoco depende de su contexto. Las comprobaciones de archivos de los snapshots HTTP usan disco asíncrono en lotes de 16 y una consulta conjunta, en lugar de consultas por canción con stat síncrono.

La cola elimina su primera entrada una vez al avanzar; no mueve todas las restantes. La colección inicial de canciones publica una sola notificación en bloque. Los snapshots equivalentes conservan sus filas aunque la deserialización produzca arrays distintos.

Inicio y Favoritas conservan una vista cada uno y la reutilizan al volver mientras los datos coincidan. Los cambios de biblioteca, estadísticas y filtros invalidan Favoritas; el contenido de Inicio tiene su propia firma. Las filas de biblioteca se describen una vez por snapshot, la búsqueda vacía no normaliza cada título, y navegar entre filtros existentes no vuelve a guardar toda la cola. Los estilos se aplican al contenido que cambia.

Las mediciones de navegación usan 500 favoritas y una cola de 500, doce sugerencias sintéticas sin portadas y cuatro ciclos Inicio → Favoritas → Inicio. En la instalación final los cambios posteriores a la primera apertura rondaron 6–7 ms de trabajo síncrono, incluido UpdateLayout. La primera apertura todavía incluye construir los controles y fue de unos 71 ms en esa ejecución. No son mediciones de latencia de red, decodificación de portadas ni una garantía de cada frame en el equipo del usuario.

## Espacio y empaquetado

La inspección inicial encontró 50,33 GiB en el proyecto, de los que 49,12 GiB pertenecían a `output`. Predominaban copias de compilaciones completas, instaladores y entornos de actualización. Tras retirar empaquetados y pruebas antiguas, la medición fue de 5,38 GiB para el proyecto y 4,06 GiB para `output`; E: quedó con aproximadamente 46,7 GiB libres. Los informes pequeños y otras evidencias de pruebas se conservaron.

`package-desktop.ps1` comprueba el arranque del paquete antes de generar y publicar su manifiesto. En el canal local habitual actualiza la instalación existente y espera a que `/api/status` anuncie el nuevo número de compilación. Solo después retira los empaquetados anteriores. El instalador mantiene la recuperación transaccional y los respaldos de SQLite/estado; las copias de música no se mueven ni se incluyen en el paquete.

Los temporales de cada ejecución se retiran también al fallar. Las compilaciones activas mantienen un archivo abierto y la limpieza comprueba procesos y rutas antes de eliminar. No sigue enlaces o junctions. En una publicación fallida se conservan los instaladores anteriores.

## Verificación reproducible

```powershell
.\scripts\test-build-maintenance.ps1
.\scripts\test-build-update.ps1 -OlderInstaller <anterior> -NewerInstaller <nuevo> -BuildNumber <build>
.\scripts\check-desktop-performance.ps1
.\scripts\check-desktop-performance.ps1 -Navigation
.\scripts\check-desktop-performance.ps1 -Sections
.\scripts\check-desktop-performance.ps1 -Executable <Openfy.exe-publicado> -Packaged -Navigation
.\scripts\cleanup-builds.ps1
```

Las pruebas nativas usan datos y estado separados. La prueba de navegación comprueba reutilización de ambas vistas, virtualización, ausencia de cambios de filas innecesarios y actualización después de añadir una canción; también verifica búsqueda y filtros. La prueba de instalación conserva una favorita y un JSON de estado, comprueba el backend nuevo y exige que el proceso y los binarios anteriores se hayan retirado.

Las pruebas automatizadas de backend/web, contratos y audio, las seis pruebas de descargas en Chromium/WebKit y las comprobaciones de ventana real pasaron durante esta investigación. `output/performance-check` conserva los resultados; `output/desktop/reports` guarda manifiestos, arranque y limpieza. Los logs conservados de la sesión original no demuestran por sí solos los tirones reportados; la evidencia de estas correcciones es el código y las reproducciones controladas.

Resultado final: Openfy 0.3.0+1794735518 instalado y confirmado por su backend. Pasaron 172 pruebas Vitest, 51 de contratos/lógica .NET, 11 de audio/host y seis de descargas en navegador. La aplicación instalada pasó ambas comprobaciones nativas de rendimiento, incluida la búsqueda. El respaldo previo y la biblioteca posterior conservan los mismos identificadores, favoritos, asociaciones de audio, hashes/tamaños de assets y playlists: 558 guardadas, 500 favoritas y 500 copias locales. E: terminó con 46,8 GiB libres; no quedaron directorios de compilación nativa o web del empaquetado.

## Revisión ampliada de navegación (0.4.2)

Se revisaron Biblioteca ↔ Favoritas, Inicio, playlists, Descargas, Ajustes, álbumes, artistas, búsqueda y Más reproducidas. La reproducción sintética contiene 558 canciones guardadas, 500 favoritas, 279 álbumes, 300 artistas y una playlist de 558 canciones. Los logs de la sesión anterior se conservaron antes de reiniciar; las causas descritas aquí se comprobaron en el código y en esta reproducción.

Biblioteca y Favoritas compartían una tabla: cada cambio publicaba 58 altas/bajas y volvía a preparar contenedores, aunque las cabeceras estuvieran en caché. Ahora cada colección conserva su propia tabla y fuente de filas; las inactivas permanecen contraídas. Ambas cachés tienen un límite de seis colecciones. Las tres pestañas de Biblioteca conservan sus cabeceras y tarjetas mientras coincidan biblioteca, estadísticas y filtros. Los cambios reales invalidan el contenido correspondiente.

Una apertura que necesita preparar contenido presenta un skeleton antes de continuar. La descripción inicial de las canciones se calcula fuera del hilo de WinUI y los controles secundarios de cada fila se preparan por fases. Los skeletons usan composición para el pulso y respetan tanto los efectos de Openfy como el movimiento reducido de Windows. No hay espera mínima añadida. Una vista válida en caché se muestra directamente.

Los álbumes/artistas de Biblioteca, los resultados de búsqueda y los lanzamientos de un artista usan una cuadrícula virtualizada cuando superan doce tarjetas. Solo se crean controles para la región visible y su margen de realización. La búsqueda presenta canciones primero y mantiene placeholders independientes para las secciones pendientes. Los selectores del ranking reciben datos en lugar de cientos de controles de opciones construidos de antemano.

Las páginas remotas muestran su carga al abrirse, cancelan peticiones al abandonarlas y rechazan respuestas de una navegación anterior. El ranking también comprueba la generación de cada cambio de filtro. Álbumes y artistas tienen una caché de datos de tres minutos, limitada a doce entradas por tipo. Los fallos de apertura ofrecen Reintentar y se limpian al navegar a otra sección.

La referencia anterior está en `output/performance-check/b5215ab72cee4cba94d7ef92aefd09e6/state/sections-performance.json`. El trabajo síncrono inicial, incluido layout, fue de 192 ms en Biblioteca; las pestañas de álbumes y artistas tardaron 535 y 795 ms. En una ejecución posterior (`output/performance-check/47a78bcaeef04532907caba0944ee987/state/sections-performance.json`), Biblioteca ↔ Favoritas en caliente consumió 4,7–5,9 ms sumando solicitud y layout, con cero cambios de filas. Las pestañas crearon 20 tarjetas en vez de 279/300; quedaron listas en 51/78 ms incluyendo la espera asíncrona del primer frame. La primera materialización de Biblioteca todavía midió 58 ms de layout en esa ejecución, después de presentar el skeleton: estas mediciones no acreditan un máximo de 16 ms por frame.

`-Sections` comprueba reutilización de cabeceras/tablas, conservación de pestañas, desplazamiento hasta el último álbum/artista, límite y expulsión de caché, skeletons con red lenta, búsqueda parcial, errores recuperables y rechazo de respuestas atrasadas de álbum/ranking. Guarda JSON y capturas de las vistas de carga, tarjetas, búsqueda y ranking en su directorio de estado aislado. `-Navigation` conserva la regresión Inicio ↔ Favoritas, actualización de biblioteca y filtros. Los tiempos son de datos sintéticos sin portadas ni descargas reales; no sustituyen una revisión de fluidez durante reproducción y red reales.

La actualización quedó instalada como **0.4.2+1794807716**, confirmada por `/api/status`. La aplicación instalada pasó las tres comprobaciones: secciones (`output/performance-check/835c05f7743a475bb5602f1854e402ad/state/sections-performance.json`), navegación (`output/performance-check/fbe3152dab4c46f3871c63929d93b145/state/navigation-performance.json`) y descargas (`output/performance-check/5e75169ef34a49a6b147cd2d1228a73f/state/downloads-performance.json`). Biblioteca ↔ Favoritas en caliente midió 4,2–5,1 ms sumando solicitud y layout; la primera Biblioteca aún requirió 45 ms de layout tras mostrar su skeleton. Pasaron además 97 pruebas de contratos/lógica .NET, 17 de audio/host/Discord y tres de notas de versión. Se inspeccionaron las capturas reales de skeletons, álbumes, búsqueda parcial y ranking.

`output/performance-check/sections-install-20261115` conserva los logs previos, el empaquetado, el estado del backend y la comparación de biblioteca anterior/posterior. Coinciden todos los datos de canciones, favoritos, audio local y playlists devueltos por la API: 558 guardadas, 500 favoritas, 558 copias locales y una playlist. El instalador anterior se retiró del proyecto y del feed, y los temporales propios del empaquetado se eliminaron al terminar.


## Salida de la ficha de artista en Windows (0.6.0, 2026-11-21)

Tras visitar una ficha de artista con la transparencia activada, Inicio, Biblioteca, Descargas, Más reproducidas o un álbum podían quedarse cargando, y la X del buscador también bloqueaba la aplicación. La pila capturada en una reproducción fue `COMException (0x800F0902)` en `IMap.Insert` ← `ApplySearchBoxStyle` ← `UpdateTopBar` ← `SyncArtistSurface` ← `BuildLoadingCatalog` ← `BeginContentNavigation`. Al cambiar de página se reescribían entradas del `ResourceDictionary` del buscador mientras estaba bajo el puntero o enfocado. Esa llamada ocurre antes del `try/finally` de la navegación, así que `ContentLoading` no volvía a `false`. Los volcados de la aplicación instalada registraron después el mismo HRESULT como excepción *stowed* (`0xC000027B`).

Ahora `Views/StateBrushes.cs` registra cada clave de estado una sola vez, con un pincel propio, y después solo cambia su `Color`. Un pincel puede seguir a otro cuyo color se anima, como el tinte del marco o la paleta del artista. Se aplica al buscador y a los botones de la barra superior, a la barra lateral, a las cabeceras y filas de canciones y al fondo deshabilitado del botón de reproducción. Los contenedores reciben sus pinceles al crearse (`ChoosingItemContainer`) y los botones de fila los declaran en la plantilla. El registro se guarda en una propiedad adjunta del elemento: un `ConditionalWeakTable` indexado por el *wrapper* .NET perdía la entrada cuando CsWinRT entregaba otro *wrapper* para el mismo contenedor reciclado.

`--sections-check` incluye `CheckArtistExitAsync`. Activa la transparencia y sale de la ficha de un artista de prueba con un álbum hacia Inicio con y sin caché, Biblioteca, Descargas, Más reproducidas y el álbum. Comprueba la solicitud del álbum en el servidor de prueba y limpia la búsqueda con el evento de la X. Mantiene el buscador alternando entre `PointerOver` y `Focused` y los botones superiores y laterales en `PointerOver`. Con el código anterior fallaba en la primera salida a Inicio. Pasó tres veces seguidas en el espacio de trabajo y contra el ejecutable instalado, junto con `-Navigation` y `-Downloads`.

Una instalación aislada (`OPENFY_INSTALL_TEST_ROOT` con el marcador `.openfy-qa` y un `NITRO_PORT` libre, porque el 3000 puede estar ocupado) con el build 0.6.0+1795235639 repitió los recorridos reales con «Rauw»: cabecera animada, salida a Inicio y limpieza con la X, álbum abierto desde la ficha con reproducción, Descargas y Más reproducidas. Los registros de sesión no contienen `0x800F0902` ni `COMException` y Windows no registró errores de la aplicación. La actualización quedó instalada como **0.6.0+1795241588**, confirmada por `/api/status`. Los registros de la sesión anterior se conservaron en `output/artist-exit-before-update`.

La web no se ve afectada: `tests/e2e/artist-exit.spec.ts` recorre los mismos casos y pasa en `chromium` y `mobile-webkit`. En Android, `ArtistExitQaTest` pasó en el emulador (API 37) sin cierres ni ANR. Con fallos inducidos aparecieron dos problemas propios de Android: el álbum se queda con esqueletos si vence el timeout de 60 s del proveedor, y al volver a una ficha cuya paginación se canceló, «Ver más canciones» sigue deshabilitado. La evidencia está en `output/android-artist-exit`.
