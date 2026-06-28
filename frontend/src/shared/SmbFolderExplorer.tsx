import type React from 'react'
import { observer } from 'mobx-react-lite'
import { FolderView, PathBar, SpinningCircle } from '@wwf971/react-comp-misc'
import './SmbFolderExplorer.css'

export type SmbFolderExplorerItem = {
  name: string
  isDirectory: boolean
  sizeBytes?: number
}

export type SmbFolderExplorerMessageState = {
  status: 'idle' | 'loading' | 'success' | 'error' | 'warning'
  messageText: string
}

export type SmbFolderExplorerState = {
  path: string
  items: SmbFolderExplorerItem[]
  rowsSelectedId: string[]
  messageState: SmbFolderExplorerMessageState
  isExploring: boolean
}

export type SmbFolderExplorerRequestResult = {
  isSuccess: boolean
  messageText: string
}

export type SmbFolderExplorerStore = {
  getSmbFolderExplorerState: (accessPointId: string) => SmbFolderExplorerState
  setSmbFolderExplorerPath: (accessPointId: string, path: string) => void
  setSmbFolderExplorerSelectedRowIds: (accessPointId: string, rowIds: string[]) => void
  setSmbFolderExplorerMessageState?: (accessPointId: string, messageState: SmbFolderExplorerMessageState) => void
  requestSmbFolderExplorerList: (accessPointId: string, path: string) => Promise<SmbFolderExplorerRequestResult>
}

export type SmbFolderExplorerData = {
  accessPointId: string
  titleText?: string
  getRowData?: (item: SmbFolderExplorerItem, rowId: string) => Record<string, unknown>
  controlContent?: React.ReactNode
}

export type SmbFolderExplorerConfig = {
  bodyHeight?: number
  isPathEditable?: boolean
  isDisabled?: boolean
  pathRoot?: string
}

export type SmbFolderExplorerEventData = {
  accessPointId: string
  path?: string
  rowId?: string
  event?: MouseEvent | React.MouseEvent<HTMLDivElement>
}

export type SmbFolderExplorerProps = {
  data: SmbFolderExplorerData
  config?: SmbFolderExplorerConfig
  onEvent?: (eventType: string, eventData: SmbFolderExplorerEventData) => void
  store?: SmbFolderExplorerStore
}

const FOLDER_COLUMNS = {
  name: { data: 'name', align: 'left' },
  type: { data: 'type', align: 'left' },
  size: { data: 'size', align: 'left' },
}

const FOLDER_COLUMNS_ORDER = ['name', 'type', 'size']

const FOLDER_COLUMNS_SIZE = {
  name: { width: 260, minWidth: 140, resizable: true },
  type: { width: 90, minWidth: 70, resizable: true },
  size: { width: 100, minWidth: 70, resizable: true },
}

type SmbPathData = {
  segments: Array<{ name: string }>
}

