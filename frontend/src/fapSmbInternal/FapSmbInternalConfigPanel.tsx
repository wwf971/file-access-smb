import { useEffect, useState } from 'react'
import { observer } from 'mobx-react-lite'
import { KeyValues, MetadataKeyValues, SpinningCircle } from '@wwf971/react-comp-misc'
import { fapSmbInternalStore, getFapSmbInternalSourceLabel } from '../store/fapSmbInternalStore'

type MetadataRow = {
  id: string
  key: string
  value: string
}

const FapSmbInternalConfigPanel = observer(() => {
  const item = fapSmbInternalStore.selectedItem
  const [name, setName] = useState('')
  const [pathRoot, setPathRoot] = useState('/')
  const [fileAccessPointSmbExternalMode, setFileAccessPointSmbExternalMode] = useState<'id' | 'name'>('id')
  const [fileAccessPointSmbExternalValue, setFileAccessPointSmbExternalValue] = useState('')
  const [metadataRows, setMetadataRows] = useState<MetadataRow[]>([])
  const [selectedMetadataTag, setSelectedMetadataTag] = useState<string | null>(null)
  const [messageState, setMessageState] = useState({ status: 'idle', messageText: '' })

  useEffect(() => {
    if (!item) {
      return
    }
    setName(item.name)
    setPathRoot(item.pathRoot || '/')
    if (item.fileAccessPointSmbExternalInfo?.name) {
      setFileAccessPointSmbExternalMode('name')
      setFileAccessPointSmbExternalValue(String(item.fileAccessPointSmbExternalInfo.name || ''))
    } else {
      setFileAccessPointSmbExternalMode('id')
      setFileAccessPointSmbExternalValue(String(item.fileAccessPointSmbExternalInfo?.id || ''))
    }
    setMetadataRows(Object.entries(item.metadata || {}).map(([key, value], index) => ({
      id: `${key}_${index}`,
      key: String(key || ''),
      value: typeof value === 'object' ? JSON.stringify(value) : String(value ?? ''),
    })))
    setSelectedMetadataTag(null)
    setMessageState({ status: 'idle', messageText: '' })
  }, [item?.fileAccessPointId])

  if (!item) {
    return <div className="panel-title">No FAP SMB internal selected</div>
  }

  const isPanelLocked = fapSmbInternalStore.isSaving || fapSmbInternalStore.isDeleting
  const canWrite = fapSmbInternalStore.canWrite
  const isEditable = item.isDeletable && canWrite
  const selectedRowIndex = selectedMetadataTag ? metadataRows.findIndex((row) => row.id === selectedMetadataTag) : -1

  const buildMetadataObject = () => {
    const metadataObject: Record<string, string> = {}
    metadataRows.forEach((row) => {
      const key = String(row.key || '').trim()
      if (key) {
        metadataObject[key] = String(row.value || '')
      }
    })
    return metadataObject
  }

  const buildFileAccessPointSmbExternalInfo = () => {
    const value = String(fileAccessPointSmbExternalValue || '').trim()
    return fileAccessPointSmbExternalMode === 'name' ? { name: value } : { id: value }
  }

  return (
    <div className={`panel-root ${isPanelLocked ? 'panel-locked' : ''}`}>
      <div className="panel-title">
        SMB Internal Config {item.name} [{getFapSmbInternalSourceLabel(item)}]
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
      <div className="kv-wrap">
        <KeyValues
          data={[
            { key: 'fileAccessPointId', value: item.fileAccessPointId },
            { key: 'fileTableName', value: item.fileTableName || '-' },
            { key: 'smbExternalInfo', value: JSON.stringify(item.fileAccessPointSmbExternalInfo || {}) },
            { key: 'deletable', value: item.isDeletable ? 'true' : 'false' },
          ]}
          isEditable={false}
        />
      </div>
      <div className="editor-grid">
        <input
          className="text-input"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="name"
          disabled={isPanelLocked || !isEditable}
        />
        <input
          className="text-input"
          value={pathRoot}
          onChange={(event) => setPathRoot(event.target.value)}
          placeholder="pathRoot"
          disabled={isPanelLocked || !isEditable}
        />
        <div className="panel-row">
          <button
            type="button"
            className={`mini-btn ${fileAccessPointSmbExternalMode === 'id' ? 'mode-btn-active' : ''}`}
            disabled={isPanelLocked || !isEditable}
            onClick={() => setFileAccessPointSmbExternalMode('id')}
          >
            smb/external id
          </button>
          <button
            type="button"
            className={`mini-btn ${fileAccessPointSmbExternalMode === 'name' ? 'mode-btn-active' : ''}`}
            disabled={isPanelLocked || !isEditable}
            onClick={() => setFileAccessPointSmbExternalMode('name')}
          >
            smb/external name
          </button>
        </div>
        <input
          className="text-input"
          value={fileAccessPointSmbExternalValue}
          onChange={(event) => setFileAccessPointSmbExternalValue(event.target.value)}
          placeholder={fileAccessPointSmbExternalMode === 'name' ? 'case-sensitive name' : 'id'}
          disabled={isPanelLocked || !isEditable}
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
          isEditable,
        }}
        onEvent={async (eventType, eventData) => {
          if (eventType === 'selectedRowIdChange') {
            if (eventData.selectedRowId !== null) {
              setSelectedMetadataTag(eventData.selectedRowId)
            }
            return
          }
          if (eventType === 'cellUpdate') {
            const { rowId, field, nextValue } = eventData
            setMetadataRows((prev) => prev.map((row) => {
              if (row.id !== rowId) return row
              return field === 'key' ? { ...row, key: nextValue } : { ...row, value: nextValue }
            }))
            return { code: 0 }
          }
          if (eventType === 'addAtEnd') {
            const nextId = `meta_${Date.now()}`
            setMetadataRows((prev) => [...prev, { id: nextId, key: 'new_key', value: '' }])
            setSelectedMetadataTag(nextId)
            return
          }
          if (eventType === 'moveUp') {
            setMetadataRows((prev) => {
              if (selectedRowIndex <= 0) return prev
              const nextRows = [...prev]
              const [row] = nextRows.splice(selectedRowIndex, 1)
              nextRows.splice(selectedRowIndex - 1, 0, row)
              return nextRows
            })
            return
          }
          if (eventType === 'moveDown') {
            setMetadataRows((prev) => {
              if (selectedRowIndex < 0 || selectedRowIndex >= prev.length - 1) return prev
              const nextRows = [...prev]
              const [row] = nextRows.splice(selectedRowIndex, 1)
              nextRows.splice(selectedRowIndex + 1, 0, row)
              return nextRows
            })
            return
          }
          if (eventType === 'delete') {
            if (selectedMetadataTag) {
              setMetadataRows((prev) => prev.filter((row) => row.id !== selectedMetadataTag))
              setSelectedMetadataTag(null)
            }
            return
          }
          if (eventType === 'messageStateChange') {
            setMessageState(eventData.messageState)
            return
          }
          if (eventType === 'messageDismiss') {
            setMessageState({ status: 'idle', messageText: '' })
          }
        }}
      />
      <div className="panel-row">
        <button
          type="button"
          className="main-btn"
          disabled={!isEditable || isPanelLocked}
          onClick={async () => {
            const result = await fapSmbInternalStore.requestUpdateCurrent(
              name,
              pathRoot,
              buildFileAccessPointSmbExternalInfo(),
              buildMetadataObject(),
            )
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
          disabled={!isEditable || isPanelLocked}
          onClick={async () => {
            const result = await fapSmbInternalStore.requestDeleteCurrent()
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

export default FapSmbInternalConfigPanel
