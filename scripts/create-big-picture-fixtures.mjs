// Long, embedded AAC lyrics for the isolated Big Picture transition/scroll checks.
import { mkdir } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import sharp from 'sharp'
import ffmpeg from 'ffmpeg-static'

const directory = resolve(process.argv[2] || 'output/big-picture-followup/fixtures')
await mkdir(directory, { recursive: true })
for (let i = 0; i < 2; i++) {
  const cover = join(directory, `cover-${i}.jpg`)
  await sharp({ create: { width: 600, height: 600, channels: 3, background: i ? '#944e69' : '#3b7481' } }).jpeg().toFile(cover)
  const lyrics = Array.from({ length: 40 }, (_, line) => `[00:${String(line).padStart(2, '0')}.00]Verso ${line + 1} de la canción ${i + 1}`).join('\n')
  const result = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', `sine=frequency=${300 + i * 100}:duration=40:sample_rate=22050`,
    '-i', cover, '-map', '0:a:0', '-map', '1:v:0', '-c:v', 'mjpeg', '-disposition:v:0', 'attached_pic', '-af', 'volume=0.01', '-c:a', 'aac',
    '-metadata', `title=Big Picture ${i + 1}`, '-metadata', 'artist=Openfy QA', '-metadata', 'album=Regresiones Big Picture', '-metadata', `lyrics=${lyrics}`, join(directory, `track-${i}.m4a`)], { windowsHide: true })
  if (result.status !== 0) throw new Error(result.stderr.toString())
}
console.log(directory)
