import { makeAutoObservable, runInAction } from 'mobx'
import { requestAuthenticatedJson } from '../../apiRequest'
import { fapSmbExternalStore, type FapSmbExternalItem } from './fapSmbExternalStore'

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

type CopyMoveSelectorState = {
  isOpen: boolean
  searchText: string
  selectedFileAccessPointId: string
  selectedFolderPath: string
  messageText: string
}

type TaskListViewState = {
  selectedTaskIds: string[]
}

class TaskStore {
  isListLoading = false
  isSubmitting = false
  isCancelling = false
  isDeleting = false
  isResubmitting = false
  isDropdownOpen = false
  isPanelOpen = false
  errorText = ''
  messageText = ''
  taskItems: TaskRow[] = []
  taskSelectedId = ''
  taskListViewStateByKey: Record<string, TaskListViewState> = {}
  copyMoveMode: 'copy' | 'move' = 'copy'
  copyMoveFileAccessPointId = ''
  copyMoveFileAccessPointName = ''
  copyMoveTargetFolderPath = '/'
  isCopyMoveEnsureTargetFolder = true
  copyMoveItemList: TaskCopyMoveItem[] = []
  isCopyMovePanelOpen = false
  copyMoveSelectorState: CopyMoveSelectorState = {
    isOpen: false,
    searchText: '',
    selectedFileAccessPointId: '',
    selectedFolderPath: '/',
    messageText: '',
  }

  constructor() {
    makeAutoObservable(this, {}, { autoBind: true })
  }

  get taskSelected() {
    return this.taskItems.find((task) => task.taskId === this.taskSelectedId) || null
  }

  get taskUndergoingCount() {
    return this.taskItems.filter((task) => task.taskStatus === TASK_STATUS.undergoing).length
  }

  getTaskListViewState(viewKey: string) {
    const normalizedKey = String(viewKey || 'default')
    if (!this.taskListViewStateByKey[normalizedKey]) {
      this.taskListViewStateByKey[normalizedKey] = {
        selectedTaskIds: [],
      }
    }
    return this.taskListViewStateByKey[normalizedKey]
  }

  getSelectedTaskForView(viewKey: string) {
    const selectedTaskId = this.getTaskListViewState(viewKey).selectedTaskIds[0] || ''
    return this.taskItems.find((task) => task.taskId === selectedTaskId) || null
  }

  setTaskListSelectedTaskIds(viewKey: string, taskIds: string[]) {
    this.getTaskListViewState(viewKey).selectedTaskIds = taskIds
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
    this.isCopyMoveEnsureTargetFolder = true
    this.copyMoveItemList = params.itemList
    this.resetCopyMoveSelectorState(false)
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
    this.resetCopyMoveSelectorState(false)
  }

  setCopyMoveTargetFolderPath(path: string) {
    this.copyMoveTargetFolderPath = String(path || '/')
  }

  setCopyMoveEnsureTargetFolder(isEnsure: boolean) {
    this.isCopyMoveEnsureTargetFolder = isEnsure
  }

  get copyMoveSourceFileAccessPoint() {
    return this.getSmbExternalItemById(this.copyMoveFileAccessPointId)
  }

  get copyMoveTargetInfo() {
    return parseTargetFolderExpression(
      this.copyMoveTargetFolderPath,
      this.copyMoveSourceFileAccessPoint,
      fapSmbExternalStore.items,
    )
  }

  get copyMovePreviewTargetFolderPath() {
    return this.copyMoveTargetInfo.folderPath
  }

  get copyMovePreviewTargetFileAccessPoint() {
    return this.copyMoveTargetInfo.fileAccessPoint
  }

  get copyMoveSelectorFileAccessPointItems() {
    const searchText = this.copyMoveSelectorState.searchText.trim().toLowerCase()
    const items = fapSmbExternalStore.items
    if (!searchText) {
      return items
    }
    return items.filter((item) => {
      const name = item.name.toLowerCase()
      const id = item.fileAccessPointId.toLowerCase()
      return name.includes(searchText) || id.includes(searchText)
    })
  }

  get copyMoveSelectorFileAccessPoint() {
    return this.getSmbExternalItemById(this.copyMoveSelectorState.selectedFileAccessPointId)
  }

  get copyMoveSelectorExploreState() {
    if (!this.copyMoveSelectorState.selectedFileAccessPointId) {
      return null
    }
    return fapSmbExternalStore.getExploreState(this.copyMoveSelectorState.selectedFileAccessPointId)
  }

  getSmbExternalItemById(fileAccessPointId: string) {
    return fapSmbExternalStore.items.find((item) => item.fileAccessPointId === fileAccessPointId) || null
  }

