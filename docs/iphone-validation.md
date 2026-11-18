# Validación física en iPhone — funcionamiento básico confirmado

El 11 de noviembre de 2026 el usuario confirmó el acceso desde su iPhone y después reportó: «funcionó perfectamente, descarga, bloqueo y avión». Quedan confirmadas la descarga y la reproducción con pantalla bloqueada y en modo avión en su dispositivo con iOS 27.

Las pruebas prolongadas y de interrupciones continúan pendientes: el reporte no especifica duración, avance automático, reapertura con el PC apagado, controles de audífonos, llamadas ni cambios de Bluetooth. Este protocolo conserva esas comprobaciones para completar la validación. Si una prueba revela una limitación de Safari que impida cumplir los requisitos, registrar el fallo y detener la ampliación para revisar la distribución del iPhone.

## Preparación

1. Compilar en producción, iniciar el servidor y configurar Tailscale Serve siguiendo el README.
2. Abrir la dirección privada HTTPS en Safari, compartir y elegir **Añadir a pantalla de inicio**. Abrir Openfy desde ese icono. La primera instalación necesita Internet y conexión con el PC.
3. Importar diez canciones propias que sumen al menos 45 minutos. Alternativamente, con Openfy iniciado, ejecutar `npm run test:audio` para generar diez piezas sintéticas originales de cinco minutos; no contienen música comercial. Utilizar el Node preparado por `setup.ps1` o la versión requerida en el README.
4. Esperar las importaciones y conversiones. Abrir el álbum o crear una playlist con las diez canciones en el orden deseado.
5. Anotar modelo de iPhone, versión exacta de iOS, modelo de audífonos, fecha y tipo de conexión. No se requiere compartir estos datos con ningún servicio externo.

## Sesión por streaming (mínimo 45 minutos)

- Iniciar la cola con los audífonos conectados y bloquear el iPhone.
- Comprobar que la canción termina y la siguiente comienza sin desbloquear. Repetir durante toda la cola; no confundir reproducción continua con reproducción sin pausa entre pistas (gapless no forma parte de esta versión).
- Usar reproducir/pausar/anterior/siguiente desde audífonos y pantalla de bloqueo.
- Abrir otras aplicaciones, volver a Openfy y navegar entre biblioteca y búsqueda sin perder la reproducción.
- Adelantar y retroceder dentro de una canción.
- Recibir una llamada de prueba. Registrar pausa/interrupción y comportamiento al terminarla. La reanudación debe obedecer a las decisiones de iOS; nunca forzar una reproducción inesperada.
- Desconectar Bluetooth y comprobar que iOS pausa el audio en lugar de emitirlo inesperadamente por el altavoz. Reconectar y reanudar explícitamente.
- Cambiar de Wi-Fi a datos móviles manteniendo Tailscale activo. Registrar cualquier corte o necesidad de reintento.

## Sesión sin conexión

1. Descargar la playlist completa. En **Descargas**, las diez canciones deben indicar **Disponible sin conexión**.
2. Pausar y cerrar Openfy. Activar modo avión y apagar el servidor del PC.
3. Abrir Openfy desde su icono, entrar a la playlist y reproducir las diez canciones con pantalla bloqueada durante al menos 45 minutos.
4. Adelantar, retroceder, cambiar pistas, cerrar y reabrir la aplicación. No debe necesitar el PC para cargar su interfaz, metadatos o audio ya descargado.
5. Eliminar una descarga y verificar que la canción desaparece de las disponibles en ese dispositivo. Los originales del PC se conservan.
6. En una cola con una pista no descargada, comprobar que el avance automático permite continuar con las disponibles y no se queda en un bucle.

## Resultado y evidencia

Exportar el archivo desde **Ajustes → Exportar diagnóstico** inmediatamente después de cada sesión. Se guarda localmente y contiene eventos técnicos (IDs de pistas, posiciones, cambios de visibilidad y errores), no archivos de audio. Los temporizadores de JavaScript pueden suspenderse al bloquear iOS: el diagnóstico debe complementarse con las observaciones reales.

