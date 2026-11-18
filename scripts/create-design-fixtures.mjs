// Synthetic music and code-drawn covers for isolated native visual checks.
import { mkdir } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { spawnSync } from 'node:child_process'
import sharp from 'sharp'
import ffmpeg from 'ffmpeg-static'
const directory = resolve(process.argv[2] || 'output/native-design-qa/fixtures')
await mkdir(directory, { recursive: true })
const albums = [ ['Horizonte', 'Openfy Sessions', '#314D50', '#ADBA95'], ['Ritmos de la ciudad', 'Estudio Norte', '#64444F', '#DFAF97'], ['A través del tiempo', 'Mar de Fondo', '#353D69', '#ADACE5'], ['Mañanas tranquilas', 'Openfy Sessions', '#53694D', '#D6CB9A'], ['Entre luces', 'Estudio Norte', '#61423D', '#D88F61'], ['La última canción', 'Mar de Fondo', '#343B45', '#A4BBC6'] ]
for (let i = 0; i < albums.length; i++) {
  const [album,artist,dark,light] = albums[i]
  const artwork = join(directory,`cover-${i}.jpg`)
  await sharp(Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="600" height="600"><defs><linearGradient id="g" x2="1" y2="1"><stop stop-color="${dark}"/><stop offset="1" stop-color="${light}"/></linearGradient></defs><rect width="600" height="600" fill="url(#g)"/><circle cx="410" cy="360" r="260" fill="none" stroke="${light}" stroke-width="2" opacity=".4"/><circle cx="410" cy="360" r="190" fill="none" stroke="${light}" opacity=".3"/><path d="M0 450Q250 180 600 520V600H0" fill="${dark}" opacity=".5"/><text x="48" y="85" fill="${light}" font-size="24" font-family="Segoe UI">${artist}</text><text x="48" y="505" fill="white" font-size="35" font-family="Segoe UI" font-weight="600">${album}</text></svg>`)).jpeg().toFile(artwork)
  const titles = i === 0 ? ['Horizonte', 'Una canción con un título largo para volver a casa'] : [album]
  for (let n=0; n<titles.length; n++) {
    const result=spawnSync(ffmpeg,['-hide_banner','-loglevel','error','-y','-f','lavfi','-i',`sine=frequency=${220+i*30+n}:duration=8:sample_rate=22050`,'-i',artwork,'-map','0:a:0','-map','1:v:0','-c:v','mjpeg','-disposition:v:0','attached_pic','-af','volume=0.01','-c:a','libmp3lame','-metadata',`title=${titles[n]}`,'-metadata',`artist=${artist}`,'-metadata',`album=${album}`,'-metadata',`track=${n+1}`,'-metadata','lyrics=[00:00.00]El sonido de tu mundo\n[00:02.00]Tu música va contigo\n[00:05.00]Un lugar para cada canción',join(directory,`track-${i}-${n}.mp3`)],{windowsHide:true})
    if(result.status!==0) throw new Error(result.stderr.toString())
  }
}
console.log(directory)
