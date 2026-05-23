import { makeAutoObservable, runInAction } from 'mobx'
import { requestAuthenticatedJson } from '../../apiRequest'

export class ServiceStore {
  isPingLoading = false
  errorText = ''
  pingText = 'idle'
  databaseText = 'idle'

  constructor() {
    makeAutoObservable(this, {}, { autoBind: true })
  }

  async requestPing() {
    if (this.isPingLoading) {
      return
    }
    runInAction(() => {
      this.isPingLoading = true
      this.errorText = ''
    })
    try {
      const data = await requestAuthenticatedJson('/api/health/ping')
      runInAction(() => {
        this.pingText = JSON.stringify(data)
      })
      return { isSuccess: true, messageText: this.pingText }
    } catch (error: unknown) {
      runInAction(() => {
        this.errorText = String(error)
      })
      return { isSuccess: false, messageText: String(error) }
    } finally {
      runInAction(() => {
        this.isPingLoading = false
      })
    }
  }

  async requestDatabaseInfo() {
    try {
      const data = await requestAuthenticatedJson('/api/health/database')
      runInAction(() => {
        this.databaseText = JSON.stringify(data)
      })
      return { isSuccess: true, messageText: this.databaseText }
    } catch (error: unknown) {
      runInAction(() => {
        this.errorText = String(error)
      })
      return { isSuccess: false, messageText: String(error) }
    }
  }
}

export const serviceStore = new ServiceStore()
