import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSettingsStore } from '../store/useSettingsStore';
import { useServerStore } from '../store/useServerStore';

export default function Settings() {
  const navigate = useNavigate();
  const { settings, fetchSettings, saveSettings, scanDirectory } = useSettingsStore();
  const { fetchServers } = useServerStore();

  const [formData, setFormData] = useState({
    base_path: settings.base_path,
    port_min: settings.port_min,
    port_max: settings.port_max,
  });
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [isScanning, setIsScanning] = useState(false);

  useEffect(() => {
    fetchSettings();
  }, [fetchSettings]);

  useEffect(() => {
    setFormData({
      base_path: settings.base_path,
      port_min: settings.port_min,
      port_max: settings.port_max,
    });
  }, [settings]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);
    const res = await saveSettings(formData);
    setFeedback({
      type: res.ok ? 'success' : 'error',
      text: res.message,
    });
  };

  const handleScanExisting = async () => {
    setFeedback(null);
    setIsScanning(true);
    // On sauvegarde d'abord le chemin pour s'assurer qu'il existe
    const saveRes = await saveSettings(formData);
    if (!saveRes.ok) {
      setFeedback({ type: 'error', text: saveRes.message });
      setIsScanning(false);
      return;
    }

    const scanRes = await scanDirectory(formData.base_path);
    await fetchServers();
    setFeedback({
      type: scanRes.ok ? 'success' : 'error',
      text: scanRes.message,
    });
    setIsScanning(false);
  };

  return (
    <div className="p-8 max-w-4xl mx-auto">
      <header className="mb-8 flex items-center space-x-4 border-b border-[#1E1F22] pb-6">
        <button
          onClick={() => navigate('/')}
          className="text-gray-400 hover:text-white bg-[#2B2D31] px-3.5 py-2 rounded-lg transition-colors text-sm"
        >
          ← Retour
        </button>
        <div>
          <h1 className="text-3xl font-bold text-white tracking-wide">Paramètres de l'Application</h1>
          <p className="text-gray-400 text-sm mt-1">
            Configuration directe dans l'interface (aucune modification de fichier requise sur le serveur/Raspberry Pi)
          </p>
        </div>
      </header>

      <form onSubmit={handleSubmit} className="bg-[#2B2D31] p-6 rounded-xl border border-[#1E1F22] shadow-sm">
        {feedback && (
          <div
            className={`mb-6 p-4 rounded-lg text-sm border ${
              feedback.type === 'success'
                ? 'bg-[#23A559]/15 border-[#23A559]/50 text-[#23A559]'
                : 'bg-[#DA373C]/15 border-[#DA373C]/50 text-[#DA373C]'
            }`}
          >
            {feedback.text}
          </div>
        )}

        <div className="space-y-6">
          {/* Dossier d'installation */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="block text-white font-medium">Dossier parent des serveurs Minecraft</label>
              <span
                className={`text-xs px-2.5 py-0.5 rounded-full ${
                  settings.path_exists
                    ? 'bg-[#23A559]/20 text-[#23A559]'
                    : 'bg-amber-500/20 text-amber-300'
                }`}
              >
                {settings.path_exists
                  ? '✓ Dossier actif sur la machine'
                  : 'Sera créé automatiquement à la sauvegarde'}
              </span>
            </div>
            <p className="text-sm text-gray-400 mb-3">
              Indiquez le chemin sur votre machine (ou cliquez sur une suggestion détectée ci-dessous). OurCraft créera automatiquement le dossier s'il n'existe pas encore.
            </p>
            <input
              type="text"
              value={formData.base_path}
              onChange={(e) => setFormData({ ...formData, base_path: e.target.value })}
              placeholder="ex: /home/pi/minecraft"
              className="w-full bg-[#111214] text-white border border-[#1E1F22] rounded-md px-4 py-2.5 font-mono text-sm focus:outline-none focus:border-[#5865F2]"
              required
            />

            {settings.suggested_paths && settings.suggested_paths.length > 0 && (
              <div className="mt-3">
                <span className="text-xs text-gray-400 block mb-2">
                  Dossiers détectés sur cette machine (clic rapide) :
                </span>
                <div className="flex flex-wrap gap-2">
                  {settings.suggested_paths.map((suggestion) => {
                    const isSelected = formData.base_path === suggestion;
                    return (
                      <button
                        key={suggestion}
                        type="button"
                        onClick={() => setFormData({ ...formData, base_path: suggestion })}
                        className={`text-xs font-mono px-3 py-1.5 rounded-lg border transition-colors ${
                          isSelected
                            ? 'bg-[#5865F2] text-white border-[#5865F2]'
                            : 'bg-[#1E1F22] text-gray-300 border-[#111214] hover:border-[#5865F2]'
                        }`}
                      >
                        📁 {suggestion}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          <div className="w-full h-px bg-[#1E1F22] my-4"></div>

          {/* Plage de ports */}
          <div>
            <label className="block text-white font-medium mb-2">Plage de ports dynamiques</label>
            <p className="text-sm text-gray-400 mb-3">
              OurCraft attribuera automatiquement un port disponible dans cette plage lors de la création d'un serveur.
            </p>
            <div className="flex items-center space-x-4">
              <div className="flex-1">
                <label className="block text-xs text-gray-400 uppercase tracking-wider mb-1">Port Minimum</label>
                <input
                  type="number"
                  value={formData.port_min}
                  onChange={(e) => setFormData({ ...formData, port_min: parseInt(e.target.value) || 25565 })}
                  className="w-full bg-[#111214] text-white border border-[#1E1F22] rounded-md px-4 py-2 font-mono text-sm focus:outline-none focus:border-[#5865F2]"
                  required
                />
              </div>
              <span className="text-gray-500 mt-5">-</span>
              <div className="flex-1">
                <label className="block text-xs text-gray-400 uppercase tracking-wider mb-1">Port Maximum</label>
                <input
                  type="number"
                  value={formData.port_max}
                  onChange={(e) => setFormData({ ...formData, port_max: parseInt(e.target.value) || 25575 })}
                  className="w-full bg-[#111214] text-white border border-[#1E1F22] rounded-md px-4 py-2 font-mono text-sm focus:outline-none focus:border-[#5865F2]"
                  required
                />
              </div>
            </div>
          </div>
        </div>

        <div className="mt-8 flex flex-wrap items-center justify-between gap-4 pt-4 border-t border-[#1E1F22]">
          <button
            type="submit"
            className="bg-[#5865F2] hover:bg-[#4752C4] text-white px-6 py-2.5 rounded-md font-medium transition-colors shadow-md"
          >
            Sauvegarder (et créer le dossier)
          </button>

          <button
            type="button"
            onClick={handleScanExisting}
            disabled={isScanning}
            className="bg-[#1E1F22] hover:bg-[#111214] border border-[#111214] text-gray-200 px-5 py-2.5 rounded-md font-medium transition-colors text-sm"
          >
            {isScanning ? 'Scan en cours...' : '🔍 Importer les serveurs existants de ce dossier'}
          </button>
        </div>
      </form>
    </div>
  );
}
