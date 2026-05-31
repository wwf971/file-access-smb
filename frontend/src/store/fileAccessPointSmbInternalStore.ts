import { makeAutoObservable, runInAction } from 'mobx'
import { requestAuthenticatedBlob, requestAuthenticatedJson } from '../../apiRequest'
import { fileAccessPointStore } from './fileAccessPointStore'

export type FileAccessPointSmbInternalItem = {
  fileAccessPointId: string
  name: string
  fileAccessPointType: 'smb/internal'
  fileAccessPointSmbExternalInfo: {
    id?: string
    name?: string
  }
  pathRoot: string
  metadata: Record<string, unknown>
  fileTableName: string
  sourceType: 'config' | 'database'
  isDeletable: boolean
  createdAt: string
  updatedAt: string
}

export type FileAccessPointSmbInternalFileItem = {
  fileId: string
  fileName: string
  filePath: string
  fileType: string
  sizeBytes: number
  metadata: Record<string, unknown>
  isDeleted: boolean
  createdAt: string
  updatedAt: string
  deletedAt: string
}

export class FileAccessPointSmbInternalStore {
  isListLoading = false
  isSaving = false
  isDeleting = false
  isFileListLoading = false
  errorText = ''
  items: FileAccessPointSmbInternalItem[] = []
  selectedId = ''
  selectedPanel: 'config' | 'explore' = 'config'
  fileItemsByFileAccessPointId: Record<string, FileAccessPointSmbInternalFileItem[]> = {}
  pageIndexByFileAccessPointId: Record<string, number> = {}
  pageSizeByFileAccessPointId: Record<string, number> = {}
  totalCountByFileAccessPointId: Record<string, number> = {}
  selectedFileIdByFileAccessPointId: Record<string, string> = {}

  constructor() {
    makeAutoObservable(this, {}, { autoBind: true })
  }

  get canWrite() {
    return fileAccessPointStore.canWrite
  }

  get selectedItem() {
    return this.items.find((item) => item.fileAccessPointId === this.selectedId) || null
  }

  get selectedFileItems() {
    if (!this.selectedId) {
      return []
    }
    return this.fileItemsByFileAccessPointId[this.selectedId] || []
  }

  get selectedFileId() {
    if (!this.selectedId) {
      return ''
    }
    return this.selectedFileIdByFileAccessPointId[this.selectedId] || ''
  }

  get selectedPageIndex() {
    return this.getPageIndex(this.selectedId)
  }

  get selectedPageSize() {
    return this.getPageSize(this.selectedId)
  }

  get selectedTotalCount() {
    return this.totalCountByFileAccessPointId[this.selectedId] || 0
  }

  get selectedPageCount() {
    const pageSize = this.selectedPageSize
    if (pageSize <= 0) {
      return 1
    }
    return Math.max(1, Math.ceil(this.selectedTotalCount / pageSize))
  }

  get selectedFileItem() {
    const fileId = this.selectedFileId
    return this.selectedFileItems.find((item) => item.fileId === fileId) || null
  }

  getPageIndex(fileAccessPointId: string) {
    return this.pageIndexByFileAccessPointId[fileAccessPointId] || 0
  }

  getPageSize(fileAccessPointId: string) {
    return this.pageSizeByFileAccessPointId[fileAccessPointId] || 50
  }

  setSelected(fileAccessPointId: string, panel: 'config' | 'explore') {
    this.selectedId = fileAccessPointId
    this.selectedPanel = panel
  }

  setSelectedFileId(fileAccessPointId: string, fileId: string) {
    this.selectedFileIdByFileAccessPointId[fileAccessPointId] = fileId
  }

