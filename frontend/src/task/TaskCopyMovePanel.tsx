import { observer } from 'mobx-react-lite'
import { FolderView, SpinningCircle } from '@wwf971/react-comp-misc'
import { taskStore } from '../store/taskStore'

const COPY_MOVE_COLUMNS = {
  name: { data: 'name', align: 'left' },
  source: { data: 'source', align: 'left' },
  target: { data: 'target', align: 'left' },
}

const COPY_MOVE_COLUMNS_ORDER = ['name', 'source', 'target']

const COPY_MOVE_COLUMNS_SIZE = {
  name: { width: 170, minWidth: 110, resizable: true },
  source: { width: 250, minWidth: 140, resizable: true },
  target: { width: 250, minWidth: 140, resizable: true },
}

const TaskCopyMovePanel = observer(() => {
  if (!taskStore.isCopyMovePanelOpen) {
    return null
  }
  const targetFolderPath = normalizePath(taskStore.copyMoveTargetFolderPath)
  const rows = taskStore.copyMoveItemList.map((item, index) => ({
    id: `${index}`,
    data: {
      name: <div className="task-copy-move-cell" title={item.name}>{item.name}</div>,
      source: <div className="task-copy-move-cell" title={item.pathSource}>{item.pathSource}</div>,
      target: <div className="task-copy-move-cell" title={joinPath(targetFolderPath, item.name)}>{joinPath(targetFolderPath, item.name)}</div>,
    },
  }))

  return (
    <div className="task-copy-move-overlay">
      <div className="task-copy-move-popup">
        <div className="task-copy-move-top-row">
          <div className="task-copy-move-title-wrap">
            <div className="task-copy-move-title">{taskStore.copyMoveMode} selected items</div>
            <div className="task-copy-move-subtitle">{taskStore.copyMoveFileAccessPointName}</div>
          </div>
          <button
            type="button"
            className="main-btn"
            disabled={taskStore.isSubmitting}
            onClick={() => {
              taskStore.closeCopyMovePanel()
            }}
          >
            close
          </button>
        </div>
        <div className="task-copy-move-path-row">
          <div className="task-copy-move-label">target folder</div>
          <input
            className="text-input task-copy-move-input"
            value={taskStore.copyMoveTargetFolderPath}
            disabled={taskStore.isSubmitting}
            onChange={(event) => {
              taskStore.setCopyMoveTargetFolderPath(event.target.value)
            }}
          />
        </div>
        <div className="task-copy-move-table-wrap">
          <FolderView
            columns={COPY_MOVE_COLUMNS}
            columnsOrder={COPY_MOVE_COLUMNS_ORDER}
            columnsSizeInit={COPY_MOVE_COLUMNS_SIZE}
            rows={rows}
            bodyHeight={260}
            showStatusBar={true}
            listOnly={true}
            selectionMode="none"
            rowsSelectedId={[]}
            loading={false}
            showStatusItemCount={true}
          />
        </div>
        {taskStore.errorText || taskStore.messageText || taskStore.isSubmitting ? (
          <div className={`task-copy-move-message ${taskStore.errorText ? 'status-error' : 'status-info'}`}>
            {taskStore.isSubmitting ? <SpinningCircle width={12} height={12} /> : null}
            <span>{taskStore.errorText || taskStore.messageText || 'submitting'}</span>
          </div>
        ) : null}
        <div className="task-copy-move-bottom-row">
          <button
            type="button"
            className="main-btn"
            disabled={taskStore.isSubmitting || taskStore.copyMoveItemList.length === 0}
            onClick={() => {
              taskStore.requestSubmitCopyMove()
            }}
          >
            submit task
          </button>
        </div>
      </div>
    </div>
  )
})

function normalizePath(path: string) {
  let normalized = String(path || '/').replace(/\\/g, '/').trim()
  while (normalized.includes('//')) {
    normalized = normalized.replaceAll('//', '/')
  }
  if (!normalized.startsWith('/')) {
    normalized = `/${normalized}`
  }
  normalized = normalized.replace(/\/+$/, '')
  return normalized || '/'
}

function joinPath(folderPath: string, name: string) {
  const normalizedFolder = normalizePath(folderPath)
  const normalizedName = String(name || '').replace(/\\/g, '/').split('/').filter(Boolean).join('/')
  if (!normalizedName) {
    return normalizedFolder
  }
  if (normalizedFolder === '/') {
    return `/${normalizedName}`
  }
  return `${normalizedFolder}/${normalizedName}`
}

export default TaskCopyMovePanel
