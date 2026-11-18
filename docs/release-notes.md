# Novedades

Después de una actualización, Openfy muestra una sola vez el cuadro **Novedades**. Contiene una sección por cada versión instalada desde la última que vio ese dispositivo, de la más reciente a la más antigua. Si alguien pasa de la 1.1 a la 1.7, ve las secciones de la 1.7 a la 1.2. Las versiones anteriores a la que tenía no aparecen. **Ajustes → Novedades** abre el historial completo hasta la versión instalada.

Windows y la PWA leen el mismo archivo, `shared/release-notes.json`. Va dentro de cada compilación, así que funciona sin conexión.

## Añadir una versión

Cada vez que cambie `version` en `package.json`, añade su entrada **al principio** de `releases`:

```json
{
  "version": "0.4.0",
  "date": "2026-12-01",
  "summary": "Una frase opcional que resume la versión.",
  "items": [
    { "type": "new", "text": "Algo que antes no existía." },
    { "type": "improved", "text": "Algo que ya existía y ahora funciona mejor." },
    { "type": "fixed", "text": "Un fallo corregido." }
  ]
}
```

- `type` se muestra como **Nuevo**, **Mejora** o **Arreglo**.
- Escribe para quien usa la aplicación, no para quien la programa. Una línea por cambio.
- `npm test` y `scripts/package-desktop.ps1` fallan si falta la entrada de la versión actual. También fallan si las versiones no están ordenadas, se repiten o algún elemento está vacío.

## Comportamiento

- Se compara solo `major.minor.patch`. Recompilar la misma versión no vuelve a mostrar el cuadro.
- Si el dispositivo no tiene ninguna versión registrada (instalación nueva o primera vez con esta función), muestra solo la versión actual.
- Si la versión registrada es igual o posterior a la instalada, no muestra nada.
- La versión se registra al cerrar el cuadro. Si la aplicación se cierra antes, el cuadro vuelve a aparecer en el siguiente inicio.
- PWA: la clave `openfy-release-seen` de `localStorage`. Windows: `release-notes.json` en el directorio de estado (`%LOCALAPPDATA%\Openfy\desktop` o `--state-dir`). El instalador conserva este archivo junto con el resto del estado.
- En Windows no aparece durante las comprobaciones automáticas (`--startup-check`, `--smoke-test`, `--visual-check`, `--visual-players`, `--listening-test`, `--youtube-test`, `--offline-test`, `--benchmark-mode`, `--navigation-check`, `--downloads-check`, `--sections-check`, `--verify-update`). Tampoco aparece si ya hay otro diálogo abierto; en ese caso se muestra en el siguiente inicio.
