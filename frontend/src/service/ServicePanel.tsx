import React from 'react'
import { observer } from 'mobx-react-lite'
import { KeyValues } from '@wwf971/react-comp-misc'
import { serviceStore } from '../store/serviceStore'

function safeParseObject(text: string) {
  try {
    const parsed = JSON.parse(text || '{}')
    return typeof parsed === 'object' && parsed !== null ? (parsed as Record<string, string>) : {}
  } catch (_error) {
    return {}
  }
}

type ServicePanelProps = {
  mode: 'metadata' | 'basic-info' | 'database'
}

const ServicePanel = observer(({ mode }: ServicePanelProps) => {
  const databaseData = safeParseObject(serviceStore.databaseText)
  const pingData = safeParseObject(serviceStore.pingText)
  const titleText = mode === 'database' ? 'Service Database' : mode === 'basic-info' ? 'Service Basic Info' : 'Service Metadata'
  const panelData = mode === 'database'
    ? [
        { key: 'databaseKey', value: String(databaseData.databaseKey || '') },
        { key: 'databaseName', value: String(databaseData.databaseName || '') },
        { key: 'databaseHost', value: String(databaseData.host || '') },
        { key: 'databasePort', value: String(databaseData.port || '') },
        { key: 'databaseUser', value: String(databaseData.username || '') },
      ]
    : mode === 'basic-info'
      ? [
          { key: 'service', value: String(pingData.service || '') },
          { key: 'status', value: String(pingData.status || '') },
          { key: 'databaseBootstrapOk', value: String(pingData.isDatabaseBootstrapOk || '') },
          { key: 'databaseBootstrapErrorText', value: String(pingData.databaseBootstrapErrorText || '') },
        ]
      : [
          { key: 'service', value: String(pingData.service || '') },
          { key: 'status', value: String(pingData.status || '') },
          { key: 'databaseKey', value: String(databaseData.databaseKey || '') },
          { key: 'databaseName', value: String(databaseData.databaseName || '') },
        ]
  return (
    <div className="panel-root">
      <div className="panel-title">{titleText}</div>
      <div className="panel-row">
        <button
          type="button"
          className="main-btn"
          onClick={() => {
            serviceStore.requestPing()
            serviceStore.requestDatabaseInfo()
          }}
        >
          refresh status
        </button>
      </div>
      <div className="kv-wrap">
        <KeyValues
          data={panelData}
          isEditable={false}
        />
      </div>
    </div>
  )
})

export default ServicePanel
