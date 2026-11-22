# Iniciar Openfy con Windows

La aplicación instalada puede abrirse sola al iniciar sesión, igual que Discord o Spotify, para que la biblioteca y el servidor del iPhone estén disponibles sin abrir la ventana. Se activa en **Ajustes › Aplicación para Windows › Iniciar Openfy con Windows**. Está desactivado de forma predeterminada.

## Cómo funciona

- El interruptor escribe el valor `Openfy` en `HKCU\Software\Microsoft\Windows\CurrentVersion\Run` con `"%LOCALAPPDATA%\Openfy\installer\Openfy.Setup.exe" --launch --background`. Es el mismo lanzador que el acceso directo del menú Inicio: recupera una actualización interrumpida y abre `Openfy.exe` con el perfil guardado (estado, biblioteca y puerto), así que la instancia de inicio de sesión es la misma que abre el acceso directo. No requiere permisos de administrador ni crea tareas programadas.
- El registro es la única fuente de verdad; no se guarda en `settings.json`. Si el inicio se desactiva desde el Administrador de tareas o desde **Configuración › Aplicaciones › Inicio**, Windows lo marca en `Explorer\StartupApproved\Run` (primer byte impar) sin borrar la entrada. El interruptor aparece apagado y Ajustes lo indica. Volver a activarlo desde Openfy escribe el valor de «habilitado» (`02` seguido de ceros).
- Cada inicio de la aplicación instalada corrige una entrada existente que apunte a otro ejecutable. Nunca crea una entrada que el usuario no activó ni cambia su aprobación.
- El desinstalador borra ambos valores. Solo se registra la instalación personal (`%LOCALAPPDATA%\Programs\Openfy`): nunca la copia del espacio de trabajo (`--workspace`), una instalación de pruebas (`OPENFY_INSTALL_TEST_ROOT`) ni las comprobaciones (`--startup-check`, `--smoke-test`…). En ellas el interruptor está desactivado con el aviso «Disponible en la aplicación instalada».
- Ajustes vuelve a leer el registro cada vez que la ventana recupera el foco, por si se cambió desde el Administrador de tareas.

## Arranque en la bandeja

Con `--background`:

- No se crea la ventana de apertura y la principal se prepara oculta: no aparece ninguna ventana ni se roba el foco. El backend, la sesión del reproductor, la bandeja, los controles multimedia y Discord se inician como siempre.
- El minirreproductor, el widget y las Novedades pendientes esperan a que el usuario abra la ventana por primera vez. WinUI puede emitir `Loaded` con la ventana oculta, así que la espera comprueba también `AppWindow.IsVisible`; sin esa comprobación, el diálogo de Novedades se abría sobre la ventana oculta y le quitaba el teclado al usuario.
- Si Windows retrasa la entrada y el usuario ya abrió Openfy, la instancia de `--background` sale sin mostrar nada.
- Si la apertura falla, aparece la pantalla habitual con **Reintentar** y **Salir**.
- Abrir Openfy desde el menú Inicio o el icono de la bandeja muestra la ventana; si todavía se está preparando, muestra la pantalla de apertura.

## Linux

El paquete de Linux es solo el servidor. `openfy install-service` lo instala como servicio de usuario de systemd (`WantedBy=default.target`, `enable --now`), que arranca al iniciar sesión; con `loginctl enable-linger "$USER"` arranca también al encender el equipo sin sesión. Ver [linux.md](linux.md).

## Diagnóstico

El registro de sesión nativo anota `startup.window` con resultado `tray` o `revealed`, y `startup.entry` con `enabled`, `disabled`, `repaired` o `failed`.
