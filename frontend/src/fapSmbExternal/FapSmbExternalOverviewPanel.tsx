import { observer } from 'mobx-react-lite'
import { KeyValues } from '@wwf971/react-comp-misc'
import { fapSmbExternalStore } from '../store/fapSmbExternalStore'

const FapSmbExternalOverviewPanel = observer(() => {
  const totalCount = fapSmbExternalStore.items.length
  const configCount = fapSmbExternalStore.items.filter((item) => item.sourceType === 'config').length
  const dbCount = fapSmbExternalStore.items.filter((item) => item.sourceType === 'database').length

  return (
    <div className="panel-root">
      <div className="panel-title">FAP SMB External Overview</div>
      <div className="panel-row">
        <button
          type="button"
          className="main-btn"
          disabled={fapSmbExternalStore.isSaving || !fapSmbExternalStore.canWrite}
          onClick={() => {
            fapSmbExternalStore.requestCreateOne()
          }}
        >
          create FAP SMB external
        </button>
        <button
          type="button"
          className="main-btn"
          disabled={fapSmbExternalStore.isListLoading}
          onClick={() => {
            fapSmbExternalStore.requestLoadList()
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

export default FapSmbExternalOverviewPanel
