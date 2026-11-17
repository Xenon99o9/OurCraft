import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useServerStore, type ImportCandidate } from '../store/useServerStore';
import { useSettingsStore } from '../store/useSettingsStore';
import { useAuthStore, APP_THEMES, type AppThemeId } from '../store/useAuthStore';
import {
  PlusIcon,
  DownloadIcon,
  ShieldIcon,
  UsersIcon,
  SettingsIcon,
  RefreshIcon,
  FolderIcon,
  CrownIcon,
  UserIcon,
  LogOutIcon,
  PaletteIcon,
} from '../components/Icons';

const ENGINE_OPTIONS = [
  { id: 'VANILLA', name: 'Vanilla Classique', badge: 'Officiel Mojang', desc: 'Serveur Minecraft officiel pur, sans modification' },
  { id: 'PAPER', name: 'Paper', badge: 'Optimisé + Plugins', desc: 'Haute performance + support des plugins Bukkit/Spigot' },
  { id: 'FABRIC', name: 'Fabric', badge: 'Mods légers', desc: 'Idéal pour les mods modernes et les performances' },
  { id: 'FORGE', name: 'Forge', badge: 'Mods classiques', desc: 'Le grand classique pour les modpacks complets' },
  { id: 'NEOFORGE', name: 'NeoForge', badge: 'Mods 1.20+', desc: 'Successeur moderne de Forge pour les versions récentes' },
  { id: 'PURPUR', name: 'Purpur', badge: 'Paper+', desc: 'Fork de Paper avec options de gameplay avancées' },
  { id: 'SPIGOT', name: 'Spigot', badge: 'Plugins', desc: 'Moteur de plugins historique' },
];

const VERSION_PRESETS = [
  'LATEST',
  '1.21.4',
  '1.21.1',
  '1.20.4',
  '1.20.1',
  '1.19.4',
  '1.18.2',
  '1.16.5',
  '1.12.2',
];

const RAM_PRESETS = ['1G', '2G', '4G', '6G', '8G', '12G'];

