import { makeAutoObservable } from 'mobx'
import { requestAuthenticatedJson } from '../../apiRequest'
import { fileAccessPointStore } from './fileAccessPointStore'
import { serviceStore } from './serviceStore'

export const PAGE_KEY = {
  serviceMetadata: 'service-metadata',
  serviceBasicInfo: 'service-basic-info',
  serviceDatabase: 'service-database',
  fileAccessPointOverview: 'file-access-point-overview',
  fileAccessPointConfig: 'file-access-point-config',
  fileAccessPointExplore: 'file-access-point-explore',
} as const

class AppStore {
  currentPageKey: string = PAGE_KEY.serviceMetadata

  constructor() {
    makeAutoObservable(this, {}, { autoBind: true })
  }

  get errorText() {
    return fileAccessPointStore.errorText || serviceStore.errorText
  }

  async bootstrap() {
    await requestAuthenticatedJson('/api/login/check')
    await Promise.all([serviceStore.requestPing(), serviceStore.requestDatabaseInfo()])
    await fileAccessPointStore.requestLoadList()
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
}

export const appStore = new AppStore()
