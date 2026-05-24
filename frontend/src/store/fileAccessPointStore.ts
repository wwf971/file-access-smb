import { makeAutoObservable, runInAction } from 'mobx'
import { resolveApiUrl, withAuthQuery } from '../../publicPath'
import { requestAuthenticatedJson, requestAuthenticatedBlob } from '../../apiRequest'
import { authStore } from './authStore'

export type FileAccessPointItem = {
  fileAccessPointId: string
  name: string
  sourceType: 'config' | 'database'
  isDeletable: boolean
  permission: string
  metadata: {
    host: string
    username: string
    password: string
    share: string
    path: string
  }
  isMetadataValid: boolean
  validationErrorTextList: string[]
  connection: {
    isConnected: boolean
    lastCheckUnixMs: number
    lastErrorText: string
  }
}

type ExploreItem = {
  name: string
  isDirectory: boolean
  sizeBytes: number
}

type ExploreState = {
  path: string
  items: ExploreItem[]
  isExploring: boolean
  editingRowId: string | null
  editingName: string
  renamingRowId: string | null
}

export class FileAccessPointStore {
  isListLoading = false
  isSaving = false
  isDeleting = false
  isChecking = false
  isZipRunning = false
  errorText = ''
  items: FileAccessPointItem[] = []
  selectedId = ''
  selectedPanel: 'config' | 'explore' = 'config'
  exploreStateByFileAccessPointId: Record<string, ExploreState> = {}
  zipTaskId = ''
  zipLatestLogText = ''
  zipStatusText = ''
  zipWebSocket: null | WebSocket = null
  zipStatusPollingTimer: null | number = null

  constructor() {
    makeAutoObservable(this, {}, { autoBind: true })
  }

  get selectedItem() {
    return this.items.find((item) => item.fileAccessPointId === this.selectedId) || null
  }

  get canRead() {
    return String(authStore.permission || '').toUpperCase().includes('R')
  }

  get canWrite() {
    return String(authStore.permission || '').toUpperCase().includes('W')
  }

  createExploreState() {
    return {
      path: '/',
      items: [],
      isExploring: false,
      editingRowId: null,
      editingName: '',
      renamingRowId: null,
    }
  }

  getExploreState(fileAccessPointId: string) {
    const normalizedId = String(fileAccessPointId || '')
    if (!normalizedId) {
      return this.createExploreState()
    }
    if (!this.exploreStateByFileAccessPointId[normalizedId]) {
      this.exploreStateByFileAccessPointId[normalizedId] = this.createExploreState()
    }
    return this.exploreStateByFileAccessPointId[normalizedId]
  }

  setExplorePath(fileAccessPointId: string, path: string) {
    const state = this.getExploreState(fileAccessPointId)
    state.path = String(path || '/')
  }

  setExploreEditingRow(fileAccessPointId: string, rowId: string | null, editingName = '') {
    const state = this.getExploreState(fileAccessPointId)
    state.editingRowId = rowId
    state.editingName = editingName
  }

  setExploreEditingName(fileAccessPointId: string, editingName: string) {
    const state = this.getExploreState(fileAccessPointId)
    state.editingName = editingName
  }

  setSelected(id: string, panel: 'config' | 'explore') {
    this.selectedId = id
    this.selectedPanel = panel
  }

  async requestLoadList() {
    if (this.isListLoading) {
      return
    }
    runInAction(() => {
      this.isListLoading = true
      this.errorText = ''
    })
    try {
      const data = await requestAuthenticatedJson('/file-access-point/list')
      const items = Array.isArray(data.items) ? (data.items as FileAccessPointItem[]) : []
      runInAction(() => {
        this.items = items
        const nextIdSet = new Set(items.map((item) => item.fileAccessPointId))
        items.forEach((item) => {
          this.getExploreState(item.fileAccessPointId)
        })
        Object.keys(this.exploreStateByFileAccessPointId).forEach((fileAccessPointId) => {
          if (!nextIdSet.has(fileAccessPointId)) {
            delete this.exploreStateByFileAccessPointId[fileAccessPointId]
          }
        })
        if (!this.selectedId || !items.find((item) => item.fileAccessPointId === this.selectedId)) {
          this.selectedId = items[0]?.fileAccessPointId || ''
          this.selectedPanel = 'config'
        }
      })
      return { isSuccess: true, messageText: 'loaded' }
    } catch (error: unknown) {
      runInAction(() => {
        this.errorText = String(error)
      })
      return { isSuccess: false, messageText: String(error) }
    } finally {
      runInAction(() => {
        this.isListLoading = false
      })
    }
  }

