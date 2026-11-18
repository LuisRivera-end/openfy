import { matchSpotifyTrack } from '../../server/utils/music-spotify-match'
import { searchYouTubeMusic } from '../../server/utils/youtube-music'

export const spotifyMatch = (p: any) => matchSpotifyTrack(p.track, query => searchYouTubeMusic(query).then(result => result.songs))
