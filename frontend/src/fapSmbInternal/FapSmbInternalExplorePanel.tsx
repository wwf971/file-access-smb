import { useEffect, useState } from 'react'
import { observer } from 'mobx-react-lite'
import { FolderView, MenuComp, SpinningCircle } from '@wwf971/react-comp-misc'
import { fapSmbInternalStore, getFapSmbInternalSourceLabel, type FapSmbInternalFileItem } from '../store/fapSmbInternalStore'

const FOLDER_COLUMNS = {
  name: { data: 'name', align: 'left' },
  type: { data: 'type', align: 'left' },
  size: { data: 'size', align: 'left' },
  created: { data: 'created', align: 'left' },
}

const FOLDER_COLUMNS_ORDER = ['name', 'type', 'size', 'created']
const FOLDER_COLUMNS_SIZE = {
  name: { width: 260, minWidth: 140, resizable: true },
  type: { width: 120, minWidth: 80, resizable: true },
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
  const [imagePreviewState, setImagePreviewState] = useState<{
    fileName: string
    imageUrl: string
  }>({
    fileName: '',
    imageUrl: '',
  })

  useEffect(() => {
    if (item?.fileAccessPointId) {
      fapSmbInternalStore.requestLoadFiles(item.fileAccessPointId)
    }
  }, [item?.fileAccessPointId])

  useEffect(() => {
    return () => {
      if (imagePreviewState.imageUrl) {
        URL.revokeObjectURL(imagePreviewState.imageUrl)
      }
    }
  }, [imagePreviewState.imageUrl])

  if (!item) {
    return <div className="panel-title">No FAP SMB internal selected</div>
  }

  const rows = fapSmbInternalStore.selectedFileItems.map((fileItem) => ({
    id: fileItem.fileId,
    data: {
      name: fileItem.fileName,
      type: fileItem.fileType || '-',
      size: String(fileItem.sizeBytes),
      created: fileItem.createdAt || '-',
    },
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

  const runPreviewImage = async (fileItem: FapSmbInternalFileItem | null) => {
    if (!fileItem || !isImageFile(fileItem)) {
      setMessageState({ status: 'error', messageText: 'selected file is not an image' })
      return
    }
    if (imagePreviewState.imageUrl) {
      URL.revokeObjectURL(imagePreviewState.imageUrl)
    }
    setMessageState({ status: 'loading', messageText: `loading preview ${fileItem.fileName}` })
    const result = await fapSmbInternalStore.requestFileBlob(fileItem)
    if (!result.isSuccess || !result.blob) {
      setMessageState({ status: 'error', messageText: result.messageText })
      return
    }
    const imageUrl = URL.createObjectURL(result.blob)
    setImagePreviewState({
      fileName: fileItem.fileName,
      imageUrl,
    })
    setMessageState({ status: 'success', messageText: `preview loaded ${fileItem.fileName}` })
  }

  const closeImagePreview = () => {
    if (imagePreviewState.imageUrl) {
      URL.revokeObjectURL(imagePreviewState.imageUrl)
    }
    setImagePreviewState({
      fileName: '',
      imageUrl: '',
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
          disabled={!isImageFile(fapSmbInternalStore.selectedFileItem)}
          onClick={() => runPreviewImage(fapSmbInternalStore.selectedFileItem)}
        >
          preview image
        </button>
      </div>
      <div className="kv-wrap">
        page {fapSmbInternalStore.selectedPageIndex + 1} / {fapSmbInternalStore.selectedPageCount}
        , total {fapSmbInternalStore.selectedTotalCount}
        , selected {fapSmbInternalStore.selectedFileItemList.length}
      </div>
      <div className="list-wrap">
        <FolderView
          columns={FOLDER_COLUMNS}
          columnsOrder={FOLDER_COLUMNS_ORDER}
          columnsSizeInit={FOLDER_COLUMNS_SIZE}
          rows={rows}
          bodyHeight={360}
          showStatusBar={false}
          listOnly={true}
          selectionMode="multiple"
          selectedRowIds={fapSmbInternalStore.selectedFileIds}
          onSelectedRowIdsChange={(rowIds: string[]) => {
            fapSmbInternalStore.setSelectedFileIds(item.fileAccessPointId, rowIds)
          }}
          onRowDoubleClick={(rowId: string) => {
            const fileItem = getFileItemById(String(rowId || ''))
            if (isImageFile(fileItem)) {
              runPreviewImage(fileItem)
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
                name: 'Preview Image',
                data: { action: 'preview-image' },
                disabled: !isImageFile(getFileItemById(contextMenuState.rowId)),
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
            if (menuItem?.data?.action === 'preview-image') {
              runPreviewImage(fileItem)
            }
            closeContextMenu()
          }}
        />
      ) : null}
      {imagePreviewState.imageUrl ? (
        <div className="image-preview-overlay">
          <div className="image-preview-popup">
            <div className="image-preview-top-row">
              <div className="image-preview-title">{imagePreviewState.fileName}</div>
              <button
                type="button"
                className="main-btn"
                onClick={closeImagePreview}
              >
                close
              </button>
            </div>
            <div className="image-preview-body">
              <img className="image-preview-img" src={imagePreviewState.imageUrl} alt={imagePreviewState.fileName} />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
})

export default FapSmbInternalExplorePanel
