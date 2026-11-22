# Openfy para Linux

Cada release incluye `Openfy-<versión>-<compilación>-linux-x64.tar.gz` y `…-linux-arm64.tar.gz`. Contienen el mismo servidor de Node que usa la aplicación de Windows: la biblioteca SQLite, la API y la PWA que abren el iPhone, Android y el navegador. La aplicación nativa de Windows (WinUI) no tiene versión para Linux.

## Qué incluye

| Ruta | Contenido |
| --- | --- |
| `openfy` | Lanzador. Sin argumentos inicia el servidor en primer plano. |
| `node/bin/node` | Node 22 oficial; no hace falta instalar Node. |
| `app/.output` | Compilación de producción con `better-sqlite3`, `sharp` y FFmpeg para Linux. |
| `app/scripts/serve.mjs` | El mismo arranque que `npm start`: solo escucha en `127.0.0.1`. |
| `openfy.service` | Plantilla del servicio de systemd para el usuario. |
| `openfy.env.example` | Configuración de ejemplo. |

Requisitos: glibc 2.31 o posterior (Debian 11, Ubuntu 20.04, Fedora 32, RHEL/Rocky 9 o más recientes). El `better-sqlite3` precompilado necesita glibc 2.29, por lo que Debian 10 y RHEL 8 no funcionan. Alpine y otras distribuciones con musl tampoco. `scripts/check-linux-package.sh` prueba cada paquete en Debian 11, Ubuntu 20.04, Debian 12 y Ubuntu 24.04 antes de publicarlo.

## Instalación

```bash
mkdir -p ~/.local/opt
tar -xzf Openfy-*-linux-x64.tar.gz -C ~/.local/opt
~/.local/opt/Openfy-*/openfy            # prueba en primer plano; Ctrl+C para salir
~/.local/opt/Openfy-*/openfy install-service
```

`install-service` escribe `~/.config/systemd/user/openfy.service` apuntando a la carpeta extraída y lo activa. Para que siga funcionando sin una sesión iniciada: `loginctl enable-linger "$USER"`. `openfy uninstall-service` lo quita sin tocar la biblioteca.

## Carpetas y configuración

- Biblioteca: `${XDG_DATA_HOME:-~/.local/share}/openfy/data`, o `OPENFY_DATA_DIR`.
- Configuración: `${XDG_CONFIG_HOME:-~/.config}/openfy/openfy.env`. `openfy config` la crea a partir del ejemplo y muestra su ruta. Admite las mismas variables que el `.env` del repositorio (`NITRO_PORT`, `OPENFY_ORIGIN`, `OPENFY_FFMPEG`, `OPENFY_MOTION_ART`…).
- Solo puede haber un servidor por biblioteca (`.openfy-library.lock`). Para mover una biblioteca de Windows, copia la carpeta `data` completa con el servidor detenido y apunta `OPENFY_DATA_DIR` a ella.

## Acceso desde el teléfono

Igual que en Windows, el servidor no se expone a la red: Tailscale Serve lo publica dentro de tu tailnet con HTTPS.

```bash
sudo tailscale serve --bg 3000
```

Añade la dirección exacta a `openfy.env` (`OPENFY_ORIGIN=https://tu-equipo.tu-tailnet.ts.net`) y reinicia con `systemctl --user restart openfy`. Sin `OPENFY_ORIGIN`, las peticiones que llegan por Tailscale se rechazan.

## Actualizar

Detén el servicio, extrae la versión nueva junto a la anterior y ejecuta `openfy install-service` desde la carpeta nueva. La biblioteca y la configuración no se mueven. Las migraciones de SQLite se aplican al arrancar, como en Windows; no vuelvas a una versión anterior después de abrir la biblioteca con una más nueva.

## Cómo se publica

`.github/workflows/release-linux.yml` se lanza a mano (`workflow_dispatch`) con la etiqueta de un release ya creado, por ejemplo `v0.6.3-build.1795300000`. Comprueba que la versión coincide con `package.json`, compila en `ubuntu-24.04` (x64) y `ubuntu-24.04-arm` (arm64) con `scripts/package-linux.sh`, prueba cada paquete en contenedores (estado, PWA, service worker, SQLite y una conversión AAC con el FFmpeg incluido) y sube los archivos al release. También añade sus huellas a `SHA256SUMS.txt`.

```bash
gh workflow run release-linux.yml -R LuisRivera-end/openfy --ref dev -f tag=v0.6.3-build.1795300000
```

Los módulos nativos dependen de la plataforma, así que el paquete no se puede crear desde Windows. Para probarlo en local se puede ejecutar `scripts/package-linux.sh <compilación> <carpeta>` dentro de WSL o de otro Linux con Node 22.