  async requestLoadList() {
    if (this.isListLoading) {
      return { isSuccess: false, messageText: 'list loading' }
    }
    runInAction(() => {
      this.isListLoading = true
      this.errorText = ''
    })
    try {
      const data = await requestAuthenticatedJson('/smb-internal-file-access-point/list')
      const items = Array.isArray(data.items) ? (data.items as FileAccessPointSmbInternalItem[]) : []
      runInAction(() => {
        this.items = items
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
    const fapSmbExternal = fileAccessPointStore.items[0]
    if (!fapSmbExternal) {
      return { isSuccess: false, messageText: 'create smb/external file access point first' }
    }
    runInAction(() => {
      this.isSaving = true
      this.errorText = ''
    })
    try {
      await requestAuthenticatedJson('/smb-internal-file-access-point/create', {
        method: 'POST',
        body: JSON.stringify({
          name: `smb_internal_${Date.now()}`,
          pathRoot: '/',
          fileAccessPointSmbExternalInfo: {
            id: fapSmbExternal.fileAccessPointId,
          },
          metadata: {},
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

  async requestUpdateCurrent(
    name: string,
    pathRoot: string,
    fileAccessPointSmbExternalInfo: Record<string, string>,
    metadata: Record<string, string>,
  ) {
    if (!this.canWrite) {
      return { isSuccess: false, messageText: 'write permission required' }
    }
    if (this.isSaving || !this.selectedItem) {
      return { isSuccess: false, messageText: 'busy or no selection' }
    }
    runInAction(() => {
      this.isSaving = true
      this.errorText = ''
    })
    try {
      await requestAuthenticatedJson('/smb-internal-file-access-point/update', {
        method: 'POST',
        body: JSON.stringify({
          fileAccessPointId: this.selectedItem.fileAccessPointId,
          name,
          pathRoot,
          fileAccessPointSmbExternalInfo,
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
    const fileAccessPointId = this.selectedItem.fileAccessPointId
    runInAction(() => {
      this.isDeleting = true
      this.errorText = ''
    })
    try {
      await requestAuthenticatedJson('/smb-internal-file-access-point/delete', {
        method: 'POST',
        body: JSON.stringify({ fileAccessPointId }),
      })
      await this.requestLoadList()
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

  async requestLoadFiles(fileAccessPointId = this.selectedId, pageIndex = this.getPageIndex(fileAccessPointId)) {
    if (!fileAccessPointId) {
      return { isSuccess: false, messageText: 'no selection' }
    }
    if (this.isFileListLoading) {
      return { isSuccess: false, messageText: 'file list loading' }
    }
    const pageSize = this.getPageSize(fileAccessPointId)
    runInAction(() => {
      this.isFileListLoading = true
      this.errorText = ''
      this.pageIndexByFileAccessPointId[fileAccessPointId] = pageIndex
    })
    try {
      const data = await requestAuthenticatedJson('/smb-internal-file-access-point/file/list', {
        method: 'POST',
        body: JSON.stringify({
          fileAccessPointId,
          pageIndex,
          pageSize,
        }),
      })
      const items = Array.isArray(data.items) ? (data.items as FileAccessPointSmbInternalFileItem[]) : []
      runInAction(() => {
        this.fileItemsByFileAccessPointId[fileAccessPointId] = items
        this.totalCountByFileAccessPointId[fileAccessPointId] = Number(data.totalCount || 0)
        const selectedFileId = this.selectedFileIdByFileAccessPointId[fileAccessPointId]
        if (!selectedFileId || !items.find((item) => item.fileId === selectedFileId)) {
          this.selectedFileIdByFileAccessPointId[fileAccessPointId] = items[0]?.fileId || ''
        }
      })
      return { isSuccess: true, messageText: 'loaded' }
    } catch (error: unknown) {
      runInAction(() => {
        this.errorText = String(error)
        this.fileItemsByFileAccessPointId[fileAccessPointId] = []
      })
      return { isSuccess: false, messageText: String(error) }
    } finally {
      runInAction(() => {
        this.isFileListLoading = false
      })
    }
  }

  async requestSetPageIndex(pageIndex: number) {
    const pageIndexNext = Math.max(0, Math.min(this.selectedPageCount - 1, pageIndex))
    return this.requestLoadFiles(this.selectedId, pageIndexNext)
  }

  async requestDownloadSelectedFile() {
    if (!this.selectedItem || !this.selectedFileItem) {
      return { isSuccess: false, messageText: 'no file selected' }
    }
    try {
      const response = await requestAuthenticatedBlob('/smb-internal-file-access-point/file/download', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          fileAccessPointId: this.selectedItem.fileAccessPointId,
          fileId: this.selectedFileItem.fileId,
        }),
      })
      const blob = await response.blob()
      const downloadUrl = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = downloadUrl
      anchor.download = this.selectedFileItem.fileName || `${this.selectedFileItem.fileId}.bin`
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      URL.revokeObjectURL(downloadUrl)
      return { isSuccess: true, messageText: `downloaded ${this.selectedFileItem.fileName}` }
    } catch (error: unknown) {
      runInAction(() => {
        this.errorText = String(error)
      })
      return { isSuccess: false, messageText: String(error) }
    }
  }
}

export const fileAccessPointSmbInternalStore = new FileAccessPointSmbInternalStore()
