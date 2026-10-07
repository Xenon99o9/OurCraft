import { useEffect } from 'react';
import { useServerStore } from './store/useServerStore';

function App() {
  // On récupère TOUTES les fonctions du store maintenant !
  const { servers, isLoading, fetchServers, startServer, stopServer } = useServerStore();

  useEffect(() => {
    fetchServers();
  }, [fetchServers]);

  return (
    <div className="min-h-screen bg-[#313338] text-gray-100 font-sans p-8">
      <div className="max-w-6xl mx-auto">
        
        {/* En-tête */}
        <header className="mb-8 flex items-center justify-between border-b border-[#1E1F22] pb-6">
          <div>
            <h1 className="text-3xl font-bold text-white tracking-wide">OurCraft</h1>
            <p className="text-gray-400 text-sm mt-1">Gestionnaire de serveurs Agentless</p>
          </div>
          <button 
            onClick={fetchServers}
            className="bg-[#5865F2] hover:bg-[#4752C4] text-white px-5 py-2.5 rounded-md font-medium transition-colors shadow-md"
          >
            Actualiser
          </button>
        </header>

        {/* Gestion des états de chargement */}
        {isLoading ? (
          <div className="flex justify-center items-center h-40">
            <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-[#5865F2]"></div>
          </div>
        ) : servers.length === 0 ? (
          <div className="text-center text-gray-400 mt-20 bg-[#2B2D31] p-10 rounded-xl border border-[#1E1F22]">
            <p className="text-xl font-medium text-white mb-2">Aucun serveur détecté</p>
            <p>Démarrez un conteneur pour le voir apparaître ici.</p>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
            {/* Grille des serveurs */}
            {servers.map((server) => (
              <div key={server.id} className="bg-[#2B2D31] p-5 rounded-xl shadow-sm border border-[#1E1F22] hover:shadow-md transition-shadow flex flex-col">
                
                {/* Titre et Statut */}
                <div className="flex justify-between items-start mb-4">
                  <h2 className="text-xl font-bold text-white truncate pr-2" title={server.name}>
                    {server.name}
                  </h2>
                  <span className="flex items-center space-x-2 bg-[#1E1F22] px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider shrink-0">
                    <span className={`w-2.5 h-2.5 rounded-full ${server.status.includes('running') ? 'bg-[#23A559]' : 'bg-[#DA373C]'}`}></span>
                    <span className="text-gray-300">{server.status.includes('running') ? 'En ligne' : 'Hors ligne'}</span>
                  </span>
                </div>
                
                {/* Informations techniques */}
                <div className="mb-6 flex-grow">
                  <p className="text-xs text-gray-400 uppercase font-semibold mb-1">Image Docker</p>
                  <p className="text-sm text-gray-300 font-mono bg-[#1E1F22] p-2 rounded border border-[#111214] truncate">
                    {server.image}
                  </p>
                </div>
                
                {/* Boutons d'action : NOUVELLE LOGIQUE CONNECTÉE ICI */}
                <div className="flex space-x-3 mt-auto">
                  <button 
                    onClick={() => startServer(server)}
                    disabled={server.status.includes('running')}
                    className="flex-1 bg-[#23A559] hover:bg-[#1D8B4A] disabled:opacity-50 disabled:cursor-not-allowed text-white py-2 rounded-md font-medium transition-colors text-sm"
                  >
                    Démarrer
                  </button>
                  <button 
                    onClick={() => stopServer(server.name)}
                    disabled={!server.status.includes('running')}
                    className="flex-1 bg-[#DA373C] hover:bg-[#C92B30] disabled:opacity-50 disabled:cursor-not-allowed text-white py-2 rounded-md font-medium transition-colors text-sm"
                  >
                    Arrêter
                  </button>
                </div>

              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default App;