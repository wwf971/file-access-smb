import { resolveApiUrl } from './publicPath'
import { authStore } from './src/store/authStore'

type ApiResponse<T = Record<string, unknown>> = {
  code: number
  data?: T
  message?: string
}

const FETCH_CREDENTIALS: RequestCredentials = 'include'

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

const parseJsonBody = (body: BodyInit | null | undefined) => {
  if (typeof body !== 'string' || !body.trim()) {
    return {}
  }
  try {
    const data = JSON.parse(body) as unknown
    return data && typeof data === 'object' && !Array.isArray(data) ? data as Record<string, unknown> : {}
  } catch {
    return {}
  }
}

const buildOptionsWithAuthBody = (options: RequestInit, token: string) => {
  const method = `${options.method ?? 'GET'}`.toUpperCase()
  if (!token || method === 'GET' || method === 'HEAD') {
    return options
  }
  const body = parseJsonBody(options.body)
  return {
    ...options,
    body: JSON.stringify({ ...body, authToken: token }),
  }
}

export async function requestAuthenticatedJson(
  path: string,
  options: RequestInit = {},
) {
  const token = await authStore.getServiceToken()
  const optionsWithAuthBody = buildOptionsWithAuthBody(options, token)
  const baseUrl = resolveApiUrl(path)
  const url = withNoCacheQuery(baseUrl, optionsWithAuthBody)
  const extraHeaders = optionsWithAuthBody.headers || {}
  const response = await fetch(url, {
    ...optionsWithAuthBody,
    credentials: FETCH_CREDENTIALS,
    cache: 'no-store',
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache, no-store, max-age=0',
      Pragma: 'no-cache',
      ...extraHeaders,
    },
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
  const token = await authStore.getServiceToken()
  const optionsWithAuthBody = buildOptionsWithAuthBody(options, token)
  const baseUrl = resolveApiUrl(path)
  const url = withNoCacheQuery(baseUrl, optionsWithAuthBody)
  const extraHeaders = optionsWithAuthBody.headers || {}
  const response = await fetch(url, {
    ...optionsWithAuthBody,
    credentials: FETCH_CREDENTIALS,
    cache: 'no-store',
    headers: {
      'Cache-Control': 'no-cache, no-store, max-age=0',
      Pragma: 'no-cache',
      ...extraHeaders,
    },
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
