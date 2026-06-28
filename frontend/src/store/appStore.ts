import { makeAutoObservable } from 'mobx'
import { requestAuthenticatedJson } from '../../apiRequest'
import { fapSmbExternalStore } from './fapSmbExternalStore'
import { fapSmbInternalStore } from './fapSmbInternalStore'
import { serviceStore } from './serviceStore'

export const PAGE_KEY = {
  serviceMetadata: 'service-metadata',
  serviceBasicInfo: 'service-basic-info',
  serviceTask: 'service-task',
  fapSmbExternalOverview: 'fap-smb-external-overview',
  fapSmbExternalConfig: 'fap-smb-external-config',
  fapSmbExternalExplore: 'fap-smb-external-explore',
  fapSmbInternalOverview: 'fap-smb-internal-overview',
  fapSmbInternalConfig: 'fap-smb-internal-config',
  fapSmbInternalExplore: 'fap-smb-internal-explore',
} as const

class AppStore {
  currentPageKey: string = PAGE_KEY.serviceMetadata

  constructor() {
    makeAutoObservable(this, {}, { autoBind: true })
  }

  get errorText() {
    return fapSmbExternalStore.errorText || fapSmbInternalStore.errorText || serviceStore.errorText
  }

  async bootstrap() {
    await requestAuthenticatedJson('/login/check', { method: 'POST', body: JSON.stringify({}) })
    await Promise.all([serviceStore.requestPing(), serviceStore.requestDatabaseInfo()])
    await Promise.all([
      fapSmbExternalStore.requestLoadList(),
      fapSmbInternalStore.requestLoadList(),
    ])
  }

  selectServicePage(pageKey: string) {
    if (
      pageKey !== PAGE_KEY.serviceMetadata
      && pageKey !== PAGE_KEY.serviceBasicInfo
      && pageKey !== PAGE_KEY.serviceTask
    ) {
      this.currentPageKey = PAGE_KEY.serviceMetadata
      return
    }
    this.currentPageKey = pageKey
  }

  selectFapSmbExternalOverview() {
    this.currentPageKey = PAGE_KEY.fapSmbExternalOverview
  }

  selectFapSmbExternal(fileAccessPointId: string, panel: 'config' | 'explore') {
    fapSmbExternalStore.setSelected(fileAccessPointId, panel)
    this.currentPageKey = panel === 'config' ? PAGE_KEY.fapSmbExternalConfig : PAGE_KEY.fapSmbExternalExplore
  }

  selectFapSmbInternalOverview() {
    this.currentPageKey = PAGE_KEY.fapSmbInternalOverview
  }

  selectFapSmbInternal(fileAccessPointId: string, panel: 'config' | 'explore') {
    fapSmbInternalStore.setSelected(fileAccessPointId, panel)
    this.currentPageKey = panel === 'config'
      ? PAGE_KEY.fapSmbInternalConfig
      : PAGE_KEY.fapSmbInternalExplore
  }
}

export const appStore = new AppStore()
