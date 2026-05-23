import React, { useState } from 'react'
import { observer } from 'mobx-react-lite'
import { requestAuthenticatedBlob } from '../../apiRequest'
import { FolderView, MenuComp, SpinningCircle } from '@wwf971/react-comp-misc'
import { fileAccessPointStore } from '../store/fileAccessPointStore'

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
  return `/${parts.join('/')}` || '/'
}

function buildNextPath(currentPath: string, itemName: string) {
  const base = currentPath === '/' ? '' : currentPath
  return `${base}/${itemName}`
}

const FOLDER_COLUMNS = {
  name: { data: 'name', align: 'left' },
  type: { data: 'type', align: 'left' },
  size: { data: 'size', align: 'right' },
}

const FOLDER_COLUMNS_ORDER = ['name', 'type', 'size']
const FOLDER_COLUMNS_SIZE = {
  name: { width: 260, minWidth: 140, resizable: true },
  type: { width: 90, minWidth: 70, resizable: true },
  size: { width: 90, minWidth: 70, resizable: true },
}

const FileExplorePanel = observer(() => {
  const item = fileAccessPointStore.selectedItem
  const exploreState = item ? fileAccessPointStore.getExploreState(item.fileAccessPointId) : null
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

  const runExplore = async (path: string) => {
    setMessageState({
      status: 'loading',
      messageText: `Listing path: ${path}`,
    })
    const result = await fileAccessPointStore.requestExplore(path)
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
      const response = await requestAuthenticatedBlob('/api/file-access-point/explore/download', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          fileAccessPointId: item.fileAccessPointId,
          path: targetPath,
        }),
      })
      const blob = await response.blob()
      const downloadUrl = URL.createObjectURL(blob)
      const anchor = document.createElement('a')
      anchor.href = downloadUrl
      anchor.download = targetPath.split('/').filter((part) => part).pop() || 'download.bin'
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      URL.revokeObjectURL(downloadUrl)
      setMessageState({
        status: 'success',
        messageText: `Downloaded: ${targetPath}`,
      })
    } catch (error: unknown) {
      setMessageState({
        status: 'error',
        messageText: String(error),
      })
    }
  }

  if (!item) {
    return <div className="panel-title">No file access point selected</div>
  }

  const folderRows = (exploreState?.items || []).map((exploreItem) => ({
    id: `${exploreItem.isDirectory ? 'd' : 'f'}:${exploreItem.name}`,
    data: {
      name: exploreItem.name,
      type: exploreItem.isDirectory ? 'dir' : 'file',
      size: exploreItem.isDirectory ? '-' : String(exploreItem.sizeBytes),
    },
  }))

  return (
    <div className="panel-root">
      <div className="panel-title">
        SMB Explore {item.name} [{item.sourceType}]
      </div>
      {messageState.messageText ? (
        <div className={`frontend-message-bar status-${messageState.status}`}>
          {messageState.status === 'loading' ? <SpinningCircle width={13} height={13} /> : null}
          <div className="frontend-message-content">
            <span>{messageState.messageText}</span>
            <button
              type="button"
              className="frontend-message-dismiss-btn"
              onClick={() => {
                setMessageState({
                  status: 'idle',
                  messageText: '',
                })
              }}
              disabled={messageState.status === 'loading'}
            >
              Dismiss
            </button>
          </div>
        </div>
      ) : null}
      <div className="panel-row">
        <input
          className="text-input path-input"
          value={exploreState?.path || '/'}
          onChange={(event) => {
            if (!item) {
              return
            }
            fileAccessPointStore.setExplorePath(item.fileAccessPointId, event.target.value)
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
            const normalizedRowId = String(rowId || '')
            const isDir = normalizedRowId.startsWith('d:')
            if (!isDir) {
              return
            }
            const name = normalizedRowId.slice(2)
            runExplore(buildNextPath(exploreState?.path || '/', name))
          }}
          onRowContextMenu={(event: MouseEvent, rowId: string) => {
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
          }}
          loading={exploreState?.isExploring}
          loadingMessage="loading directory"
        />
      </div>
      {contextMenuState.position ? (
        <MenuComp
          items={[
            {
              type: 'item',
              name: 'Download',
              data: { action: 'download' },
              disabled: !contextMenuState.rowId?.startsWith('f:'),
            },
            {
              type: 'item',
              name: 'Download Zip',
              data: { action: 'download-zip' },
              disabled: !contextMenuState.rowId?.startsWith('d:') || fileAccessPointStore.isZipRunning,
            },
            {
              type: 'item',
              name: 'Open',
              data: { action: 'open' },
              disabled: !contextMenuState.rowId?.startsWith('d:'),
            },
          ]}
          position={contextMenuState.position}
          onClose={() => {
            setContextMenuState({
              position: null,
              rowId: null,
            })
          }}
          onContextMenu={(event: MouseEvent) => {
            event.preventDefault()
          }}
          onItemClick={(menuItem: any) => {
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
            if (menuItem?.data?.action === 'download-zip' && exploreItem.isDirectory) {
              fileAccessPointStore.requestStartZip(buildNextPath(exploreState?.path || '/', exploreItem.name))
            }
          }}
        />
      ) : null}
    </div>
  )
})

export default FileExplorePanel
