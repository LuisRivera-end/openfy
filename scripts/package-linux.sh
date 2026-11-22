#!/usr/bin/env bash
# Builds the Linux release archive on a Linux machine (CI: .github/workflows/release-linux.yml).
# Native modules (better-sqlite3, sharp, FFmpeg) are per platform, so this cannot run on Windows.
# Usage: scripts/package-linux.sh <build-number> <output-dir>
set -euo pipefail

build="${1:?Falta el número de compilación}"
out="$(mkdir -p "${2:?Falta la carpeta de salida}" && cd "$2" && pwd)"
repo="$(cd "$(dirname "$0")/.." && pwd)"
cd "$repo"

case "$(uname -m)" in
  x86_64) arch=x64 ;;
  aarch64|arm64) arch=arm64 ;;
  *) echo "Arquitectura no compatible: $(uname -m)" >&2; exit 1 ;;
esac
version="$(node -p "require('./package.json').version")"
name="Openfy-$version-$build-linux-$arch"
stage="$(mktemp -d)/$name"
mkdir -p "$stage/app/scripts" "$stage/node/bin"

OPENFY_BUILD="$build" npm run build

cp -a .output "$stage/app/.output"
cp scripts/serve.mjs "$stage/app/scripts/serve.mjs"
# Nitro traces sharp's addon but not always the libvips library it loads at runtime.
for package in node_modules/@img/sharp-linux-* node_modules/@img/sharp-libvips-linux-*; do
  [[ -d "$package" ]] || continue
  case "$package" in *musl*) continue ;; esac
  target="$stage/app/.output/server/$package"
  [[ -d "$target" ]] || { mkdir -p "$(dirname "$target")"; cp -a "$package" "$target"; }
done

# The same official Node binary that ran the build.
cp "$(command -v node)" "$stage/node/bin/node"
node_root="$(dirname "$(dirname "$(command -v node)")")"
[[ -f "$node_root/LICENSE" ]] && cp "$node_root/LICENSE" "$stage/node/LICENSE"

cp packaging/linux/openfy packaging/linux/openfy.service packaging/linux/openfy.env.example "$stage/"
cp packaging/linux/LEEME.txt LICENSE "$stage/"
printf 'Openfy %s (compilación %s, linux-%s)\n' "$version" "$build" "$arch" > "$stage/VERSION"
chmod 755 "$stage/openfy" "$stage/node/bin/node"
ffmpeg="$stage/app/.output/server/node_modules/ffmpeg-static/ffmpeg"
[[ -f "$ffmpeg" ]] || { echo "Falta FFmpeg en el paquete." >&2; exit 1; }
chmod 755 "$ffmpeg"

# Everything the server needs must load from the package alone, with the bundled Node.
for required in better-sqlite3/build/Release/better_sqlite3.node @jitl/quickjs-wasmfile-release-sync/dist/emscripten-module.wasm; do
  [[ -f "$stage/app/.output/server/node_modules/$required" ]] || { echo "Falta $required en el paquete." >&2; exit 1; }
done
(cd "$stage/app/.output/server" && "$stage/node/bin/node" -e "require('better-sqlite3'); require('sharp')")
"$ffmpeg" -hide_banner -version | head -1

tar -C "$(dirname "$stage")" -czf "$out/$name.tar.gz" "$name"
echo "$out/$name.tar.gz"