  async requestCreateOne() {
    if (!this.canWrite) {
      return { isSuccess: false, messageText: 'write permission required' }
    }
    if (this.isSaving) {
      return { isSuccess: false, messageText: 'busy' }
    }
    runInAction(() => {
      this.isSaving = true
    })
    try {
      await requestAuthenticatedJson('/file-access-point/create', {
        method: 'POST',
        body: JSON.stringify({
          name: `smb_${Date.now()}`,
          metadata: {
            host: '',
            username: '',
            password: '',
            share: '',
            path: '/',
          },
        }),
      })
      await this.requestLoadList()
      const created = this.items[this.items.length - 1]
      if (created) {
        this.setSelected(created.fileAccessPointId, 'config')
      }
      return { isSuccess: true, messageText: 'created' }
    } catch (error: unknown) {
      runInAction(() => {
        this.errorText = String(error)
      })
      return { isSuccess: false, messageText: String(error) }
    } finally {
      runInAction(() => {
        this.isSaving = false
      })
    }
  }

  async requestUpdateCurrent(name: string, metadata: Record<string, string>) {
    if (!this.canWrite) {
      return { isSuccess: false, messageText: 'write permission required' }
    }
    if (this.isSaving || !this.selectedItem) {
      return { isSuccess: false, messageText: 'busy or no selection' }
    }
    runInAction(() => {
      this.isSaving = true
    })
    try {
      await requestAuthenticatedJson('/file-access-point/update', {
        method: 'POST',
        body: JSON.stringify({
          fileAccessPointId: this.selectedItem.fileAccessPointId,
          name,
          metadata,
        }),
      })
      await this.requestLoadList()
      return { isSuccess: true, messageText: 'saved' }
    } catch (error: unknown) {
      runInAction(() => {
        this.errorText = String(error)
      })
      return { isSuccess: false, messageText: String(error) }
    } finally {
      runInAction(() => {
        this.isSaving = false
      })
    }
  }

  async requestDeleteCurrent() {
    if (!this.canWrite) {
      return { isSuccess: false, messageText: 'write permission required' }
    }
    if (this.isDeleting || !this.selectedItem) {
      return { isSuccess: false, messageText: 'busy or no selection' }
    }
    runInAction(() => {
      this.isDeleting = true
    })
    try {
      const deletingId = this.selectedItem.fileAccessPointId
      await requestAuthenticatedJson('/file-access-point/delete', {
        method: 'POST',
        body: JSON.stringify({
          fileAccessPointId: deletingId,
        }),
      })
      await this.requestLoadList()
      if (this.selectedId === deletingId) {
        this.selectedId = this.items[0]?.fileAccessPointId || ''
      }
      return { isSuccess: true, messageText: 'deleted' }
    } catch (error: unknown) {
      runInAction(() => {
        this.errorText = String(error)
      })
      return { isSuccess: false, messageText: String(error) }
    } finally {
      runInAction(() => {
        this.isDeleting = false
      })
    }
  }

  async requestCheckConnection(isForceReconnect: boolean, timeoutMs = 8000) {
    if (this.isChecking || !this.selectedItem) {
      return { isSuccess: false, messageText: 'busy or no selection' }
    }
    runInAction(() => {
      this.isChecking = true
    })
    const normalizedTimeoutMs = Number.isFinite(timeoutMs)
      ? Math.max(1000, Math.min(30000, Math.floor(timeoutMs)))
      : 8000
    const abortController = new AbortController()
    const timeoutHandle = window.setTimeout(() => {
      abortController.abort()
    }, normalizedTimeoutMs)
    try {
      const url = isForceReconnect
        ? '/file-access-point/connection/reconnect'
        : '/file-access-point/connection/check'
      await requestAuthenticatedJson(url, {
        method: 'POST',
        body: JSON.stringify({
          fileAccessPointId: this.selectedItem.fileAccessPointId,
        }),
        signal: abortController.signal,
      })
      await this.requestLoadList()
      return { isSuccess: true, messageText: isForceReconnect ? 'reconnected' : 'checked' }
    } catch (error: unknown) {
      const isTimeoutError = error instanceof DOMException && error.name === 'AbortError'
      runInAction(() => {
        this.errorText = isTimeoutError ? `connection test timeout (${normalizedTimeoutMs}ms)` : String(error)
      })
      return {
        isSuccess: false,
        messageText: isTimeoutError ? `connection test timeout (${normalizedTimeoutMs}ms)` : String(error),
      }
    } finally {
      window.clearTimeout(timeoutHandle)
      runInAction(() => {
        this.isChecking = false
      })
    }
  }