const SmbFolderExplorer = observer(({
  data,
  config,
  onEvent,
  store,
}: SmbFolderExplorerProps) => {
  if (!store) {
    throw new Error('SmbFolderExplorer store is required')
  }
  const accessPointId = data.accessPointId
  const titleText = data.titleText || ''
  const bodyHeight = config?.bodyHeight ?? 320
  const isPathEditable = config?.isPathEditable !== false
  const isDisabled = config?.isDisabled === true
  const pathRoot = normalizeSmbPath(config?.pathRoot || '/')
  const state = store.getSmbFolderExplorerState(accessPointId)
  const messageState = state.messageState || createSmbFolderExplorerMessageState()
  const isLocked = isDisabled || state.isExploring

  const requestList = async (pathVisible: string) => {
    const normalizedPathVisible = normalizeSmbPath(pathVisible)
    const normalizedPath = buildActualPathFromVisiblePath(normalizedPathVisible, pathRoot)
    setExplorerMessage(store, accessPointId, {
      status: 'loading',
      messageText: `Listing path: ${normalizedPathVisible}`,
    })
    const result = await store.requestSmbFolderExplorerList(accessPointId, normalizedPath)
    setExplorerMessage(store, accessPointId, {
      status: result.isSuccess ? 'success' : 'error',
      messageText: result.messageText,
    })
    return result
  }

  const pathVisible = buildVisiblePathFromActualPath(state.path || '/', pathRoot)
  const pathData = getSmbPathData(pathVisible)

  const parsePathString = (raw: string) => {
    const parsedPathData = parseSmbPathString(raw)
    if (!parsedPathData) {
      setExplorerMessage(store, accessPointId, {
        status: 'error',
        messageText: 'invalid path string',
      })
    }
    return parsedPathData
  }

  const commitPathData = async (nextPathData: SmbPathData) => {
    const nextPath = buildSmbPathFromPathData(nextPathData)
    if (nextPath === pathVisible) {
      return true
    }
    const result = await requestList(nextPath)
    return result.isSuccess
  }

  const openPathSegment = (index: number) => {
    const nextPath = buildSmbPathFromPathData({
      segments: pathData.segments.slice(0, index + 1),
    })
    if (nextPath === pathVisible) {
      return
    }
    void requestList(nextPath)
  }

  const folderRows = (state.items || []).map((item) => ({
    id: getSmbFolderExplorerRowId(item),
    data: data.getRowData?.(item, getSmbFolderExplorerRowId(item)) || getDefaultRowData(item),
  }))

  return (
    <div className="smb-folder-explorer-root">
      {titleText ? <div className="smb-folder-explorer-title">{titleText}</div> : null}
      <div className={`smb-folder-explorer-message status-${messageState.messageText ? messageState.status : 'empty'}`}>
        {messageState.status === 'loading' && messageState.messageText ? <SpinningCircle width={13} height={13} /> : null}
        <div className="smb-folder-explorer-message-text">{messageState.messageText || 'no message'}</div>
        <button
          type="button"
          className="smb-folder-explorer-btn"
          disabled={messageState.status === 'loading' || !messageState.messageText}
          onClick={() => {
            setExplorerMessage(store, accessPointId, createSmbFolderExplorerMessageState())
          }}
        >
          Dismiss
        </button>
      </div>
      <div className="smb-folder-explorer-toolbar">
        <PathBar
          pathData={pathData}
          onPathSegClicked={openPathSegment}
          onPathChangeCommit={commitPathData}
          parsePathString={parsePathString}
          addSlashBeforeFirstSeg={true}
          appendTrailingSlash={false}
          allowEditText={isPathEditable && !isLocked}
          height={28}
        />
        <div className="smb-folder-explorer-control-row">
          {data.controlContent}
          <button
            type="button"
            className="smb-folder-explorer-btn"
            disabled={isLocked}
            onClick={() => {
              void requestList(pathVisible)
            }}
          >
            reload
          </button>
          <button
            type="button"
            className="smb-folder-explorer-btn"
            disabled={isLocked}
            onClick={() => {
              void requestList(buildSmbParentPath(pathVisible))
            }}
          >
            up
          </button>
          <button
            type="button"
            className="smb-folder-explorer-btn"
            disabled={isLocked}
            onClick={() => {
              void requestList('/')
            }}
          >
            root
          </button>
        </div>
      </div>
      <div
        className="smb-folder-explorer-table"
        onMouseDownCapture={(event) => {
          const rowElement = (event.target as HTMLElement | null)?.closest?.('[data-row-id]')
          if (event.shiftKey && rowElement) {
            event.preventDefault()
          }
        }}
        onContextMenu={(event) => {
          const rowElement = (event.target as HTMLElement | null)?.closest?.('[data-row-id]')
          if (rowElement) {
            return
          }
          onEvent?.('backgroundContextMenu', {
            accessPointId,
            event,
          })
        }}
      >
        <FolderView
          data={{
            columns: FOLDER_COLUMNS,
            colsOrder: FOLDER_COLUMNS_ORDER,
            rows: folderRows,
            rowIdsSelected: state.rowsSelectedId || [],
            statusBar: {
              itemCount: folderRows.length,
              messageState: state.isExploring
                ? { status: 'loading', messageText: 'loading directory' }
                : null,
            },
          }}
          config={{
            colSizeById: FOLDER_COLUMNS_SIZE,
            bodyHeight,
            isListOnly: true,
            isStatusBarVisible: false,
            selectionMode: 'multiple',
            isLocked,
            isContextMenuBuiltInDisabled: true,
          }}
          onEvent={async (eventType, eventData) => {
            if (eventType === 'rowIdsSelectedChange') {
              store.setSmbFolderExplorerSelectedRowIds(accessPointId, eventData.rowIdsSelected as string[])
              return { code: 0 }
            }
            if (eventType === 'rowDoubleClick') {
              const rowId = String(eventData.rowId || '')
              if (isLocked) {
                return { code: 0 }
              }
              const item = getItemByRowId(state.items || [], rowId)
              if (!item?.isDirectory) {
                return { code: 0 }
              }
              const nextPath = buildSmbChildPath(pathVisible || '/', item.name)
              const nextPathActual = buildActualPathFromVisiblePath(nextPath, pathRoot)
              onEvent?.('folderOpen', {
                accessPointId,
                path: nextPathActual,
                rowId,
              })
              void requestList(nextPath)
              return { code: 0 }
            }
            if (eventType === 'rowContextMenu') {
              onEvent?.('rowContextMenu', {
                accessPointId,
                rowId: String(eventData.rowId || ''),
                event: eventData.event as MouseEvent,
              })
              return { code: 0 }
            }
            return { code: 0 }
          }}
        />
      </div>
    </div>
  )
})

