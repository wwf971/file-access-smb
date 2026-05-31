import React, { useCallback, useEffect, useRef, useState } from 'react'
import { observer } from 'mobx-react-lite'
import { EditIcon, FolderView, InfoIconWithTooltip, SpinningCircle } from '@wwf971/react-comp-misc'
import { fapSmbExternalStore } from '../store/fapSmbExternalStore'
import type { UploadFileItem } from '../store/fapSmbExternalStore'

const UPLOAD_COLUMNS = {
  fileName: { data: 'fileName', align: 'left' },
  uploadName: { data: 'uploadName', align: 'left' },
  status: { data: 'status', align: 'left' },
}

const UPLOAD_COLUMNS_ORDER = ['fileName', 'uploadName', 'status']

const UPLOAD_COLUMNS_SIZE = {
  fileName: { width: 210, minWidth: 140, resizable: true },
  uploadName: { width: 230, minWidth: 150, resizable: true },
  status: { width: 220, minWidth: 180, resizable: true },
}

const UploadNameCell = observer(({ item }: { item: UploadFileItem }) => {
  const editRef = React.useRef<HTMLDivElement | null>(null)
  const containerRef = React.useRef<HTMLDivElement | null>(null)
  const iconMeasureRef = React.useRef<HTMLSpanElement | null>(null)
  const originalValueRef = React.useRef('')
  const [isEditing, setIsEditing] = useState(false)
  const [isIconPinned, setIsIconPinned] = useState(false)
  const isLocked = item.status === 'uploading' || item.status === 'success'

  const measureIconPlacement = useCallback(() => {
    const container = containerRef.current
    const iconEl = iconMeasureRef.current
    const contentEl = editRef.current
    if (!container || !iconEl || !contentEl) {
      setIsIconPinned(false)
      return
    }
    const gap = 4
    const neededWidth = contentEl.scrollWidth + gap + iconEl.offsetWidth
    setIsIconPinned(neededWidth > container.clientWidth + 0.5)
  }, [])

  useEffect(() => {
    measureIconPlacement()
    const container = containerRef.current
    if (!container) {
      return undefined
    }
    const observer = new ResizeObserver(() => {
      measureIconPlacement()
    })
    observer.observe(container)
    return () => {
      observer.disconnect()
    }
  }, [measureIconPlacement, item.uploadName, isEditing, isLocked])

  useEffect(() => {
    if (!isEditing && editRef.current && editRef.current.textContent !== item.uploadName) {
      editRef.current.textContent = item.uploadName
    }
  }, [item.uploadName, isEditing])

  useEffect(() => {
    if (!isEditing || !editRef.current) {
      return
    }
    editRef.current.focus()
    const range = document.createRange()
    const selection = window.getSelection()
    range.selectNodeContents(editRef.current)
    selection?.removeAllRanges()
    selection?.addRange(range)
  }, [isEditing])

  const startEditing = () => {
    if (isLocked) {
      return
    }
    originalValueRef.current = item.uploadName
    setIsEditing(true)
  }

  const commitEditing = () => {
    if (!editRef.current) {
      setIsEditing(false)
      return
    }
    fapSmbExternalStore.setUploadItemName(item.itemId, String(editRef.current.textContent || '').trim())
    setIsEditing(false)
  }

  const cancelEditing = () => {
    if (editRef.current) {
      editRef.current.textContent = originalValueRef.current
    }
    setIsEditing(false)
  }

  const renderEditButton = (isActive: boolean) => (
    <button
      type="button"
      className={`upload-file-edit-btn ${isActive ? '' : 'is-inactive'}`}
      title={isLocked ? 'editing is locked' : 'edit upload file name'}
      disabled={!isActive}
      onClick={(event) => {
        event.stopPropagation()
        startEditing()
      }}
    >
      <EditIcon width={13} height={13} />
    </button>
  )

  return (
    <div
      ref={containerRef}
      className={`upload-file-name-wrap ${isLocked ? 'is-locked' : ''} ${isEditing ? 'is-editing' : ''} ${isIconPinned ? 'is-icon-pinned' : ''}`}
      title={item.uploadName}
    >
      <div className="upload-file-name-content-row">
        <div
          ref={editRef}
          className={`upload-file-name-edit ${isEditing ? 'is-editing' : ''}`}
          contentEditable={isEditing && !isLocked}
          suppressContentEditableWarning={true}
          onBlur={() => {
            if (isEditing) {
              commitEditing()
            }
          }}
          onKeyDown={(event) => {
            if (!isEditing) {
              return
            }
            if (event.key === 'Enter') {
              event.preventDefault()
              commitEditing()
              return
            }
            if (event.key === 'Escape') {
              event.preventDefault()
              cancelEditing()
            }
          }}
        >
          {item.uploadName}
        </div>
        {!isEditing ? (
          <span ref={iconMeasureRef} className={`upload-file-edit-icon-at-content ${isIconPinned ? 'is-inactive' : ''}`}>
            {renderEditButton(!isIconPinned && !isLocked)}
          </span>
        ) : null}
      </div>
      {!isEditing ? (
        <span className={`upload-file-edit-icon-at-cell-end ${isIconPinned || isLocked ? '' : 'is-inactive'}`}>
          {renderEditButton((isIconPinned || isLocked) && !isLocked)}
        </span>
      ) : null}
    </div>
  )
})

