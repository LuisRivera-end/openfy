/** Isolated integration fixture. Bound only to loopback; never starts against the personal library. */
import { createServer } from 'node:http'
import { mkdirSync } from 'node:fs'
import { resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { createPairing, pairDevice, exchangeSync, capturePlaylist, revokeSyncDevice, SyncError } from '../server/utils/device-sync'
import { closeDatabase, libraryConnection } from '../server/database'
import { saveYouTubeSong } from '../server/utils/saved-music'

const root=resolve(process.argv[2] || 'output/android-sync/state')
mkdirSync(root,{recursive:true})
process.env.OPENFY_DATA_DIR=root
process.env.OPENFY_ORIGIN='https://openfy.test.ts.net'
const db=libraryConnection()
const a={ videoId:'abcdefghijk',title:'Sincronización A',artists:['Openfy'],album:null,artwork:null,duration:120 }
const b={ ...a,videoId:'12345678901',title:'Sincronización B' }
saveYouTubeSong({song:a,favorite:true}); saveYouTubeSong({song:b})
const playlistId=randomUUID(), localA=randomUUID(), localB=randomUUID()
db.prepare('INSERT INTO playlists(id,name,track_ids,revision,updated_at) VALUES(?,?,?,1,?)').run(playlistId,'Mixta del PC',JSON.stringify([localA,`youtube:${a.videoId}`,localB]),Date.now())
capturePlaylist(playlistId)
let drop=false
const server=createServer(async(req,res)=>{
  try {
    const raw:Buffer[]=[]; let size=0
    for await(const chunk of req) { size+=chunk.length; if(size>8*1024*1024) throw new SyncError('Body too large',413); raw.push(chunk) }
    const body=raw.length ? JSON.parse(Buffer.concat(raw).toString()) : {}
    let response:unknown
    switch(req.url) {
      case '/test/bootstrap': {
        saveYouTubeSong({song:a,favorite:true})
        db.prepare('UPDATE playlists SET name=?,track_ids=?,revision=revision+1,updated_at=? WHERE id=?').run('Mixta del PC',JSON.stringify([localA,`youtube:${a.videoId}`,localB]),Date.now(),playlistId)
        capturePlaylist(playlistId)
        response={...createPairing(),playlistId,localA,localB,a,b}; break
      }
      case '/test/drop-next': drop=true; response={ok:true}; break
      case '/test/state': response={
        playlist:db.prepare('SELECT id,name,track_ids FROM playlists WHERE id=?').get(playlistId),
        favorite:db.prepare('SELECT favorite FROM youtube_songs WHERE video_id=?').get(a.videoId),
        operations:db.prepare('SELECT COUNT(*) AS count FROM sync_operations').get(),
      }; break
      case '/test/revoke': revokeSyncDevice(body.deviceId); response={ok:true}; break
      case '/api/sync/v1/pair': response=pairDevice(body.code,body.deviceId,body.name); break
      case '/api/sync/v1/exchange': {
        for(const op of body.operations) {
          if(op.kind==='favorite' && !op.entityId.startsWith('youtube:')) throw new SyncError('Local favorite leaked')
          if(op.kind==='playlist' && op.payload.trackIds.some((id:string)=>!id.startsWith('youtube:'))) throw new SyncError('Local playlist reference leaked')
        }
        response=exchangeSync(body.deviceId,String(req.headers.authorization || '').replace(/^Bearer /,''),body.cursor,body.operations)
        if(drop) { drop=false; req.socket.destroy(); return }
        break
      }
      default: throw new SyncError('Not found',404)
    }
    res.writeHead(200,{'Content-Type':'application/json'}); res.end(JSON.stringify(response))
  } catch(error) {
    res.writeHead(error instanceof SyncError ? error.statusCode : 500,{'Content-Type':'application/json'})
    res.end(JSON.stringify({error:error instanceof Error ? error.message : 'Error'}))
  }
})
server.listen(4438,'127.0.0.1',()=>console.log('ANDROID_SYNC_HOST_READY port=4438'))
process.on('SIGINT',()=>server.close(()=>{ closeDatabase(); process.exit(0) }))
