import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSettingsStore } from '../store/useSettingsStore';

export default function Settings() {
  const navigate = useNavigate();
  const { settings, fetchSettings, saveSettings } = useSettingsStore();
  
  const [formData, setFormData] = useState(settings);
  const [savedMessage, setSavedMessage] = useState(false);

  useEffect(() => {
    fetchSettings();
  }, []);

  // Met à jour le formulaire quand les données du backend arrivent
  useEffect(() => {
    setFormData(settings);
  }, [settings]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const success = await saveSettings(formData);
    if (success) {
      setSavedMessage(true);
      setTimeout(() => setSavedMessage(false), 3000); // Fait disparaître le message après 3s
    }
  };

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <header className="mb-8 flex items-center space-x-4 border-b border-[#1E1F22] pb-6">
        <button onClick={() => navigate('/')} className="text-gray-400 hover:text-white transition-colors">
          ← Retour
        </button>
        <div>
          <h1 className="text-3xl font-bold text-white tracking-wide">Paramètres de l'Application</h1>
          <p className="text-gray-400 text-sm mt-1">Configuration globale du daemon OurCraft</p>
        </div>
      </header>

      <form onSubmit={handleSubmit} className="bg-[#2B2D31] p-6 rounded-xl border border-[#1E1F22] shadow-sm">
        <div className="space-y-6">
          
          {/* Dossier d'installation */}
          <div>
            <label className="block text-white font-medium mb-2">Dossier parent des serveurs</label>
            <p className="text-sm text-gray-400 mb-3">C'est ici que les dossiers des nouveaux serveurs seront créés.</p>
            <input 
              type="text" 
              value={formData.base_path}
              onChange={(e) => setFormData({...formData, base_path: e.target.value})}
              className="w-full bg-[#111214] text-white border border-[#1E1F22] rounded-md px-4 py-2 focus:outline-none focus:border-[#5865F2]"
              required
            />
          </div>

          <div className="w-full h-px bg-[#1E1F22] my-4"></div>

          {/* Plage de ports */}
          <div>
            <label className="block text-white font-medium mb-2">Plage de ports dynamiques</label>
            <p className="text-sm text-gray-400 mb-3">OurCraft attribuera automatiquement un port disponible dans cette plage lors de la création d'un serveur.</p>
            <div className="flex items-center space-x-4">
              <div className="flex-1">
                <label className="block text-xs text-gray-400 uppercase tracking-wider mb-1">Port Minimum</label>
                <input 
                  type="number" 
                  value={formData.port_min}
                  onChange={(e) => setFormData({...formData, port_min: parseInt(e.target.value)})}
                  className="w-full bg-[#111214] text-white border border-[#1E1F22] rounded-md px-4 py-2 focus:outline-none focus:border-[#5865F2]"
                  required
                />
              </div>
              <span className="text-gray-500 mt-5">-</span>
              <div className="flex-1">
                <label className="block text-xs text-gray-400 uppercase tracking-wider mb-1">Port Maximum</label>
                <input 
                  type="number" 
                  value={formData.port_max}
                  onChange={(e) => setFormData({...formData, port_max: parseInt(e.target.value)})}
                  className="w-full bg-[#111214] text-white border border-[#1E1F22] rounded-md px-4 py-2 focus:outline-none focus:border-[#5865F2]"
                  required
                />
              </div>
            </div>
          </div>
        </div>

        <div className="mt-8 flex items-center space-x-4">
          <button 
            type="submit"
            className="bg-[#5865F2] hover:bg-[#4752C4] text-white px-6 py-2.5 rounded-md font-medium transition-colors shadow-md"
          >
            Sauvegarder
          </button>
          {savedMessage && <span className="text-[#23A559] font-medium">✓ Paramètres mis à jour</span>}
        </div>
      </form>
    </div>
  );
}