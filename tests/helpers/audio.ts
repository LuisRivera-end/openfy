import { spawnSync } from 'node:child_process'
import ffmpeg from 'ffmpeg-static'

export function generateAudio(path: string, options: { duration?: number; frequency?: number; format?: 'mp3' | 'flac' | 'aac'; tags?: boolean; artwork?: string; lyrics?: string; genre?: string; album?: string } = {}) {
  const format = options.format || 'mp3'
  const args = ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i',
    `sine=frequency=${options.frequency || 220}:duration=${options.duration || 3}:sample_rate=22050`]
  if (options.artwork) args.push('-i', options.artwork, '-map', '0:a:0', '-map', '1:v:0', '-c:v', 'mjpeg', '-disposition:v:0', 'attached_pic')
  args.push('-af', 'volume=0.05')
  if (options.tags) args.push('-metadata', 'title=Horizonte', '-metadata', 'artist=Openfy', '-metadata', 'album=Pruebas de audio')
  if (options.lyrics) args.push('-metadata', `lyrics=${options.lyrics}`)
  if (options.genre) args.push('-metadata', `genre=${options.genre}`)
  if (options.album) args.push('-metadata', `album=${options.album}`)
  args.push('-c:a', format === 'mp3' ? 'libmp3lame' : format === 'flac' ? 'flac' : 'aac', path)
  const result = spawnSync(ffmpeg!, args, { windowsHide: true })
  if (result.status !== 0) throw new Error(result.stderr.toString())
}
