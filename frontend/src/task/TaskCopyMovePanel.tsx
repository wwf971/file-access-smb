import { observer } from 'mobx-react-lite'
import { CheckIcon, CrossIcon, EditIcon, FolderView, SpinningCircle } from '@wwf971/react-comp-misc'
import FapSmbExternalDirSelector from '../fapSmbExternal/FapSmbExternalDirSelector'
import FapSmbExternalSelector from '../fapSmbExternal/FapSmbExternalSelector'
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
  const targetFolderPath = taskStore.copyMovePreviewTargetFolderPath
  const targetFileAccessPoint = taskStore.copyMovePreviewTargetFileAccessPoint
  const rows = taskStore.copyMoveItemList.map((item, index) => ({
    id: `${index}`,
    data: {
      name: <div className="task-copy-move-cell" title={item.name}>{item.name}</div>,
      source: <div className="task-copy-move-cell" title={item.pathSource}>{item.pathSource}</div>,
      target: (
        <div className="task-copy-move-cell" title={joinPath(targetFolderPath, item.name)}>
          {targetFileAccessPoint ? `${targetFileAccessPoint.name}: ` : ''}{joinPath(targetFolderPath, item.name)}
        </div>
      ),
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
          <div className="task-copy-move-input-wrap">
            <input
              className="text-input task-copy-move-input"
              value={taskStore.copyMoveTargetFolderPath}
              disabled={taskStore.isSubmitting}
              onChange={(event) => {
                taskStore.setCopyMoveTargetFolderPath(event.target.value)
              }}
            />
            <button
              type="button"
              className="task-copy-move-icon-btn"
              disabled={taskStore.isSubmitting}
              title="select target folder"
              onClick={() => {
                taskStore.openCopyMoveSelector()
              }}
            >
              <EditIcon width={13} height={13} />
            </button>
          </div>
        </div>
        <div className="task-copy-move-option-row">
          <button
            type="button"
            className={`task-copy-move-check ${taskStore.isCopyMoveEnsureTargetFolder ? 'is-checked' : ''}`}
            role="checkbox"
            aria-checked={taskStore.isCopyMoveEnsureTargetFolder}
            disabled={taskStore.isSubmitting}
            onClick={() => {
              taskStore.setCopyMoveEnsureTargetFolder(!taskStore.isCopyMoveEnsureTargetFolder)
            }}
          >
            <span className="task-copy-move-check-box">
              {taskStore.isCopyMoveEnsureTargetFolder ? <CheckIcon width={12} height={12} /> : null}
            </span>
            <span>create target folder when missing</span>
          </button>
        </div>
        <TaskCopyMoveTargetSelector />
        <div className="task-copy-move-table-wrap">
          <FolderView
            data={{
              columns: COPY_MOVE_COLUMNS,
              colsOrder: COPY_MOVE_COLUMNS_ORDER,
              rows,
              rowIdsSelected: [],
              statusBar: {
                itemCount: rows.length,
                messageState: null,
              },
            }}
            config={{
              colSizeById: COPY_MOVE_COLUMNS_SIZE,
              bodyHeight: 260,
              isListOnly: true,
              isStatusBarVisible: true,
              isStatusItemCountVisible: true,
              selectionMode: 'none',
            }}
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

const TaskCopyMoveTargetSelector = observer(() => {
  if (!taskStore.copyMoveSelectorState.isOpen) {
    return null
  }
  const selectedFileAccessPoint = taskStore.copyMoveSelectorFileAccessPoint
  const exploreState = taskStore.copyMoveSelectorExploreState
  return (
    <div className="task-copy-move-selector-popup">
      <div className="task-copy-move-selector-top-row">
        <div className="task-copy-move-selector-title">select target by exploring</div>
        <button
          type="button"
          className="task-copy-move-icon-btn"
          onClick={() => {
            taskStore.closeCopyMoveSelector()
          }}
        >
          <CrossIcon size={13} />
        </button>
      </div>
      <div className="task-copy-move-selector-body">
        <FapSmbExternalSelector
          items={taskStore.copyMoveSelectorFileAccessPointItems}
          selectedItem={selectedFileAccessPoint}
          searchText={taskStore.copyMoveSelectorState.searchText}
          onSearchTextChange={taskStore.setCopyMoveSelectorSearchText}
          onSelect={taskStore.selectCopyMoveSelectorFileAccessPoint}
          onRefresh={taskStore.requestCopyMoveSelectorRefreshFaps}
        />
        <FapSmbExternalDirSelector
          folderPath={taskStore.copyMoveSelectorState.selectedFolderPath}
          items={exploreState?.items || []}
          isLoading={exploreState?.isExploring || false}
          isDisabled={!selectedFileAccessPoint}
          onExplore={taskStore.requestCopyMoveSelectorExplore}
        />
      </div>
      <div className="task-copy-move-selector-bottom-row">
        <div className="task-copy-move-selector-message">
          {taskStore.copyMoveSelectorState.messageText}
        </div>
        <button
          type="button"
          className="main-btn"
          disabled={!selectedFileAccessPoint}
          onClick={() => {
            taskStore.applyCopyMoveSelectorTarget()
          }}
        >
          use selected folder
        </button>
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