  resetCopyMoveSelectorState(isOpen: boolean) {
    this.copyMoveSelectorState = {
      isOpen,
      searchText: '',
      selectedFileAccessPointId: this.copyMoveTargetInfo.fileAccessPoint?.fileAccessPointId || this.copyMoveFileAccessPointId,
      selectedFolderPath: this.copyMovePreviewTargetFolderPath || '/',
      messageText: '',
    }
  }

  async openCopyMoveSelector() {
    this.resetCopyMoveSelectorState(true)
    if (fapSmbExternalStore.items.length === 0) {
      await fapSmbExternalStore.requestLoadList()
    }
    const selectedId = this.copyMoveSelectorState.selectedFileAccessPointId || fapSmbExternalStore.items[0]?.fileAccessPointId || ''
    runInAction(() => {
      this.copyMoveSelectorState.selectedFileAccessPointId = selectedId
    })
    if (selectedId) {
      await this.requestCopyMoveSelectorExplore(this.copyMoveSelectorState.selectedFolderPath || '/')
    }
  }

  closeCopyMoveSelector() {
    this.resetCopyMoveSelectorState(false)
  }

  setCopyMoveSelectorSearchText(searchText: string) {
    this.copyMoveSelectorState.searchText = String(searchText || '')
  }

  async requestCopyMoveSelectorRefreshFaps() {
    await fapSmbExternalStore.requestLoadList()
  }

  async selectCopyMoveSelectorFileAccessPoint(fileAccessPointId: string) {
    this.copyMoveSelectorState.selectedFileAccessPointId = fileAccessPointId
    this.copyMoveSelectorState.selectedFolderPath = '/'
    await this.requestCopyMoveSelectorExplore('/')
  }

  async requestCopyMoveSelectorExplore(path: string) {
    const fileAccessPointId = this.copyMoveSelectorState.selectedFileAccessPointId
    if (!fileAccessPointId) {
      return { isSuccess: false, messageText: 'select a file access point' }
    }
    const result = await fapSmbExternalStore.requestExplore(fileAccessPointId, normalizePath(path))
    runInAction(() => {
      if (result.isSuccess) {
        this.copyMoveSelectorState.selectedFolderPath = normalizePath(path)
      }
      this.copyMoveSelectorState.messageText = result.messageText
    })
    return result
  }

