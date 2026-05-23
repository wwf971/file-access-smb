export const getAppBasePath = (): string => {
  const base = import.meta.env.BASE_URL ?? '/'
  if (base === '/') {
    return ''
  }
  return base.replace(/\/$/, '')
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
