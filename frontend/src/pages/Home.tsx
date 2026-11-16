import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useServerStore } from '../store/useServerStore';

export default function Home() {
  const { servers, isLoading, fetchServers, createServer } = useServerStore();
  const navigate = useNavigate();
  
  // États pour la modale de création
  const [showModal, setShowModal] = useState(false);
  const [newServerName, setNewServerName] = useState("");
  const [isCreating, setIsCreating] = useState(false);

  useEffect(() => {
    fetchServers();
  }, [fetchServers]);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newServerName.trim()) return;
    
    setIsCreating(true);
    // On formate le nom (pas d'espaces, tout en minuscules pour Docker)
    const formattedName = newServerName.trim().toLowerCase().replace(/\s+/g, '-');
    
    const success = await createServer(formattedName);
    if (success) {
      setShowModal(false);
      setNewServerName("");
    }
    setIsCreating(false);
  };

  return (
    <div className="p-8 max-w-6xl mx-auto relative">
      
      <header className="mb-8 flex items-center justify-between border-b border-[#1E1F22] pb-6">
        <div>
          <h1 className="text-3xl font-bold text-white tracking-wide">OurCraft</h1>
          <p className="text-gray-400 text-sm mt-1">Tableau de bord global</p>
        </div>
        <div className="flex space-x-3">
          <button 
            onClick={() => setShowModal(true)}
            className="bg-[#23A559] hover:bg-[#1D8B4A] text-white px-5 py-2.5 rounded-md font-medium transition-colors shadow-md flex items-center space-x-2"
          >
            <span>+ Nouveau Serveur</span>
          </button>
          <button 
            onClick={() => navigate('/settings')}
            className="bg-[#2B2D31] hover:bg-[#1E1F22] border border-[#1E1F22] text-white px-4 py-2.5 rounded-md font-medium transition-colors shadow-sm"
          >
            ⚙️
          </button>
          <button 
            onClick={fetchServers}
            className="bg-[#5865F2] hover:bg-[#4752C4] text-white px-5 py-2.5 rounded-md font-medium transition-colors shadow-md"
          >
            Actualiser
          </button>
        </div>
      </header>

      {/* Modale de création */}
      {showModal && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-[#313338] p-6 rounded-xl border border-[#1E1F22] shadow-2xl w-full max-w-md">
            <h2 className="text-2xl font-bold text-white mb-2">Créer un serveur</h2>
            <p className="text-gray-400 text-sm mb-6">Le dossier et le port seront assignés automatiquement.</p>
            
            <form onSubmit={handleCreate}>
              <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">
                Nom du serveur
              </label>
              <input 
                type="text" 
                value={newServerName}
                onChange={(e) => setNewServerName(e.target.value)}
                placeholder="ex: survie-saison-1" 
                className="w-full bg-[#1E1F22] text-white border border-[#111214] rounded-md px-4 py-3 focus:outline-none focus:border-[#5865F2] mb-6"
                required
                autoFocus
              />
              <div className="flex justify-end space-x-3">
                <button 
                  type="button" 
                  onClick={() => setShowModal(false)}
                  className="px-4 py-2 text-white hover:underline"
                >
                  Annuler
                </button>
                <button 
                  type="submit" 
                  disabled={isCreating}
                  className="bg-[#5865F2] hover:bg-[#4752C4] disabled:opacity-50 text-white px-6 py-2 rounded-md font-medium transition-colors"
                >
                  {isCreating ? "Création..." : "Créer"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Reste de la page (Grille des serveurs) */}
      {isLoading ? (
        <div className="flex justify-center items-center h-40">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-[#5865F2]"></div>
        </div>
      ) : servers.length === 0 ? (
        <div className="text-center text-gray-400 mt-20 bg-[#2B2D31] p-10 rounded-xl border border-[#1E1F22]">
          <p className="text-xl font-medium text-white mb-2">Aucun serveur détecté</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {servers.map((server) => (
            <div 
              key={server.id} 
              onClick={() => navigate(`/server/${server.name}`)}
              className="bg-[#2B2D31] p-5 rounded-xl shadow-sm border border-[#1E1F22] hover:border-[#5865F2] hover:cursor-pointer transition-colors flex flex-col group"
            >
              <div className="flex justify-between items-start mb-4">
                <h2 className="text-xl font-bold text-white truncate pr-2 group-hover:text-[#5865F2] transition-colors">
                  {server.name}
                </h2>
                <span className="flex items-center space-x-2 bg-[#1E1F22] px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider shrink-0">
                  <span className={`w-2.5 h-2.5 rounded-full ${server.status.includes('running') ? 'bg-[#23A559]' : 'bg-[#DA373C]'}`}></span>
                </span>
              </div>
              <div className="flex flex-wrap gap-1.5 mb-3 text-xs font-mono">
                <span className="bg-[#1E1F22] text-[#5865F2] px-2 py-0.5 rounded border border-[#111214]">
                  {server.server_type || 'PAPER'} {server.version || 'LATEST'}
                </span>
                <span className="bg-[#1E1F22] text-gray-300 px-2 py-0.5 rounded border border-[#111214]">
                  RAM: {server.ram || '2G'}
                </span>
              </div>
              <div className="mt-auto pt-4 flex justify-between items-center text-sm text-gray-400">
                <span>Port: {server.port}</span>
                <span className="text-[#5865F2] group-hover:underline">Gérer →</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}