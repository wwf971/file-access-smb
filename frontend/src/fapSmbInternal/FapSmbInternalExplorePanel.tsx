import React, { useEffect, useState } from 'react'
import { observer } from 'mobx-react-lite'
import { FolderView, MenuComp, SpinningCircle } from '@wwf971/react-comp-misc'
import { fapSmbInternalStore, getFapSmbInternalSourceLabel, type FapSmbInternalFileItem } from '../store/fapSmbInternalStore'

const FOLDER_COLUMNS = {
  name: { data: 'name', align: 'left' },
  type: { data: 'type', align: 'left' },
  id: { data: 'fileId', align: 'left' },
  size: { data: 'size', align: 'left' },
  created: { data: 'created', align: 'left' },
}

const FOLDER_COLUMNS_ORDER = ['name', 'type', 'fileId', 'size', 'created']
const FOLDER_COLUMNS_SIZE = {
  name: { width: 260, minWidth: 140, resizable: true },
  type: { width: 120, minWidth: 80, resizable: true },
  fileId: { width: 130, minWidth: 90, resizable: true },
  size: { width: 90, minWidth: 70, resizable: true },
  created: { width: 190, minWidth: 120, resizable: true },
}

const isImageFile = (fileItem: FapSmbInternalFileItem | null) => {
  if (!fileItem) {
    return false
  }
  const fileType = String(fileItem.fileType || '').toLowerCase()
  const fileName = String(fileItem.fileName || '').toLowerCase()
  return fileType.startsWith('image/') || /\.(png|jpg|jpeg|gif|webp|bmp|svg)$/.test(fileName)
}

const isPdfFile = (fileItem: FapSmbInternalFileItem | null) => {
  if (!fileItem) {
    return false
  }
  const fileType = String(fileItem.fileType || '').toLowerCase()
  const fileName = String(fileItem.fileName || '').toLowerCase()
  return fileType === 'application/pdf' || fileName.endsWith('.pdf')
}

const isPreviewableFile = (fileItem: FapSmbInternalFileItem | null) => {
  return isImageFile(fileItem) || isPdfFile(fileItem)
}

const padDatePart = (value: number, length = 2) => String(value).padStart(length, '0')

const parseBackendDate = (dateText: string) => {
  const match = String(dateText || '').trim().match(
    /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?([+-]\d{2})(?::?(\d{2}))?$/,
  )
  if (!match) {
    return null
  }
  const offsetSign = match[8].startsWith('-') ? -1 : 1
  const offsetHour = Math.abs(Number(match[8]))
  const offsetMinute = Number(match[9] || 0)
  const offsetMs = offsetSign * ((offsetHour * 60 + offsetMinute) * 60 * 1000)
  const millisecond = Number(String(match[7] || '0').slice(0, 3).padEnd(3, '0'))
  return new Date(Date.UTC(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
    Number(match[4]),
    Number(match[5]),
    Number(match[6]),
    millisecond,
  ) - offsetMs)
}

const formatTimeZoneOffset = (timeZoneMinute: number) => {
  const normalizedTimeZoneMinute = Number(timeZoneMinute || 0)
  const signText = normalizedTimeZoneMinute >= 0 ? '+' : '-'
  const absMinute = Math.abs(normalizedTimeZoneMinute)
  const hourPart = Math.floor(absMinute / 60)
  const minutePart = absMinute % 60
  return `UTC${signText}${padDatePart(hourPart)}${padDatePart(minutePart)}`
}