const UploadStatusCell = observer(({ item }: { item: UploadFileItem }) => {
  if (item.status === 'uploading') {
    return (
      <div className="upload-file-status-cell status-uploading">
        <SpinningCircle width={12} height={12} />
        <span>
          {item.isBackendProcessing ? 'uploading(backend processing)' : `uploading(${item.progressPercent}%)`}
        </span>
      </div>
    )
  }
  if (item.status === 'success') {
    return <div className="upload-file-status-cell status-success">upload success</div>
  }
  if (item.status === 'error') {
    return (
      <div className="upload-file-status-cell status-error">
        <span>upload error</span>
        <span className="upload-file-status-error-mark">!</span>
        <InfoIconWithTooltip tooltipText={item.errorText || 'upload failed'} width={13} height={13} color="#9e2f2f" />
      </div>
    )
  }
  return <div className="upload-file-status-cell">to be uploaded</div>
})

const FapSmbExternalUploadFile = observer(() => {
  const task = fapSmbExternalStore.currentUploadTask
  const fileInputRef = useRef<HTMLInputElement | null>(null)

  if (!task) {
    return null
  }

  const selectedSet = new Set(task.selectedRowIds)
  const isDeleteDisabled = task.items.every((item) => !selectedSet.has(item.itemId) || item.status === 'uploading')
  const isUploadSelectedDisabled = task.isUploading || task.items.every((item) => (
    !selectedSet.has(item.itemId) || item.status === 'success' || item.status === 'uploading'
  ))
  const isUploadAllDisabled = task.isUploading || task.items.every((item) => item.status === 'success' || item.status === 'uploading')
  const rows = task.items.map((item) => {
    const isLocked = item.status === 'uploading'
    return {
      id: item.itemId,
      data: {
        fileName: (
          <div className={`upload-file-cell ${isLocked ? 'is-locked' : ''}`} title={item.fileName}>
            {item.fileName}
          </div>
        ),
        uploadName: <UploadNameCell item={item} />,
        status: <UploadStatusCell item={item} />,
      },
    }
  })

  const addFiles = (files: FileList | File[]) => {
    fapSmbExternalStore.addUploadFiles(files)
  }

  return (
    <div className="upload-file-overlay">
      <div className="upload-file-popup">
        <div className="upload-file-top-row">
          <div className="upload-file-title-wrap">
            <div className="upload-file-title">upload files</div>
            <div className="upload-file-subtitle">{task.folderPath}</div>
          </div>
          <button
            type="button"
            className="upload-file-close-btn"
            disabled={task.isUploading}
            onClick={() => {
              fapSmbExternalStore.closeUploadPopup()
            }}
          >
            x
          </button>
        </div>
        <div
          className={`upload-file-drop-area ${task.isUploading ? 'is-locked' : ''}`}
          tabIndex={0}
          onDragOver={(event) => {
            event.preventDefault()
          }}
          onDrop={(event) => {
            event.preventDefault()
            if (task.isUploading) {
              return
            }
            addFiles(event.dataTransfer.files)
          }}
          onPaste={(event) => {
            if (task.isUploading) {
              return
            }
            addFiles(event.clipboardData.files)
          }}
        >
          <div className="upload-file-drop-title">drop or paste files here</div>
          <div className="upload-file-drop-subtitle">click the button to choose files with the browser file picker</div>
          <button
            type="button"
            className="main-btn"
            disabled={task.isUploading}
            onClick={() => {
              fileInputRef.current?.click()
            }}
          >
            choose files
          </button>
          <input
            ref={fileInputRef}
            className="upload-file-hidden-input"
            type="file"
            multiple={true}
            onChange={(event) => {
              if (event.currentTarget.files) {
                addFiles(event.currentTarget.files)
              }
              event.currentTarget.value = ''
            }}
          />
        </div>
        <div className="upload-file-action-row">
          <button
            type="button"
            className="main-btn danger-btn"
            disabled={isDeleteDisabled}
            onClick={() => {
              fapSmbExternalStore.deleteSelectedUploadItems()
            }}
          >
            delete selected
          </button>
          <button
            type="button"
            className="main-btn"
            disabled={isUploadSelectedDisabled}
            onClick={() => {
              fapSmbExternalStore.requestUploadItems('selected')
            }}
          >
            upload selected
          </button>
          <button
            type="button"
            className="main-btn"
            disabled={isUploadAllDisabled}
            onClick={() => {
              fapSmbExternalStore.requestUploadItems('all')
            }}
          >
            upload all
          </button>
        </div>
        <div className="upload-file-table-wrap">
          <FolderView
            columns={UPLOAD_COLUMNS}
            columnsOrder={UPLOAD_COLUMNS_ORDER}
            columnsSizeInit={UPLOAD_COLUMNS_SIZE}
            rows={rows}
            bodyHeight={220}
            showStatusBar={true}
            listOnly={true}
            selectionMode="multiple"
            selectedRowIds={task.selectedRowIds}
            onSelectedRowIdsChange={(rowIds: string[]) => {
              fapSmbExternalStore.setUploadSelectedRowIds(rowIds)
            }}
            loading={false}
            showStatusItemCount={true}
          />
        </div>
        {task.messageText || task.errorText ? (
          <div className={`upload-file-message ${task.errorText ? 'status-error' : 'status-info'}`}>
            {task.isUploading ? <SpinningCircle width={12} height={12} /> : null}
            <span>{task.errorText || task.messageText}</span>
          </div>
        ) : null}
        <div className="upload-file-bottom-row">
          <button
            type="button"
            className="main-btn"
            disabled={task.isUploading}
            onClick={() => {
              fapSmbExternalStore.closeUploadPopup()
            }}
          >
            cancel
          </button>
        </div>
      </div>
    </div>
  )
})

export default FapSmbExternalUploadFile