  async requestExplore(path: string) {
    if (!this.selectedItem) {
      return { isSuccess: false, messageText: 'busy or no selection' }
    }
    const fileAccessPointId = this.selectedItem.fileAccessPointId
    const state = this.getExploreState(fileAccessPointId)
    if (state.isExploring) {
      return { isSuccess: false, messageText: 'busy or no selection' }
    }
    runInAction(() => {
      state.isExploring = true
      state.path = path
    })
    try {
      const data = await requestAuthenticatedJson('/file-access-point/explore/list', {
        method: 'POST',
        body: JSON.stringify({
          fileAccessPointId,
          path,
        }),
      })
      const items = Array.isArray(data.items) ? (data.items as ExploreItem[]) : []
      runInAction(() => {
        const exploreState = this.getExploreState(fileAccessPointId)
        exploreState.items = items
        const existingRowIdSet = new Set(items.map((exploreItem) => `${exploreItem.isDirectory ? 'd' : 'f'}:${exploreItem.name}`))
        if (exploreState.editingRowId && !existingRowIdSet.has(exploreState.editingRowId)) {
          exploreState.editingRowId = null
          exploreState.editingName = ''
        }
        if (exploreState.renamingRowId && !existingRowIdSet.has(exploreState.renamingRowId)) {
          exploreState.renamingRowId = null
        }
      })
      return { isSuccess: true, messageText: 'loaded' }
    } catch (error: unknown) {
      runInAction(() => {
        this.errorText = String(error)
        this.getExploreState(fileAccessPointId).items = []
      })
      return { isSuccess: false, messageText: String(error) }
    } finally {
      runInAction(() => {
        this.getExploreState(fileAccessPointId).isExploring = false
      })
    }
  }

  async requestRenameExploreItem(fileAccessPointId: string, targetPath: string, nextName: string, rowId: string) {
    if (!this.canWrite) {
      return { isSuccess: false, messageText: 'write permission required' }
    }
    const state = this.getExploreState(fileAccessPointId)
    if (state.renamingRowId) {
      return { isSuccess: false, messageText: 'rename is in progress' }
    }
    const normalizedNextName = String(nextName || '').trim()
    if (!normalizedNextName) {
      return { isSuccess: false, messageText: 'name is required' }
    }
    runInAction(() => {
      state.renamingRowId = rowId
    })
    try {
      await requestAuthenticatedJson('/file-access-point/explore/rename', {
        method: 'POST',
        body: JSON.stringify({
          fileAccessPointId,
          path: targetPath,
          nextName: normalizedNextName,
        }),
      })
      await this.requestExplore(state.path)
      runInAction(() => {
        state.editingRowId = null
        state.editingName = ''
      })
      return { isSuccess: true, messageText: `renamed to ${normalizedNextName}` }
    } catch (error: unknown) {
      runInAction(() => {
        this.errorText = String(error)
      })
      return { isSuccess: false, messageText: String(error) }
    } finally {
      runInAction(() => {
        state.renamingRowId = null
      })
    }
  }

  closeZipWebSocket() {
    if (this.zipWebSocket) {
      this.zipWebSocket.close()
      this.zipWebSocket = null
    }
  }

  stopZipStatusPolling() {
    if (this.zipStatusPollingTimer !== null) {
      window.clearInterval(this.zipStatusPollingTimer)
      this.zipStatusPollingTimer = null
    }
  }

  async requestZipStatus(taskId: string) {
    const params = new URLSearchParams({ taskId })
    const data = await requestAuthenticatedJson(`/file-access-point/zip/status?${params.toString()}`)
    return {
      status: String(data.status || ''),
      statusMessage: String(data.statusMessage || ''),
      errorText: String(data.errorText || ''),
    }
  }

  startZipStatusPolling(taskId: string) {
    if (this.zipStatusPollingTimer !== null) {
      return
    }
    const checkStatus = async () => {
      try {
        const status = await this.requestZipStatus(taskId)
        if (status.status === 'success') {
          this.stopZipStatusPolling()
          await this.requestDownloadZip(taskId)
          runInAction(() => {
            this.isZipRunning = false
            this.zipLatestLogText = status.statusMessage || 'zip build completed'
          })
          return
        }
        if (status.status === 'failed' || status.status === 'aborted') {
          this.stopZipStatusPolling()
          runInAction(() => {
            this.isZipRunning = false
            this.zipLatestLogText = status.errorText || status.statusMessage || status.status
            if (status.status === 'failed') {
              this.errorText = this.zipLatestLogText
            }
          })
        }
      } catch (error: unknown) {
        runInAction(() => {
          this.errorText = String(error)
        })
      }
    }
    this.zipStatusPollingTimer = window.setInterval(() => {
      checkStatus()
    }, 1000)
    checkStatus()
  }

