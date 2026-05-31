import React, { useState } from 'react'
import { observer } from 'mobx-react-lite'
import { FolderView, MenuComp, SpinningCircle } from '@wwf971/react-comp-misc'
import {
  fapSmbExternalStore,
  TEXT_EDITOR_MAX_SIZE_BYTES,
  TEXT_EDITOR_WARN_SIZE_BYTES,
} from '../store/fapSmbExternalStore'

function buildParentPath(path: string) {
  const normalized = String(path || '/')
  if (normalized === '/' || normalized === '') {
    return '/'
  }
  const parts = normalized.split('/').filter((item) => item)
  if (parts.length === 0) {
    return '/'
  }
  parts.pop()
  if (parts.length === 0) {
    return '/'
  }
  return `/${parts.join('/')}`
}

function buildNextPath(currentPath: string, itemName: string) {
  const base = currentPath === '/' ? '' : currentPath
  return `${base}/${itemName}`
}

const TEXT_EDITOR_ALLOWED_SUFFIX_SET = new Set([
  '.txt',
  '.md',
  '.markdown',
  '.js',
  '.jsx',
  '.ts',
  '.tsx',
  '.json',
  '.yaml',
  '.yml',
  '.css',
  '.html',
  '.xml',
  '.csv',
  '.log',
  '.py',
  '.sh',
  '.toml',
  '.ini',
  '.conf',
])

const TEXT_EDITOR_ALLOWED_NAME_SET = new Set([
  '.env',
  '.gitignore',
  'makefile',
])

const TEXT_EDITOR_BLOCKED_SUFFIX_SET = new Set([
  '.pdf',
  '.exe',
  '.dll',
  '.so',
  '.dylib',
  '.zip',
  '.7z',
  '.rar',
  '.tar',
  '.gz',
  '.jpg',
  '.jpeg',
  '.png',
  '.gif',
  '.webp',
  '.mp3',
  '.mp4',
  '.avi',
  '.mov',
  '.bin',
  '.db',
  '.sqlite',
  '.doc',
  '.docx',
  '.xls',
  '.xlsx',
  '.ppt',
  '.pptx',
  '.class',
  '.jar',
])

function getFileSuffix(fileName: string) {
  const lowerName = String(fileName || '').toLowerCase()
  const dotIndex = lowerName.lastIndexOf('.')
  if (dotIndex <= 0) {
    return ''
  }
  return lowerName.slice(dotIndex)
}

function buildTextEditorCheck(fileName: string, sizeBytes: number) {
  const lowerName = String(fileName || '').toLowerCase()
  const suffix = getFileSuffix(lowerName)
  const warningTextList = []
  if (TEXT_EDITOR_BLOCKED_SUFFIX_SET.has(suffix)) {
    return {
      status: 'error',
      messageText: `This file type is blocked for text editing: ${suffix}`,
    }
  }
  if (sizeBytes > TEXT_EDITOR_MAX_SIZE_BYTES) {
    return {
      status: 'error',
      messageText: `This file is too large for text editing: ${sizeBytes} bytes`,
    }
  }
  if (!TEXT_EDITOR_ALLOWED_SUFFIX_SET.has(suffix) && !TEXT_EDITOR_ALLOWED_NAME_SET.has(lowerName)) {
    warningTextList.push('This file suffix is not in the known text list.')
  }
  if (sizeBytes > TEXT_EDITOR_WARN_SIZE_BYTES) {
    warningTextList.push(`This file is larger than ${TEXT_EDITOR_WARN_SIZE_BYTES} bytes.`)
  }
  if (warningTextList.length > 0) {
    return {
      status: 'warning',
      messageText: warningTextList.join(' '),
    }
  }
  return {
    status: 'ok',
    messageText: '',
  }
}

const getElementUnderMenu = (event: MouseEvent) => {
  const overlayElements = Array.from(document.querySelectorAll<HTMLElement>('.menu-backdrop, .menu-core-root'))
  const previousValues = overlayElements.map((element) => ({
    element,
    pointerEvents: element.style.pointerEvents,
  }))
  overlayElements.forEach((element) => {
    element.style.pointerEvents = 'none'
  })
  const targetElement = document.elementFromPoint(event.clientX, event.clientY)
  previousValues.forEach(({ element, pointerEvents }) => {
    element.style.pointerEvents = pointerEvents
  })
  return targetElement
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
  size: { width: 90, minWidth: 70, resizable: true },
}

