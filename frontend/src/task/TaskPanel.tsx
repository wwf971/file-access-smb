import { observer } from 'mobx-react-lite'
import { FolderView, SpinningCircle } from '@wwf971/react-comp-misc'
import { getTaskLatestMessage, getTaskStatusLabel, getTaskTypeLabel, taskStore, TASK_STATUS } from '../store/taskStore'

const TASK_ITEM_COLUMNS = {
  name: { data: 'name', align: 'left' },
  source: { data: 'source', align: 'left' },
  target: { data: 'target', align: 'left' },
  status: { data: 'status', align: 'left' },
}

const TASK_ITEM_COLUMNS_ORDER = ['name', 'source', 'target', 'status']

const TASK_ITEM_COLUMNS_SIZE = {
  name: { width: 160, minWidth: 100, resizable: true },
  source: { width: 240, minWidth: 120, resizable: true },
  target: { width: 240, minWidth: 120, resizable: true },
  status: { width: 180, minWidth: 120, resizable: true },
}

const TaskPanel = observer(() => {
  const FolderViewComp = FolderView as any
  const task = taskStore.taskSelected
  if (!taskStore.isPanelOpen || !task) {
    return null
  }
  const taskInfo = task.taskInfo || {}
  const operationInfo = getObjectField(taskInfo, 'operationInfo')
  const taskProgress = getObjectField(taskInfo, 'taskProgress')
  const itemList = Array.isArray(operationInfo.itemList) ? operationInfo.itemList as Record<string, unknown>[] : []
  const rows = itemList.map((item, index) => {
    const taskStatus = Number(item.taskStatus || 0)
    const statusLabel = taskStatus ? getTaskStatusLabel(taskStatus) : 'waiting'
    return {
      id: `${index}`,
      data: {
        name: <div className="task-panel-cell" title={String(item.name || '')}>{String(item.name || '')}</div>,
        source: <div className="task-panel-cell" title={String(item.pathSource || '')}>{String(item.pathSource || '')}</div>,
        target: <div className="task-panel-cell" title={String(item.pathTarget || '')}>{String(item.pathTarget || '')}</div>,
        status: (
          <div className={`task-panel-status status-${statusLabel}`}>
            {taskStatus === TASK_STATUS.undergoing ? <SpinningCircle width={12} height={12} /> : null}
            <span>{String(item.taskStatusText || statusLabel)}</span>
          </div>
        ),
      },
    }
  })

  return (
    <div className="task-panel-overlay">
      <div className="task-panel-popup">
        <div className="task-panel-top-row">
          <div className="task-panel-title-wrap">
            <div className="task-panel-title">
              {getTaskTypeLabel(task.taskType)} task {task.taskId}
            </div>
            <div className="task-panel-subtitle">
              {getTaskStatusLabel(task.taskStatus)} {getTaskLatestMessage(task)}
            </div>
          </div>
          <button
            type="button"
            className="main-btn"
            onClick={() => {
              taskStore.setPanelOpen(false)
            }}
          >
            close
          </button>
        </div>
        <div className="task-panel-summary-row">
          <span>items {Number(taskProgress.itemCountDone || 0)} / {Number(taskProgress.itemCountTotal || itemList.length || 0)}</span>
          <span>created {task.createdAt}</span>
          <span>updated {task.updatedAt}</span>
        </div>
        <div className="task-panel-table-wrap">
          <FolderViewComp
            columns={TASK_ITEM_COLUMNS}
            columnsOrder={TASK_ITEM_COLUMNS_ORDER}
            columnsSizeInit={TASK_ITEM_COLUMNS_SIZE}
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
        <div className="task-panel-bottom-row">
          <button
            type="button"
            className="main-btn"
            disabled={task.taskStatus !== TASK_STATUS.fail || taskStore.isResubmitting}
            onClick={() => {
              taskStore.requestResubmitTask(task.taskId)
            }}
          >
            re-submit task
          </button>
          <button
            type="button"
            className="main-btn"
            disabled={task.taskStatus !== TASK_STATUS.undergoing || taskStore.isCancelling}
            onClick={() => {
              taskStore.requestCancelTask(task.taskId)
            }}
          >
            cancel task
          </button>
          <button
            type="button"
            className="main-btn danger-btn"
            disabled={task.taskStatus === TASK_STATUS.undergoing || taskStore.isDeleting}
            onClick={() => {
              taskStore.requestDeleteTask(task.taskId)
            }}
          >
            delete task
          </button>
        </div>
      </div>
    </div>
  )
})

function getObjectField(source: Record<string, unknown>, key: string) {
  const value = source[key]
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
}

export default TaskPanel
