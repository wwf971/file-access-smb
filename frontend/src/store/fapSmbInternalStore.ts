import { makeAutoObservable, runInAction } from 'mobx'
import { requestAuthenticatedBlob, requestAuthenticatedJson } from '../../apiRequest'
import { fapSmbExternalStore } from './fapSmbExternalStore'

export type FapSmbInternalItem = {
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
  isExample?: boolean
  isDeletable: boolean
  createdAt: string
  updatedAt: string
}

export type FapSmbInternalFileItem = {
  fileId: string
  fileName: string
  filePath: string
  fileType: string
  sizeBytes: number
  metadata: Record<string, unknown>
  isDeleted: boolean
  createdAt: string
  createAtTimeZone: number
  updatedAt: string
  updateAtTimeZone: number
  deletedAt: string
}

export class FapSmbInternalStore {
  isListLoading = false
  isSaving = false
  isDeleting = false
  isFileListLoading = false
  errorText = ''
  items: FapSmbInternalItem[] = []
  selectedId = ''
  selectedPanel: 'config' | 'explore' = 'config'
  fileItemsByFileAccessPointId: Record<string, FapSmbInternalFileItem[]> = {}
  pageIndexByFileAccessPointId: Record<string, number> = {}
  pageSizeByFileAccessPointId: Record<string, number> = {}
  totalCountByFileAccessPointId: Record<string, number> = {}
  selectedFileIdsByFileAccessPointId: Record<string, string[]> = {}
  editingFileIdByFileAccessPointId: Record<string, string> = {}
  editingFileNameByFileAccessPointId: Record<string, string> = {}
  renamingFileIdByFileAccessPointId: Record<string, string> = {}

  constructor() {
    makeAutoObservable(this, {}, { autoBind: true })
  }

  get canWrite() {
    return fapSmbExternalStore.canWrite
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
    return this.selectedFileIds[0] || ''
  }

  get selectedFileIds() {
    if (!this.selectedId) {
      return []
    }
    return this.selectedFileIdsByFileAccessPointId[this.selectedId] || []
  }