export function createSmbFolderExplorerMessageState(): SmbFolderExplorerMessageState {
  return {
    status: 'idle',
    messageText: '',
  }
}

export function createSmbFolderExplorerState(path = '/'): SmbFolderExplorerState {
  return {
    path: normalizeSmbPath(path),
    items: [],
    rowsSelectedId: [],
    messageState: createSmbFolderExplorerMessageState(),
    isExploring: false,
  }
}

export function normalizeSmbPath(path: string) {
  let text = String(path || '/').replace(/\\/g, '/').trim()
  while (text.includes('//')) {
    text = text.replace(/\/\//g, '/')
  }
  if (!text.startsWith('/')) {
    text = `/${text}`
  }
  if (text.length > 1) {
    text = text.replace(/\/+$/g, '')
  }
  return text || '/'
}

export function buildSmbParentPath(path: string) {
  const normalized = normalizeSmbPath(path)
  if (normalized === '/') {
    return '/'
  }
  const parts = normalized.split('/').filter((item) => item)
  parts.pop()
  return parts.length > 0 ? `/${parts.join('/')}` : '/'
}

export function buildSmbChildPath(currentPath: string, itemName: string) {
  const base = normalizeSmbPath(currentPath)
  const name = String(itemName || '').replace(/^\/+|\/+$/g, '')
  if (!name) {
    return base
  }
  return normalizeSmbPath(`${base === '/' ? '' : base}/${name}`)
}

function getSmbPathData(path: string): SmbPathData {
  const normalized = normalizeSmbPath(path)
  return {
    segments: normalized === '/'
      ? []
      : normalized.slice(1).split('/').filter(Boolean).map((name) => ({ name })),
  }
}

function parseSmbPathString(raw: string): SmbPathData | null {
  const text = String(raw ?? '')
  if (text.includes('\0')) {
    return null
  }
  return getSmbPathData(text)
}

function buildSmbPathFromPathData(pathData: SmbPathData) {
  const segments = pathData.segments || []
  if (segments.length === 0) {
    return '/'
  }
  return normalizeSmbPath(`/${segments.map((segment) => segment.name).join('/')}`)
}

function buildVisiblePathFromActualPath(pathActual: string, pathRoot: string) {
  const actual = normalizeSmbPath(pathActual)
  const root = normalizeSmbPath(pathRoot)
  if (root === '/') {
    return actual
  }
  if (actual === root) {
    return '/'
  }
  const rootPrefix = `${root}/`
  if (!actual.startsWith(rootPrefix)) {
    return actual
  }
  return normalizeSmbPath(`/${actual.slice(rootPrefix.length)}`)
}

function buildActualPathFromVisiblePath(pathVisible: string, pathRoot: string) {
  const visible = normalizeSmbPath(pathVisible)
  const root = normalizeSmbPath(pathRoot)
  if (root === '/') {
    return visible
  }
  if (visible === '/') {
    return root
  }
  return normalizeSmbPath(`${root}/${visible.slice(1)}`)
}

function getSmbFolderExplorerRowId(item: SmbFolderExplorerItem) {
  return `${item.isDirectory ? 'd' : 'f'}:${item.name}`
}

function getDefaultRowData(item: SmbFolderExplorerItem) {
  return {
    name: item.name,
    type: item.isDirectory ? 'dir' : 'file',
    size: item.isDirectory ? '-' : `${item.sizeBytes ?? 0}`,
  }
}

function getItemByRowId(items: SmbFolderExplorerItem[], rowId: string) {
  const text = String(rowId || '')
  const isDirectory = text.startsWith('d:')
  const isFile = text.startsWith('f:')
  if (!isDirectory && !isFile) {
    return null
  }
  const name = text.slice(2)
  return items.find((item) => item.name === name && item.isDirectory === isDirectory) || null
}

function setExplorerMessage(
  store: SmbFolderExplorerStore,
  accessPointId: string,
  messageState: SmbFolderExplorerMessageState,
) {
  store.setSmbFolderExplorerMessageState?.(accessPointId, messageState)
}

export default SmbFolderExplorer
