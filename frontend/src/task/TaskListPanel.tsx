import { observer } from 'mobx-react-lite'
import { FolderView, SpinningCircle } from '@wwf971/react-comp-misc'
import { getTaskLatestMessage, getTaskStatusLabel, getTaskTypeLabel, taskStore, TASK_STATUS } from '../store/taskStore'

const TASK_LIST_VIEW_KEY = 'service-task-panel'

const TASK_LIST_COLUMNS = {
  taskId: { data: 'taskId', align: 'left' },
  type: { data: 'type', align: 'left' },
  status: { data: 'status', align: 'left' },
  message: { data: 'message', align: 'left' },
  createdAt: { data: 'createdAt', align: 'left' },
  updatedAt: { data: 'updatedAt', align: 'left' },
}

const TASK_LIST_COLUMNS_ORDER = ['taskId', 'type', 'status', 'message', 'createdAt', 'updatedAt']

const TASK_LIST_COLUMNS_SIZE = {
  taskId: { width: 120, minWidth: 90, resizable: true },
  type: { width: 90, minWidth: 70, resizable: true },
  status: { width: 90, minWidth: 70, resizable: true },
  message: { width: 280, minWidth: 140, resizable: true },
  createdAt: { width: 190, minWidth: 120, resizable: true },
  updatedAt: { width: 190, minWidth: 120, resizable: true },
}

const TaskListPanel = observer(() => {
  const FolderViewComp = FolderView as any
  const viewState = taskStore.getTaskListViewState(TASK_LIST_VIEW_KEY)
  const selectedTask = taskStore.getSelectedTaskForView(TASK_LIST_VIEW_KEY)
  const isSelectedUndergoing = selectedTask?.taskStatus === TASK_STATUS.undergoing
  const isSelectedFail = selectedTask?.taskStatus === TASK_STATUS.fail
  const rows = taskStore.taskItems.map((task) => {
    const statusLabel = getTaskStatusLabel(task.taskStatus)
    const latestMessage = getTaskLatestMessage(task)
    return {
      id: task.taskId,
      data: {
        taskId: <div className="task-list-cell" title={task.taskId}>{task.taskId}</div>,
        type: <div className="task-list-cell" title={getTaskTypeLabel(task.taskType)}>{getTaskTypeLabel(task.taskType)}</div>,
        status: (
          <div className={`task-panel-status status-${statusLabel}`}>
            {task.taskStatus === TASK_STATUS.undergoing ? <SpinningCircle width={12} height={12} /> : null}
            <span>{statusLabel}</span>
          </div>
        ),
        message: <div className="task-list-cell" title={latestMessage}>{latestMessage}</div>,
        createdAt: <div className="task-list-cell" title={task.createdAt}>{task.createdAt}</div>,
        updatedAt: <div className="task-list-cell" title={task.updatedAt}>{task.updatedAt}</div>,
      },
    }
  })

  return (
    <div className="panel-root task-list-panel-root">
      <div className="panel-title">Tasks</div>
      <div className="task-list-panel-button-row">
        <button
          type="button"
          className="main-btn"
          disabled={taskStore.isListLoading}
          onClick={() => {
            taskStore.requestLoadList()
          }}
        >
          reload
        </button>
        <button
          type="button"
          className="main-btn"
          disabled={!selectedTask}
          onClick={() => {
            if (selectedTask) {
              taskStore.selectTask(selectedTask.taskId)
            }
          }}
        >
          info
        </button>
        <button
          type="button"
          className="main-btn"
          disabled={!selectedTask || !isSelectedFail || taskStore.isResubmitting}
          onClick={() => {
            if (selectedTask) {
              taskStore.requestResubmitTask(selectedTask.taskId)
            }
          }}
        >
          re-submit
        </button>
        <button
          type="button"
          className="main-btn"
          disabled={!selectedTask || !isSelectedUndergoing || taskStore.isCancelling}
          onClick={() => {
            if (selectedTask) {
              taskStore.requestCancelTask(selectedTask.taskId)
            }
          }}
        >
          cancel
        </button>
        <button
          type="button"
          className="main-btn danger-btn"
          disabled={!selectedTask || isSelectedUndergoing || taskStore.isDeleting}
          onClick={() => {
            if (selectedTask) {
              taskStore.requestDeleteTask(selectedTask.taskId)
            }
          }}
        >
          delete
        </button>
      </div>
      {taskStore.errorText ? <div className="error-box">{taskStore.errorText}</div> : null}
      <FolderViewComp
        columns={TASK_LIST_COLUMNS}
        columnsOrder={TASK_LIST_COLUMNS_ORDER}
        columnsSizeInit={TASK_LIST_COLUMNS_SIZE}
        rows={rows}
        bodyHeight={420}
        showStatusBar={true}
        listOnly={true}
        selectionMode="single"
        selectedRowIds={viewState.selectedTaskIds}
        onSelectedRowIdsChange={(taskIds: string[]) => {
          taskStore.setTaskListSelectedTaskIds(TASK_LIST_VIEW_KEY, taskIds)
        }}
        loading={taskStore.isListLoading}
        showStatusItemCount={true}
        onRowDoubleClick={(taskId: string) => {
          taskStore.selectTask(taskId)
        }}
      />
    </div>
  )
})

export default TaskListPanel
