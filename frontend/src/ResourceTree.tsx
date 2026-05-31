import { useMemo, useState } from 'react'
import { observer } from 'mobx-react-lite'
import { TreeView } from '@wwf971/react-comp-misc'
import { appStore, PAGE_KEY } from './store/appStore'
import { fapSmbExternalStore } from './store/fapSmbExternalStore'
import { fapSmbInternalStore, getFapSmbInternalSourceLabel } from './store/fapSmbInternalStore'

const ResourceTree = observer(() => {
  const TreeViewComp = TreeView as any
  const [expandedById, setExpandedById] = useState<Record<string, boolean>>({
    service: true,
    fapSmbExternal: true,
    fapSmbInternal: true,
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
      fapSmbExternal: {
        id: 'fapSmbExternal',
        text: `FAP SMB External (${fapSmbExternalStore.items.length})`,
        isLeaf: false,
        isExpanded: expandedById.fapSmbExternal === true,
        childrenIds: [
          'fapSmbExternal:overview',
          ...fapSmbExternalStore.items.map((item) => `fapSmbExternal:${item.fileAccessPointId}`),
        ],
        childrenLoadState: fapSmbExternalStore.isListLoading ? 'loading' : 'loaded',
      },
      fapSmbInternal: {
        id: 'fapSmbInternal',
        text: `FAP SMB Internal (${fapSmbInternalStore.items.length})`,
        isLeaf: false,
        isExpanded: expandedById.fapSmbInternal === true,
        childrenIds: [
          'fapSmbInternal:overview',
          ...fapSmbInternalStore.items.map((item) => `fapSmbInternal:${item.fileAccessPointId}`),
        ],
        childrenLoadState: fapSmbInternalStore.isListLoading ? 'loading' : 'loaded',
      },
      'fapSmbInternal:overview': {
        id: 'fapSmbInternal:overview',
        text: 'OverView',
        isLeaf: true,
        isExpanded: false,
        childrenIds: [],
        childrenLoadState: 'loaded',
      },
      'fapSmbExternal:overview': {
        id: 'fapSmbExternal:overview',
        text: 'OverView',
        isLeaf: true,
        isExpanded: false,
        childrenIds: [],
        childrenLoadState: 'loaded',
      },
    }
    fapSmbExternalStore.items.forEach((item) => {
      const sourceText = item.sourceType === 'config' ? 'CONFIG' : 'DB'
      itemDataById[`fapSmbExternal:${item.fileAccessPointId}`] = {
        id: `fapSmbExternal:${item.fileAccessPointId}`,
        text: `${item.name} [${sourceText}]`,
        isLeaf: false,
        isExpanded: expandedById[`fapSmbExternal:${item.fileAccessPointId}`] === true,
        childrenIds: [`fapSmbExternal:${item.fileAccessPointId}:config`, `fapSmbExternal:${item.fileAccessPointId}:explore`],
        childrenLoadState: 'loaded',
        fileAccessPointId: item.fileAccessPointId,
      }
      itemDataById[`fapSmbExternal:${item.fileAccessPointId}:config`] = {
        id: `fapSmbExternal:${item.fileAccessPointId}:config`,
        text: 'config',
        isLeaf: true,
        isExpanded: false,
        childrenIds: [],
        childrenLoadState: 'loaded',
        fileAccessPointId: item.fileAccessPointId,
        panel: 'config',
      }
      itemDataById[`fapSmbExternal:${item.fileAccessPointId}:explore`] = {
        id: `fapSmbExternal:${item.fileAccessPointId}:explore`,
        text: 'explore',
        isLeaf: true,
        isExpanded: false,
        childrenIds: [],
        childrenLoadState: 'loaded',
        fileAccessPointId: item.fileAccessPointId,
        panel: 'explore',
      }
    })
    fapSmbInternalStore.items.forEach((item) => {
      const sourceText = getFapSmbInternalSourceLabel(item)
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
        fapSmbInternalId: item.fileAccessPointId,
      }
      itemDataById[`fapSmbInternal:${item.fileAccessPointId}:config`] = {
        id: `fapSmbInternal:${item.fileAccessPointId}:config`,
        text: 'config',
        isLeaf: true,
        isExpanded: false,
        childrenIds: [],
        childrenLoadState: 'loaded',
        fapSmbInternalId: item.fileAccessPointId,
        panel: 'config',
      }
      itemDataById[`fapSmbInternal:${item.fileAccessPointId}:explore`] = {
        id: `fapSmbInternal:${item.fileAccessPointId}:explore`,
        text: 'explore',
        isLeaf: true,
        isExpanded: false,
        childrenIds: [],
        childrenLoadState: 'loaded',
        fapSmbInternalId: item.fileAccessPointId,
        panel: 'explore',
      }
    })
    return {
      rootItemIds: ['service', 'fapSmbExternal', 'fapSmbInternal'],
      itemDataById,
    }
  }, [
    expandedById,
    fapSmbExternalStore.items,
    fapSmbExternalStore.isListLoading,
    fapSmbInternalStore.items,
    fapSmbInternalStore.isListLoading,
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
          : appStore.currentPageKey === PAGE_KEY.fapSmbExternalOverview
            ? 'fapSmbExternal:overview'
          : appStore.currentPageKey === PAGE_KEY.fapSmbInternalOverview
            ? 'fapSmbInternal:overview'
          : fapSmbInternalStore.selectedId
            && (
              appStore.currentPageKey === PAGE_KEY.fapSmbInternalConfig
              || appStore.currentPageKey === PAGE_KEY.fapSmbInternalExplore
            )
            ? `fapSmbInternal:${fapSmbInternalStore.selectedId}:${fapSmbInternalStore.selectedPanel}`
          : fapSmbExternalStore.selectedId
            ? `fapSmbExternal:${fapSmbExternalStore.selectedId}:${fapSmbExternalStore.selectedPanel}`
            : 'fapSmbExternal'
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
        if (itemId === 'fapSmbExternal:overview' || itemId === 'fapSmbExternal') {
          appStore.selectFapSmbExternalOverview()
          return
        }
        if (itemId === 'fapSmbInternal:overview' || itemId === 'fapSmbInternal') {
          appStore.selectFapSmbInternalOverview()
          return
        }
        if (itemData?.fapSmbInternalId && itemData?.panel) {
          appStore.selectFapSmbInternal(String(itemData.fapSmbInternalId), itemData.panel)
          return
        }
        if (itemData?.fapSmbInternalId) {
          appStore.selectFapSmbInternal(String(itemData.fapSmbInternalId), 'config')
          return
        }
        if (itemData?.fileAccessPointId && itemData?.panel) {
          appStore.selectFapSmbExternal(String(itemData.fileAccessPointId), itemData.panel)
          return
        }
        if (itemData?.fileAccessPointId) {
          appStore.selectFapSmbExternal(String(itemData.fileAccessPointId), 'config')
        }
      }}
    />
  )
})

export default ResourceTree
