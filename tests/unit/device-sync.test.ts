import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { closeDatabase, libraryConnection, librarySchema } from '../../server/database'
import { applyPortable, authenticateDevice, capturePlaylist, createPairing, exchangeSync, pairDevice, revokeSyncDevice } from '../../server/utils/device-sync'
import { saveYouTubeSong } from '../../server/utils/saved-music'
import type { SyncOperation } from '../../shared/types/sync'

let root:string
const originalOrigin=process.env.OPENFY_ORIGIN
const originalData=process.env.OPENFY_DATA_DIR
const id=randomUUID(), deviceId=randomUUID()
const a={ videoId:'abcdefghijk',title:'Canción A',artists:['Openfy'],album:null,artwork:null,duration:120 }
const b={ ...a,videoId:'12345678901',title:'Canción B' }
let token=''
let sequence=0
const operation=(kind:SyncOperation['kind'],entityId:string,payload:SyncOperation['payload'],baseRevision=0):SyncOperation => ({ operationId:randomUUID(),sequence:++sequence,kind,entityId,payload,baseRevision })
beforeAll(async()=>{ root=await mkdtemp(join(tmpdir(),'openfy-sync-')); process.env.OPENFY_DATA_DIR=root; process.env.OPENFY_ORIGIN='https://openfy.test.ts.net' })
afterAll(async()=>{ closeDatabase(); if(originalData===undefined) delete process.env.OPENFY_DATA_DIR; else process.env.OPENFY_DATA_DIR=originalData; if(originalOrigin===undefined) delete process.env.OPENFY_ORIGIN; else process.env.OPENFY_ORIGIN=originalOrigin; await rm(root,{ recursive:true,force:true }) })

describe('Android private synchronization',()=>{
  it('migrates additively and pairs with an expiring single-use code',()=>{
    expect(librarySchema()).toBe(6)
    const pairing=createPairing(1000)
    expect(()=>pairDevice(pairing.code,randomUUID(),'Caducado',pairing.expiresAt)).toThrow(/caducado/)
    const fresh=createPairing()
    token=pairDevice(fresh.code,deviceId,'Android de prueba').token
    expect(()=>pairDevice(fresh.code,randomUUID(),'Repetido')).toThrow()
    expect(()=>authenticateDevice('invalid',deviceId)).toThrow()
    expect(()=>authenticateDevice(token,randomUUID())).toThrow()
  })
  it('replaces only YouTube slots and preserves all local order',()=>{
    expect(applyPortable(['local-1','youtube:abcdefghijk','local-2','youtube:12345678901','local-3'],['youtube:12345678901','youtube:abcdefghijk','youtube:ABCDEFGHIJK']))
      .toEqual(['local-1','youtube:12345678901','local-2','youtube:abcdefghijk','youtube:ABCDEFGHIJK','local-3'])
    expect(applyPortable(['local-1','youtube:abcdefghijk','local-2'],[])).toEqual(['local-1','local-2'])
    expect(applyPortable(['local-1'],['youtube:abcdefghijk'])).toEqual(['local-1','youtube:abcdefghijk'])
  })
  it('synchronizes only portable references and makes retries idempotent after reopening',()=>{
    saveYouTubeSong({song:a,favorite:true}); saveYouTubeSong({song:b})
    libraryConnection().prepare('INSERT INTO playlists(id,name,track_ids,revision,updated_at) VALUES(?,?,?,1,1)').run(id,'Mixta',JSON.stringify(['local-1','youtube:abcdefghijk','local-2']))
    const revision=capturePlaylist(id)
    const op=operation('playlist',id,{ name:'Compartida',trackIds:['youtube:12345678901','youtube:abcdefghijk'],songs:[b,a] },revision)
    const first=exchangeSync(deviceId,token,0,[op])
    const shared=first.changes.findLast(change=>change.entityId===id)!
    expect(JSON.stringify(shared)).not.toContain('local-')
    expect(libraryConnection().prepare('SELECT track_ids FROM playlists WHERE id=?').get(id)).toEqual({track_ids:JSON.stringify(['local-1','youtube:12345678901','youtube:abcdefghijk','local-2'])})
    closeDatabase()
    expect(exchangeSync(deviceId,token,first.cursor,[op]).acknowledgements).toEqual(first.acknowledgements)
    expect(()=>exchangeSync(deviceId,token,0,[{...op,payload:{name:'Alterada',trackIds:[],songs:[]}}])).toThrow(/diferentes/)
  })
  it('keeps simultaneous playlist edits as a conflict copy',()=>{
    const result=exchangeSync(deviceId,token,0,[operation('playlist',id,{ name:'Editada offline',trackIds:['youtube:abcdefghijk'],songs:[a] },0)])
    expect(result.acknowledgements[0]?.conflictId).toBeTruthy()
    expect(libraryConnection().prepare('SELECT name FROM playlists WHERE id=?').get(id)).toEqual({name:'Compartida'})
    expect(libraryConnection().prepare('SELECT name FROM playlists WHERE id=?').get(result.acknowledgements[0]!.conflictId!)).toEqual({name:'Editada offline (conflicto Android)'})
  })
  it('deletes the shared projection while preserving local music in an excluded playlist',()=>{
    const current=libraryConnection().prepare("SELECT revision FROM sync_entities WHERE kind='playlist' AND entity_id=?").get(id) as {revision:number}
    exchangeSync(deviceId,token,0,[operation('deletePlaylist',id,{},current.revision)])
    expect(libraryConnection().prepare('SELECT 1 FROM playlists WHERE id=?').get(id)).toBeUndefined()
    const local=libraryConnection().prepare("SELECT id,track_ids FROM playlists WHERE name='Compartida (local)'").get() as {id:string;track_ids:string}
    expect(JSON.parse(local.track_ids)).toEqual(['local-1','local-2'])
    expect(exchangeSync(deviceId,token,0,[]).changes.some(change=>change.entityId===local.id)).toBe(false)
  })
  it('uses server acceptance order for favorites and rejects revoked devices',()=>{
    exchangeSync(deviceId,token,0,[operation('favorite','youtube:abcdefghijk',{song:a,favorite:false})])
    expect(libraryConnection().prepare('SELECT favorite FROM youtube_songs WHERE video_id=?').get(a.videoId)).toEqual({favorite:0})
    revokeSyncDevice(deviceId)
    expect(()=>exchangeSync(deviceId,token,0,[])).toThrow(/revocado/)
  })
})
