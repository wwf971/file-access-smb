import React from 'react'
import { observer } from 'mobx-react-lite'
import { appStore, PAGE_KEY } from './store/appStore'
import { fileAccessPointStore } from './store/fileAccessPointStore'
import ServicePanel from './service/ServicePanel'
import FileAccessPointOverviewPanel from './fileAccessPoint/FileAccessPointOverviewPanel'
import FileAccessPointConfigPanel from './fileAccessPoint/FileAccessPointConfigPanel'
import FileExplorePanel from './fileAccessPoint/FileExplorePanel'

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
  if (!fileAccessPointStore.selectedItem) {
    return <div className="panel-title">No file access point selected</div>
  }
  if (appStore.currentPageKey === PAGE_KEY.fileAccessPointExplore) {
    return <FileExplorePanel />
  }
  return <FileAccessPointConfigPanel />
})

export default ResourcePanel
