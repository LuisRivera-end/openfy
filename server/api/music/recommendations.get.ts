import { getRecommendations } from '../../utils/recommendations'
export default defineEventHandler(event => getRecommendations(getQuery(event).refresh === 'true'))
