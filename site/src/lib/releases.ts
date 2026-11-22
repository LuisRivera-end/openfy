/** Latest stable release of LuisRivera-end/openfy, read from the public GitHub API. */
export const REPO = 'LuisRivera-end/openfy'
export const RELEASES_URL = `https://github.com/${REPO}/releases`
export const LATEST_URL = `${RELEASES_URL}/latest`
const API_URL = `https://api.github.com/repos/${REPO}/releases/latest`

export interface ReleaseAsset { url: string; size: number; name: string }
export interface ReleaseInfo {
  version: string
  /** ISO date of publication. */
  date: string
  page: string
  windows?: ReleaseAsset
  android?: ReleaseAsset
  linux?: ReleaseAsset
  linuxArm64?: ReleaseAsset
  checksums?: ReleaseAsset
}

interface GitHubAsset { name: string; size: number; browser_download_url: string }
interface GitHubRelease { tag_name: string; html_url: string; published_at: string; assets: GitHubAsset[] }

const WINDOWS = /^Openfy-Setup-.+-x64\.exe$/i
const ANDROID = /^Openfy-.+-release\.apk$/i
const LINUX = /^Openfy-.+-linux-x64\.tar\.gz$/i
const LINUX_ARM64 = /^Openfy-.+-linux-arm64\.tar\.gz$/i
const CHECKSUMS = /^SHA256SUMS\.txt$/i

/** `v0.5.4-build.1794983913` → `0.5.4`. */
export const versionFromTag = (tag: string) => /^v?(\d+\.\d+\.\d+)/.exec(tag)?.[1] ?? tag.replace(/^v/, '')

export function parseRelease(release: GitHubRelease): ReleaseInfo {
  const pick = (pattern: RegExp): ReleaseAsset | undefined => {
    const asset = release.assets.find(a => pattern.test(a.name))
    return asset && { url: asset.browser_download_url, size: asset.size, name: asset.name }
  }
  return {
    version: versionFromTag(release.tag_name),
    date: release.published_at,
    page: release.html_url,
    windows: pick(WINDOWS),
    android: pick(ANDROID),
    linux: pick(LINUX),
    linuxArm64: pick(LINUX_ARM64),
    checksums: pick(CHECKSUMS)
  }
}

let pending: Promise<ReleaseInfo | null> | null = null

/** Resolves to null when GitHub cannot be reached; callers then keep the links to /releases/latest. */
export function loadRelease(timeoutMs = 6000): Promise<ReleaseInfo | null> {
  pending ??= (async () => {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await fetch(API_URL, { headers: { Accept: 'application/vnd.github+json' }, signal: controller.signal })
      if (!response.ok) return null
      return parseRelease(await response.json() as GitHubRelease)
    } catch {
      return null
    } finally {
      clearTimeout(timer)
    }
  })()
  return pending
}

export const formatSize = (bytes: number, locale: string) =>
  new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(bytes / 1048576) + ' MB'

export const formatDate = (iso: string, locale: string) =>
  new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(iso))
