import { useEffect } from 'react'
import { observer } from 'mobx-react-lite'
import { Login, SpinningCircle } from '@wwf971/react-comp-misc'
import './App.css'
import ResourceTree from './ResourceTree'
import ResourcePanel from './ResourcePanel'
import Header from './Header'
import TaskCopyMovePanel from './task/TaskCopyMovePanel'
import TaskPanel from './task/TaskPanel'
import FapSmbExternalEditorTxt from './fapSmbExternal/FapSmbExternalEditorTxt'
import FapSmbExternalUploadFile from './fapSmbExternal/FapSmbExternalUploadFile'
import { appStore } from './store/appStore'
import { authStore } from './store/authStore'
import { fapSmbExternalStore } from './store/fapSmbExternalStore'
import { taskStore } from './store/taskStore'

const App = observer(() => {
  useEffect(() => {
    authStore.initialize()
  }, [])

  useEffect(() => {
    if (authStore.isLoggedIn) {
      appStore.bootstrap()
    }
  }, [authStore.isLoggedIn])

  useEffect(() => {
    if (!authStore.isLoggedIn) {
      return undefined
    }
    taskStore.requestLoadList()
    const timerId = window.setInterval(() => {
      taskStore.requestLoadList()
    }, 3000)
    return () => {
      window.clearInterval(timerId)
    }
  }, [authStore.isLoggedIn])

  if (authStore.isInitializing) {
    return (
      <div className="app-root app-login-root">
        <div className="app-init-text">loading</div>
      </div>
    )
  }

  if (!authStore.isLoggedIn) {
    return (
      <div className="app-root app-login-root">
        <Login
          title="file-access-smb login"
          data={authStore.loginData}
          onDataChangeRequest={authStore.onDataChangeRequest}
          useAuthToken={true}
          showTokenAtLogin={true}
        />
      </div>
    )
  }

  return (
    <div className="app-root">
      <Header />
      <div className="app-layout">
        <aside className="left-panel">
          <ResourceTree />
        </aside>
        <section className="right-panel">
          <ResourcePanel />
        </section>
      </div>
      {fapSmbExternalStore.isZipRunning ? (
        <div className="zip-overlay-root">
          <div className="zip-overlay-popup">
            <div className="zip-overlay-spinner-row">
              <SpinningCircle width={18} height={18} />
              <div className="zip-overlay-title">building zip archive</div>
            </div>
            <div className="zip-overlay-log">{fapSmbExternalStore.zipLatestLogText || 'running'}</div>
            <button
              type="button"
              className="main-btn zip-abort-btn"
              onClick={() => {
                fapSmbExternalStore.requestAbortZip()
              }}
            >
              abort
            </button>
          </div>
        </div>
      ) : null}
      <FapSmbExternalEditorTxt />
      <FapSmbExternalUploadFile />
      <TaskCopyMovePanel />
      <TaskPanel />
    </div>
  )
})

export default App