| Comprobación | Resultado / momento / observación |
| --- | --- |
| Acceso por la dirección privada HTTPS en iPhone | Confirmado por el usuario el 11 de noviembre de 2026 |
| Descarga en el iPhone | Confirmada por el usuario el 11 de noviembre de 2026 |
| Reproducción con pantalla bloqueada | Confirmada por el usuario el 11 de noviembre de 2026 |
| Reproducción en modo avión | Confirmada por el usuario el 11 de noviembre de 2026 |
| Streaming 45 minutos y diez canciones | Pendiente |
| Avance automático bloqueado | Pendiente |
| Controles de audífonos y pantalla de bloqueo | Pendiente |
| Llamada e interrupciones | Pendiente |
| Desconexión y reconexión Bluetooth | Pendiente |
| Cambio Wi-Fi / datos móviles | Pendiente |
| Reapertura en modo avión y PC apagado | Pendiente |
| Cola offline 45 minutos y diez canciones | Pendiente |
| Seek y saltos de pista offline | Pendiente |

Si falla, registrar pasos exactos, minuto aproximado, estado de la pantalla/red y diagnóstico. Corregir primero el reproductor si es un fallo propio. Si la limitación es de Safari, no añadir más funciones: revisar una capa nativa para iOS y su instalación antes de continuar.

## Nueva fuente: YouTube Music

La validación anterior corresponde a archivos de la biblioteca. La búsqueda y reproducción desde YouTube Music necesitan una aceptación física independiente. El motor WebKit de Windows no mantuvo la reproducción de las pistas reales durante la comprobación; los detalles están en [la verificación de YouTube Music](youtube-validation.md).

Con el PC conectado e Internet disponible en ambos dispositivos:

1. Aceptar la actualización de Openfy con la música pausada y abrir **Buscar → YouTube Music**.
2. Buscar una canción, reproducirla y adelantar a un punto posterior al minuto dos. Comprobar que sigue sonando.
3. Formar una cola con canciones de YouTube y archivos locales; probar pausa, siguiente, anterior y reapertura sin reproducción automática.
4. Escuchar con pantalla bloqueada durante 45 minutos, comprobando avance automático, controles de audífonos, Bluetooth y una interrupción por llamada.
5. Cambiar entre Wi-Fi y datos móviles manteniendo Tailscale activo; registrar las interrupciones y probar reintentar desde la barra si el proveedor falla.

Las canciones de YouTube necesitan conexión y no se convierten en descargas offline. Todos los pasos de esta sección permanecen pendientes de confirmación del usuario. Exportar el diagnóstico desde Ajustes si falla alguno.

## Letras: aceptación física pendiente

Las pruebas automatizadas de WebKit móvil no sustituyen esta comprobación en el iPhone:

1. Actualizar la PWA con la música pausada. Abrir una canción local y **Reproductor ampliado → Letras**; comprobar texto, línea activa y desplazamiento sin ocultar los controles.
2. Pausar y pulsar un verso: debe cambiar la posición y conservar la pausa. Reanudar, desplazarse manualmente y pulsar **Seguir reproducción**.
3. Descargar una canción con letra disponible. Esperar a que se guarde la letra, activar modo avión, cerrar y volver a abrir Openfy. Comprobar reproducción, letras y salto por verso con el PC apagado.
4. Probar una canción con texto sin tiempos, una instrumental y otra sin letras. Comprobar mensajes y legibilidad con tamaño de texto aumentado y movimiento reducido.
5. Con conexión, abrir letras de una canción de YouTube Music, avanzar y cambiar rápidamente de pista. La letra debe corresponder siempre a la canción actual. Bloquear y desbloquear la pantalla y comprobar que el seguimiento recupera la posición del audio.

6. (2026-11-15, actualizado en la 0.4.0) Abrir el reproductor ampliado: en vertical abre con la portada grande; el botón de letra muestra la cabecera compacta (portada pequeña, título, artista), la letra en el centro y los controles abajo, y la elección se mantiene al volver a abrirlo. En horizontal, la letra a la derecha de la portada en pantallas de 900 px o más. Comprobar que el fondo toma los colores de la portada sin zonas negras, que se funde al cambiar de canción y que se congela al pausar.
7. Con una canción cuya letra incrustada traiga tiempos por palabra (LRC mejorado), comprobar que la palabra cantada se rellena de izquierda a derecha y que el consumo y la temperatura siguen siendo razonables durante varios minutos.

Estado: pendiente de prueba física. La verificación automatizada y sus límites están en [lyrics-validation.md](lyrics-validation.md).

## Experiencia móvil (0.4.0)

La lista de comprobación física de la barra de estado, las zonas seguras, los gestos, las hojas inferiores y las transiciones está en [mobile-ux.md](mobile-ux.md#pendiente-en-un-iphone-físico-con-ios-27). Estado: pendiente de prueba física en iOS 27.
