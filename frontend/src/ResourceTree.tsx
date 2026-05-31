import { useMemo, useState } from 'react'
import { observer } from 'mobx-react-lite'
import { TreeView } from '@wwf971/react-comp-misc'
import { appStore, PAGE_KEY } from './store/appStore'
import { fileAccessPointStore } from './store/fileAccessPointStore'
import { fileAccessPointSmbInternalStore } from './store/fileAccessPointSmbInternalStore'

const ResourceTree = observer(() => {
  const TreeViewComp = TreeView as any
  const [expandedById, setExpandedById] = useState<Record<string, boolean>>({
    service: true,
    fileAccessPoints: true,
    fileAccessPointsSmbInternal: true,
  })

  const treeData = useMemo(() => {
    const itemDataById: Record<string, any> = {
      service: {
        id: 'service',
        text: 'Service',
        isLeaf: false,
        isExpanded: expandedById.service === true,
        childrenIds: ['service:metadata', 'service:basic-info', 'service:database'],
        childrenLoadState: 'loaded',
      },
      'service:metadata': {
        id: 'service:metadata',
        text: 'metadata',
        isLeaf: true,
        isExpanded: false,
        childrenIds: [],
        childrenLoadState: 'loaded',
      },
      'service:basic-info': {
        id: 'service:basic-info',
        text: 'Basic Info',
        isLeaf: true,
        isExpanded: false,
        childrenIds: [],
        childrenLoadState: 'loaded',
      },
      'service:database': {
        id: 'service:database',
        text: 'database',
        isLeaf: true,
        isExpanded: false,
        childrenIds: [],
        childrenLoadState: 'loaded',
      },
      fileAccessPoints: {
        id: 'fileAccessPoints',
        text: `FileAccessPoint(SMB) (${fileAccessPointStore.items.length})`,
        isLeaf: false,
        isExpanded: expandedById.fileAccessPoints === true,
        childrenIds: [
          'fileAccessPoints:overview',
          ...fileAccessPointStore.items.map((item) => `fap:${item.fileAccessPointId}`),
        ],
        childrenLoadState: fileAccessPointStore.isListLoading ? 'loading' : 'loaded',
      },
      fileAccessPointsSmbInternal: {
        id: 'fileAccessPointsSmbInternal',
        text: `FileAccessPoint(Internal) (${fileAccessPointSmbInternalStore.items.length})`,
        isLeaf: false,
        isExpanded: expandedById.fileAccessPointsSmbInternal === true,
        childrenIds: [
          'fileAccessPointsSmbInternal:overview',
          ...fileAccessPointSmbInternalStore.items.map((item) => `fapSmbInternal:${item.fileAccessPointId}`),
        ],
        childrenLoadState: fileAccessPointSmbInternalStore.isListLoading ? 'loading' : 'loaded',
      },
      'fileAccessPointsSmbInternal:overview': {
        id: 'fileAccessPointsSmbInternal:overview',
        text: 'OverView',
        isLeaf: true,
        isExpanded: false,
        childrenIds: [],
        childrenLoadState: 'loaded',
      },
      'fileAccessPoints:overview': {
        id: 'fileAccessPoints:overview',
        text: 'OverView',
        isLeaf: true,
        isExpanded: false,
        childrenIds: [],
        childrenLoadState: 'loaded',
      },
    }
    fileAccessPointStore.items.forEach((item) => {
      const sourceText = item.sourceType === 'config' ? 'CONFIG' : 'DB'
      itemDataById[`fap:${item.fileAccessPointId}`] = {
        id: `fap:${item.fileAccessPointId}`,
        text: `${item.name} [${sourceText}]`,
        isLeaf: false,
        isExpanded: expandedById[`fap:${item.fileAccessPointId}`] === true,
        childrenIds: [`fap:${item.fileAccessPointId}:config`, `fap:${item.fileAccessPointId}:explore`],
        childrenLoadState: 'loaded',
        fileAccessPointId: item.fileAccessPointId,
      }
      itemDataById[`fap:${item.fileAccessPointId}:config`] = {
        id: `fap:${item.fileAccessPointId}:config`,
        text: 'config',
        isLeaf: true,
        isExpanded: false,
        childrenIds: [],
        childrenLoadState: 'loaded',
        fileAccessPointId: item.fileAccessPointId,
        panel: 'config',
      }
      itemDataById[`fap:${item.fileAccessPointId}:explore`] = {
        id: `fap:${item.fileAccessPointId}:explore`,
        text: 'explore',
        isLeaf: true,
        isExpanded: false,
        childrenIds: [],
        childrenLoadState: 'loaded',
        fileAccessPointId: item.fileAccessPointId,
        panel: 'explore',
      }
    })
    fileAccessPointSmbInternalStore.items.forEach((item) => {
      const sourceText = item.sourceType === 'config' ? 'CONFIG' : 'DB'
      itemDataById[`fapSmbInternal:${item.fileAccessPointId}`] = {
        id: `fapSmbInternal:${item.fileAccessPointId}`,
        text: `${item.name} [${sourceText}]`,
        isLeaf: false,
        isExpanded: expandedById[`fapSmbInternal:${item.fileAccessPointId}`] === true,
        childrenIds: [
          `fapSmbInternal:${item.fileAccessPointId}:config`,
          `fapSmbInternal:${item.fileAccessPointId}:explore`,
        ],
        childrenLoadState: 'loaded',
        fileAccessPointSmbInternalId: item.fileAccessPointId,
      }
      itemDataById[`fapSmbInternal:${item.fileAccessPointId}:config`] = {
        id: `fapSmbInternal:${item.fileAccessPointId}:config`,
        text: 'config',
        isLeaf: true,
        isExpanded: false,
        childrenIds: [],
        childrenLoadState: 'loaded',
        fileAccessPointSmbInternalId: item.fileAccessPointId,
        panel: 'config',
      }
      itemDataById[`fapSmbInternal:${item.fileAccessPointId}:explore`] = {
        id: `fapSmbInternal:${item.fileAccessPointId}:explore`,
        text: 'explore',
        isLeaf: true,
        isExpanded: false,
        childrenIds: [],
        childrenLoadState: 'loaded',
        fileAccessPointSmbInternalId: item.fileAccessPointId,
        panel: 'explore',
      }
    })
    return {
      rootItemIds: ['service', 'fileAccessPoints', 'fileAccessPointsSmbInternal'],
      itemDataById,
    }
  }, [
    expandedById,
    fileAccessPointStore.items,
    fileAccessPointStore.isListLoading,
    fileAccessPointSmbInternalStore.items,
    fileAccessPointSmbInternalStore.isListLoading,
  ])

  return (
    <TreeViewComp
      rootItemIds={treeData.rootItemIds}
      getItemDataById={(itemId) => treeData.itemDataById[itemId] || null}
      selectedItemId={
        appStore.currentPageKey === PAGE_KEY.serviceMetadata
          ? 'service:metadata'
          : appStore.currentPageKey === PAGE_KEY.serviceBasicInfo
            ? 'service:basic-info'
          : appStore.currentPageKey === PAGE_KEY.serviceDatabase
            ? 'service:database'
          : appStore.currentPageKey === PAGE_KEY.fileAccessPointOverview
            ? 'fileAccessPoints:overview'
          : appStore.currentPageKey === PAGE_KEY.fileAccessPointSmbInternalOverview
            ? 'fileAccessPointsSmbInternal:overview'
          : fileAccessPointSmbInternalStore.selectedId
            && (
              appStore.currentPageKey === PAGE_KEY.fileAccessPointSmbInternalConfig
              || appStore.currentPageKey === PAGE_KEY.fileAccessPointSmbInternalExplore
            )
            ? `fapSmbInternal:${fileAccessPointSmbInternalStore.selectedId}:${fileAccessPointSmbInternalStore.selectedPanel}`
          : fileAccessPointStore.selectedId
            ? `fap:${fileAccessPointStore.selectedId}:${fileAccessPointStore.selectedPanel}`
            : 'fileAccessPoints'
      }
      onDataChangeRequest={async (type: string, params: any) => {
        if (type !== 'toggle-expand') return { code: 0 }
        const itemId = String(params?.itemId || '')
        const nextIsExpanded = params?.nextIsExpanded === true
        setExpandedById((prev) => ({
          ...prev,
          [itemId]: nextIsExpanded,
        }))
        return { code: 0 }
      }}
      onItemClick={(itemId: string, itemData: any) => {
        if (itemId === 'service' || itemId === 'service:metadata') {
          appStore.selectServicePage(PAGE_KEY.serviceMetadata)
          return
        }
        if (itemId === 'service:basic-info') {
          appStore.selectServicePage(PAGE_KEY.serviceBasicInfo)
          return
        }
        if (itemId === 'service:database') {
          appStore.selectServicePage(PAGE_KEY.serviceDatabase)
          return
        }
        if (itemId === 'fileAccessPoints:overview' || itemId === 'fileAccessPoints') {
          appStore.selectFileAccessPointOverview()
          return
        }
        if (itemId === 'fileAccessPointsSmbInternal:overview' || itemId === 'fileAccessPointsSmbInternal') {
          appStore.selectFileAccessPointSmbInternalOverview()
          return
        }
        if (itemData?.fileAccessPointSmbInternalId && itemData?.panel) {
          appStore.selectFileAccessPointSmbInternal(String(itemData.fileAccessPointSmbInternalId), itemData.panel)
          return
        }
        if (itemData?.fileAccessPointSmbInternalId) {
          appStore.selectFileAccessPointSmbInternal(String(itemData.fileAccessPointSmbInternalId), 'config')
          return
        }
        if (itemData?.fileAccessPointId && itemData?.panel) {
          appStore.selectFileAccessPoint(String(itemData.fileAccessPointId), itemData.panel)
          return
        }
        if (itemData?.fileAccessPointId) {
          appStore.selectFileAccessPoint(String(itemData.fileAccessPointId), 'config')
        }
      }}
    />
  )
})

export default ResourceTree
