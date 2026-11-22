# Apertura de Openfy

Windows abre una ventana compacta de 420 × 300 DIP. Web/PWA muestra una pantalla que cubre la aplicación, incluida una plantilla HTML visible antes de ejecutar JavaScript. Ambas usan el logo existente, un pulso de 1,4 segundos y un fundido de 240 ms al terminar. No hay duración mínima artificial. El movimiento se desactiva con las preferencias de accesibilidad o de efectos de Openfy.

## Cuándo aparece la aplicación

1. Se preparan ajustes, biblioteca y playlists, estado local de descargas y sesión del reproductor. En Windows se conecta primero el proceso de Node y su puente local. El conjunto de estas etapas dispone de 30 segundos.
2. Se leen las cachés de historial y sugerencias y se inicia su actualización. Una caché válida permite continuar sin esperar a la actualización. Sin caché, el contenido inicial dispone de hasta 5 segundos adicionales; las peticiones que sigan pendientes continúan después de abrirse la interfaz.
3. Se monta y prepara la vista real antes del relevo. Las portadas mantienen sus placeholders, carga diferida y reintentos actuales y no bloquean la apertura. Tampoco la bloquean letras, actualizaciones o descargas de audio.

Web conserva la ruta solicitada y coordina también las primeras cargas de álbum, artista y ranking dentro de ese presupuesto opcional. Biblioteca, favoritos, playlists, descargas y búsqueda vacía dependen de los datos esenciales ya preparados.

La interfaz permanece fuera de la navegación con teclado durante la apertura. Al terminar el fundido web se desbloquea y recibe el foco el contenido principal. Windows restaura la posición guardada antes de mostrar la ventana principal y abre mini/widget después del relevo.

## Fallos y ciclo de vida

- Un fallo esencial permite **Reintentar**; Windows ofrece **Salir** y web **Recargar**. Las etapas completadas y las tareas en curso se reutilizan para evitar duplicados.
- Una desconexión web permite abrir los datos conservados y escuchar las copias locales. Los fallos opcionales conservan la presentación de error de su sección.
- Si este dispositivo ya tiene la biblioteca guardada, web solo espera 3 segundos a que el PC conteste a `/api/status` antes de abrirse con esos datos. La sincronización completa empieza cuando el PC responde. Sirve para el caso de un PC apagado o un nodo de Tailscale sin conexión, en el que la red acepta la petición y nunca la contesta: no hace falta activar el modo avión.
- Sin respuesta del PC, Openfy reintenta solo a los 3, 6 y 12 segundos y después cada 30, y quita el aviso de desconexión cuando vuelve a responder. Las comprobaciones automáticas de actualización esperan a que el PC esté disponible.
- `ofetch` no aplica su `timeout` si recibe también un `signal`. Las peticiones que se pueden cancelar llevan el límite en la propia señal (`deadlineSignal` en `shared/utils/startup.ts`).
- Salir durante el arranque cancela la preparación y detiene el backend propio. Un cierre anterior a la restauración de la sesión no guarda una cola vacía sobre la sesión anterior.
- La activación de otra instancia se comunica mediante un evento de Windows asociado al perfil: activa la apertura o la ventana principal sin reiniciar la sesión. Volver de la bandeja o recuperar Node no repite la apertura.
- `--verify-update` conserva una comprobación breve del backend y la ventana. `--startup-check <archivo>` comprueba la ventana principal revelada y añade `startup` y `splashClosed` al informe existente.

## Diagnóstico

Consultar primero [session-diagnostics.md](session-diagnostics.md). El registro nativo incluye `startup` con resultados `started`, `prepared`, `revealed` y `failed`, y eventos `startup.essential`, `startup.content` y `startup.window`. `deferred` indica que venció la espera opcional, no que la petición haya fallado. `elapsedMs` en la preparación mide desde el comienzo del intento; no incluye el fundido posterior. Los detalles técnicos de los errores quedan en el registro.

Web publica marcas locales de Performance: `openfy:startup:start`, `openfy:startup:prepared` y la medida `openfy:startup`. No se añade telemetría remota ni se modifica el esquema persistido.

## Verificación

Validación del 15 de noviembre de 2026, con datos y procesos de prueba aislados de la instalación personal:

- Tipos y compilación Nuxt de producción; compilación WinUI.
- Pruebas unitarias del límite de espera, cancelación, resultados tardíos y recuperación; pruebas del host real y audio nativo.
- Chromium y WebKit móvil: espera esencial, contenido lento, caché, reintento de almacenamiento, enlace directo, desconexión, movimiento reducido y presentación anterior a JavaScript. Regresiones de Inicio, cola/sesión y descargas.
- Arranque nativo real con `--startup-check`: backend conectado, ventana principal preparada y apertura cerrada.
- Revisión visual nativa: fallo por puerto ocupado, liberación del puerto y reintento exitoso; segunda instancia sin duplicar proceso ni vaciar los logs; salida limpia mediante el perfil de prueba.

WebKit automatizado no sustituye una comprobación en Safari/iPhone físico. Las pruebas de escalado y varios monitores requieren una revisión física adicional.

Para probar la compilación nativa del proyecto, salir de la instalación abierta mediante su bandeja y ejecutar `scripts/start-desktop.ps1`. La compilación del proyecto requiere el backend preparado por los scripts existentes; abrir directamente el ejecutable de desarrollo sin sus argumentos no equivale a una instalación empaquetada.
