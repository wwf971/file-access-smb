import { makeAutoObservable, runInAction } from 'mobx'
import { requestAuthenticatedJson } from '../../apiRequest'

export const TASK_STATUS = {
  undergoing: 1,
  success: 2,
  fail: 3,
  cancel: 4,
} as const

export const TASK_TYPE = {
  smbExternalCopy: 3,
  smbExternalMove: 4,
} as const

export type TaskRow = {
  taskId: string
  taskType: number
  taskStatus: number
  taskStatusText: string
  taskInfo: Record<string, unknown>
  userId: string
  createdAt: string
  updatedAt: string
}

export type TaskCopyMoveItem = {
  name: string
  pathSource: string
  pathTarget: string
  fileAccessPointSource: {
    fileAccessPointType: 'smb/external'
    fileAccessPointId: string
    fileAccessPointName: string
  }
  fileAccessPointTarget: {
    fileAccessPointType: 'smb/external'
    fileAccessPointId: string
    fileAccessPointName: string
  }
  isDirectory: boolean
  sizeBytes: number
  taskStatus?: number
  taskStatusText?: string
}

class TaskStore {
  isListLoading = false
  isSubmitting = false
  isCancelling = false
  isDeleting = false
  isDropdownOpen = false
  isPanelOpen = false
  errorText = ''
  messageText = ''
  taskItems: TaskRow[] = []
  taskSelectedId = ''
  copyMoveMode: 'copy' | 'move' = 'copy'
  copyMoveFileAccessPointId = ''
  copyMoveFileAccessPointName = ''
  copyMoveTargetFolderPath = '/'
  copyMoveItemList: TaskCopyMoveItem[] = []
  isCopyMovePanelOpen = false

  constructor() {
    makeAutoObservable(this, {}, { autoBind: true })
  }

  get taskSelected() {
    return this.taskItems.find((task) => task.taskId === this.taskSelectedId) || null
  }

  get taskUndergoingCount() {
    return this.taskItems.filter((task) => task.taskStatus === TASK_STATUS.undergoing).length
  }

  setDropdownOpen(isOpen: boolean) {
    this.isDropdownOpen = isOpen
  }

  setPanelOpen(isOpen: boolean) {
    this.isPanelOpen = isOpen
  }

  selectTask(taskId: string) {
    this.taskSelectedId = taskId
    this.isPanelOpen = true
    this.isDropdownOpen = false
  }

  openCopyMovePanel(params: {
    mode: 'copy' | 'move'
    fileAccessPointId: string
    fileAccessPointName: string
    targetFolderPath: string
    itemList: TaskCopyMoveItem[]
  }) {
    this.copyMoveMode = params.mode
    this.copyMoveFileAccessPointId = params.fileAccessPointId
    this.copyMoveFileAccessPointName = params.fileAccessPointName
    this.copyMoveTargetFolderPath = params.targetFolderPath || '/'
    this.copyMoveItemList = params.itemList
    this.isCopyMovePanelOpen = true
    this.errorText = ''
    this.messageText = ''
  }

  closeCopyMovePanel() {
    if (this.isSubmitting) {
      return
    }
    this.isCopyMovePanelOpen = false
    this.copyMoveItemList = []
  }

  setCopyMoveTargetFolderPath(path: string) {
    this.copyMoveTargetFolderPath = String(path || '/')
  }

