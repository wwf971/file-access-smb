import { useEffect, useRef } from 'react'
import { observer } from 'mobx-react-lite'
import { authStore } from './store/authStore'
import { taskStore } from './store/taskStore'
import TaskItem from './task/TaskItem'

const Header = observer(() => {
  const taskMenuRef = useRef<HTMLDivElement | null>(null)
  const loginMenuRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    const handleDocumentClick = (event: MouseEvent) => {
      const target = event.target as Node | null
      if (taskMenuRef.current && target && !taskMenuRef.current.contains(target)) {
        taskStore.setDropdownOpen(false)
      }
      if (loginMenuRef.current && target && !loginMenuRef.current.contains(target)) {
        authStore.setMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', handleDocumentClick)
    return () => {
      document.removeEventListener('mousedown', handleDocumentClick)
    }
  }, [])

  return (
    <div className="app-header-root">
      <div className="app-header-title">file access smb</div>
      <div className="app-header-spacer" />
      <div className="app-header-task-wrap" ref={taskMenuRef}>
        <button
          type="button"
          className="app-header-btn"
          onClick={() => {
            const isNextOpen = !taskStore.isDropdownOpen
            taskStore.setDropdownOpen(isNextOpen)
            if (isNextOpen) {
              taskStore.requestLoadList()
            }
          }}
        >
          tasks {taskStore.taskUndergoingCount > 0 ? `(${taskStore.taskUndergoingCount})` : ''}
        </button>
        {taskStore.isDropdownOpen ? (
          <div className="app-header-menu task-dropdown-menu">
            <div className="task-dropdown-top-row">
              <span>task list</span>
              <button
                type="button"
                className="mini-btn"
                disabled={taskStore.isListLoading}
                onClick={() => {
                  taskStore.requestLoadList()
                }}
              >
                reload
              </button>
            </div>
            <div className="task-dropdown-list">
              {taskStore.taskItems.length === 0 ? (
                <div className="task-dropdown-empty">no task</div>
              ) : (
                taskStore.taskItems.map((task) => (
                  <TaskItem
                    key={task.taskId}
                    task={task}
                    isSelected={task.taskId === taskStore.taskSelectedId}
                    onOpen={(taskId) => taskStore.selectTask(taskId)}
                    onCancel={(taskId) => taskStore.requestCancelTask(taskId)}
                    onDelete={(taskId) => taskStore.requestDeleteTask(taskId)}
                  />
                ))
              )}
            </div>
            {taskStore.errorText ? <div className="task-dropdown-error">{taskStore.errorText}</div> : null}
          </div>
        ) : null}
      </div>
      <div className="app-header-login-wrap" ref={loginMenuRef}>
        <button
          type="button"
          className="app-header-btn"
          onClick={() => {
            authStore.setMenuOpen(!authStore.isMenuOpen)
          }}
        >
          {authStore.isLoggedIn ? `login: ${authStore.username || 'user'}` : 'login'}
        </button>
        {authStore.isMenuOpen ? (
          <div className="app-header-menu login-dropdown-menu">
            <div className="login-dropdown-status">
              {authStore.isLoggedIn ? `logged in as ${authStore.username || 'user'}` : 'not logged in'}
            </div>
            <button
              type="button"
              className="mini-btn"
              disabled={!authStore.isLoggedIn}
              onClick={() => {
                authStore.logout()
              }}
            >
              logout
            </button>
          </div>
        ) : null}
      </div>
    </div>
  )
})

export default Header