type NameCellProps = {
  rowId: string
  name: string
  isEditing: boolean
  isRenaming: boolean
  isRowLocked: boolean
  onStartEditing: () => void
  onCancelEditing: () => void
  onCommitEditing: (nextName: string) => void
}

const NameCell = ({
  rowId,
  name,
  isEditing,
  isRenaming,
  isRowLocked,
  onStartEditing,
  onCancelEditing,
  onCommitEditing,
}: NameCellProps) => {
  const editRef = React.useRef<HTMLDivElement | null>(null)

  React.useEffect(() => {
    if (!isEditing || !editRef.current) {
      return
    }
    editRef.current.focus()
    const range = document.createRange()
    range.selectNodeContents(editRef.current)
    range.collapse(false)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
  }, [isEditing, rowId])

  return (
    <div className={`explore-name-cell ${isRowLocked ? 'is-locked' : ''}`}>
      <div
        ref={editRef}
        className={`explore-name-content ${isEditing ? 'is-editing' : ''}`}
        contentEditable={isEditing}
        suppressContentEditableWarning={true}
        onDoubleClick={() => {
          if (isRowLocked) {
            return
          }
          onStartEditing()
        }}
        onBlur={(event) => {
          if (!isEditing) {
            return
          }
          onCommitEditing(String(event.currentTarget.textContent || '').trim())
        }}
        onKeyDown={(event) => {
          if (!isEditing) {
            return
          }
          if (event.key === 'Enter') {
            event.preventDefault()
            onCommitEditing(String(event.currentTarget.textContent || '').trim())
            return
          }
          if (event.key === 'Escape') {
            event.preventDefault()
            onCancelEditing()
          }
        }}
      >
        {name}
      </div>
      {isRenaming ? (
        <span className="explore-name-spinner">
          <SpinningCircle width={12} height={12} />
        </span>
      ) : null}
    </div>
  )
}

