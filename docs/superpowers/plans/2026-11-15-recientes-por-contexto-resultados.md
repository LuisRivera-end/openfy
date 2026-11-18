# Recientes por contexto — resultados

Implementado el 2026-11-15 en servidor, PWA y Windows. Se conservan las reglas del diseño: origen por entrada de cola, escucha efectiva mayor que cero, una tarjeta por origen y exclusión del historial antiguo sin contexto, conservando todas sus estadísticas.

## Cambios incluidos

- Contrato TS/.NET y fixture compartida actualizados; acumuladores y recuperación conservan el contexto.
- El endpoint entrega tarjetas de canción, favoritas, playlist, álbum y artista, ordenadas por su escucha más reciente. Resuelve nombres actuales de playlists y omite destinos eliminados.
- Reproducción, aleatorio y menús de cola reciben el contexto correcto, incluidos los controles compartidos de colección.
- Ambos inicios muestran tarjetas mixtas; las colecciones navegan y las canciones reproducen solo las canciones de la fila. Se conserva la canción seleccionada al reproducir cualquier tarjeta reciente en Windows.
- Caché `listening-recent-v2` en todos los caminos de lectura y escritura. Sin migraciones: SQLite 5, IndexedDB 4 y snapshots de cola existentes.
- La actualización de duración de una canción repetida en Windows conserva el contexto y la identidad de cada aparición.

## Validación

- TypeScript: 171 pruebas unitarias aprobadas y comprobación de tipos correcta.
- .NET: 44 pruebas del núcleo aprobadas. Compilación Release de Windows sin errores ni advertencias.
- Nuxt: compilación de producción correcta con el Node privado del proyecto.
- Suite E2E completa: 145 de 146 escenarios aprobados en Chromium y WebKit móvil. Todos los escenarios de Inicio, recientes, letras, colecciones y recuperación de contexto pasaron.
- Fallo previo confirmado: `youtube.spec.ts:238`, “reports playback failure and can retry the same song”, falla al esperar el botón Pausar tras reintentar un audio con error simulado en WebKit. También falla ejecutándolo aisladamente contra la compilación anterior 1794726999, previa a este cambio. No se modificó ese comportamiento.
- Revisión nativa aislada aprobada: cinco tipos de tarjeta con audio sintético, orígenes independientes para canciones repetidas, aleatorio, restauración pausada y reproducción desde una tarjeta que no es la primera.
- El ejecutable publicado pasó la comprobación de arranque fuera del entorno de desarrollo.

Evidencia local: `output/recent-context/e2e.log`, `baseline-e2e.log`, `retry-e2e.log`, `full-suite-failure/`, `native/screenshots-final/visual-check.json` y `package.log`. Las comprobaciones usaron bibliotecas y estados aislados; los recorridos automatizados con audio sintético no sustituyen una prueba manual en un iPhone físico.

## Distribución

Instalador preparado: Openfy 0.3.0, compilación 1794728380. El paquete contiene ambos clientes y el servidor actualizados y conserva la compatibilidad con SQLite 5. La publicación utiliza el canal local de actualizaciones de la app, manteniendo el manifiesto y el instalador anteriores.
