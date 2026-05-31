import { observer } from 'mobx-react-lite'
import { KeyValues } from '@wwf971/react-comp-misc'
import { fapSmbInternalStore } from '../store/fapSmbInternalStore'

const FapSmbInternalOverviewPanel = observer(() => {
  const totalCount = fapSmbInternalStore.items.length
  const configCount = fapSmbInternalStore.items.filter((item) => item.sourceType === 'config').length
  const dbCount = fapSmbInternalStore.items.filter((item) => item.sourceType === 'database').length

  return (
    <div className="panel-root">
      <div className="panel-title">FAP SMB Internal Overview</div>
      <div className="panel-row">
        <button
          type="button"
          className="main-btn"
          disabled={fapSmbInternalStore.isSaving || !fapSmbInternalStore.canWrite}
          onClick={() => {
            fapSmbInternalStore.requestCreateOne()
          }}
        >
          create FAP SMB internal
        </button>
        <button
          type="button"
          className="main-btn"
          disabled={fapSmbInternalStore.isListLoading}
          onClick={() => {
            fapSmbInternalStore.requestLoadList()
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

export default FapSmbInternalOverviewPanel
