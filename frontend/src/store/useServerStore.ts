import { create } from 'zustand'

const API_BASE = `http://${window.location.hostname}:8000`

export interface Server {
  id: string
  name: string
  status: string
  image: string
  path: string
  port: number
  ram?: string
  server_type?: string
  version?: string
}

export interface ServerSettingsPayload {
  port: number
  ram: string
  server_type: string
  version: string
  backup_before_convert?: boolean
}

export interface CreateServerPayload {
  name: string
  server_type: string
  version: string
  ram: string
  port?: number
}

export interface ImportCandidate {
  name: string
  path: string
  already_imported: boolean
  is_minecraft_dir: boolean
  detected_port: number | null
  detected_type?: string
  detected_version?: string
}

interface ServerStore {
  servers: Server[]
  isLoading: boolean
  fetchServers: () => Promise<void>
  startServer: (server: Server) => Promise<void>
  stopServer: (serverName: string) => Promise<void>
  deleteServer: (serverName: string) => Promise<boolean>
  createServer: (payload: CreateServerPayload) => Promise<{ ok: boolean; message: string }>
  updateServerSettings: (serverName: string, settings: ServerSettingsPayload) => Promise<{ ok: boolean; message: string }>
  fetchImportCandidates: (basePath?: string) => Promise<{ base_path: string; exists: boolean; candidates: ImportCandidate[] }>
  importServers: (
    basePath: string,
    selectedFolders: string[],
    engineOverrides?: Record<string, string>
  ) => Promise<{ ok: boolean; message: string; added: number }>
}

export const useServerStore = create<ServerStore>((set, get) => ({
  servers: [],
  isLoading: false,

  fetchServers: async () => {
    set({ isLoading: true })
    try {
      const response = await fetch(`${API_BASE}/api/servers`)
      if (!response.ok) throw new Error('Erreur réseau')
      
      const data = await response.json()
      set({ servers: data, isLoading: false })
    } catch (error) {
      console.error("Erreur lors de la récupération des serveurs:", error)
      set({ isLoading: false })
    }
  },

  startServer: async (server) => {
    try {
      const response = await fetch(`${API_BASE}/api/servers/launch`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          name: server.name,
          host_path: server.path,
          port: server.port,
          ram: server.ram || '2G',
          server_type: server.server_type || 'PAPER',
          version: server.version || 'LATEST'
        })
      })
      
      if (response.ok) {
        get().fetchServers()
      } else {
        console.error("Erreur renvoyée par l'API au démarrage")
      }
    } catch (error) {
      console.error("Erreur de connexion au démarrage:", error)
    }
  },

  stopServer: async (serverName) => {
    try {
      const response = await fetch(`${API_BASE}/api/servers/${serverName}/stop`, {
        method: 'POST'
      })
      
      if (response.ok) {
        get().fetchServers()
      } else {
        console.error("Erreur renvoyée par l'API à l'arrêt")
      }
    } catch (error) {
      console.error("Erreur de connexion à l'arrêt:", error)
    }
  },

  createServer: async (payload) => {
    try {
      const response = await fetch(`${API_BASE}/api/servers/create`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      })
      const data = await response.json()
      if (response.ok) {
        await get().fetchServers()
        return { ok: true, message: data.message || "Serveur créé avec succès !" }
      }
      return { ok: false, message: data.detail || "Erreur lors de la création du serveur." }
    } catch (error) {
      console.error("Erreur de création:", error)
      return { ok: false, message: "Impossible de contacter l'API." }
    }
  },

  deleteServer: async (serverName) => {
    try {
      const response = await fetch(`${API_BASE}/api/servers/${serverName}`, {
        method: 'DELETE'
      })
      if (response.ok) {
        get().fetchServers()
        return true
      }
      return false
    } catch (error) {
      console.error("Erreur à la suppression:", error)
      return false
    }
  },

  updateServerSettings: async (serverName, settings) => {
    try {
      const response = await fetch(`${API_BASE}/api/servers/${serverName}/settings`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(settings)
      })
      const data = await response.json()
      if (response.ok) {
        await get().fetchServers()
        return { ok: true, message: data.message || "Paramètres mis à jour !" }
      }
      return { ok: false, message: data.detail || "Erreur lors de la sauvegarde." }
    } catch (error) {
      console.error("Erreur updateServerSettings:", error)
      return { ok: false, message: "Impossible de contacter le serveur API." }
    }
  },

  fetchImportCandidates: async (basePath) => {
    try {
      const query = basePath ? `?base_path=${encodeURIComponent(basePath)}` : ''
      const response = await fetch(`${API_BASE}/api/servers/import/candidates${query}`)
      if (response.ok) {
        return await response.json()
      }
    } catch (error) {
      console.error("Erreur fetchImportCandidates:", error)
    }
    return { base_path: basePath || '', exists: false, candidates: [] }
  },

  importServers: async (basePath, selectedFolders, engineOverrides) => {
    try {
      const response = await fetch(`${API_BASE}/api/servers/scan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          base_path: basePath,
          selected_folders: selectedFolders,
          engine_overrides: engineOverrides
        })
      })
      const data = await response.json()
      if (response.ok) {
        await get().fetchServers()
        return {
          ok: true,
          message: `${data.nouveaux_serveurs_ajoutes} serveur(s) importé(s) avec succès !`,
          added: data.nouveaux_serveurs_ajoutes
        }
      }
      return { ok: false, message: data.detail || "Erreur lors de l'importation.", added: 0 }
    } catch {
      return { ok: false, message: "Erreur réseau lors de l'importation.", added: 0 }
    }
  }
}))
