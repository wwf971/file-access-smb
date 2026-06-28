import { FolderView } from '@wwf971/react-comp-misc'

type FapSmbExternalDirItem = {
  name: string
  isDirectory: boolean
  sizeBytes: number
}

type FapSmbExternalDirSelectorProps = {
  folderPath: string
  items: FapSmbExternalDirItem[]
  isLoading: boolean
  isDisabled: boolean
  onExplore: (folderPath: string) => void
}

const FapSmbExternalDirSelector = ({
  folderPath,
  items,
  isLoading,
  isDisabled,
  onExplore,
}: FapSmbExternalDirSelectorProps) => {
  const normalizedFolderPath = normalizePath(folderPath)
  const parentPath = buildParentPath(normalizedFolderPath)
  const rows = items
    .filter((item) => item.isDirectory)
    .map((item) => ({
      id: `d:${item.name}`,
      data: {
        name: <div className="task-copy-move-cell" title={item.name}>{item.name}</div>,
      },
    }))
  return (
    <div className="fap-smb-external-dir-selector-root">
      <div className="fap-smb-external-dir-selector-toolbar">
        <button
          type="button"
          className="main-btn"
          disabled={isDisabled || normalizedFolderPath === '/'}
          onClick={() => {
            onExplore(parentPath)
          }}
        >
          parent
        </button>
        <button
          type="button"
          className="main-btn"
          disabled={isDisabled}
          onClick={() => {
            onExplore(normalizedFolderPath)
          }}
        >
          refresh
        </button>
        <div className="fap-smb-external-dir-selector-path" title={normalizedFolderPath}>
          {normalizedFolderPath}
        </div>
      </div>
      <FolderView
        data={{
          columns: { name: { data: 'name', align: 'left' } },
          colsOrder: ['name'],
          rows,
          rowIdsSelected: [],
          statusBar: {
            itemCount: rows.length,
            messageState: isLoading
              ? { status: 'loading', messageText: 'loading directories' }
              : null,
          },
        }}
        config={{
          colSizeById: { name: { width: 300, minWidth: 160, resizable: true } },
          bodyHeight: 170,
          isListOnly: true,
          isStatusBarVisible: true,
          isStatusItemCountVisible: true,
          selectionMode: 'none',
          isLocked: isDisabled || isLoading,
        }}
        onEvent={async (eventType, eventData) => {
          if (eventType === 'rowDoubleClick') {
            const name = String(eventData.rowId || '').replace(/^d:/, '')
            onExplore(joinPath(normalizedFolderPath, name))
            return { code: 0 }
          }
          return { code: 0 }
        }}
      />
    </div>
  )
}

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

function buildParentPath(path: string) {
  const normalizedPath = normalizePath(path)
  const parts = normalizedPath.split('/').filter(Boolean)
  parts.pop()
  return parts.length ? `/${parts.join('/')}` : '/'
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

export default FapSmbExternalDirSelector
