# Validación de Windows nativo

Fecha: 13 de noviembre de 2026. Se utiliza una biblioteca sintética aislada de la biblioteca personal. El respaldo inicial de código y datos está fuera del repositorio, en `%LOCALAPPDATA%\Openfy\backups\native-20261113-002336`.

## Resultados automatizados

| Comprobación | Resultado |
|---|---|
| TypeScript/Vitest | 88 casos correctos |
| Tipos y compilación Nuxt de producción | Correctos |
| Navegador Chromium y WebKit móvil | 78 escenarios correctos |
| Contratos, estado atómico y política gráfica .NET | 16 casos correctos |
| Media Foundation, WASAPI y host .NET | 8 casos: AAC, MP3, FLAC, AAC fragmentado, rangos, ciclo de vida y cancelación de arranque bloqueado |
| Arranque, biblioteca bloqueada, puerto ocupado, reinicio de Node y cierre | Correctos con procesos reales y carpetas temporales |
| Instalación autocontenida fuera del checkout | Prueba funcional correcta |
| Dos monitores físicos | Detectados a 239,76 Hz y 100 Hz; vistas activas, límite de unos 23,8 FPS y parada al pausar |
| “Bad Romance”, `J2kPH11Z4cM`, web real | Reproducción y salto correctos; 294,466667 s de duración |
| Misma pista, motor nativo real | Reproducción, salto al segundo 164 y salto pausado correctos |

La regresión de streaming cubre cuerpos bloqueados tras las cabeceras, fallos de conexión al inicio y en fragmentos posteriores, renovaciones HTTP, rangos y cancelación. La regresión de letras comprueba que una respuesta antigua no sobrescriba la firma más reciente en SQLite ni en IndexedDB. Los contratos comunes incluyen cola mixta, catálogo y letras.

La prueba gráfica crea mini, widget y fullscreen, mueve una vista al segundo monitor y comprueba renderizado, límite global y pausa. Los FPS reales a alta frecuencia dependen del hardware y el compositor; no se presentan como garantía de alcanzar los Hz. El cierre del proceso principal también eliminó su Node mediante el Job Object.

La prueba de reapertura realiza 13 ciclos y confirma que solo se retienen las tres ventanas reutilizables. Después del calentamiento, la última tanda registró −1 handle, −4 hilos y unos 3 MiB de variación de memoria privada, sin crecimiento de ventanas ni recursos gráficos por apertura. La destrucción al salir desacopla el `SwapChainPanel`, detiene el hilo de render y libera superficies, buffers, temporizadores y suscripciones.

## Medición de recursos

`scripts/measure-desktop.ps1` ejecuta tres veces reposo y reproducción en ambas versiones, además de tres ejecuciones de vistas animadas y de 24 FPS en la aplicación nativa. Cuenta los árboles de procesos de Openfy y Node; en la web, todos los procesos del Chromium aislado y su backend. Excluye el proceso del arnés. Utiliza la misma biblioteca, equipo y audio silenciado. Guarda muestras y duración real en `output/desktop/benchmark/results.json`.

La memoria es memoria privada en MiB. CPU es el porcentaje agregado dividido entre los procesadores lógicos. El arranque termina cuando el escenario queda preparado, por lo que el de reproducción incluye abrir el audio. Las cifras de GPU del proveedor WMI deben interpretarse con cautela: en este equipo devolvió mayoritariamente ceros incluso con superficies activas; no equivalen a ausencia de trabajo gráfico. Se conserva el valor recibido para reproducibilidad.

La comparación final de reproducción normal, después de reducir las actualizaciones innecesarias del transporte, se repitió tres veces con ventanas de al menos 20 segundos. Las letras visibles conservan actualizaciones de 200 ms; los gráficos usan su propio reloj. (2026-11-14: con letra visible en fullscreen, mini o widget, el reloj de la interfaz pasa a 50 ms y la marca por palabra lee el reloj audible en cada frame; las cifras de esta tabla son anteriores a ese cambio.) Resultados en `output/desktop/benchmark/normal-transport.json`:

| Reproducción normal | Nativo + Node | Chromium + Node |
|---|---:|---:|
| Memoria privada media | 159,73 MiB | 427,13 MiB |
| CPU media del equipo | 0,094 % | 0,114 % |
| Arranque preparado medio | 1,31 s | 2,73 s |

En estas muestras la memoria se reduce un 62,6 % y la CPU media no aumenta. Son mediciones cortas en este equipo, no una garantía para toda biblioteca o hardware. Una comparación intermedia que silenció el elemento HTML directamente se conserva en `normal-final.json`, pero no se utiliza para aceptar la optimización: ese modo puede suspender trabajo del navegador y altera la comparación con una salida WASAPI activa. La prueba final silencia la salida de Chromium, conservando su reproducción; Openfy silencia su sesión WASAPI.

Las tres ejecuciones iniciales por escenario también registraron aproximadamente 183 MiB y 1,52 % de CPU con las tres vistas animadas, y 188 MiB y 0,40 % con límite de 24 FPS. Estos valores de vistas son anteriores al último ajuste del reloj del transporte y se documentan por separado; corresponden a objetivos de 239,76 Hz en las ventanas del monitor principal. No se extrapolan a otros equipos.

## Validación física pendiente

Debe completarse en el iPhone real la reproducción nueva de YouTube, letras, descargas, modo avión y bloqueo con la ventana principal cerrada. WebKit móvil de Windows no sustituye Safari/iOS. También queda la aceptación prolongada con Bluetooth, cambio y desconexión física de dispositivos de audio, suspensión/reanudación, desconexión de monitor, juegos fullscreen/borderless y accesibilidad con lector de pantalla.

Las pruebas automáticas y las muestras cortas no certifican una sesión de varias horas ni ausencia de fugas a largo plazo. El acceso Win+W y la integración con Explorer no forman parte de esta versión.
