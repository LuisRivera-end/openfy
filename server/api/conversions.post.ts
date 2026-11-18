import { eq } from 'drizzle-orm'
import { getDatabase } from '../database'
import { tracks } from '../database/schema'
import { resumeConversions } from '../utils/workers'
export default defineEventHandler(() => {
  resumeConversions()
  getDatabase().update(tracks).set({ conversion: 'pending', conversionError: null }).where(eq(tracks.conversion, 'failed')).run()
  return { ok: true }
})
