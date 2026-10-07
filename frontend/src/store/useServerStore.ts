import { create } from 'zustand'

interface Server {
  id: string
  name: string
  status: string
  image: string
  path: string
  port: number
}

interface ServerStore {
  servers: Server[]
  isLoading: boolean
  fetchServers: () => Promise<void>
  startServer: (server: Server) => Promise<void>
  stopServer: (serverName: string) => Promise<void>
}

// L'ajout de "get" ici permet à nos fonctions d'appeler fetchServers() pour rafraîchir la liste
export const useServerStore = create<ServerStore>((set, get) => ({
  servers: [],
  isLoading: false,

  fetchServers: async () => {
    set({ isLoading: true })
    try {
      const response = await fetch('http://localhost:8000/api/servers')
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
      const response = await fetch('http://localhost:8000/api/servers/launch', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          name: server.name,
          host_path: server.path,
          port: server.port
        })
      })
      
      if (response.ok) {
        // Le serveur est lancé, on rafraîchit l'affichage pour passer la pastille au vert
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
      const response = await fetch(`http://localhost:8000/api/servers/${serverName}/stop`, {
        method: 'POST'
      })
      
      if (response.ok) {
        // Le serveur est arrêté, on rafraîchit l'affichage pour passer la pastille au rouge
        get().fetchServers()
      } else {
        console.error("Erreur renvoyée par l'API à l'arrêt")
      }
    } catch (error) {
      console.error("Erreur de connexion à l'arrêt:", error)
    }
  }
}))