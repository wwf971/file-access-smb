import { observer } from 'mobx-react-lite'
import { KeyValues } from '@wwf971/react-comp-misc'
import { fileAccessPointStore } from '../store/fileAccessPointStore'

const FileAccessPointOverviewPanel = observer(() => {
  const totalCount = fileAccessPointStore.items.length
  const configCount = fileAccessPointStore.items.filter((item) => item.sourceType === 'config').length
  const dbCount = fileAccessPointStore.items.filter((item) => item.sourceType === 'database').length

  return (
    <div className="panel-root">
      <div className="panel-title">FileAccessPoint(SMB) OverView</div>
      <div className="panel-row">
        <button
          type="button"
          className="main-btn"
          disabled={fileAccessPointStore.isSaving || !fileAccessPointStore.canWrite}
          onClick={() => {
            fileAccessPointStore.requestCreateOne()
          }}
        >
          create file access point
        </button>
        <button
          type="button"
          className="main-btn"
          disabled={fileAccessPointStore.isListLoading}
          onClick={() => {
            fileAccessPointStore.requestLoadList()
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

export default FileAccessPointOverviewPanel
