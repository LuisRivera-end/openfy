# Ícono de Openfy

La fuente única es `public/icons/openfy.svg`. Conserva el diseño original y se usa directamente para el logo y el favicon de la web. `npm run icons` genera los PNG y el ICO desde ese vector a la resolución final de cada archivo, sin ampliar una imagen rasterizada de menor tamaño. También actualiza `desktop/Openfy.Windows/Assets/Openfy.png`, utilizado por el logo de la aplicación nativa.

- Web/PWA: PNG de 192, 512 y 1024 px, más el SVG para la interfaz.
- iOS: PNG opacos de 120, 152, 167 y 180 px con `sizes` explícito en la cabecera; la variante general `apple-touch-icon.png` tiene 1024 px. El sistema aplica las esquinas al fondo cuadrado.
- Iconos adaptativos: `maskable-512.png` tiene fondo opaco y conserva el símbolo en la zona central.
- Windows: `Openfy.ico` incluye 16, 20, 24, 30, 32, 36, 40, 48, 60, 64, 72, 80, 96, 128 y 256 px. El PNG de la interfaz tiene 1024 px.

Las variantes explícitas de iOS siguen la [selección de iconos de Safari](https://developer.apple.com/library/archive/documentation/AppleApplications/Reference/SafariWebContent/ConfiguringWebApplications/ConfiguringWebApplications.html). Los tamaños de Windows cubren las superficies y escalas descritas por [Microsoft](https://learn.microsoft.com/en-us/windows/apps/design/iconography/app-icon-construction).

La compilación web incluye los recursos en la caché de la PWA y el proyecto nativo incorpora los recursos de Windows. Los cambios requieren compilar y actualizar la aplicación correspondiente. Un acceso ya instalado en la pantalla de inicio de iOS puede conservar su ícono anterior; cambiar los archivos del servidor no garantiza que el sistema renueve ese acceso. La nitidez y la renovación del ícono en un iPhone físico necesitan validación en ese dispositivo.
