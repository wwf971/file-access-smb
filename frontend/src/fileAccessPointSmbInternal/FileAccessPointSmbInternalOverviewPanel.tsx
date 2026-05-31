import { observer } from 'mobx-react-lite'
import { KeyValues } from '@wwf971/react-comp-misc'
import { fileAccessPointSmbInternalStore } from '../store/fileAccessPointSmbInternalStore'

const FileAccessPointSmbInternalOverviewPanel = observer(() => {
  const totalCount = fileAccessPointSmbInternalStore.items.length
  const configCount = fileAccessPointSmbInternalStore.items.filter((item) => item.sourceType === 'config').length
  const dbCount = fileAccessPointSmbInternalStore.items.filter((item) => item.sourceType === 'database').length

  return (
    <div className="panel-root">
      <div className="panel-title">FileAccessPoint(SMB Internal) OverView</div>
      <div className="panel-row">
        <button
          type="button"
          className="main-btn"
          disabled={fileAccessPointSmbInternalStore.isSaving || !fileAccessPointSmbInternalStore.canWrite}
          onClick={() => {
            fileAccessPointSmbInternalStore.requestCreateOne()
          }}
        >
          create smb/internal file access point
        </button>
        <button
          type="button"
          className="main-btn"
          disabled={fileAccessPointSmbInternalStore.isListLoading}
          onClick={() => {
            fileAccessPointSmbInternalStore.requestLoadList()
          }}
        >
          reload list
        </button>
      </div>
      <div className="kv-wrap">
        <KeyValues
          data={[
            { key: 'totalCount', value: String(totalCount) },
            { key: 'configCount', value: String(configCount) },
            { key: 'dbCount', value: String(dbCount) },
          ]}
          isEditable={false}
        />
      </div>
    </div>
  )
})

export default FileAccessPointSmbInternalOverviewPanel