export default function Home() {
  const { servers, isLoading, fetchServers, createServer, fetchImportCandidates, importServers } = useServerStore();
  const { settings, fetchSettings } = useSettingsStore();
  const { user, logout, updateTheme, hasPermission } = useAuthStore();
  const navigate = useNavigate();

  const isAdmin = user?.role === 'admin';
  const visibleServers = servers.filter((s) => hasPermission(s.name, 'view'));

  // Menu déroulant de thème du compte
  const [showThemeMenu, setShowThemeMenu] = useState(false);

  // --- ÉTATS MODALE CRÉATION ---
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newServerName, setNewServerName] = useState('');
  const [selectedType, setSelectedType] = useState('VANILLA');
  const [selectedVersion, setSelectedVersion] = useState('LATEST');
  const [customVersionMode, setCustomVersionMode] = useState(false);
  const [selectedRam, setSelectedRam] = useState('2G');
  const [selectedPort, setSelectedPort] = useState<number>(25565);
  const [isCreating, setIsCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  // --- ÉTATS MODALE IMPORTATION DÉDIÉE ---
  const [showImportModal, setShowImportModal] = useState(false);
  const [importPath, setImportPath] = useState('');
  const [candidates, setCandidates] = useState<ImportCandidate[]>([]);
  const [selectedFolders, setSelectedFolders] = useState<string[]>([]);
  const [engineOverrides, setEngineOverrides] = useState<Record<string, string>>({});
  const [isLoadingCandidates, setIsLoadingCandidates] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [importFeedback, setImportFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    fetchServers();
    fetchSettings();
  }, [fetchServers, fetchSettings]);

  const computeNextFreePort = () => {
    const used = new Set(servers.map((s) => s.port));
    const minP = settings.port_min || 25565;
    const maxP = settings.port_max || 25575;
    for (let p = minP; p <= maxP; p++) {
      if (!used.has(p)) return p;
    }
    return minP;
  };

  // --- LOGIQUE CRÉATION ---
  const openCreateModal = () => {
    setNewServerName('');
    setSelectedType('VANILLA');
    setSelectedVersion('LATEST');
    setCustomVersionMode(false);
    setSelectedRam('2G');
    setSelectedPort(computeNextFreePort());
    setCreateError(null);
    setShowCreateModal(true);
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newServerName.trim()) return;

    setIsCreating(true);
    setCreateError(null);
    const formattedName = newServerName.trim().toLowerCase().replace(/\s+/g, '-');

    const res = await createServer({
      name: formattedName,
      server_type: selectedType,
      version: selectedVersion.trim() || 'LATEST',
      ram: selectedRam.trim() || '2G',
      port: Number(selectedPort),
    });

    if (res.ok) {
      setShowCreateModal(false);
    } else {
      setCreateError(res.message);
    }
    setIsCreating(false);
  };

  // --- LOGIQUE IMPORTATION DÉDIÉE ---
  const loadCandidates = async (targetPath: string) => {
    setIsLoadingCandidates(true);
    setImportFeedback(null);
    const data = await fetchImportCandidates(targetPath);
    setImportPath(data.base_path);
    setCandidates(data.candidates);

    const initialOverrides: Record<string, string> = {};
    for (const c of data.candidates) {
      initialOverrides[c.name] = c.detected_type || 'VANILLA';
    }
    setEngineOverrides(initialOverrides);

    const autoSelected = data.candidates
      .filter((c) => !c.already_imported && c.is_minecraft_dir)
      .map((c) => c.name);
    setSelectedFolders(autoSelected);
    setIsLoadingCandidates(false);
  };

  const openImportModal = () => {
    const initialPath = settings.base_path || '';
    setImportPath(initialPath);
    setShowImportModal(true);
    loadCandidates(initialPath);
  };

  const toggleFolderSelection = (folderName: string) => {
    setSelectedFolders((prev) =>
      prev.includes(folderName) ? prev.filter((f) => f !== folderName) : [...prev, folderName]
    );
  };

  const handleConfirmImport = async () => {
    if (selectedFolders.length === 0) return;
    setIsImporting(true);
    setImportFeedback(null);
    const res = await importServers(importPath, selectedFolders, engineOverrides);
    setIsImporting(false);
    if (res.ok) {
      setImportFeedback({ type: 'success', text: res.message });
      await loadCandidates(importPath);
      setTimeout(() => {
        setShowImportModal(false);
      }, 900);
    } else {
      setImportFeedback({ type: 'error', text: res.message });
    }
  };

  const availableCandidates = candidates.filter((c) => !c.already_imported);
  const nextSuggestedPort = computeNextFreePort();
  const currentTheme = APP_THEMES.find((t) => t.id === (user?.theme || 'discord')) || APP_THEMES[0];

  return (
    <div className="p-6 md:p-8 max-w-7xl mx-auto relative">
      {/* HEADER PRINCIPAL : TOUS LES BOUTONS SUR UNE SEULE LIGNE + COMPTE EN HAUT À DROITE */}
      <header className="mb-8 border-b border-[#1E1F22] pb-5 flex items-center justify-between gap-4">
        {/* GAUCHE : Titre épuré */}
        <h1 className="text-2xl md:text-3xl font-extrabold text-white tracking-tight shrink-0">
          OurCraft
        </h1>

        {/* DROITE : Tous les boutons d'action + Compte connecté tout à droite sur la même ligne */}
        <div className="flex items-center gap-2 shrink-0">
          {isAdmin && (
            <>
              <button
                onClick={openCreateModal}
                className="bg-[#23A559] hover:bg-[#1D8B4A] text-white px-3.5 py-2 rounded-lg font-semibold transition-colors shadow-sm flex items-center gap-1.5 text-xs whitespace-nowrap"
              >
                <PlusIcon className="w-4 h-4" />
                <span>Nouveau Serveur</span>
              </button>

              <button
                onClick={openImportModal}
                className="bg-[#2B2D31] hover:bg-[#1E1F22] border border-[#1E1F22] text-white px-3 py-2 rounded-lg font-medium transition-colors flex items-center gap-1.5 text-xs whitespace-nowrap"
              >
                <DownloadIcon className="w-3.5 h-3.5 text-[#8EA1E1]" />
                <span>Importer</span>
              </button>

              <button
                onClick={() => navigate('/security')}
                className="bg-[#2B2D31] hover:bg-[#1E1F22] border border-[#1E1F22] text-amber-300 px-3 py-2 rounded-lg font-medium transition-colors flex items-center gap-1.5 text-xs whitespace-nowrap"
                title="Bouclier Réseau & Anti-Attaques"
              >
                <ShieldIcon className="w-3.5 h-3.5" />
                <span>Bouclier</span>
              </button>

              <button
                onClick={() => navigate('/users')}
                className="bg-[#2B2D31] hover:bg-[#1E1F22] border border-[#1E1F22] text-gray-200 px-3 py-2 rounded-lg font-medium transition-colors flex items-center gap-1.5 text-xs whitespace-nowrap"
                title="Gestion des comptes & droits par serveur"
              >
                <UsersIcon className="w-3.5 h-3.5 text-[#8EA1E1]" />
                <span>Comptes</span>
              </button>

              <button
                onClick={() => navigate('/settings')}
                className="bg-[#2B2D31] hover:bg-[#1E1F22] border border-[#1E1F22] text-gray-200 p-2 rounded-lg transition-colors"
                title="Paramètres globaux de l'application"
              >
                <SettingsIcon className="w-4 h-4" />
              </button>
            </>
          )}

          <button
            onClick={fetchServers}
            className="bg-[#2B2D31] hover:bg-[#1E1F22] border border-[#1E1F22] text-gray-300 hover:text-white p-2 rounded-lg transition-colors"
            title="Rafraîchir l'état des serveurs"
          >
            <RefreshIcon className="w-4 h-4" />
          </button>

          <div className="w-px h-6 bg-[#1E1F22] mx-1" />

          {/* Sélecteur de Thème sauvegardé sur le compte */}
          <div className="relative">
            <button
              onClick={() => setShowThemeMenu((v) => !v)}
              className="bg-[#2B2D31] hover:bg-[#1E1F22] border border-[#1E1F22] text-gray-200 px-2.5 py-2 rounded-lg flex items-center gap-1.5 text-xs font-medium transition-colors"
              title="Changer le thème visuel de votre compte"
            >
              <PaletteIcon className="w-3.5 h-3.5 text-[#8EA1E1]" />
              <span
                className="w-2.5 h-2.5 rounded-full"
                style={{ backgroundColor: currentTheme.color }}
              />
            </button>

            {showThemeMenu && (
              <div className="absolute right-0 mt-2 w-48 bg-[#2B2D31] border border-[#111214] rounded-xl shadow-2xl p-1.5 z-50">
                <div className="px-2.5 py-1.5 text-[10px] font-bold uppercase tracking-wider text-gray-400">
                  Thème du compte ({user?.username})
                </div>
                {APP_THEMES.map((t) => {
                  const isSelected = (user?.theme || 'discord') === t.id;
                  return (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => {
                        updateTheme(t.id as AppThemeId);
                        setShowThemeMenu(false);
                      }}
                      className={`w-full px-3 py-2 rounded-lg text-xs flex items-center justify-between transition-colors ${
                        isSelected
                          ? 'bg-[#5865F2] text-white font-semibold'
                          : 'text-gray-300 hover:bg-[#1E1F22]'
                      }`}
                    >
                      <span className="flex items-center gap-2">
                        <span
                          className="w-3 h-3 rounded-full border border-white/30"
                          style={{ backgroundColor: t.color }}
                        />
                        <span>{t.label}</span>
                      </span>
                      {isSelected && <span>✓</span>}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Badge du compte connecté tout en haut à droite */}
          {user && (
            <div className="bg-[#2B2D31] border border-[#1E1F22] text-gray-200 text-xs px-3 py-1.5 rounded-lg flex items-center gap-2 whitespace-nowrap">
              {isAdmin ? (
                <CrownIcon className="w-3.5 h-3.5 text-amber-400" />
              ) : (
                <UserIcon className="w-3.5 h-3.5 text-[#8EA1E1]" />
              )}
              <span className="font-bold text-white">{user.username}</span>
              <button
                onClick={logout}
                className="ml-1 pl-2 border-l border-[#1E1F22] text-gray-400 hover:text-[#DA373C] flex items-center gap-1 transition-colors"
                title="Se déconnecter"
              >
                <LogOutIcon className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>
      </header>

      {/* ========================================================= */}
      {/* MODALE 1 : CRÉER UN NOUVEAU SERVEUR                       */}
      {/* ========================================================= */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-[#2B2D31] rounded-2xl border border-[#1E1F22] shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[92vh]">
            <div className="p-6 bg-[#1E1F22] border-b border-[#2B2D31] flex items-center justify-between">
              <div>
                <h2 className="text-xl font-bold text-white">Créer un nouveau serveur Minecraft</h2>
                <p className="text-gray-400 text-xs mt-1">
                  Choisissez le moteur (Vanilla Classique, Paper, Forge, Fabric...), la version, la RAM et le port.
                </p>
              </div>
              <button
                onClick={() => setShowCreateModal(false)}
                className="text-gray-400 hover:text-white bg-[#2B2D31] w-8 h-8 rounded-lg flex items-center justify-center"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreate} className="p-6 overflow-y-auto space-y-5">
              {createError && (
                <div className="p-3.5 rounded-lg bg-[#DA373C]/15 border border-[#DA373C]/50 text-[#DA373C] text-sm">
                  {createError}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="sm:col-span-2">
                  <label className="block text-xs font-bold text-gray-300 uppercase tracking-wider mb-2">
                    1. Nom du serveur
                  </label>
                  <input
                    type="text"
                    value={newServerName}
                    onChange={(e) => setNewServerName(e.target.value)}
                    placeholder="ex: survie-vanilla"
                    className="w-full bg-[#1E1F22] text-white border border-[#111214] rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-[#5865F2]"
                    required
                    autoFocus
                  />
                  <p className="text-xs text-gray-500 mt-1 truncate">
                    Dossier :{' '}
                    <code className="text-gray-400">
                      {settings.base_path}/{newServerName.trim().toLowerCase().replace(/\s+/g, '-') || 'mon-serveur'}
                    </code>
                  </p>
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-300 uppercase tracking-wider mb-2">
                    2. Port d'écoute
                  </label>
                  <input
                    type="number"
                    min={1024}
                    max={65535}
                    value={selectedPort}
                    onChange={(e) => setSelectedPort(Number(e.target.value))}
                    className="w-full bg-[#1E1F22] text-white border border-[#111214] rounded-lg px-3.5 py-2.5 font-mono text-sm focus:outline-none focus:border-[#5865F2]"
                    required
                  />
                  <div className="flex items-center justify-between text-[11px] text-gray-400 mt-1">
                    <span>Prochain libre : {nextSuggestedPort}</span>
                    {selectedPort !== nextSuggestedPort && (
                      <button
                        type="button"
                        onClick={() => setSelectedPort(nextSuggestedPort)}
                        className="text-[#5865F2] hover:underline"
                      >
                        Reset
                      </button>
                    )}
                  </div>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-300 uppercase tracking-wider mb-2">
                  3. Type / Moteur du serveur (convertible à tout moment par la suite)
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {ENGINE_OPTIONS.map((eng) => {
                    const active = selectedType === eng.id;
                    return (
                      <button
                        key={eng.id}
                        type="button"
                        onClick={() => setSelectedType(eng.id)}
                        className={`p-3 rounded-xl border text-left transition-all flex flex-col justify-between ${
                          active
                            ? 'bg-[#5865F2]/20 border-[#5865F2] text-white shadow'
                            : 'bg-[#1E1F22] border-[#111214] text-gray-300 hover:border-gray-600'
                        }`}
                      >
                        <div className="flex items-center justify-between w-full mb-1">
                          <span className="font-bold text-sm text-white">{eng.name}</span>
                          <span
                            className={`text-[10px] px-2 py-0.5 rounded-full font-semibold ${
                              active ? 'bg-[#5865F2] text-white' : 'bg-[#2B2D31] text-gray-400'
                            }`}
                          >
                            {eng.badge}
                          </span>
                        </div>
                        <span className="text-xs text-gray-400">{eng.desc}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
                <div>
                  <label className="block text-xs font-bold text-gray-300 uppercase tracking-wider mb-2">
                    4. Version de Minecraft
                  </label>
                  <div className="space-y-2">
                    <select
                      value={!customVersionMode && VERSION_PRESETS.includes(selectedVersion) ? selectedVersion : 'CUSTOM'}
                      onChange={(e) => {
                        if (e.target.value === 'CUSTOM') {
                          setCustomVersionMode(true);
                          setSelectedVersion('1.20.1');
                        } else {
                          setCustomVersionMode(false);
                          setSelectedVersion(e.target.value);
                        }
                      }}
                      className="w-full bg-[#1E1F22] text-white border border-[#111214] rounded-lg px-3.5 py-2.5 text-sm focus:outline-none focus:border-[#5865F2]"
                    >
                      {VERSION_PRESETS.map((v) => (
                        <option key={v} value={v}>
                          {v === 'LATEST' ? 'LATEST (Dernière version officielle)' : `Minecraft ${v}`}
                        </option>
                      ))}
                      <option value="CUSTOM">Autre version précise...</option>
                    </select>

                    {customVersionMode && (
                      <input
                        type="text"
                        value={selectedVersion}
                        onChange={(e) => setSelectedVersion(e.target.value)}
                        placeholder="Tapez la version (ex: 1.19.2, 1.16.5...)"
                        className="w-full bg-[#111214] text-white border border-[#5865F2] rounded-lg px-3.5 py-2 font-mono text-sm focus:outline-none"
                        required
                      />
                    )}
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-300 uppercase tracking-wider mb-2">
                    5. RAM allouée au conteneur
                  </label>
                  <div className="flex flex-wrap gap-1.5 mb-2">
                    {RAM_PRESETS.map((ram) => (
                      <button
                        key={ram}
                        type="button"
                        onClick={() => setSelectedRam(ram)}
                        className={`px-3 py-1.5 rounded-lg text-xs font-mono font-bold border transition-colors ${
                          selectedRam === ram
                            ? 'bg-[#5865F2] text-white border-[#5865F2]'
                            : 'bg-[#1E1F22] text-gray-300 border-[#111214] hover:border-gray-600'
                        }`}
                      >
                        {ram}
                      </button>
                    ))}
                  </div>
                  <input
                    type="text"
                    value={selectedRam}
                    onChange={(e) => setSelectedRam(e.target.value.toUpperCase())}
                    placeholder="ex: 2G, 4G, 4096M"
                    className="w-full bg-[#1E1F22] text-white border border-[#111214] rounded-lg px-3.5 py-1.5 font-mono text-xs focus:outline-none focus:border-[#5865F2]"
                    required
                  />
                </div>
              </div>

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-[#1E1F22]">
                <button
                  type="button"
                  onClick={() => setShowCreateModal(false)}
                  className="px-4 py-2 text-sm text-gray-300 hover:text-white"
                >
                  Annuler
                </button>
                <button
                  type="submit"
                  disabled={isCreating}
                  className="bg-[#23A559] hover:bg-[#1D8B4A] disabled:opacity-50 text-white px-6 py-2.5 rounded-lg font-semibold text-sm transition-colors shadow-md"
                >
                  {isCreating
                    ? 'Création en cours...'
                    : `Créer (${selectedType} ${selectedVersion} • Port ${selectedPort})`}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* MODALE 2 : MENU D'IMPORTATION DÉDIÉ + CONVERSION          */}
      {/* ========================================================= */}
      {showImportModal && (
        <div className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-50 p-4">
          <div className="bg-[#2B2D31] rounded-2xl border border-[#1E1F22] shadow-2xl w-full max-w-2xl overflow-hidden flex flex-col max-h-[90vh]">
            <div className="p-6 bg-[#1E1F22] border-b border-[#2B2D31] flex items-center justify-between">
              <div>
                <h2 className="text-xl font-bold text-white flex items-center gap-2.5">
                  <DownloadIcon className="w-5 h-5 text-[#8EA1E1]" />
                  <span>Importer ou Convertir des serveurs existants</span>
                </h2>
                <p className="text-gray-400 text-xs mt-1">
                  OurCraft détecte automatiquement le moteur de chaque dossier (Vanilla, Paper, Forge...) et vous permet de le convertir à l'importation.
                </p>
              </div>
              <button
                onClick={() => setShowImportModal(false)}
                className="text-gray-400 hover:text-white bg-[#2B2D31] w-8 h-8 rounded-lg flex items-center justify-center"
              >
                ✕
              </button>
            </div>

            <div className="p-6 overflow-y-auto space-y-5">
              <div>
                <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">
                  Dossier parent à analyser
                </label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={importPath}
                    onChange={(e) => setImportPath(e.target.value)}
                    placeholder="/home/pi/minecraft"
                    className="flex-grow bg-[#1E1F22] text-white border border-[#111214] rounded-lg px-3.5 py-2 font-mono text-sm focus:outline-none focus:border-[#5865F2]"
                  />
                  <button
                    type="button"
                    onClick={() => loadCandidates(importPath)}
                    disabled={isLoadingCandidates}
                    className="bg-[#5865F2] hover:bg-[#4752C4] text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors shrink-0"
                  >
                    {isLoadingCandidates ? 'Analyse...' : 'Analyser'}
                  </button>
                </div>
              </div>

              {importFeedback && (
                <div
                  className={`p-3.5 rounded-lg text-sm border ${
                    importFeedback.type === 'success'
                      ? 'bg-[#23A559]/15 border-[#23A559]/50 text-[#23A559]'
                      : 'bg-[#DA373C]/15 border-[#DA373C]/50 text-[#DA373C]'
                  }`}
                >
                  {importFeedback.text}
                </div>
              )}

              <div>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-xs font-bold text-gray-400 uppercase tracking-wider">
                    Sous-dossiers trouvés ({candidates.length})
                  </span>
                  {availableCandidates.length > 0 && (
                    <div className="flex gap-3 text-xs">
                      <button
                        type="button"
                        onClick={() => setSelectedFolders(availableCandidates.map((c) => c.name))}
                        className="text-[#5865F2] hover:underline"
                      >
                        Tout cocher
                      </button>
                      <button
                        type="button"
                        onClick={() => setSelectedFolders([])}
                        className="text-gray-400 hover:underline"
                      >
                        Tout décocher
                      </button>
                    </div>
                  )}
                </div>

                {isLoadingCandidates ? (
                  <div className="bg-[#1E1F22] rounded-xl p-8 text-center text-gray-400 text-sm">
                    Inspection des dossiers en cours...
                  </div>
                ) : candidates.length === 0 ? (
                  <div className="bg-[#1E1F22] rounded-xl p-8 text-center text-gray-400 text-sm">
                    Aucun sous-dossier trouvé dans <code className="text-gray-300">{importPath}</code>.
                  </div>
                ) : (
                  <div className="bg-[#1E1F22] rounded-xl border border-[#111214] divide-y divide-[#2B2D31] max-h-72 overflow-y-auto">
                    {candidates.map((cand) => {
                      const isChecked = selectedFolders.includes(cand.name);
                      const detectedEngine = cand.detected_type || 'VANILLA';
                      const targetEngine = engineOverrides[cand.name] || detectedEngine;
                      const isConverting = targetEngine !== detectedEngine;

                      return (
                        <div
                          key={cand.path}
                          className={`p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 transition-colors ${
                            cand.already_imported ? 'opacity-50' : 'hover:bg-[#2B2D31]/60'
                          }`}
                        >
                          <div
                            onClick={() => {
                              if (!cand.already_imported) toggleFolderSelection(cand.name);
                            }}
                            className="flex items-center gap-3 min-w-0 cursor-pointer flex-grow"
                          >
                            <input
                              type="checkbox"
                              checked={cand.already_imported ? true : isChecked}
                              disabled={cand.already_imported}
                              onChange={() => {}}
                              className="w-4 h-4 accent-[#5865F2] rounded cursor-pointer shrink-0"
                            />
                            <div className="min-w-0">
                              <div className="font-semibold text-sm text-white truncate flex flex-wrap items-center gap-2">
                                <FolderIcon className="w-4 h-4 text-[#8EA1E1] shrink-0" />
                                <span>{cand.name}</span>
                                {cand.is_minecraft_dir && !cand.already_imported && (
                                  <span className="text-[10px] bg-[#23A559]/20 text-[#23A559] px-2 py-0.5 rounded-full font-medium">
                                    Détecté : {detectedEngine} ({cand.detected_version || 'LATEST'})
                                  </span>
                                )}
                                {isConverting && !cand.already_imported && (
                                  <span className="text-[10px] bg-amber-500/20 text-amber-300 px-2 py-0.5 rounded-full font-bold">
                                    Sera converti en {targetEngine}
                                  </span>
                                )}
                              </div>
                              <div className="text-xs text-gray-500 font-mono truncate">{cand.path}</div>
                            </div>
                          </div>

                          <div className="flex items-center gap-2 shrink-0 self-end sm:self-auto">
                            {cand.already_imported ? (
                              <span className="text-xs bg-[#2B2D31] text-gray-400 px-2.5 py-1 rounded-full">
                                Déjà importé
                              </span>
                            ) : (
                              <>
                                <select
                                  value={targetEngine}
                                  onChange={(e) =>
                                    setEngineOverrides((prev) => ({ ...prev, [cand.name]: e.target.value }))
                                  }
                                  className="bg-[#2B2D31] text-white border border-[#111214] rounded-lg px-2.5 py-1 text-xs focus:outline-none focus:border-[#5865F2]"
                                >
                                  {ENGINE_OPTIONS.map((eng) => (
                                    <option key={eng.id} value={eng.id}>
                                      {eng.id === detectedEngine
                                        ? `${eng.id} (Origine)`
                                        : `Convertir → ${eng.id}`}
                                    </option>
                                  ))}
                                </select>
                                {cand.detected_port ? (
                                  <span className="text-xs font-mono bg-[#2B2D31] text-gray-300 px-2 py-1 rounded">
                                    :{cand.detected_port}
                                  </span>
                                ) : null}
                              </>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>

              <div className="flex items-center justify-end gap-3 pt-4 border-t border-[#1E1F22]">
                <button
                  type="button"
                  onClick={() => setShowImportModal(false)}
                  className="px-4 py-2 text-sm text-gray-300 hover:text-white"
                >
                  Fermer
                </button>
                <button
                  type="button"
                  onClick={handleConfirmImport}
                  disabled={isImporting || selectedFolders.length === 0}
                  className="bg-[#5865F2] hover:bg-[#4752C4] disabled:opacity-40 text-white px-6 py-2.5 rounded-lg font-semibold text-sm transition-colors shadow-md"
                >
                  {isImporting
                    ? 'Importation...'
                    : `Importer la sélection (${selectedFolders.length})`}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================= */}
      {/* GRILLE DES SERVEURS                                       */}
      {/* ========================================================= */}
      {isLoading ? (
        <div className="flex justify-center items-center h-40">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-[#5865F2]"></div>
        </div>
      ) : visibleServers.length === 0 ? (
        <div className="text-center text-gray-400 mt-16 bg-[#2B2D31] p-10 rounded-xl border border-[#1E1F22]">
          <p className="text-xl font-bold text-white mb-2">Aucun serveur dans votre tableau de bord</p>
          <p className="text-sm text-gray-400 mb-6 max-w-md mx-auto">
            {isAdmin
              ? 'Créez un nouveau serveur configuré sur mesure ou importez vos dossiers de serveurs existants en un clic.'
              : "Aucun serveur n'a encore été attribué à votre sous-compte par l'administrateur."}
          </p>
          {isAdmin && (
            <div className="flex flex-wrap justify-center gap-3">
              <button
                onClick={openCreateModal}
                className="bg-[#23A559] hover:bg-[#1D8B4A] text-white px-5 py-2.5 rounded-lg font-semibold transition-colors text-sm flex items-center gap-2"
              >
                <PlusIcon className="w-4 h-4" />
                <span>Nouveau Serveur</span>
              </button>
              <button
                onClick={openImportModal}
                className="bg-[#5865F2] hover:bg-[#4752C4] text-white px-5 py-2.5 rounded-lg font-semibold transition-colors text-sm flex items-center gap-2"
              >
                <DownloadIcon className="w-4 h-4" />
                <span>Importer des serveurs existants</span>
              </button>
            </div>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {visibleServers.map((server) => {
            const isOnline = server.status.includes('running');
            return (
              <div
                key={server.id}
                onClick={() => navigate(`/server/${server.name}`)}
                className="bg-[#2B2D31] p-5 rounded-xl shadow-sm border border-[#1E1F22] hover:border-[#5865F2] hover:cursor-pointer transition-all flex flex-col group"
              >
                <div className="flex justify-between items-start mb-4">
                  <h2 className="text-xl font-bold text-white truncate pr-2 group-hover:text-[#5865F2] transition-colors">
                    {server.name}
                  </h2>
                  <span
                    className={`flex items-center space-x-1.5 px-2.5 py-1 rounded-full text-xs font-bold uppercase tracking-wider shrink-0 ${
                      isOnline ? 'bg-[#23A559]/15 text-[#23A559]' : 'bg-[#1E1F22] text-gray-400'
                    }`}
                  >
                    <span className={`w-2 h-2 rounded-full ${isOnline ? 'bg-[#23A559]' : 'bg-[#DA373C]'}`}></span>
                    <span>{isOnline ? 'En ligne' : 'Arrêté'}</span>
                  </span>
                </div>
                <div className="flex flex-wrap gap-1.5 mb-3 text-xs font-mono">
                  <span className="bg-[#1E1F22] text-[#8EA1E1] px-2.5 py-0.5 rounded border border-[#111214] font-semibold">
                    {server.server_type || 'VANILLA'} {server.version || 'LATEST'}
                  </span>
                  <span className="bg-[#1E1F22] text-gray-300 px-2.5 py-0.5 rounded border border-[#111214]">
                    RAM: {server.ram || '2G'}
                  </span>
                </div>
                <div className="mt-auto pt-4 border-t border-[#1E1F22] flex justify-between items-center text-sm text-gray-400">
                  <span className="font-mono text-xs">Port: {server.port}</span>
                  <span className="text-[#5865F2] font-medium group-hover:translate-x-0.5 transition-transform">
                    Ouvrir le panel →
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
