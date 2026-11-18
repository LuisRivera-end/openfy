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
