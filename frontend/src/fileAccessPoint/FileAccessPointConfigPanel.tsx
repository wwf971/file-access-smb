import React, { useEffect, useState } from 'react'
import { observer } from 'mobx-react-lite'
import { KeyValues, MetadataKeyValues, SpinningCircle } from '@wwf971/react-comp-misc'
import { fileAccessPointStore } from '../store/fileAccessPointStore'

type MetadataRow = {
  id: string
  key: string
  value: string
}

const FileAccessPointConfigPanel = observer(() => {
  const item = fileAccessPointStore.selectedItem
  const [name, setName] = useState('')
  const [metadataRows, setMetadataRows] = useState<MetadataRow[]>([])
  const [selectedMetadataTag, setSelectedMetadataTag] = useState<string | null>(null)
  const [messageState, setMessageState] = useState({
    status: 'idle',
    messageText: '',
  })

  useEffect(() => {
    if (!item) {
      return
    }
    setName(item.name)
    const rowList = Object.entries(item.metadata || {}).map(([key, value], index) => ({
      id: `${key}_${index}`,
      key: String(key || ''),
      value: String(value ?? ''),
    }))
    setMetadataRows(rowList)
    setSelectedMetadataTag(null)
    setMessageState({
      status: 'idle',
      messageText: '',
    })
  }, [item?.fileAccessPointId])

  const isPanelLocked = fileAccessPointStore.isChecking || fileAccessPointStore.isSaving || fileAccessPointStore.isDeleting

  const selectedRowIndex = selectedMetadataTag
    ? metadataRows.findIndex((row) => row.id === selectedMetadataTag)
    : -1

  const buildMetadataObject = () => {
    const metadataObject: Record<string, string> = {}
    metadataRows.forEach((row) => {
      const key = String(row.key || '').trim()
      if (!key) {
        return
      }
      metadataObject[key] = String(row.value || '')
    })
    return metadataObject
  }

  const handleCheckConnection = async (isForceReconnect: boolean) => {
    if (!item) {
      return
    }
    setMessageState({
      status: 'loading',
      messageText: isForceReconnect ? 'Reconnecting SMB connection' : 'Checking SMB connection',
    })
    const result = await fileAccessPointStore.requestCheckConnection(isForceReconnect, 8000)
    setMessageState({
      status: result?.isSuccess ? 'success' : 'error',
      messageText: result?.messageText || '',
    })
  }

  if (!item) {
    return <div className="panel-title">No file access point selected</div>
  }

  return (
    <div className={`panel-root ${isPanelLocked ? 'panel-locked' : ''}`}>
      <div className="panel-title">
        SMB Config {item.name} [{item.sourceType}]
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
        <button
          type="button"
          className="main-btn"
          onClick={() => {
            handleCheckConnection(false)
          }}
          disabled={isPanelLocked}
        >
          check connection
        </button>
        <button
          type="button"
          className="main-btn"
          onClick={() => {
            handleCheckConnection(true)
          }}
          disabled={isPanelLocked}
        >
          force reconnect
        </button>
        <button
          type="button"
          className="main-btn"
          onClick={() => {
            fileAccessPointStore.requestLoadList()
          }}
          disabled={isPanelLocked}
        >
          reload list
        </button>
      </div>
      <div className="kv-wrap">
        <KeyValues
          data={[
            { key: 'connection', value: item.connection.isConnected ? 'connected' : 'disconnected' },
            { key: 'lastError', value: item.connection.lastErrorText || '-' },
            { key: 'metadataValid', value: item.isMetadataValid ? 'true' : 'false' },
            { key: 'validationErrors', value: item.validationErrorTextList.join(' | ') || '-' },
            { key: 'deletable', value: item.isDeletable ? 'true' : 'false' },
          ]}
          isEditable={false}
        />
      </div>
      <div className="editor-grid fap-name-row">
        <input
          className="text-input"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="name"
          disabled={isPanelLocked || !item.isDeletable}
        />
      </div>
      <MetadataKeyValues
        data={{
          titleText: 'Metadata',
          rows: metadataRows,
          selectedRowId: selectedMetadataTag,
          messageState,
        }}
        config={{
          isLocked: isPanelLocked,
          isEditable: item.isDeletable,
        }}
        onEvent={async (eventType, eventData) => {
          if (eventType === 'selectedRowIdChange') {
            if (eventData.selectedRowId === null) {
              return
            }
            setSelectedMetadataTag(eventData.selectedRowId)
            return
          }
          if (eventType === 'cellUpdate') {
            const { rowId, field, nextValue } = eventData
            setMetadataRows((prev) => prev.map((row) => {
              if (row.id !== rowId) {
                return row
              }
              if (field === 'key') {
                return { ...row, key: nextValue }
              }
              return { ...row, value: nextValue }
            }))
            return { code: 0 }
          }
          if (eventType === 'addAtEnd') {
            const nextId = `meta_${Date.now()}`
            setMetadataRows((prev) => [...prev, { id: nextId, key: 'new_key', value: '' }])
            setSelectedMetadataTag(nextId)
            return
          }
          if (eventType === 'addAbove') {
            if (!selectedMetadataTag) {
              return
            }
            const nextId = `meta_${Date.now()}`
            setMetadataRows((prev) => {
              const selectedIndex = prev.findIndex((row) => row.id === selectedMetadataTag)
              if (selectedIndex < 0) {
                return prev
              }
              const nextRows = [...prev]
              nextRows.splice(selectedIndex, 0, { id: nextId, key: 'new_key', value: '' })
              return nextRows
            })
            setSelectedMetadataTag(nextId)
            return
          }
          if (eventType === 'addBelow') {
            if (!selectedMetadataTag) {
              return
            }
            const nextId = `meta_${Date.now()}`
            setMetadataRows((prev) => {
              const selectedIndex = prev.findIndex((row) => row.id === selectedMetadataTag)
              if (selectedIndex < 0) {
                return prev
              }
              const nextRows = [...prev]
              nextRows.splice(selectedIndex + 1, 0, { id: nextId, key: 'new_key', value: '' })
              return nextRows
            })
            setSelectedMetadataTag(nextId)
            return
          }
          if (eventType === 'moveUp') {
            setMetadataRows((prev) => {
              if (selectedRowIndex <= 0) {
                return prev
              }
              const nextRows = [...prev]
              const [row] = nextRows.splice(selectedRowIndex, 1)
              nextRows.splice(selectedRowIndex - 1, 0, row)
              return nextRows
            })
            return
          }
          if (eventType === 'moveDown') {
            setMetadataRows((prev) => {
              if (selectedRowIndex < 0 || selectedRowIndex >= prev.length - 1) {
                return prev
              }
              const nextRows = [...prev]
              const [row] = nextRows.splice(selectedRowIndex, 1)
              nextRows.splice(selectedRowIndex + 1, 0, row)
              return nextRows
            })
            return
          }
          if (eventType === 'delete') {
            if (!selectedMetadataTag) {
              return
            }
            setMetadataRows((prev) => prev.filter((row) => row.id !== selectedMetadataTag))
            setSelectedMetadataTag(null)
            return
          }
          if (eventType === 'messageStateChange') {
            setMessageState(eventData.messageState)
            return
          }
          if (eventType === 'messageDismiss') {
            setMessageState({
              status: 'idle',
              messageText: '',
            })
          }
        }}
      />
      <div className="panel-row">
        <button
          type="button"
          className="main-btn"
          disabled={!item.isDeletable || isPanelLocked}
          onClick={async () => {
            const result = await fileAccessPointStore.requestUpdateCurrent(name, buildMetadataObject())
            setMessageState({
              status: result?.isSuccess ? 'success' : 'error',
              messageText: result?.messageText || '',
            })
          }}
        >
          save metadata
        </button>
        <button
          type="button"
          className="main-btn danger-btn"
          disabled={!item.isDeletable || isPanelLocked}
          onClick={async () => {
            const result = await fileAccessPointStore.requestDeleteCurrent()
            setMessageState({
              status: result?.isSuccess ? 'success' : 'error',
              messageText: result?.messageText || '',
            })
          }}
        >
          delete
        </button>
      </div>
    </div>
  )
})

export default FileAccessPointConfigPanel
