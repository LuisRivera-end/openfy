# Diagnóstico de Openfy

Para investigar errores de peticiones, portadas, comunicación con Node o arranque, lee primero [docs/session-diagnostics.md](docs/session-diagnostics.md).

Los logs adicionales contienen solo la sesión actual y se vacían al siguiente arranque real. Antes de reiniciar durante una investigación, conserva una copia de los dos archivos si necesitas esa evidencia. La guía explica su ubicación, eventos, campos y límites; no atribuyas una causa que los registros no demuestren.

# Compilación y aplicación de cambios

Antes de indicar cómo aplicar cambios, distingue la instalación de Windows del modo de desarrollo. Comprueba la ruta y los argumentos del proceso activo cuando sea necesario.

- `npm run build` compila la web y el backend del repositorio en `.output`; sirve para desarrollo, `npm start`, pruebas y el cliente iniciado con `scripts/start-desktop.ps1` (`--workspace`).
- Para aplicar cambios a la aplicación de Windows instalada, usa `scripts/package-desktop.ps1`. Con el canal local habitual, genera y verifica el instalador, actualiza y reabre la instalación existente, confirma el número de compilación del backend y limpia los empaquetados anteriores.
- La instalación usa su propio `backend/.output`. No indiques que reiniciar la app instalada después de `npm run build` incorpora los cambios del repositorio.
- Para paquetes de prueba utiliza un `-FeedRoot` aislado junto con `-NoInstall`. Conserva la separación entre las salidas de compilaciones concurrentes; no elimines las de otro proceso ni atribuyas su eliminación sin evidencia.

Consulta [docs/performance-and-builds.md](docs/performance-and-builds.md) para el flujo de empaquetado, limpieza y verificaciones.