  async requestLoadList() {
    if (this.isListLoading) {
      return { isSuccess: false, messageText: 'task list loading' }
    }
    runInAction(() => {
      this.isListLoading = true
      this.errorText = ''
    })
    try {
      const data = await requestAuthenticatedJson('/fap-smb-external/task/list', {
        method: 'POST',
        body: JSON.stringify({ limit: 80 }),
      })
      const items = Array.isArray(data.items) ? (data.items as TaskRow[]) : []
      runInAction(() => {
        this.taskItems = items
        if (this.taskSelectedId && !items.some((task) => task.taskId === this.taskSelectedId)) {
          this.taskSelectedId = ''
          this.isPanelOpen = false
        }
      })
      return { isSuccess: true, messageText: 'task list loaded' }
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

  async requestSubmitCopyMove() {
    if (this.isSubmitting) {
      return { isSuccess: false, messageText: 'task submitting' }
    }
    const targetFolder = normalizePath(this.copyMoveTargetFolderPath)
    const itemList = this.copyMoveItemList.map((item) => ({
      ...item,
      pathTarget: joinPath(targetFolder, item.name),
    }))
    runInAction(() => {
      this.isSubmitting = true
      this.errorText = ''
      this.messageText = ''
    })
    try {
      const data = await requestAuthenticatedJson('/fap-smb-external/task/submit', {
        method: 'POST',
        body: JSON.stringify({
          taskType: this.copyMoveMode === 'copy' ? TASK_TYPE.smbExternalCopy : TASK_TYPE.smbExternalMove,
          operationInfo: {
            itemList,
            isOverwriteAllowed: false,
          },
        }),
      })
      const task = data.task as TaskRow
      runInAction(() => {
        if (task?.taskId) {
          this.taskSelectedId = task.taskId
          this.taskItems = [task, ...this.taskItems.filter((item) => item.taskId !== task.taskId)]
        }
        this.isCopyMovePanelOpen = false
        this.copyMoveItemList = []
        this.isPanelOpen = true
        this.messageText = 'task submitted'
      })
      await this.requestLoadList()
      return { isSuccess: true, messageText: 'task submitted' }
    } catch (error: unknown) {
      runInAction(() => {
        this.errorText = String(error)
      })
      return { isSuccess: false, messageText: String(error) }
    } finally {
      runInAction(() => {
        this.isSubmitting = false
      })
    }
  }

  async requestCancelTask(taskId: string) {
    if (this.isCancelling) {
      return { isSuccess: false, messageText: 'task cancelling' }
    }
    runInAction(() => {
      this.isCancelling = true
      this.errorText = ''
    })
    try {
      await requestAuthenticatedJson('/fap-smb-external/task/cancel', {
        method: 'POST',
        body: JSON.stringify({ taskId }),
      })
      await this.requestLoadList()
      return { isSuccess: true, messageText: 'task cancelled' }
    } catch (error: unknown) {
      runInAction(() => {
        this.errorText = String(error)
      })
      return { isSuccess: false, messageText: String(error) }
    } finally {
      runInAction(() => {
        this.isCancelling = false
      })
    }
  }

  async requestDeleteTask(taskId: string) {
    if (this.isDeleting) {
      return { isSuccess: false, messageText: 'task deleting' }
    }
    runInAction(() => {
      this.isDeleting = true
      this.errorText = ''
    })
    try {
      await requestAuthenticatedJson('/fap-smb-external/task/delete', {
        method: 'POST',
        body: JSON.stringify({ taskId }),
      })
      await this.requestLoadList()
      return { isSuccess: true, messageText: 'task deleted' }
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
}

function normalizePath(path: string) {
  let normalized = String(path || '/').replace(/\\/g, '/').trim()
  while (normalized.includes('//')) {
    normalized = normalized.replaceAll('//', '/')
  }
  if (!normalized.startsWith('/')) {
    normalized = `/${normalized}`
  }
  normalized = normalized.replace(/\/+$/, '')
  return normalized || '/'
}

function joinPath(folderPath: string, name: string) {
  const normalizedFolder = normalizePath(folderPath)
  const normalizedName = String(name || '').replace(/\\/g, '/').split('/').filter(Boolean).join('/')
  if (!normalizedName) {
    return normalizedFolder
  }
  if (normalizedFolder === '/') {
    return `/${normalizedName}`
  }
  return `${normalizedFolder}/${normalizedName}`
}

export function getTaskStatusLabel(taskStatus: number) {
  if (taskStatus === TASK_STATUS.undergoing) {
    return 'undergoing'
  }
  if (taskStatus === TASK_STATUS.success) {
    return 'success'
  }
  if (taskStatus === TASK_STATUS.fail) {
    return 'fail'
  }
  if (taskStatus === TASK_STATUS.cancel) {
    return 'cancel'
  }
  return 'unknown'
}

export function getTaskTypeLabel(taskType: number) {
  if (taskType === TASK_TYPE.smbExternalCopy) {
    return 'copy'
  }
  if (taskType === TASK_TYPE.smbExternalMove) {
    return 'move'
  }
  return `task ${taskType}`
}

export const taskStore = new TaskStore()
