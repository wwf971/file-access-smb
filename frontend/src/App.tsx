import { useEffect } from 'react'
import { observer } from 'mobx-react-lite'
import { Login, SpinningCircle } from '@wwf971/react-comp-misc'
import './App.css'
import ResourceTree from './ResourceTree'
import ResourcePanel from './ResourcePanel'
import { appStore } from './store/appStore'
import { authStore } from './store/authStore'
import { fileAccessPointStore } from './store/fileAccessPointStore'

const App = observer(() => {
  useEffect(() => {
    authStore.initialize()
  }, [])

  useEffect(() => {
    if (authStore.isLoggedIn) {
      appStore.bootstrap()
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
      <div className="app-layout">
        <aside className="left-panel">
          <ResourceTree />
        </aside>
        <section className="right-panel">
          <ResourcePanel />
        </section>
      </div>
      {fileAccessPointStore.isZipRunning ? (
        <div className="zip-overlay-root">
          <div className="zip-overlay-popup">
            <div className="zip-overlay-spinner-row">
              <SpinningCircle width={18} height={18} />
              <div className="zip-overlay-title">building zip archive</div>
            </div>
            <div className="zip-overlay-log">{fileAccessPointStore.zipLatestLogText || 'running'}</div>
            <button
              type="button"
              className="main-btn zip-abort-btn"
              onClick={() => {
                fileAccessPointStore.requestAbortZip()
              }}
            >
              abort
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
})

export default App
