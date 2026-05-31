import { makeAutoObservable } from 'mobx'
import { requestAuthenticatedJson } from '../../apiRequest'
import { fileAccessPointStore } from './fileAccessPointStore'
import { fileAccessPointSmbInternalStore } from './fileAccessPointSmbInternalStore'
import { serviceStore } from './serviceStore'

export const PAGE_KEY = {
  serviceMetadata: 'service-metadata',
  serviceBasicInfo: 'service-basic-info',
  serviceDatabase: 'service-database',
  fileAccessPointOverview: 'file-access-point-overview',
  fileAccessPointConfig: 'file-access-point-config',
  fileAccessPointExplore: 'file-access-point-explore',
  fileAccessPointSmbInternalOverview: 'file-access-point-smb-internal-overview',
  fileAccessPointSmbInternalConfig: 'file-access-point-smb-internal-config',
  fileAccessPointSmbInternalExplore: 'file-access-point-smb-internal-explore',
} as const

class AppStore {
  currentPageKey: string = PAGE_KEY.serviceMetadata

  constructor() {
    makeAutoObservable(this, {}, { autoBind: true })
  }

  get errorText() {
    return fileAccessPointStore.errorText || fileAccessPointSmbInternalStore.errorText || serviceStore.errorText
  }

  async bootstrap() {
    await requestAuthenticatedJson('/login/check')
    await Promise.all([serviceStore.requestPing(), serviceStore.requestDatabaseInfo()])
    await Promise.all([
      fileAccessPointStore.requestLoadList(),
      fileAccessPointSmbInternalStore.requestLoadList(),
    ])
  }

  selectServicePage(pageKey: string) {
    if (
      pageKey !== PAGE_KEY.serviceMetadata
      && pageKey !== PAGE_KEY.serviceBasicInfo
      && pageKey !== PAGE_KEY.serviceDatabase
    ) {
      this.currentPageKey = PAGE_KEY.serviceMetadata
      return
    }
    this.currentPageKey = pageKey
  }

  selectFileAccessPointOverview() {
    this.currentPageKey = PAGE_KEY.fileAccessPointOverview
  }

  selectFileAccessPoint(fileAccessPointId: string, panel: 'config' | 'explore') {
    fileAccessPointStore.setSelected(fileAccessPointId, panel)
    this.currentPageKey = panel === 'config' ? PAGE_KEY.fileAccessPointConfig : PAGE_KEY.fileAccessPointExplore
  }

  selectFileAccessPointSmbInternalOverview() {
    this.currentPageKey = PAGE_KEY.fileAccessPointSmbInternalOverview
  }

  selectFileAccessPointSmbInternal(fileAccessPointId: string, panel: 'config' | 'explore') {
    fileAccessPointSmbInternalStore.setSelected(fileAccessPointId, panel)
    this.currentPageKey = panel === 'config'
      ? PAGE_KEY.fileAccessPointSmbInternalConfig
      : PAGE_KEY.fileAccessPointSmbInternalExplore
  }
}

export const appStore = new AppStore()