  applyCopyMoveSelectorTarget() {
    const fileAccessPoint = this.copyMoveSelectorFileAccessPoint
    if (!fileAccessPoint) {
      this.copyMoveSelectorState.messageText = 'select a file access point'
      return
    }
    this.copyMoveTargetFolderPath = formatTargetFolderExpression(fileAccessPoint, this.copyMoveSelectorState.selectedFolderPath)
    this.resetCopyMoveSelectorState(false)
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
      const previousTaskById = new Map(this.taskItems.map((task) => [task.taskId, task]))
      const data = await requestAuthenticatedJson('/fap-smb-external/task/list', {
        method: 'POST',
        body: JSON.stringify({ limit: 80 }),
      })
      const items = Array.isArray(data.items) ? (data.items as TaskRow[]) : []
      const taskListForRefresh = items.filter((task) => {
        const previousTask = previousTaskById.get(task.taskId)
        return task.taskStatus === TASK_STATUS.success && previousTask?.taskStatus !== TASK_STATUS.success
      })
      runInAction(() => {
        this.taskItems = items
        Object.values(this.taskListViewStateByKey).forEach((state) => {
          state.selectedTaskIds = state.selectedTaskIds.filter((taskId) => items.some((task) => task.taskId === taskId))
        })
        if (this.taskSelectedId && !items.some((task) => task.taskId === this.taskSelectedId)) {
          this.taskSelectedId = ''
          this.isPanelOpen = false
        }
      })
      taskListForRefresh.forEach((task) => {
        this.refreshExploreForCompletedTask(task)
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
    const targetInfo = this.copyMoveTargetInfo
    const targetFolder = targetInfo.folderPath
    if (!targetInfo.fileAccessPoint) {
      return { isSuccess: false, messageText: 'target file access point not found' }
    }
    const itemList = this.copyMoveItemList.map((item) => ({
      ...item,
      pathTarget: joinPath(targetFolder, item.name),
      fileAccessPointTarget: {
        fileAccessPointType: 'smb/external' as const,
        fileAccessPointId: targetInfo.fileAccessPoint?.fileAccessPointId || item.fileAccessPointTarget.fileAccessPointId,
        fileAccessPointName: targetInfo.fileAccessPoint?.name || item.fileAccessPointTarget.fileAccessPointName,
      },
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
            targetFolderPath: this.copyMoveTargetFolderPath,
            targetFolderPathResolved: targetFolder,
            fileAccessPointTarget: {
              fileAccessPointType: 'smb/external',
              fileAccessPointId: targetInfo.fileAccessPoint.fileAccessPointId,
              fileAccessPointName: targetInfo.fileAccessPoint.name,
            },
            itemList,
            isOverwriteAllowed: false,
            isEnsureTargetFolder: this.isCopyMoveEnsureTargetFolder,
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

  async requestResubmitTask(taskId: string) {
    if (this.isResubmitting) {
      return { isSuccess: false, messageText: 'task resubmitting' }
    }
    runInAction(() => {
      this.isResubmitting = true
      this.errorText = ''
    })
    try {
      const data = await requestAuthenticatedJson('/fap-smb-external/task/resubmit', {
        method: 'POST',
        body: JSON.stringify({ taskId }),
      })
      const task = data.task as TaskRow
      runInAction(() => {
        if (task?.taskId) {
          this.taskSelectedId = task.taskId
          this.taskItems = [task, ...this.taskItems.filter((item) => item.taskId !== task.taskId)]
          this.isPanelOpen = true
        }
      })
      await this.requestLoadList()
      return { isSuccess: true, messageText: 'task resubmitted' }
    } catch (error: unknown) {
      runInAction(() => {
        this.errorText = String(error)
      })
      return { isSuccess: false, messageText: String(error) }
    } finally {
      runInAction(() => {
        this.isResubmitting = false
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

  refreshExploreForCompletedTask(task: TaskRow) {
    if (task.taskType !== TASK_TYPE.smbExternalCopy && task.taskType !== TASK_TYPE.smbExternalMove) {
      return
    }
    const taskInfo = task.taskInfo || {}
    const operationInfo = getObjectField(taskInfo, 'operationInfo')
    const itemList = Array.isArray(operationInfo.itemList) ? operationInfo.itemList as Record<string, unknown>[] : []
    const refreshKeySet = new Set<string>()
    itemList.forEach((item) => {
      const sourceInfo = getObjectField(item, 'fileAccessPointSource')
      const targetInfo = getObjectField(item, 'fileAccessPointTarget')
      const sourceFileAccessPointId = String(sourceInfo.fileAccessPointId || '')
      const targetFileAccessPointId = String(targetInfo.fileAccessPointId || '')
      const sourceFolderPath = buildParentPath(String(item.pathSource || '/'))
      const targetFolderPath = buildParentPath(String(item.pathTarget || '/'))
      if (task.taskType === TASK_TYPE.smbExternalMove && sourceFileAccessPointId) {
        refreshKeySet.add(`${sourceFileAccessPointId}\n${sourceFolderPath}`)
      }
      if (targetFileAccessPointId) {
        refreshKeySet.add(`${targetFileAccessPointId}\n${targetFolderPath}`)
      }
    })
    refreshKeySet.forEach((refreshKey) => {
      const [fileAccessPointId, folderPath] = refreshKey.split('\n')
      const exploreState = fapSmbExternalStore.getExploreState(fileAccessPointId)
      if (exploreState.path === folderPath && !exploreState.isExploring) {
        fapSmbExternalStore.requestExplore(fileAccessPointId, folderPath)
      }
    })
  }
}

function getObjectField(source: Record<string, unknown>, key: string) {
  const value = source[key]
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

function parseTargetFolderExpression(
  targetFolder: string,
  defaultFileAccessPoint: FapSmbExternalItem | null,
  fileAccessPointItems: FapSmbExternalItem[],
) {
  const text = String(targetFolder || '/').trim()
  const match = text.match(/^\[fap-smb-external:(.*)\(([^()]+)\)\](\/.*)?$/)
  if (!match) {
    return {
      fileAccessPoint: defaultFileAccessPoint,
      folderPath: normalizePath(text),
    }
  }
  const fileAccessPointId = match[2] || ''
  const fileAccessPoint = fileAccessPointItems.find((item) => item.fileAccessPointId === fileAccessPointId) || null
  return {
    fileAccessPoint,
    folderPath: normalizePath(match[3] || '/'),
  }
}

function formatTargetFolderExpression(fileAccessPoint: FapSmbExternalItem, folderPath: string) {
  return `[fap-smb-external:${fileAccessPoint.name}(${fileAccessPoint.fileAccessPointId})]${normalizePath(folderPath)}`
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

function buildParentPath(path: string) {
  const normalizedPath = normalizePath(path)
  const parts = normalizedPath.split('/').filter(Boolean)
  parts.pop()
  return parts.length ? `/${parts.join('/')}` : '/'
}

export function getTaskLatestMessage(task: TaskRow) {
  const taskInfo = task.taskInfo || {}
  const progress = getObjectField(taskInfo, 'taskProgress')
  const progressList = Array.isArray(progress.progressList) ? progress.progressList as Record<string, unknown>[] : []
  const latestProgress = progressList[progressList.length - 1]
  const latestMessage = latestProgress ? String(latestProgress.taskStatusMessage || '') : ''
  return latestMessage || task.taskStatusText || task.taskId
}

export function getTaskStatusLabel(taskStatus: number) {
  if (taskStatus === TASK_STATUS.undergoing) {
    return 'running'
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
