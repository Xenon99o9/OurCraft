import { create } from 'zustand'

interface Settings {
  base_path: string
  port_min: number
  port_max: number
}

interface SettingsStore {
  settings: Settings
  isLoading: boolean
  fetchSettings: () => Promise<void>
  saveSettings: (newSettings: Settings) => Promise<boolean>
}

export const useSettingsStore = create<SettingsStore>((set) => ({
  settings: { base_path: "", port_min: 25565, port_max: 25575 },
  isLoading: false,

  fetchSettings: async () => {
    set({ isLoading: true })
    try {
      const response = await fetch('http://localhost:8000/api/settings')
      const data = await response.json()
      set({ settings: data, isLoading: false })
    } catch (error) {
      console.error("Erreur de récupération des paramètres:", error)
      set({ isLoading: false })
    }
  },

  saveSettings: async (newSettings) => {
    set({ isLoading: true })
    try {
      const response = await fetch('http://localhost:8000/api/settings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newSettings)
      })
      if (response.ok) {
        set({ settings: newSettings, isLoading: false })
        return true
      }
      return false
    } catch (error) {
      console.error("Erreur de sauvegarde:", error)
      set({ isLoading: false })
      return false
    }
  }
}))