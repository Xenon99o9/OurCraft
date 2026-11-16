import { create } from 'zustand'

const API_BASE = `http://${window.location.hostname}:8000`

export interface Settings {
  base_path: string
  port_min: number
  port_max: number
  path_exists?: boolean
  suggested_paths?: string[]
}

interface SettingsStore {
  settings: Settings
  isLoading: boolean
  fetchSettings: () => Promise<void>
  saveSettings: (newSettings: { base_path: string; port_min: number; port_max: number }) => Promise<{ ok: boolean; message: string }>
  scanDirectory: (basePath: string) => Promise<{ ok: boolean; message: string; added: number }>
}

export const useSettingsStore = create<SettingsStore>((set) => ({
  settings: { base_path: "", port_min: 25565, port_max: 25575, path_exists: true, suggested_paths: [] },
  isLoading: false,

  fetchSettings: async () => {
    set({ isLoading: true })
    try {
      const response = await fetch(`${API_BASE}/api/settings`)
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
      const response = await fetch(`${API_BASE}/api/settings`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(newSettings)
      })
      const data = await response.json()
      if (response.ok) {
        set({ settings: data.settings || { ...newSettings, path_exists: true }, isLoading: false })
        return { ok: true, message: data.message || "Paramètres sauvegardés !" }
      }
      set({ isLoading: false })
      return { ok: false, message: data.detail || "Erreur lors de la sauvegarde." }
    } catch (error) {
      console.error("Erreur de sauvegarde:", error)
      set({ isLoading: false })
      return { ok: false, message: "Erreur de connexion au backend." }
    }
  },

  scanDirectory: async (basePath) => {
    try {
      const response = await fetch(`${API_BASE}/api/servers/scan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ base_path: basePath })
      })
      const data = await response.json()
      if (response.ok) {
        return {
          ok: true,
          message: `${data.nouveaux_serveurs_ajoutes} nouveau(x) serveur(s) importé(s) depuis ${basePath}.`,
          added: data.nouveaux_serveurs_ajoutes
        }
      }
      return { ok: false, message: data.detail || "Erreur lors du scan.", added: 0 }
    } catch {
      return { ok: false, message: "Erreur réseau lors du scan.", added: 0 }
    }
  }
}))