  async requestDownloadZip(taskId: string) {
    const params = new URLSearchParams({ taskId })
    const response = await requestAuthenticatedBlob(`/file-access-point/zip/download?${params.toString()}`)
    const blob = await response.blob()
    const downloadUrl = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = downloadUrl
    anchor.download = `${taskId}.zip`
    document.body.appendChild(anchor)
    anchor.click()
    anchor.remove()
    URL.revokeObjectURL(downloadUrl)
  }

  connectZipWebSocket(taskId: string) {
    this.closeZipWebSocket()
    this.stopZipStatusPolling()
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
    const authToken = String(authStore.token || '')
    const wsUrl = `${protocol}//${window.location.host}${withAuthQuery(
      resolveApiUrl(`/file-access-point/zip/ws/${encodeURIComponent(taskId)}`),
      authToken,
    )}`
    const ws = new WebSocket(wsUrl)
    this.zipWebSocket = ws
    ws.onmessage = (event) => {
      try {
        const body = JSON.parse(String(event.data || '{}')) as {
          type?: string
          status?: string
          messageText?: string
        }
        if (body.type === 'log') {
          runInAction(() => {
            this.zipLatestLogText = String(body.messageText || '')
          })
          return
        }
        if (body.type === 'status') {
          const statusText = String(body.status || '')
          const messageText = String(body.messageText || '')
          runInAction(() => {
            this.zipStatusText = messageText
            this.zipLatestLogText = messageText || this.zipLatestLogText
          })
          if (statusText === 'success') {
            this.requestDownloadZip(taskId)
              .catch((error: unknown) => {
                runInAction(() => {
                  this.errorText = String(error)
                })
              })
              .finally(() => {
                runInAction(() => {
                  this.isZipRunning = false
                })
                this.stopZipStatusPolling()
                this.closeZipWebSocket()
              })
            return
          }
          if (statusText === 'failed' || statusText === 'aborted') {
            runInAction(() => {
              this.isZipRunning = false
              if (statusText === 'failed') {
                this.errorText = messageText || 'zip process failed'
              }
            })
            this.stopZipStatusPolling()
            this.closeZipWebSocket()
          }
        }
      } catch (error: unknown) {
        runInAction(() => {
          this.errorText = String(error)
          this.zipLatestLogText = 'zip websocket parse error, fallback to status polling'
        })
        this.startZipStatusPolling(taskId)
        this.closeZipWebSocket()
      }
    }
    ws.onerror = () => {
      runInAction(() => {
        this.zipLatestLogText = 'zip websocket disconnected, checking status'
      })
      this.startZipStatusPolling(taskId)
      this.closeZipWebSocket()
    }
    ws.onclose = () => {
      if (this.isZipRunning) {
        this.startZipStatusPolling(taskId)
      }
    }
  }

  async requestStartZip(path: string) {
    if (this.isZipRunning || !this.selectedItem) {
      return { isSuccess: false, messageText: 'busy or no selection' }
    }
    runInAction(() => {
      this.isZipRunning = true
      this.zipTaskId = ''
      this.zipLatestLogText = 'starting zip process'
      this.zipStatusText = ''
    })
    try {
      const data = await requestAuthenticatedJson('/file-access-point/zip/start', {
        method: 'POST',
        body: JSON.stringify({
          fileAccessPointId: this.selectedItem.fileAccessPointId,
          path,
        }),
      })
      const taskId = String(data.taskId || '')
      runInAction(() => {
        this.zipTaskId = taskId
      })
      this.connectZipWebSocket(taskId)
      return { isSuccess: true, messageText: 'zip started' }
    } catch (error: unknown) {
      runInAction(() => {
        this.isZipRunning = false
        this.errorText = String(error)
      })
      this.stopZipStatusPolling()
      return { isSuccess: false, messageText: String(error) }
    }
  }

  async requestAbortZip() {
    if (!this.zipTaskId) {
      return { isSuccess: false, messageText: 'no zip task' }
    }
    try {
      await requestAuthenticatedJson('/file-access-point/zip/abort', {
        method: 'POST',
        body: JSON.stringify({
          taskId: this.zipTaskId,
        }),
      })
      runInAction(() => {
        this.zipLatestLogText = 'aborting zip process'
      })
      return { isSuccess: true, messageText: 'aborting' }
    } catch (error: unknown) {
      runInAction(() => {
        this.errorText = String(error)
      })
      return { isSuccess: false, messageText: String(error) }
    }
  }
}

export const fileAccessPointStore = new FileAccessPointStore()
