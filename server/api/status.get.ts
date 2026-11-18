import { conversionPaused } from '../utils/workers'
import { isMaintenance } from '../utils/update-maintenance'
export default defineEventHandler(() => ({ online: true, maintenance: isMaintenance(), conversionPaused: conversionPaused(), ...useRuntimeConfig().public.release,
  ...(process.env.OPENFY_DESKTOP_INSTANCE ? { desktopInstance: process.env.OPENFY_DESKTOP_INSTANCE } : {}) }))