const formatBackendDateWithTimeZone = (dateText: string, timeZoneMinute: number) => {
  const dateValue = parseBackendDate(dateText)
  if (!dateValue) {
    return dateText || '-'
  }
  const normalizedTimeZoneMinute = Number(timeZoneMinute || 0)
  const shiftedDate = new Date(dateValue.getTime() + normalizedTimeZoneMinute * 60 * 1000)
  return [
    `${shiftedDate.getUTCFullYear()}-${padDatePart(shiftedDate.getUTCMonth() + 1)}-${padDatePart(shiftedDate.getUTCDate())}`,
    `${padDatePart(shiftedDate.getUTCHours())}:${padDatePart(shiftedDate.getUTCMinutes())}:${padDatePart(shiftedDate.getUTCSeconds())}`,
    formatTimeZoneOffset(normalizedTimeZoneMinute),
  ].join(' ')
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
  const isFinishingRef = React.useRef(false)

  React.useEffect(() => {
    isFinishingRef.current = false
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
          if (!isEditing || isFinishingRef.current) {
            return
          }
          isFinishingRef.current = true
          onCommitEditing(String(event.currentTarget.textContent || '').trim())
        }}
        onKeyDown={(event) => {
          if (!isEditing) {
            return
          }
          if (event.key === 'Enter') {
            event.preventDefault()
            isFinishingRef.current = true
            onCommitEditing(String(event.currentTarget.textContent || '').trim())
            return
          }
          if (event.key === 'Escape') {
            event.preventDefault()
            isFinishingRef.current = true
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

const FapSmbInternalExplorePanel = observer(() => {
  const item = fapSmbInternalStore.selectedItem
  const [messageState, setMessageState] = useState({ status: 'idle', messageText: '' })
  const [contextMenuState, setContextMenuState] = useState<{
    position: null | { x: number, y: number }
    rowId: null | string
  }>({
    position: null,
    rowId: null,
  })
  const [filePreviewState, setFilePreviewState] = useState<{
    fileName: string
    fileUrl: string
    fileKind: 'image' | 'pdf'
  }>({
    fileName: '',
    fileUrl: '',
    fileKind: 'image',
  })

  useEffect(() => {
    if (item?.fileAccessPointId) {
      fapSmbInternalStore.requestLoadFiles(item.fileAccessPointId)
    }
  }, [item?.fileAccessPointId])

  useEffect(() => {
    return () => {
      if (filePreviewState.fileUrl) {
        URL.revokeObjectURL(filePreviewState.fileUrl)
      }
    }
  }, [filePreviewState.fileUrl])

  if (!item) {
    return <div className="panel-title">No FAP SMB internal selected</div>
  }

  const canWrite = fapSmbInternalStore.canWrite
  const editingFileId = fapSmbInternalStore.selectedEditingFileId
  const editingFileName = fapSmbInternalStore.selectedEditingFileName
  const renamingFileId = fapSmbInternalStore.selectedRenamingFileId
  const rows = fapSmbInternalStore.selectedFileItems.map((fileItem) => ({
    id: fileItem.fileId,
    data: {
      name: (
        <NameCell
          rowId={fileItem.fileId}
          name={editingFileId === fileItem.fileId ? (editingFileName || fileItem.fileName) : fileItem.fileName}
          isEditing={editingFileId === fileItem.fileId}
          isRenaming={renamingFileId === fileItem.fileId}
          isRowLocked={!canWrite || Boolean(renamingFileId)}
          onStartEditing={() => {
            fapSmbInternalStore.setSelectedFileId(item.fileAccessPointId, fileItem.fileId)
            fapSmbInternalStore.setEditingFile(item.fileAccessPointId, fileItem.fileId, fileItem.fileName)
          }}
          onCancelEditing={() => {
            fapSmbInternalStore.setEditingFile(item.fileAccessPointId, '', '')
          }}
          onCommitEditing={async (nextName: string) => {
            if (!nextName || nextName === fileItem.fileName) {
              fapSmbInternalStore.setEditingFile(item.fileAccessPointId, '', '')
              return
            }
            setMessageState({ status: 'loading', messageText: `renaming ${fileItem.fileName} to ${nextName}` })
            const result = await fapSmbInternalStore.requestRenameFileItem(fileItem, nextName)
            setMessageState({
              status: result?.isSuccess ? 'success' : 'error',
              messageText: result?.messageText || '',
            })
          }}
        />
      ),
      type: fileItem.fileType || '-',
      fileId: fileItem.fileId,
      size: String(fileItem.sizeBytes),
      created: formatBackendDateWithTimeZone(fileItem.createdAt, fileItem.createAtTimeZone),
    },
    rowClassName: renamingFileId === fileItem.fileId ? 'explore-row-renaming' : '',
  }))

  const runLoadPage = async (pageIndex: number) => {
    setMessageState({ status: 'loading', messageText: 'loading files' })
    const result = await fapSmbInternalStore.requestSetPageIndex(pageIndex)
    setMessageState({
      status: result?.isSuccess ? 'success' : 'error',
      messageText: result?.messageText || '',
    })
  }

  const runDownload = async () => {
    setMessageState({ status: 'loading', messageText: 'downloading selected file item(s)' })
    const result = await fapSmbInternalStore.requestDownloadSelectedFiles()
    setMessageState({
      status: result?.isSuccess ? 'success' : 'error',
      messageText: result?.messageText || '',
    })
  }

  const runDownloadOne = async (fileItem: FapSmbInternalFileItem | null) => {
    if (!fileItem) {
      return
    }
    setMessageState({ status: 'loading', messageText: `downloading ${fileItem.fileName}` })
    const result = await fapSmbInternalStore.requestDownloadFileItem(fileItem)
    setMessageState({
      status: result?.isSuccess ? 'success' : 'error',
      messageText: result?.messageText || '',
    })
  }

  const runPreviewFile = async (fileItem: FapSmbInternalFileItem | null) => {
    if (!fileItem || !isPreviewableFile(fileItem)) {
      setMessageState({ status: 'error', messageText: 'selected file is not previewable' })
      return
    }
    if (filePreviewState.fileUrl) {
      URL.revokeObjectURL(filePreviewState.fileUrl)
    }
    setMessageState({ status: 'loading', messageText: `loading preview ${fileItem.fileName}` })
    const result = await fapSmbInternalStore.requestFileBlob(fileItem)
    if (!result.isSuccess || !result.blob) {
      setMessageState({ status: 'error', messageText: result.messageText })
      return
    }
    const fileKind = isPdfFile(fileItem) ? 'pdf' : 'image'
    const previewBlob = fileKind === 'pdf' ? new Blob([result.blob], { type: 'application/pdf' }) : result.blob
    const fileUrl = URL.createObjectURL(previewBlob)
    setFilePreviewState({
      fileName: fileItem.fileName,
      fileUrl,
      fileKind,
    })
    setMessageState({ status: 'success', messageText: `preview loaded ${fileItem.fileName}` })
  }

  const closeFilePreview = () => {
    if (filePreviewState.fileUrl) {
      URL.revokeObjectURL(filePreviewState.fileUrl)
    }
    setFilePreviewState({
      fileName: '',
      fileUrl: '',
      fileKind: 'image',
    })
  }

  const getFileItemById = (fileId: string | null) => {
    return fapSmbInternalStore.selectedFileItems.find((fileItem) => fileItem.fileId === fileId) || null
  }

  const openContextMenu = (event: MouseEvent, rowId: string) => {
    event.preventDefault()
    event.stopPropagation()
    const normalizedRowId = String(rowId || '')
    if (!normalizedRowId) {
      return
    }
    if (!fapSmbInternalStore.selectedFileIds.includes(normalizedRowId)) {
      fapSmbInternalStore.setSelectedFileIds(item.fileAccessPointId, [normalizedRowId])
    }
    setContextMenuState({
      position: null,
      rowId: null,
    })
    requestAnimationFrame(() => {
      setContextMenuState({
        position: { x: event.clientX, y: event.clientY },
        rowId: normalizedRowId,
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

  return (
    <div className="panel-root">
      <div className="panel-title">
        SMB Internal Explore {item.name} [{getFapSmbInternalSourceLabel(item)}]
      </div>
      <div className={`frontend-message-bar status-${messageState.messageText ? messageState.status : 'empty'}`}>
        {messageState.status === 'loading' && messageState.messageText ? <SpinningCircle width={13} height={13} /> : null}
        <div className="frontend-message-content">
          <span className={messageState.messageText ? '' : 'frontend-message-empty'}>{messageState.messageText || '(NO MESSAGE)'}</span>
          <button
            type="button"
            className="frontend-message-dismiss-btn"
            onClick={() => setMessageState({ status: 'idle', messageText: '' })}
            disabled={messageState.status === 'loading' || !messageState.messageText}
          >
            Dismiss
          </button>
        </div>
      </div>
      <div className="panel-row">
        <button
          type="button"
          className="main-btn"
          disabled={fapSmbInternalStore.isFileListLoading}
          onClick={() => runLoadPage(fapSmbInternalStore.selectedPageIndex)}
        >
          reload
        </button>
        <button
          type="button"
          className="main-btn"
          disabled={fapSmbInternalStore.isFileListLoading || fapSmbInternalStore.selectedPageIndex <= 0}
          onClick={() => runLoadPage(fapSmbInternalStore.selectedPageIndex - 1)}
        >
          previous page
        </button>
        <button
          type="button"
          className="main-btn"
          disabled={fapSmbInternalStore.isFileListLoading || fapSmbInternalStore.selectedPageIndex >= fapSmbInternalStore.selectedPageCount - 1}
          onClick={() => runLoadPage(fapSmbInternalStore.selectedPageIndex + 1)}
        >
          next page
        </button>
        <button
          type="button"
          className="main-btn"
          disabled={fapSmbInternalStore.selectedFileItemList.length === 0}
          onClick={() => runDownload()}
        >
          download selected ({fapSmbInternalStore.selectedFileItemList.length})
        </button>
        <button
          type="button"
          className="main-btn"
          disabled={!isPreviewableFile(fapSmbInternalStore.selectedFileItem)}
          onClick={() => runPreviewFile(fapSmbInternalStore.selectedFileItem)}
        >
          preview
        </button>
      </div>
      <div className="kv-wrap">
        page {fapSmbInternalStore.selectedPageIndex + 1} / {fapSmbInternalStore.selectedPageCount}
        , total {fapSmbInternalStore.selectedTotalCount}
        , selected {fapSmbInternalStore.selectedFileItemList.length}
      </div>
      <div className="list-wrap explorer-table-wrap">
        <FolderView
          columns={FOLDER_COLUMNS}
          columnsOrder={FOLDER_COLUMNS_ORDER}
          columnsSizeInit={FOLDER_COLUMNS_SIZE}
          rows={rows}
          bodyHeight={360}
          showStatusBar={false}
          listOnly={true}
          selectionMode="multiple"
          rowsSelectedId={fapSmbInternalStore.selectedFileIds}
          onSelectedRowIdsChange={(rowIds: string[]) => {
            fapSmbInternalStore.setSelectedFileIds(item.fileAccessPointId, rowIds)
          }}
          onRowDoubleClick={(rowId: string) => {
            const fileItem = getFileItemById(String(rowId || ''))
            if (isPreviewableFile(fileItem)) {
              runPreviewFile(fileItem)
              return
            }
            runDownloadOne(fileItem)
          }}
          onRowContextMenu={(event: MouseEvent, rowId: string) => {
            openContextMenu(event, rowId)
          }}
          loading={fapSmbInternalStore.isFileListLoading}
          loadingMessage="loading files"
        />
      </div>
      {contextMenuState.position ? (
        <MenuComp
          data={{
            items: [
              {
                type: 'item',
                name: 'Download Selected',
                data: { action: 'download-selected' },
                disabled: fapSmbInternalStore.selectedFileItemList.length === 0,
              },
              {
                type: 'item',
                name: 'Download This File',
                data: { action: 'download-one' },
                disabled: !contextMenuState.rowId,
              },
              {
                type: 'item',
                name: 'Preview',
                data: { action: 'preview' },
                disabled: !isPreviewableFile(getFileItemById(contextMenuState.rowId)) || Boolean(renamingFileId),
              },
              {
                type: 'item',
                name: 'Rename',
                data: { action: 'rename' },
                disabled: !canWrite || !contextMenuState.rowId || Boolean(renamingFileId),
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
            const fileItem = getFileItemById(contextMenuState.rowId)
            if (menuItem?.data?.action === 'download-selected') {
              runDownload()
            }
            if (menuItem?.data?.action === 'download-one') {
              runDownloadOne(fileItem)
            }
            if (menuItem?.data?.action === 'preview') {
              runPreviewFile(fileItem)
            }
            if (menuItem?.data?.action === 'rename' && fileItem && canWrite) {
              fapSmbInternalStore.setSelectedFileId(item.fileAccessPointId, fileItem.fileId)
              fapSmbInternalStore.setEditingFile(item.fileAccessPointId, fileItem.fileId, fileItem.fileName)
            }
            closeContextMenu()
          }}
        />
      ) : null}
      {filePreviewState.fileUrl ? (
        <div className="file-preview-overlay">
          <div className={`file-preview-popup ${filePreviewState.fileKind === 'pdf' ? 'is-pdf' : 'is-image'}`}>
            <div className="file-preview-top-row">
              <div className="file-preview-title">{filePreviewState.fileName}</div>
              <button
                type="button"
                className="main-btn"
                onClick={closeFilePreview}
              >
                close
              </button>
            </div>
            <div className="file-preview-body">
              {filePreviewState.fileKind === 'pdf' ? (
                <iframe className="file-preview-pdf" src={filePreviewState.fileUrl} title={filePreviewState.fileName} />
              ) : (
                <img className="file-preview-img" src={filePreviewState.fileUrl} alt={filePreviewState.fileName} />
              )}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
})

export default FapSmbInternalExplorePanel
