# Novedades — diseño (2026-11-15)

## Intención

Después de actualizar, Openfy no explicaba qué había cambiado. Se quiere un cuadro compacto de **Novedades** que aparezca una vez tras la actualización. Si se saltaron varias versiones, el mismo cuadro se divide en una sección por versión intermedia. Solo incluye versiones posteriores a la que estaba instalada. No es una página grande.

## Decisiones del usuario

- Aparece en Windows y en la PWA.
- El texto vive en un archivo del repositorio que viaja dentro de cada compilación (`shared/release-notes.json`).
- Sin versión previa registrada, muestra solo la versión actual.
- Se puede volver a abrir desde Ajustes, con el historial completo.

## Enfoques considerados

1. **Archivo en el repositorio incluido en cada compilación** (elegido). Funciona sin conexión, es igual en los dos clientes y se puede validar al empaquetar.
2. Notas en el manifiesto de actualización o en el cuerpo de la release de GitHub. Requiere red y la PWA no tiene acceso a ese canal.
3. Servir las notas desde Node. Añade una API para datos estáticos y hace depender el diálogo nativo del backend.

## Diseño

- Regla compartida `releasesSince(releases, lastSeen, current)`: devuelve las entradas en (lastSeen, current], de la más reciente a la más antigua. Sin historial válido, solo devuelve `current`. Ignora el número de compilación. Está implementada en `shared/utils/release-notes.ts` y en `Openfy.Core/ReleaseNotes.cs`, y la fija `tests/fixtures/release-notes-contract.json`.
- Registro por dispositivo: `localStorage` `openfy-release-seen` en la PWA y `release-notes.json` en el directorio de estado de Windows. Se escribe al cerrar el cuadro, o de inmediato si no hay nada que mostrar.
- PWA: `app/stores/releaseNotes.ts`, `app/components/ReleaseNotesDialog.vue` (sobre `AppDialog`), comprobación en `app.vue` al revelar la interfaz y botón en Ajustes.
- Windows: `Views/MainWindow.ReleaseNotes.cs` (`ContentDialog` con desplazamiento), lanzado desde `App.xaml.cs` excepto en los modos de comprobación, y botón en Ajustes.
- Controles al publicar: Vitest valida el archivo real y `package-desktop.ps1` rechaza una versión sin entrada.

## Decisiones propias

- `localStorage` en lugar de Dexie, para que Playwright pueda sembrar el valor y las pruebas existentes no vean el cuadro.
- Etiquetas Nuevo, Mejora y Arreglo, con los mismos colores en los dos clientes.
- La línea «Esto es lo nuevo desde la X» solo aparece cuando hay más de una versión.
- En Windows, si hay otro diálogo o menú abierto, el cuadro se pospone al siguiente inicio en lugar de esperar.
