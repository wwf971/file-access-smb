import { makeAutoObservable, runInAction } from 'mobx'
import { resolveApiUrl } from '../../publicPath'

const LOCAL_STORAGE_AUTH_TOKEN_KEY = 'file-access-smb-auth-token'

type ApiResponse<T = Record<string, unknown>> = {
  code: number
  data?: T
  message?: string
}

class AuthStore {
  isInitializing = false
  isLoading = false
  isLoggedIn = false
  username = ''
  password = ''
  token = ''
  loginMode: 'credentials' | 'token' = 'credentials'
  message = ''
  messageType: 'error' | 'success' = 'error'
  isPasswordVisible = false
  permission = 'R'

  constructor() {
    makeAutoObservable(this, {}, { autoBind: true })
  }

  async requestJson(url: string, options: RequestInit = {}) {
    const response = await fetch(resolveApiUrl(url), {
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
      },
      ...options,
    })
    const body = (await response.json()) as ApiResponse
    if (!response.ok || body.code < 0) {
      throw new Error(body.message || `request failed: ${response.status}`)
    }
    return body.data || {}
  }

  saveToken(token: string) {
    const normalizedToken = String(token || '').trim()
    if (!normalizedToken) {
      localStorage.removeItem(LOCAL_STORAGE_AUTH_TOKEN_KEY)
      return
    }
    localStorage.setItem(LOCAL_STORAGE_AUTH_TOKEN_KEY, normalizedToken)
  }

  loadSavedToken() {
    return String(localStorage.getItem(LOCAL_STORAGE_AUTH_TOKEN_KEY) || '').trim()
  }

  async initialize() {
    if (this.isInitializing) {
      return
    }
    runInAction(() => {
      this.isInitializing = true
      this.token = this.loadSavedToken()
      this.loginMode = this.token ? 'token' : 'credentials'
    })
    if (!this.token) {
      runInAction(() => {
        this.isInitializing = false
      })
      return
    }
    await this.submitTokenLogin()
    runInAction(() => {
      this.isInitializing = false
    })
  }

  get loginData() {
    return {
      isLoggedIn: this.isLoggedIn,
      isLoading: this.isLoading,
      username: this.username,
      password: this.password,
      token: this.token,
      loginMode: this.loginMode,
      message: this.message,
      messageType: this.messageType,
      isPasswordVisible: this.isPasswordVisible,
      loginStatus: this.message,
    }
  }

  getAuthHeaders() {
    if (!this.token) {
      return {}
    }
    return {
      Authorization: `Bearer ${this.token}`,
    }
  }

  clearSessionOnUnauthorized() {
    if (!this.isLoggedIn) {
      return
    }
    runInAction(() => {
      this.token = ''
      this.isLoggedIn = false
      this.permission = 'R'
      this.message = 'Session expired, please login again'
      this.messageType = 'error'
    })
    this.saveToken('')
  }

  async submitCredentialsLogin() {
    runInAction(() => {
      this.isLoading = true
      this.message = ''
    })
    try {
      const data = await this.requestJson('/login', {
        method: 'POST',
        body: JSON.stringify({
          username: this.username,
          password: this.password,
        }),
      })
      const token = String(data.token || '')
      runInAction(() => {
        this.token = token
        this.permission = String(data.permission || 'R')
        this.isLoggedIn = true
        this.password = ''
        this.message = 'Login success'
        this.messageType = 'success'
      })
      this.saveToken(token)
      return { code: 0 }
    } catch (error: unknown) {
      runInAction(() => {
        this.isLoggedIn = false
        this.permission = 'R'
        this.message = String(error)
        this.messageType = 'error'
      })
      return { code: -1, message: String(error) }
    } finally {
      runInAction(() => {
        this.isLoading = false
      })
    }
  }

  async submitTokenLogin() {
    runInAction(() => {
      this.isLoading = true
      this.message = ''
    })
    try {
      const data = await this.requestJson('/login/token', {
        method: 'POST',
        body: JSON.stringify({
          token: this.token,
        }),
      })
      const token = String(data.token || '')
      runInAction(() => {
        this.token = token
        this.permission = String(data.permission || 'R')
        this.isLoggedIn = true
        this.message = 'Login success'
        this.messageType = 'success'
      })
      this.saveToken(token)
      return { code: 0 }
    } catch (error: unknown) {
      runInAction(() => {
        this.isLoggedIn = false
        this.permission = 'R'
        this.message = String(error)
        this.messageType = 'error'
      })
      this.saveToken('')
      return { code: -1, message: String(error) }
    } finally {
      runInAction(() => {
        this.isLoading = false
      })
    }
  }

  async onDataChangeRequest(type: string, params: Record<string, unknown> = {}) {
    if (type === 'set-login-mode') {
      const nextMode = String(params.loginMode || '')
      runInAction(() => {
        this.loginMode = nextMode === 'token' ? 'token' : 'credentials'
        this.message = ''
      })
      return { code: 0 }
    }
    if (type === 'set-username') {
      runInAction(() => {
        this.username = String(params.username || '')
      })
      return { code: 0 }
    }
    if (type === 'set-password') {
      runInAction(() => {
        this.password = String(params.password || '')
      })
      return { code: 0 }
    }
    if (type === 'set-token') {
      runInAction(() => {
        this.token = String(params.token || '')
      })
      return { code: 0 }
    }
    if (type === 'toggle-password-visible') {
      runInAction(() => {
        this.isPasswordVisible = !this.isPasswordVisible
      })
      return { code: 0 }
    }
    if (type === 'submit-credentials') {
      return this.submitCredentialsLogin()
    }
    if (type === 'submit-token') {
      return this.submitTokenLogin()
    }
    return { code: -1, message: `unsupported action: ${type}` }
  }
}

export const authStore = new AuthStore()
