import { mkdir, copyFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { spawnSync } from 'node:child_process'
import ffmpeg from 'ffmpeg-static'
const out=resolve(process.argv[2])
await mkdir(out,{recursive:true})
for(const [extension,codec] of [['m4a','aac'],['mp3','libmp3lame'],['flac','flac']]) {
  const result=spawnSync(ffmpeg,['-hide_banner','-loglevel','error','-y','-f','lavfi','-i','sine=frequency=440:duration=8',
    '-af','volume=0.03','-c:a',codec,'-metadata','title=Horizonte','-metadata','artist=Openfy','-metadata','album=Pruebas Android',
    '-metadata','genre=Ambient','-metadata','lyrics=[00:00.00]Inicio\n[00:04.00]Horizonte',resolve(out,`fixture.${extension}`)],{encoding:'utf8'})
  if(result.status!==0) throw new Error(result.stderr)
}
for(const name of ['lyrics-contract.json','listening-contract.json']) await copyFile(resolve('tests/fixtures',name),resolve(out,name))
// Live wallpaper QA: a song with an embedded cover, and a looping Motion-like HLS video for the offline cache.
const ff=(args)=>{ const result=spawnSync(ffmpeg,['-hide_banner','-loglevel','error','-y',...args],{encoding:'utf8'}); if(result.status!==0) throw new Error(result.stderr) }
const gradient='c0=0xff5f6d:c1=0x5b2bd6:c2=0x00c9a7:n=3:seed=7'
await mkdir(resolve(out,'motion'),{recursive:true})
ff(['-f','lavfi','-i',`gradients=s=1024x1024:${gradient}:x0=0:y0=0:x1=1024:y1=1024`,'-frames:v','1',resolve(out,'wallpaper-cover.jpg')])
ff(['-f','lavfi','-i','sine=frequency=330:duration=8','-i',resolve(out,'wallpaper-cover.jpg'),'-map','0:a','-map','1:v','-af','volume=0.03',
  '-c:a','aac','-c:v','mjpeg','-disposition:v:0','attached_pic','-metadata','title=Fondo animado','-metadata','artist=Openfy',
  '-metadata','album=Portadas Android',resolve(out,'wallpaper.m4a')])
ff(['-f','lavfi','-i',`gradients=s=720x720:${gradient}:speed=0.05:r=30`,'-t','4',
  '-vf',"hue=h=t*90,drawbox=x='(iw-120)*(0.5+0.4*sin(t*PI/2))':y=300:w=120:h=120:color=white@0.85:t=fill",
  '-c:v','libx264','-profile:v','main','-pix_fmt','yuv420p','-g','30','-f','hls','-hls_time','2','-hls_playlist_type','vod',
  '-hls_segment_filename',resolve(out,'motion','motion%d.ts'),resolve(out,'motion','motion.m3u8')])
