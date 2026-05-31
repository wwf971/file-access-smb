import React from 'react'
import { observer } from 'mobx-react-lite'
import { appStore, PAGE_KEY } from './store/appStore'
import { fapSmbExternalStore } from './store/fapSmbExternalStore'
import { fapSmbInternalStore } from './store/fapSmbInternalStore'
import ServicePanel from './service/ServicePanel'
import FapSmbExternalOverviewPanel from './fapSmbExternal/FapSmbExternalOverviewPanel'
import FapSmbExternalConfigPanel from './fapSmbExternal/FapSmbExternalConfigPanel'
import FapSmbExternalExplorePanel from './fapSmbExternal/FapSmbExternalExplorePanel'
import FapSmbInternalOverviewPanel from './fapSmbInternal/FapSmbInternalOverviewPanel'
import FapSmbInternalConfigPanel from './fapSmbInternal/FapSmbInternalConfigPanel'
import FapSmbInternalExplorePanel from './fapSmbInternal/FapSmbInternalExplorePanel'

const ResourcePanel = observer(() => {
  if (appStore.currentPageKey === PAGE_KEY.serviceMetadata) {
    return <ServicePanel mode="metadata" />
  }
  if (appStore.currentPageKey === PAGE_KEY.serviceBasicInfo) {
    return <ServicePanel mode="basic-info" />
  }
  if (appStore.currentPageKey === PAGE_KEY.serviceDatabase) {
    return <ServicePanel mode="database" />
  }
  if (appStore.currentPageKey === PAGE_KEY.fapSmbExternalOverview) {
    return <FapSmbExternalOverviewPanel />
  }
  if (appStore.currentPageKey === PAGE_KEY.fapSmbInternalOverview) {
    return <FapSmbInternalOverviewPanel />
  }
  if (
    appStore.currentPageKey === PAGE_KEY.fapSmbInternalConfig
    || appStore.currentPageKey === PAGE_KEY.fapSmbInternalExplore
  ) {
    if (!fapSmbInternalStore.selectedItem) {
      return <div className="panel-title">No FAP SMB internal selected</div>
    }
    if (appStore.currentPageKey === PAGE_KEY.fapSmbInternalExplore) {
      return <FapSmbInternalExplorePanel />
    }
    return <FapSmbInternalConfigPanel />
  }
  if (!fapSmbExternalStore.selectedItem) {
    return <div className="panel-title">No FAP SMB external selected</div>
  }
  if (appStore.currentPageKey === PAGE_KEY.fapSmbExternalExplore) {
    return <FapSmbExternalExplorePanel />
  }
  return <FapSmbExternalConfigPanel />
})

export default ResourcePanel
