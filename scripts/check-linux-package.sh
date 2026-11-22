#!/usr/bin/env bash
# Smoke test of a Linux release archive inside clean containers (old and current glibc).
# Usage: scripts/check-linux-package.sh <archive.tar.gz> [image...]
set -euo pipefail
archive="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"
shift
images=("$@"); [[ ${#images[@]} -gt 0 ]] || images=(debian:bullseye ubuntu:20.04 debian:bookworm ubuntu:24.04)
for image in "${images[@]}"; do
  echo "== $image"
  docker run --rm -v "$archive:/package.tar.gz:ro" "$image" bash -euc '
    mkdir -p /opt && tar -xzf /package.tar.gz -C /opt
    cd /opt/Openfy-*
    ldd --version | head -1
    export HOME=/tmp/home OPENFY_MOTION_ART=off OPENFY_METADATA_LOOKUP=off NITRO_PORT=4321
    ./openfy version
    ./openfy & server=$!
    probe() { node/bin/node -e "fetch(\"http://127.0.0.1:4321\" + process.argv[1]).then(async r => { if (!r.ok) process.exit(1); console.log(process.argv[1], r.status, (await r.text()).length) }).catch(() => process.exit(1))" "$1"; }
    for attempt in $(seq 1 60); do probe /api/status >/dev/null && break; sleep 1; done
    probe /api/status
    probe /
    probe /sw.js
    probe /api/library
    app/.output/server/node_modules/ffmpeg-static/ffmpeg -hide_banner -loglevel error -f lavfi -i sine=d=1 -c:a aac -f mp4 -y /tmp/check.m4a
    echo "aac $(stat -c %s /tmp/check.m4a) bytes"
    kill $server; wait $server || true
    test -f /tmp/home/.local/share/openfy/data/openfy.sqlite
    echo "ok"
  '
done
