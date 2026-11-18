import { searchYouTubeMusic, resolveYouTubeAudio, youtubeSession } from '../../server/utils/youtube-music'
import { spotifyMatch } from './spotify'
import { searchYouTubeArtists, searchYouTubeAlbums, getYouTubeArtist, getYouTubeAlbum, getYouTubeArtistSongs, getYouTubeArtistReleases, getYouTubeDiscoveryArtist } from '../../server/utils/youtube-catalog'

globalThis.openfy = {
  probe: async () => { const session = await youtubeSession(); const result = await session.music.search('Daft Punk Get Lucky',{ type:'song' }); return { ok:Boolean(result) } },
  probeAudio: async (p: any) => { const session=await youtubeSession(true); const info=await session.getBasicInfo(p.id,{ client:'VISIONOS' });
    const format=info.streaming_data?.adaptive_formats?.find(f => f.has_audio && !f.has_video && f.mime_type.startsWith('audio/mp4'));
    if(!format) throw new Error('No AAC format'); await format.decipher(session.session.player); return { ok:true }; },
  search: (p: any) => p.kind === 'artists' ? searchYouTubeArtists(p.query,p.cursor) : p.kind === 'albums'
    ? searchYouTubeAlbums(p.query,p.cursor) : searchYouTubeMusic(p.query,p.cursor),
  resolve: async (p: any) => {
    const audio=await resolveYouTubeAudio(p.id,Boolean(p.renew))
    const url=new URL(audio.url)
    // Expiring signatures/CDN hosts may change. These fields identify the encoded resource.
    const itag=url.searchParams.get('itag'), modified=url.searchParams.get('lmt')
    return {...audio,resource:itag && modified && audio.bytes ? `${p.id}:${itag}:${modified}:${audio.bytes}:${audio.mime}` : null}
  },
  artist: (p: any) => getYouTubeArtist(p.id), album: (p: any) => getYouTubeAlbum(p.id),
  artistSongs: (p: any) => getYouTubeArtistSongs(p.id,p.cursor),
  artistReleases: (p: any) => getYouTubeArtistReleases(p.id,p.kind,p.cursor),
  recommendations: async (p: any) => {
    const reference=p.seed.artistRefs?.[0] || { id:null,name:p.seed.artists[0] }
    const seed=await getYouTubeDiscoveryArtist(reference)
    const groups=await Promise.all(seed.similar.slice(0,2).map(getYouTubeDiscoveryArtist))
    const excluded=new Set(p.excluded || [])
    const songs=[...new Map(groups.flatMap(group=>group.songs).filter(song=>!excluded.has(song.videoId)).map(song=>[song.videoId,song])).values()].slice(0,12)
    const year=Number.isInteger(p.year) ? Number(p.year) : new Date().getFullYear()
    const albums=[...new Map([seed,...groups].flatMap(group=>group.releases)
      .filter(album=>album.year !== null && album.year >= year-1 && album.year <= year)
      .map(album=>[album.id,album])).values()]
      .sort((left,right)=>(right.year ?? 0)-(left.year ?? 0)).slice(0,24)
    return { songs,albums }
  },
  lyrics: async (p: any) => {
    const result = await (await youtubeSession()).music.getLyrics(p.id)
    return { plainText:result?.description.toString().trim() || '', attribution:result?.footer?.toString() || 'YouTube Music' }
  },
  spotifyMatch,
}