const FapSmbExternalExplorePanel = observer(() => {
  const item = fapSmbExternalStore.selectedItem
  const exploreState = item ? fapSmbExternalStore.getExploreState(item.fileAccessPointId) : null
  const canWrite = fapSmbExternalStore.canWrite
  const [messageState, setMessageState] = useState({
    status: 'idle',
    messageText: '',
  })
  const [contextMenuState, setContextMenuState] = useState<{
    position: null | { x: number, y: number }
    rowId: null | string
  }>({
    position: null,
    rowId: null,
  })
  const [textOpenDialogState, setTextOpenDialogState] = useState<{
    status: 'idle' | 'warning' | 'error'
    messageText: string
    targetPath: string
  }>({
    status: 'idle',
    messageText: '',
    targetPath: '',
  })

  const runExplore = async (path: string) => {
    setMessageState({
      status: 'loading',
      messageText: `Listing path: ${path}`,
    })
    const result = await fapSmbExternalStore.requestExplore(path)
    setMessageState({
      status: result?.isSuccess ? 'success' : 'error',
      messageText: result?.messageText || '',
    })
  }

  const getExploreItemByRowId = (rowId: string | null) => {
    if (!exploreState) {
      return null
    }
    const normalized = String(rowId || '')
    const isDirectory = normalized.startsWith('d:')
    const isFile = normalized.startsWith('f:')
    if (!isDirectory && !isFile) {
      return null
    }
    const name = normalized.slice(2)
    return exploreState.items.find((exploreItem) => exploreItem.name === name) || null
  }

  const runDownload = async (targetPath: string) => {
    if (!item) {
      return
    }
    setMessageState({
      status: 'loading',
      messageText: `Downloading: ${targetPath}`,
    })
    try {
      const result = await fapSmbExternalStore.requestDownloadExploreFile(item.fileAccessPointId, targetPath)
      setMessageState({
        status: result?.isSuccess ? 'success' : 'error',
        messageText: result?.messageText || '',
      })
    } catch (error: unknown) {
      setMessageState({
        status: 'error',
        messageText: String(error),
      })
    }
  }

  const runOpenTextEditor = async (targetPath: string) => {
    if (!item) {
      return
    }
    setMessageState({
      status: 'loading',
      messageText: `Opening text editor: ${targetPath}`,
    })
    const result = await fapSmbExternalStore.requestOpenTextEditor(item.fileAccessPointId, targetPath)
    setMessageState({
      status: result?.isSuccess ? 'success' : 'error',
      messageText: result?.messageText || '',
    })
    if (!result?.isSuccess) {
      setTextOpenDialogState({
        status: 'error',
        messageText: result?.messageText || 'failed to open text editor',
        targetPath: '',
      })
    }
  }

  const requestOpenTextEditorWithCheck = (exploreItem: { name: string, isDirectory: boolean, sizeBytes: number }) => {
    if (!exploreState || exploreItem.isDirectory) {
      return
    }
    const targetPath = buildNextPath(exploreState.path || '/', exploreItem.name)
    const checkResult = buildTextEditorCheck(exploreItem.name, exploreItem.sizeBytes)
    if (checkResult.status === 'error') {
      setTextOpenDialogState({
        status: 'error',
        messageText: checkResult.messageText,
        targetPath: '',
      })
      return
    }
    if (checkResult.status === 'warning') {
      setTextOpenDialogState({
        status: 'warning',
        messageText: checkResult.messageText,
        targetPath,
      })
      return
    }
    runOpenTextEditor(targetPath)
  }

  const runCleanBackupFiles = async () => {
    if (!exploreState) {
      return
    }
    setMessageState({
      status: 'loading',
      messageText: `Cleaning backup files: ${exploreState.path}`,
    })
    const result = await fapSmbExternalStore.requestCleanTextBackups(exploreState.path || '/')
    setMessageState({
      status: result?.isSuccess ? 'success' : 'error',
      messageText: result?.messageText || '',
    })
  }

  const openContextMenu = (event: MouseEvent, rowId: string) => {
    event.preventDefault()
    event.stopPropagation()
    setContextMenuState({
      position: null,
      rowId: null,
    })
    requestAnimationFrame(() => {
      setContextMenuState({
        position: { x: event.clientX, y: event.clientY },
        rowId: String(rowId || ''),
      })
    })
  }

  const closeContextMenu = () => {
    setContextMenuState({
      position: null,
      rowId: null,
    })
  }

  const handleBackdropContextMenu = (event: MouseEvent) => {
    event.preventDefault()
    const targetElement = getElementUnderMenu(event)
    const rowElement = targetElement?.closest?.('[data-row-id]')
    const rowId = rowElement?.getAttribute('data-row-id')
    if (rowId) {
      openContextMenu(event, rowId)
      return
    }
    closeContextMenu()
  }

  if (!item) {
    return <div className="panel-title">No FAP SMB external selected</div>
  }

  const folderRows = (exploreState?.items || []).map((exploreItem) => ({
    id: `${exploreItem.isDirectory ? 'd' : 'f'}:${exploreItem.name}`,
    data: {
      name: (
        <NameCell
          rowId={`${exploreItem.isDirectory ? 'd' : 'f'}:${exploreItem.name}`}
          name={
            exploreState?.editingRowId === `${exploreItem.isDirectory ? 'd' : 'f'}:${exploreItem.name}`
              ? (exploreState?.editingName || exploreItem.name)
              : exploreItem.name
          }
          isEditing={exploreState?.editingRowId === `${exploreItem.isDirectory ? 'd' : 'f'}:${exploreItem.name}`}
          isRenaming={exploreState?.renamingRowId === `${exploreItem.isDirectory ? 'd' : 'f'}:${exploreItem.name}`}
          isRowLocked={!canWrite || Boolean(exploreState?.renamingRowId === `${exploreItem.isDirectory ? 'd' : 'f'}:${exploreItem.name}`)}
          onStartEditing={() => {
            if (!item) {
              return
            }
            fapSmbExternalStore.setExploreEditingRow(
              item.fileAccessPointId,
              `${exploreItem.isDirectory ? 'd' : 'f'}:${exploreItem.name}`,
              exploreItem.name,
            )
          }}
          onCancelEditing={() => {
            if (!item) {
              return
            }
            fapSmbExternalStore.setExploreEditingRow(item.fileAccessPointId, null, '')
          }}
          onCommitEditing={async (nextName: string) => {
            if (!item || !exploreState) {
              return
            }
            const rowId = `${exploreItem.isDirectory ? 'd' : 'f'}:${exploreItem.name}`
            if (!nextName || nextName === exploreItem.name) {
              fapSmbExternalStore.setExploreEditingRow(item.fileAccessPointId, null, '')
              return
            }
            const targetPath = buildNextPath(exploreState.path || '/', exploreItem.name)
            setMessageState({
              status: 'loading',
              messageText: `Renaming: ${exploreItem.name} -> ${nextName}`,
            })
            const result = await fapSmbExternalStore.requestRenameExploreItem(
              item.fileAccessPointId,
              targetPath,
              nextName,
              rowId,
            )
            setMessageState({
              status: result?.isSuccess ? 'success' : 'error',
              messageText: result?.messageText || '',
            })
          }}
        />
      ),
      type: exploreItem.isDirectory ? 'dir' : 'file',
      size: exploreItem.isDirectory ? '-' : String(exploreItem.sizeBytes),
    },
    rowClassName: exploreState?.renamingRowId === `${exploreItem.isDirectory ? 'd' : 'f'}:${exploreItem.name}`
      ? 'explore-row-renaming'
      : '',
  }))

  return (
    <div className="panel-root">
      <div className="panel-title">
        SMB Explore {item.name} [{item.sourceType}]
      </div>
      <div className={`frontend-message-bar status-${messageState.messageText ? messageState.status : 'empty'}`}>
        {messageState.status === 'loading' && messageState.messageText ? <SpinningCircle width={13} height={13} /> : null}
        <div className="frontend-message-content">
          <span className={messageState.messageText ? '' : 'frontend-message-empty'}>{messageState.messageText || '(NO MESSAGE)'}</span>
          <button
            type="button"
            className="frontend-message-dismiss-btn"
            onClick={() => {
              setMessageState({
                status: 'idle',
                messageText: '',
              })
            }}
            disabled={messageState.status === 'loading' || !messageState.messageText}
          >
            Dismiss
          </button>
        </div>
      </div>
      <div className="panel-row">
        <input
          className="text-input path-input"
          value={exploreState?.path || '/'}
          onChange={(event) => {
            if (!item) {
              return
            }
            fapSmbExternalStore.setExplorePath(item.fileAccessPointId, event.target.value)
          }}
        />
        <button
          type="button"
          className="main-btn"
          disabled={exploreState?.isExploring}
          onClick={() => {
            runExplore(exploreState?.path || '/')
          }}
        >
          list
        </button>
        <button
          type="button"
          className="main-btn"
          disabled={exploreState?.isExploring}
          onClick={() => {
            runExplore(buildParentPath(exploreState?.path || '/'))
          }}
        >
          up
        </button>
        <button
          type="button"
          className="main-btn"
          disabled={!canWrite || exploreState?.isExploring || fapSmbExternalStore.isUploadPopupOpen}
          onClick={() => {
            if (!item) {
              return
            }
            const result = fapSmbExternalStore.openUploadPopup(item.fileAccessPointId, exploreState?.path || '/')
            setMessageState({
              status: result?.isSuccess ? 'success' : 'error',
              messageText: result?.messageText || '',
            })
          }}
        >
          upload
        </button>
      </div>
      <div className="list-wrap">
        <FolderView
          columns={FOLDER_COLUMNS}
          columnsOrder={FOLDER_COLUMNS_ORDER}
          columnsSizeInit={FOLDER_COLUMNS_SIZE}
          rows={folderRows}
          bodyHeight={320}
          showStatusBar={false}
          listOnly={true}
          selectedRowId={null}
          onRowDoubleClick={(rowId: string) => {
            if (exploreState?.renamingRowId) {
              return
            }
            const normalizedRowId = String(rowId || '')
            const isDir = normalizedRowId.startsWith('d:')
            if (!isDir) {
              return
            }
            const name = normalizedRowId.slice(2)
            runExplore(buildNextPath(exploreState?.path || '/', name))
          }}
          onRowContextMenu={(event: MouseEvent, rowId: string) => {
            openContextMenu(event, rowId)
          }}
          loading={exploreState?.isExploring}
          loadingMessage="loading directory"
        />
      </div>
      {contextMenuState.position ? (
        <MenuComp
          data={{
            items: [
              {
                type: 'item',
                name: 'Download',
                data: { action: 'download' },
                disabled: !contextMenuState.rowId?.startsWith('f:') || Boolean(exploreState?.renamingRowId),
              },
              {
                type: 'item',
                name: 'Open Text',
                data: { action: 'open-text' },
                disabled: !canWrite || !contextMenuState.rowId?.startsWith('f:') || Boolean(exploreState?.renamingRowId) || fapSmbExternalStore.isTextEditorLoading || fapSmbExternalStore.isTextEditorSaving,
              },
              {
                type: 'item',
                name: 'Download Zip',
                data: { action: 'download-zip' },
                disabled: !contextMenuState.rowId?.startsWith('d:') || fapSmbExternalStore.isZipRunning || Boolean(exploreState?.renamingRowId),
              },
              {
                type: 'item',
                name: 'Open',
                data: { action: 'open' },
                disabled: !contextMenuState.rowId?.startsWith('d:') || Boolean(exploreState?.renamingRowId),
              },
              {
                type: 'item',
                name: 'Rename',
                data: { action: 'rename' },
                disabled: !canWrite || !contextMenuState.rowId || Boolean(exploreState?.renamingRowId),
              },
              {
                type: 'item',
                name: 'Clean Bak Files',
                data: { action: 'clean-bak' },
                disabled: !canWrite || Boolean(exploreState?.renamingRowId) || fapSmbExternalStore.isTextEditorLoading || fapSmbExternalStore.isTextEditorSaving,
              },
            ],
            position: contextMenuState.position,
          }}
          onEvent={(eventType: string, eventData: any) => {
            if (eventType === 'close') {
              closeContextMenu()
              return
            }
            if (eventType === 'backdropContextMenu') {
              handleBackdropContextMenu(eventData.event)
              return
            }
            if (eventType !== 'itemClick') {
              return
            }
            const menuItem = eventData?.item
            const exploreItem = getExploreItemByRowId(contextMenuState.rowId)
            if (!exploreItem) {
              return
            }
            if (menuItem?.data?.action === 'open' && exploreItem.isDirectory) {
              runExplore(buildNextPath(exploreState?.path || '/', exploreItem.name))
              return
            }
            if (menuItem?.data?.action === 'download' && !exploreItem.isDirectory) {
              runDownload(buildNextPath(exploreState?.path || '/', exploreItem.name))
            }
            if (menuItem?.data?.action === 'open-text' && !exploreItem.isDirectory) {
              requestOpenTextEditorWithCheck(exploreItem)
            }
            if (menuItem?.data?.action === 'download-zip' && exploreItem.isDirectory) {
              fapSmbExternalStore.requestStartZip(buildNextPath(exploreState?.path || '/', exploreItem.name))
            }
            if (menuItem?.data?.action === 'rename' && item && canWrite) {
              const rowId = contextMenuState.rowId || ''
              fapSmbExternalStore.setExploreEditingRow(item.fileAccessPointId, rowId, exploreItem.name)
            }
            if (menuItem?.data?.action === 'clean-bak' && canWrite) {
              runCleanBackupFiles()
            }
            closeContextMenu()
          }}
        />
      ) : null}
      {textOpenDialogState.status !== 'idle' ? (
        <div className="text-editor-notice-overlay">
          <div className={`text-editor-notice-popup status-${textOpenDialogState.status}`}>
            <div className="text-editor-notice-title">
              {textOpenDialogState.status === 'warning' ? 'Open text warning' : 'Open text error'}
            </div>
            <div className="text-editor-notice-message">{textOpenDialogState.messageText}</div>
            <div className="text-editor-notice-actions">
              {textOpenDialogState.status === 'warning' ? (
                <button
                  type="button"
                  className="main-btn"
                  onClick={() => {
                    const targetPath = textOpenDialogState.targetPath
                    setTextOpenDialogState({
                      status: 'idle',
                      messageText: '',
                      targetPath: '',
                    })
                    runOpenTextEditor(targetPath)
                  }}
                >
                  continue
                </button>
              ) : null}
              <button
                type="button"
                className="main-btn"
                onClick={() => {
                  setTextOpenDialogState({
                    status: 'idle',
                    messageText: '',
                    targetPath: '',
                  })
                }}
              >
                close
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
})

export default FapSmbExternalExplorePanel
