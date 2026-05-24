import { resolveApiUrl, withAuthQuery } from './publicPath'
import { authStore } from './src/store/authStore'

type ApiResponse<T = Record<string, unknown>> = {
  code: number
  data?: T
  message?: string
}

const FETCH_CREDENTIALS: RequestCredentials = 'include'

const buildAuthHeaders = (extraHeaders: HeadersInit = {}) => {
  const token = authStore.token
  return {
    ...authStore.getAuthHeaders(),
    ...(token ? { 'X-Auth-Token': token } : {}),
    ...extraHeaders,
  }
}

const withNoCacheQuery = (url: string, options: RequestInit = {}) => {
  const method = `${options.method ?? 'GET'}`.toUpperCase()
  if (method !== 'GET') {
    return url
  }
  const joiner = url.includes('?') ? '&' : '?'
  return `${url}${joiner}_t=${Date.now()}`
}

const parseJsonResponse = async (response: Response) => {
  const responseText = await response.text()
  try {
    return JSON.parse(responseText) as ApiResponse
  } catch (error: unknown) {
    const previewText = responseText.slice(0, 120).replace(/\s+/g, ' ')
    throw Object.assign(
      new Error(`backend response is not JSON (status ${response.status}): ${previewText}`),
      { cause: error },
    )
  }
}

const parseErrorMessage = (responseText: string) => {
  try {
    const body = JSON.parse(responseText) as ApiResponse
    return String(body.message || responseText)
  } catch (error: unknown) {
    return responseText || String(error)
  }
}

export async function requestAuthenticatedJson(
  path: string,
  options: RequestInit = {},
) {
  const token = authStore.token
  const baseUrl = withAuthQuery(resolveApiUrl(path), token)
  const url = withNoCacheQuery(baseUrl, options)
  const extraHeaders = options.headers || {}
  const response = await fetch(url, {
    credentials: FETCH_CREDENTIALS,
    cache: 'no-store',
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache, no-store, max-age=0',
      Pragma: 'no-cache',
      ...buildAuthHeaders(extraHeaders),
    },
    ...options,
  })
  const body = await parseJsonResponse(response)
  if (response.status === 401) {
    authStore.clearSessionOnUnauthorized()
    throw new Error(body.message || 'unauthorized')
  }
  if (!response.ok || body.code < 0) {
    throw new Error(body.message || `request failed: ${response.status}`)
  }
  return body.data || {}
}

export async function requestAuthenticatedBlob(path: string, options: RequestInit = {}) {
  const token = authStore.token
  const baseUrl = withAuthQuery(resolveApiUrl(path), token)
  const url = withNoCacheQuery(baseUrl, options)
  const extraHeaders = options.headers || {}
  const response = await fetch(url, {
    credentials: FETCH_CREDENTIALS,
    cache: 'no-store',
    headers: {
      'Cache-Control': 'no-cache, no-store, max-age=0',
      Pragma: 'no-cache',
      ...buildAuthHeaders(extraHeaders),
    },
    ...options,
  })
  if (response.status === 401) {
    authStore.clearSessionOnUnauthorized()
    throw new Error('unauthorized')
  }
  if (!response.ok) {
    const responseText = await response.text()
    const errorMessage = parseErrorMessage(responseText)
    throw new Error(errorMessage || `request failed: ${response.status}`)
  }
  return response
}
