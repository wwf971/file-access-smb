/// <reference types="vite/client" />

const APP_BASE_ASSET_PLACEHOLDER = '/__APP_BASE__/'
const APP_BASE_PATH_CANDIDATES = ['/files']

export const getRuntimeAppBasePath = (): string => {
  if (typeof window === 'undefined') {
    return ''
  }
  const { pathname } = window.location
  return APP_BASE_PATH_CANDIDATES.find((basePath) => (
    pathname === basePath || pathname.startsWith(`${basePath}/`)
  )) || ''
}

const isCurrentPathUnderBasePath = (basePath: string): boolean => {
  if (typeof window === 'undefined' || !basePath) {
    return false
  }
  const { pathname } = window.location
  return pathname === basePath || pathname.startsWith(`${basePath}/`)
}

export const getAppBasePath = (): string => {
  const base = import.meta.env.BASE_URL ?? '/'
  if (base && base !== '/' && base !== APP_BASE_ASSET_PLACEHOLDER) {
    const normalizedBase = base.replace(/\/$/, '')
    return isCurrentPathUnderBasePath(normalizedBase) ? normalizedBase : getRuntimeAppBasePath()
  }
  return getRuntimeAppBasePath()
}

export const resolveApiUrl = (path: string): string => {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`
  const base = getAppBasePath()
  if (!base) {
    return normalizedPath
  }
  return `${base}${normalizedPath}`
}

export const withAuthQuery = (url: string, token: string): string => {
  const normalizedToken = `${token ?? ''}`.trim()
  if (!normalizedToken) {
    return url
  }
  const joiner = url.includes('?') ? '&' : '?'
  return `${url}${joiner}authToken=${encodeURIComponent(normalizedToken)}`
}
