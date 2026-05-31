import { useEffect, useState } from 'react'
import { observer } from 'mobx-react-lite'
import { FolderView, SpinningCircle } from '@wwf971/react-comp-misc'
import { fileAccessPointSmbInternalStore } from '../store/fileAccessPointSmbInternalStore'

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

const FileAccessPointSmbInternalExplorePanel = observer(() => {
  const item = fileAccessPointSmbInternalStore.selectedItem
  const [messageState, setMessageState] = useState({ status: 'idle', messageText: '' })

  useEffect(() => {
    if (item?.fileAccessPointId) {
      fileAccessPointSmbInternalStore.requestLoadFiles(item.fileAccessPointId)
    }
  }, [item?.fileAccessPointId])

  if (!item) {
    return <div className="panel-title">No smb/internal file access point selected</div>
  }

  const rows = fileAccessPointSmbInternalStore.selectedFileItems.map((fileItem) => ({
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
    const result = await fileAccessPointSmbInternalStore.requestSetPageIndex(pageIndex)
    setMessageState({
      status: result?.isSuccess ? 'success' : 'error',
      messageText: result?.messageText || '',
    })
  }

  const runDownload = async () => {
    setMessageState({ status: 'loading', messageText: 'downloading file' })
    const result = await fileAccessPointSmbInternalStore.requestDownloadSelectedFile()
    setMessageState({
      status: result?.isSuccess ? 'success' : 'error',
      messageText: result?.messageText || '',
    })
  }

  return (
    <div className="panel-root">
      <div className="panel-title">
        SMB Internal Explore {item.name} [{item.sourceType}]
      </div>
      {messageState.messageText ? (
        <div className={`frontend-message-bar status-${messageState.status}`}>
          {messageState.status === 'loading' ? <SpinningCircle width={13} height={13} /> : null}
          <div className="frontend-message-content">
            <span>{messageState.messageText}</span>
            <button
              type="button"
              className="frontend-message-dismiss-btn"
              onClick={() => setMessageState({ status: 'idle', messageText: '' })}
              disabled={messageState.status === 'loading'}
            >
              Dismiss
            </button>
          </div>
        </div>
      ) : null}
      <div className="panel-row">
        <button
          type="button"
          className="main-btn"
          disabled={fileAccessPointSmbInternalStore.isFileListLoading}
          onClick={() => runLoadPage(fileAccessPointSmbInternalStore.selectedPageIndex)}
        >
          reload
        </button>
        <button
          type="button"
          className="main-btn"
          disabled={fileAccessPointSmbInternalStore.isFileListLoading || fileAccessPointSmbInternalStore.selectedPageIndex <= 0}
          onClick={() => runLoadPage(fileAccessPointSmbInternalStore.selectedPageIndex - 1)}
        >
          previous page
        </button>
        <button
          type="button"
          className="main-btn"
          disabled={fileAccessPointSmbInternalStore.isFileListLoading || fileAccessPointSmbInternalStore.selectedPageIndex >= fileAccessPointSmbInternalStore.selectedPageCount - 1}
          onClick={() => runLoadPage(fileAccessPointSmbInternalStore.selectedPageIndex + 1)}
        >
          next page
        </button>
        <button
          type="button"
          className="main-btn"
          disabled={!fileAccessPointSmbInternalStore.selectedFileItem}
          onClick={() => runDownload()}
        >
          download selected
        </button>
      </div>
      <div className="kv-wrap">
        page {fileAccessPointSmbInternalStore.selectedPageIndex + 1} / {fileAccessPointSmbInternalStore.selectedPageCount}
        , total {fileAccessPointSmbInternalStore.selectedTotalCount}
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
          selectionMode="single"
          selectedRowId={fileAccessPointSmbInternalStore.selectedFileId || null}
          onSelectedRowIdsChange={(rowIds: string[]) => {
            fileAccessPointSmbInternalStore.setSelectedFileId(item.fileAccessPointId, rowIds[0] || '')
          }}
          onRowDoubleClick={() => {
            runDownload()
          }}
          loading={fileAccessPointSmbInternalStore.isFileListLoading}
          loadingMessage="loading files"
        />
      </div>
    </div>
  )
})

export default FileAccessPointSmbInternalExplorePanel