  get selectedFileItemList() {
    const selectedIdSet = new Set(this.selectedFileIds)
    return this.selectedFileItems.filter((item) => selectedIdSet.has(item.fileId))
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

  get selectedEditingFileId() {
    return this.editingFileIdByFileAccessPointId[this.selectedId] || ''
  }

  get selectedEditingFileName() {
    return this.editingFileNameByFileAccessPointId[this.selectedId] || ''
  }

  get selectedRenamingFileId() {
    return this.renamingFileIdByFileAccessPointId[this.selectedId] || ''
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

  setSelectedFileIds(fileAccessPointId: string, fileIds: string[]) {
    this.selectedFileIdsByFileAccessPointId[fileAccessPointId] = fileIds
  }

  setSelectedFileId(fileAccessPointId: string, fileId: string) {
    this.setSelectedFileIds(fileAccessPointId, fileId ? [fileId] : [])
  }

  setEditingFile(fileAccessPointId: string, fileId: string, fileName = '') {
    this.editingFileIdByFileAccessPointId[fileAccessPointId] = fileId
    this.editingFileNameByFileAccessPointId[fileAccessPointId] = fileName
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
      const items = Array.isArray(data.items) ? (data.items as FapSmbInternalItem[]) : []
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
    const fapSmbExternal = fapSmbExternalStore.items[0]
    if (!fapSmbExternal) {
      return { isSuccess: false, messageText: 'create FAP SMB external first' }
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
      const items = Array.isArray(data.items) ? (data.items as FapSmbInternalFileItem[]) : []
      runInAction(() => {
        this.fileItemsByFileAccessPointId[fileAccessPointId] = items
        this.totalCountByFileAccessPointId[fileAccessPointId] = Number(data.totalCount || 0)
        const existingFileIdSet = new Set(items.map((item) => item.fileId))
        if (!existingFileIdSet.has(this.editingFileIdByFileAccessPointId[fileAccessPointId])) {
          this.editingFileIdByFileAccessPointId[fileAccessPointId] = ''
          this.editingFileNameByFileAccessPointId[fileAccessPointId] = ''
        }
        if (!existingFileIdSet.has(this.renamingFileIdByFileAccessPointId[fileAccessPointId])) {
          this.renamingFileIdByFileAccessPointId[fileAccessPointId] = ''
        }
        const selectedFileIds = this.selectedFileIdsByFileAccessPointId[fileAccessPointId] || []
        this.selectedFileIdsByFileAccessPointId[fileAccessPointId] = selectedFileIds.filter((fileId) => (
          items.some((item) => item.fileId === fileId)
        ))
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

  async requestFileBlob(fileItem: FapSmbInternalFileItem): Promise<{ isSuccess: boolean, messageText: string, blob?: Blob }> {
    if (!this.selectedItem || !fileItem) {
      return { isSuccess: false, messageText: 'no file selected' }
    }
    const response = await requestAuthenticatedBlob('/smb-internal-file-access-point/file/download', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        fileAccessPointId: this.selectedItem.fileAccessPointId,
        fileId: fileItem.fileId,
      }),
    })
    const blob = await response.blob()
    return { isSuccess: true, messageText: 'loaded', blob }
  }

  async requestDownloadFileItem(fileItem: FapSmbInternalFileItem) {
    if (!this.selectedItem || !fileItem) {
      return { isSuccess: false, messageText: 'no file selected' }
    }
    try {
      const result = await this.requestFileBlob(fileItem)
      if (!result.isSuccess || !result.blob) {
        return { isSuccess: false, messageText: result.messageText }
      }
      const downloadUrl = URL.createObjectURL(result.blob)
      const anchor = document.createElement('a')
      anchor.href = downloadUrl
      anchor.download = fileItem.fileName || `${fileItem.fileId}.bin`
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      URL.revokeObjectURL(downloadUrl)
      return { isSuccess: true, messageText: `downloaded ${fileItem.fileName}` }
    } catch (error: unknown) {
      runInAction(() => {
        this.errorText = String(error)
      })
      return { isSuccess: false, messageText: String(error) }
    }
  }

  async requestDownloadSelectedFiles() {
    const fileItems = this.selectedFileItemList
    if (fileItems.length === 0) {
      return { isSuccess: false, messageText: 'no file selected' }
    }
    let successCount = 0
    for (const fileItem of fileItems) {
      const result = await this.requestDownloadFileItem(fileItem)
      if (result.isSuccess) {
        successCount += 1
      }
    }
    return {
      isSuccess: successCount === fileItems.length,
      messageText: `downloaded ${successCount}/${fileItems.length} file item(s)`,
    }
  }

  async requestRenameFileItem(fileItem: FapSmbInternalFileItem, fileNameNext: string) {
    if (!this.canWrite) {
      return { isSuccess: false, messageText: 'write permission required' }
    }
    if (!this.selectedItem || !fileItem) {
      return { isSuccess: false, messageText: 'no file selected' }
    }
    const fileAccessPointId = this.selectedItem.fileAccessPointId
    if (this.renamingFileIdByFileAccessPointId[fileAccessPointId]) {
      return { isSuccess: false, messageText: 'rename is in progress' }
    }
    const normalizedFileNameNext = String(fileNameNext || '').trim()
    if (!normalizedFileNameNext) {
      return { isSuccess: false, messageText: 'name is required' }
    }
    runInAction(() => {
      this.renamingFileIdByFileAccessPointId[fileAccessPointId] = fileItem.fileId
    })
    try {
      const data = await requestAuthenticatedJson('/smb-internal-file-access-point/file/move', {
        method: 'POST',
        body: JSON.stringify({
          fileAccessPointId,
          fileId: fileItem.fileId,
          fileNameNext: normalizedFileNameNext,
        }),
      })
      const fileNext = data.file as FapSmbInternalFileItem | undefined
      runInAction(() => {
        const currentItems = this.fileItemsByFileAccessPointId[fileAccessPointId] || []
        this.fileItemsByFileAccessPointId[fileAccessPointId] = currentItems.map((item) => (
          item.fileId === fileItem.fileId && fileNext ? fileNext : item
        ))
        this.editingFileIdByFileAccessPointId[fileAccessPointId] = ''
        this.editingFileNameByFileAccessPointId[fileAccessPointId] = ''
      })
      return { isSuccess: true, messageText: `renamed to ${normalizedFileNameNext}` }
    } catch (error: unknown) {
      runInAction(() => {
        this.errorText = String(error)
        this.editingFileIdByFileAccessPointId[fileAccessPointId] = ''
        this.editingFileNameByFileAccessPointId[fileAccessPointId] = ''
      })
      return { isSuccess: false, messageText: String(error) }
    } finally {
      runInAction(() => {
        this.renamingFileIdByFileAccessPointId[fileAccessPointId] = ''
      })
    }
  }
}

export function getFapSmbInternalSourceLabel(item: FapSmbInternalItem) {
  const labelList = [item.sourceType === 'config' ? 'CONFIG' : 'DB']
  if (item.isExample) {
    labelList.push('EXAMPLE')
  }
  return labelList.join(', ')
}

export const fapSmbInternalStore = new FapSmbInternalStore()
