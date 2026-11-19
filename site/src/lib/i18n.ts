import es from '../i18n/es.json'
import en from '../i18n/en.json'

export type Lang = 'es' | 'en'
type Tree = { [key: string]: unknown }

const dictionaries: Record<Lang, Tree> = { es, en }

/** The page language is fixed by the HTML entry (/ is Spanish, /en/ is English). */
export const lang: Lang = document.documentElement.lang === 'en' ? 'en' : 'es'

function lookup(key: string): unknown {
  let node: unknown = dictionaries[lang]
  for (const part of key.split('.')) node = node && typeof node === 'object' ? (node as Tree)[part] : undefined
  return node
}

export interface Translate {
  /** Escaped text for `key`; `{name}` placeholders are replaced by `vars`. */
  (key: string, vars?: Record<string, string>): string
  /** Array value for `key` (strings are escaped, objects returned with escaped string fields). */
  list<T = string>(key: string): T[]
}

export const escapeHtml = (value: string) =>
  value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

function escapeDeep(value: unknown): unknown {
  if (typeof value === 'string') return escapeHtml(value)
  if (Array.isArray(value)) return value.map(escapeDeep)
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, escapeDeep(v)]))
  return value
}

export const t = ((key: string, vars?: Record<string, string>) => {
  const value = lookup(key)
  if (typeof value !== 'string') {
    if (import.meta.env.DEV) console.warn(`[i18n] missing ${lang}:${key}`)
    return key
  }
  let text = escapeHtml(value)
  for (const [name, replacement] of Object.entries(vars ?? {})) text = text.replaceAll(`{${name}}`, escapeHtml(replacement))
  return text
}) as Translate

t.list = <T,>(key: string) => {
  const value = lookup(key)
  return (Array.isArray(value) ? escapeDeep(value) : []) as T[]
}

export const otherLangHref = lang === 'es' ? './en/' : '../'
export const locale = lang === 'es' ? 'es-MX' : 'en-US'
