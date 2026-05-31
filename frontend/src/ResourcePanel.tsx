import React from 'react'
import { observer } from 'mobx-react-lite'
import { appStore, PAGE_KEY } from './store/appStore'
import { fileAccessPointStore } from './store/fileAccessPointStore'
import { fileAccessPointSmbInternalStore } from './store/fileAccessPointSmbInternalStore'
import ServicePanel from './service/ServicePanel'
import FileAccessPointOverviewPanel from './fileAccessPoint/FileAccessPointOverviewPanel'
import FileAccessPointConfigPanel from './fileAccessPoint/FileAccessPointConfigPanel'
import FileExplorePanel from './fileAccessPoint/FileExplorePanel'
import FileAccessPointSmbInternalOverviewPanel from './fileAccessPointSmbInternal/FileAccessPointSmbInternalOverviewPanel'
import FileAccessPointSmbInternalConfigPanel from './fileAccessPointSmbInternal/FileAccessPointSmbInternalConfigPanel'
import FileAccessPointSmbInternalExplorePanel from './fileAccessPointSmbInternal/FileAccessPointSmbInternalExplorePanel'

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
  if (appStore.currentPageKey === PAGE_KEY.fileAccessPointOverview) {
    return <FileAccessPointOverviewPanel />
  }
  if (appStore.currentPageKey === PAGE_KEY.fileAccessPointSmbInternalOverview) {
    return <FileAccessPointSmbInternalOverviewPanel />
  }
  if (
    appStore.currentPageKey === PAGE_KEY.fileAccessPointSmbInternalConfig
    || appStore.currentPageKey === PAGE_KEY.fileAccessPointSmbInternalExplore
  ) {
    if (!fileAccessPointSmbInternalStore.selectedItem) {
      return <div className="panel-title">No smb/internal file access point selected</div>
    }
    if (appStore.currentPageKey === PAGE_KEY.fileAccessPointSmbInternalExplore) {
      return <FileAccessPointSmbInternalExplorePanel />
    }
    return <FileAccessPointSmbInternalConfigPanel />
  }
  if (!fileAccessPointStore.selectedItem) {
    return <div className="panel-title">No file access point selected</div>
  }
  if (appStore.currentPageKey === PAGE_KEY.fileAccessPointExplore) {
    return <FileExplorePanel />
  }
  return <FileAccessPointConfigPanel />
})

export default ResourcePanel
