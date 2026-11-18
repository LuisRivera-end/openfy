import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import ffmpeg from 'ffmpeg-static'

// Original, low-volume synthesized tones; never download commercial tracks.
const origin = process.env.OPENFY_TEST_URL || `http://127.0.0.1:${process.env.NITRO_PORT || 3000}`
const duration = Math.max(1, Math.min(600, Number(process.argv.find(a => a.startsWith('--duration='))?.split('=')[1] || 300)))
if (!Number.isFinite(duration)) throw new Error('Duración no válida.')
const temporary = await mkdtemp(join(tmpdir(), 'openfy-test-audio-'))
try {
  for (let index = 0; index < 10; index++) {
    const title = `Prueba ${String(index + 1).padStart(2, '0')}`
    const path = join(temporary, `${title}.m4a`)
    const frequency = [130.81, 146.83, 164.81, 174.61, 196, 220, 246.94, 261.63, 293.66, 329.63][index]
    await new Promise((resolve, reject) => {
      const child = spawn(process.env.OPENFY_FFMPEG || ffmpeg, [
        '-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i',
        `aevalsrc=0.025*sin(2*PI*${frequency}*t)+0.012*sin(2*PI*${frequency * 1.5}*t):s=22050:d=${duration}`,
        '-af', `afade=t=in:d=1,afade=t=out:st=${Math.max(0, duration - 1)}:d=1`,
        '-metadata', `title=${title}`, '-metadata', 'artist=Openfy · Audio de prueba',
        '-metadata', 'album=Sesión de validación', '-c:a', 'aac', '-b:a', '64k', '-movflags', '+faststart', path,
      ], { windowsHide: true, stdio: ['ignore', 'ignore', 'inherit'] })
      child.on('error', reject)
      child.on('exit', code => code === 0 ? resolve() : reject(new Error('FFmpeg no pudo generar el audio.')))
    })
    const response = await fetch(`${origin}/api/imports?filename=${encodeURIComponent(`${title}.m4a`)}`, {
      method: 'POST', headers: { 'Content-Type': 'application/octet-stream' }, body: await readFile(path),
    })
    if (!response.ok) throw new Error(`Importación fallida: ${response.status}`)
    console.log(`${title} enviada (${duration} segundos).`)
  }
  console.log('Abre el álbum «Sesión de validación». Espera a que terminen las importaciones antes de descargarlo.')
} finally {
  // This directory is uniquely created by this script and never contains user originals.
  await rm(temporary, { recursive: true, force: true })
}
