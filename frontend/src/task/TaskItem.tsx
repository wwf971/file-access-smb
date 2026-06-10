import { observer } from 'mobx-react-lite'
import { getTaskStatusLabel, getTaskTypeLabel, TASK_STATUS, type TaskRow } from '../store/taskStore'

const TaskItem = observer(({
  task,
  isSelected,
  onOpen,
  onCancel,
  onDelete,
}: {
  task: TaskRow
  isSelected: boolean
  onOpen: (taskId: string) => void
  onCancel: (taskId: string) => void
  onDelete: (taskId: string) => void
}) => {
  const isUndergoing = task.taskStatus === TASK_STATUS.undergoing
  return (
    <div className={`task-item-root ${isSelected ? 'is-selected' : ''}`}>
      <button
        type="button"
        className="task-item-main"
        onClick={() => {
          onOpen(task.taskId)
        }}
      >
        <span className={`task-item-status status-${getTaskStatusLabel(task.taskStatus)}`}>
          {getTaskStatusLabel(task.taskStatus)}
        </span>
        <span className="task-item-title">{getTaskTypeLabel(task.taskType)}</span>
        <span className="task-item-message">{task.taskStatusText || task.taskId}</span>
      </button>
      <div className="task-item-actions">
        <button
          type="button"
          className="mini-btn"
          disabled={!isUndergoing}
          onClick={() => {
            onCancel(task.taskId)
          }}
        >
          cancel
        </button>
        <button
          type="button"
          className="mini-btn danger-btn"
          disabled={isUndergoing}
          onClick={() => {
            onDelete(task.taskId)
          }}
        >
          delete
        </button>
      </div>
    </div>
  )
})

export default TaskItem
