import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useServerStore } from '../store/useServerStore';

const API_BASE = `http://${window.location.hostname}:8000`;
const WS_BASE = `ws://${window.location.hostname}:8000`;

type TabType = 'console' | 'settings' | 'players' | 'files';

interface FileEntry {
  name: string;
  path: string;
  is_dir: boolean;
  size: number;
  modified: number;
  editable: boolean;
}

interface PlayersData {
  online: boolean;
  count: number;
  max: number;
  players: string[];
  ops: string[];
  banned: string[];
}

const SERVER_TYPES = [
  { value: 'PAPER', label: 'Paper (Recommandé - Plugins & Perf)' },
  { value: 'PURPUR', label: 'Purpur (Paper + Options avancées)' },
  { value: 'VANILLA', label: 'Vanilla (Officiel Mojang)' },
  { value: 'FABRIC', label: 'Fabric (Mods légers)' },
  { value: 'FORGE', label: 'Forge (Mods classiques)' },
  { value: 'NEOFORGE', label: 'NeoForge (Mods modernes)' },
  { value: 'SPIGOT', label: 'Spigot (Plugins)' },
];

const RAM_PRESETS = ['1G', '2G', '4G', '6G', '8G', '12G', '16G'];

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

const BOOLEAN_PROPS: { key: string; label: string; desc: string }[] = [
  { key: 'online-mode', label: 'Mode En Ligne (Premium)', desc: 'Vérifie les comptes auprès de Mojang (désactiver pour accepter les versions crackées)' },
  { key: 'pvp', label: 'PVP (Combat entre joueurs)', desc: 'Autorise les dégâts entre joueurs' },
  { key: 'white-list', label: 'Liste blanche (Whitelist)', desc: 'Seuls les joueurs autorisés peuvent rejoindre' },
  { key: 'allow-flight', label: 'Autoriser le vol (Allow Flight)', desc: 'Évite les expulsions injustifiées avec certains mods/plugins' },
  { key: 'enable-command-block', label: 'Blocs de commande', desc: 'Active les Command Blocks sur le serveur' },
  { key: 'hardcore', label: 'Mode Hardcore', desc: 'Bannissement ou passage en spectateur à la mort' },
];

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'Ko', 'Mo', 'Go'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

export default function ServerPanel() {
  const { serverName } = useParams();
  const navigate = useNavigate();
  const { servers, startServer, stopServer, fetchServers, deleteServer, updateServerSettings } = useServerStore();

  const [activeTab, setActiveTab] = useState<TabType>('console');
  const [logs, setLogs] = useState<string[]>([]);
  const [command, setCommand] = useState('');

  // --- ÉTATS ONGLET PARAMÈTRES ---
  const [portInput, setPortInput] = useState<number>(25565);
  const [ramInput, setRamInput] = useState<string>('2G');
  const [typeInput, setTypeInput] = useState<string>('PAPER');
  const [versionInput, setVersionInput] = useState<string>('LATEST');
  const [isSavingDocker, setIsSavingDocker] = useState(false);
  const [dockerFeedback, setDockerFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const [serverProps, setServerProps] = useState<Record<string, string>>({});
  const [propsExist, setPropsExist] = useState(false);
  const [isLoadingProps, setIsLoadingProps] = useState(false);
  const [isSavingProps, setIsSavingProps] = useState(false);
  const [propsFeedback, setPropsFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [customPropKey, setCustomPropKey] = useState('');
  const [customPropVal, setCustomPropVal] = useState('');

  // --- ÉTATS ONGLET JOUEURS ---
  const [playersData, setPlayersData] = useState<PlayersData>({
    online: false,
    count: 0,
    max: 20,
    players: [],
    ops: [],
    banned: [],
  });
  const [isLoadingPlayers, setIsLoadingPlayers] = useState(false);
  const [actionToast, setActionToast] = useState<string | null>(null);
  const [manualPlayerInput, setManualPlayerInput] = useState('');

  // --- ÉTATS ONGLET FICHIERS (WEB FTP) ---
  const [currentDir, setCurrentDir] = useState<string>('');
  const [fileItems, setFileItems] = useState<FileEntry[]>([]);
  const [isLoadingFiles, setIsLoadingFiles] = useState(false);
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
  const [selectedFileName, setSelectedFileName] = useState<string>('');
  const [editorContent, setEditorContent] = useState<string>('');
  const [originalContent, setOriginalContent] = useState<string>('');
  const [isLoadingFileContent, setIsLoadingFileContent] = useState(false);
  const [isSavingFile, setIsSavingFile] = useState(false);
  const [fileFeedback, setFileFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
  const [newFileName, setNewFileName] = useState<string>('');
  const [showNewFileInput, setShowNewFileInput] = useState(false);

  const wsRef = useRef<WebSocket | null>(null);
  const logsEndRef = useRef<HTMLDivElement>(null);

  const server = servers.find((s) => s.name === serverName);
  const isRunning = server?.status.includes('running') || false;

  useEffect(() => {
    if (servers.length === 0) fetchServers();
  }, [servers.length, fetchServers]);

  // Synchronise les champs du formulaire Docker quand le serveur est chargé
  useEffect(() => {
    if (server) {
      setPortInput(server.port || 25565);
      setRamInput(server.ram || '2G');
      setTypeInput(server.server_type || 'PAPER');
      setVersionInput(server.version || 'LATEST');
    }
  }, [server]);

  // Auto-scroll de la console
  useEffect(() => {
    if (activeTab === 'console') {
      logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, activeTab]);

  // Fonction pour charger les joueurs connectés
  const fetchPlayers = useCallback(async () => {
    if (!serverName) return;
    setIsLoadingPlayers(true);
    try {
      const res = await fetch(`${API_BASE}/api/servers/${serverName}/players`);
      if (res.ok) {
        const data = await res.json();
        setPlayersData(data);
      }
    } catch (err) {
      console.error('Erreur chargement joueurs:', err);
    } finally {
      setIsLoadingPlayers(false);
    }
  }, [serverName]);

  // Fonction pour charger server.properties
  const fetchServerProperties = useCallback(async () => {
    if (!serverName) return;
    setIsLoadingProps(true);
    try {
      const res = await fetch(`${API_BASE}/api/servers/${serverName}/properties`);
      if (res.ok) {
        const data = await res.json();
        setServerProps(data.properties || {});
        setPropsExist(Boolean(data.exists));
      }
    } catch (err) {
      console.error('Erreur chargement server.properties:', err);
    } finally {
      setIsLoadingProps(false);
    }
  }, [serverName]);

  // Fonction pour lister un dossier dans Web FTP
  const fetchDirectory = useCallback(
    async (dirPath: string) => {
      if (!serverName) return;
      setIsLoadingFiles(true);
      setFileFeedback(null);
      try {
        const res = await fetch(
          `${API_BASE}/api/servers/${serverName}/files?path=${encodeURIComponent(dirPath)}`
        );
        if (res.ok) {
          const data = await res.json();
          setCurrentDir(data.current_path || '');
          setFileItems(data.items || []);
        } else {
          const err = await res.json();
          setFileFeedback({ type: 'error', text: err.detail || 'Erreur de lecture du dossier.' });
        }
      } catch (err) {
        console.error('Erreur explorateur de fichiers:', err);
      } finally {
        setIsLoadingFiles(false);
      }
    },
    [serverName]
  );

  // Connexion WebSocket (reste active quel que soit l'onglet)
  useEffect(() => {
    if (!isRunning || !serverName) {
      if (wsRef.current) wsRef.current.close();
      setLogs(['[Système] Serveur hors ligne.']);
      return;
    }

    setLogs(['[Système] Connexion à la console en cours...']);

    const ws = new WebSocket(`${WS_BASE}/api/servers/${serverName}/ws`);
    wsRef.current = ws;

    ws.onmessage = (event) => {
      const line: string = event.data;
      setLogs((prev) => {
        const newLogs = [...prev, line];
        return newLogs.slice(-250);
      });

      // Si un joueur rejoint ou quitte dans les logs, on actualise la liste des joueurs en direct
      if (
        line.includes('joined the game') ||
        line.includes('left the game') ||
        line.includes('lost connection') ||
        line.includes('Made ') ||
        line.includes('Banned ')
      ) {
        setTimeout(() => {
          fetchPlayers();
        }, 600);
      }
    };

    ws.onclose = () => {
      setLogs((prev) => [...prev, '[Système] Connexion fermée.']);
    };

    return () => {
      ws.close();
    };
  }, [isRunning, serverName, fetchPlayers]);

  // Chargement contextuel lors du changement d'onglet
  useEffect(() => {
    if (activeTab === 'settings') {
      fetchServerProperties();
    } else if (activeTab === 'players') {
      fetchPlayers();
      const interval = setInterval(fetchPlayers, 5000);
      return () => clearInterval(interval);
    } else if (activeTab === 'files') {
      fetchDirectory(currentDir);
    }
  }, [activeTab, fetchServerProperties, fetchPlayers, fetchDirectory, currentDir]);

  // Envoi d'une commande dans le WebSocket
  const sendWsCommand = (cmd: string) => {
    if (!cmd.trim()) return false;
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
      wsRef.current.send(cmd.trim());
      return true;
    }
    return false;
  };

  const handleSendCommand = (e: React.FormEvent) => {
    e.preventDefault();
    if (command.trim() && sendWsCommand(command)) {
      setCommand('');
    }
  };

  const handleDelete = async () => {
    const confirm = window.confirm(
      `Êtes-vous sûr de vouloir supprimer le serveur "${server?.name}" ?\n\nLe conteneur sera détruit, mais vos fichiers resteront sur le disque par sécurité.`
    );
    if (confirm && server) {
      const success = await deleteServer(server.name);
      if (success) navigate('/');
    }
  };

  // --- ACTIONS ONGLET PARAMÈTRES ---
  const handleSaveDockerSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!server) return;
    setIsSavingDocker(true);
    setDockerFeedback(null);

    const res = await updateServerSettings(server.name, {
      port: Number(portInput),
      ram: ramInput,
      server_type: typeInput,
      version: versionInput,
    });

    setDockerFeedback({
      type: res.ok ? 'success' : 'error',
      text: res.message,
    });
    setIsSavingDocker(false);
    if (res.ok) {
      fetchServerProperties();
    }
  };

  const handlePropChange = (key: string, value: string) => {
    setServerProps((prev) => ({ ...prev, [key]: value }));
  };

  const handleAddCustomProp = () => {
    if (!customPropKey.trim()) return;
    setServerProps((prev) => ({ ...prev, [customPropKey.trim()]: customPropVal }));
    setCustomPropKey('');
    setCustomPropVal('');
  };

  const handleSaveProperties = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!serverName) return;
    setIsSavingProps(true);
    setPropsFeedback(null);
    try {
      const res = await fetch(`${API_BASE}/api/servers/${serverName}/properties`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ properties: serverProps }),
      });
      const data = await res.json();
      if (res.ok) {
        setPropsFeedback({ type: 'success', text: data.message });
        setPropsExist(true);
      } else {
        setPropsFeedback({ type: 'error', text: data.detail || 'Erreur lors de la sauvegarde.' });
      }
    } catch {
      setPropsFeedback({ type: 'error', text: 'Erreur réseau lors de la sauvegarde.' });
    } finally {
      setIsSavingProps(false);
    }
  };

  // --- ACTIONS ONGLET JOUEURS ---
  const triggerPlayerAction = (action: 'op' | 'deop' | 'kick' | 'ban' | 'pardon', player: string) => {
    if (!isRunning) {
      setActionToast('Le serveur doit être allumé pour exécuter une commande RCON / WebSocket.');
      setTimeout(() => setActionToast(null), 3500);
      return;
    }

    let cmd = `${action} ${player}`;
    if (action === 'kick') {
      const reason = window.prompt(`Raison de l'expulsion (Kick) de ${player} :`, 'Expulsé par un administrateur');
      if (reason === null) return;
      cmd = `kick ${player} ${reason}`;
    } else if (action === 'ban') {
      const reason = window.prompt(`Raison du bannissement (Ban) de ${player} :`, 'Banni par un administrateur');
      if (reason === null) return;
      cmd = `ban ${player} ${reason}`;
    }

    const sent = sendWsCommand(cmd);
    if (sent) {
      const actionLabels: Record<string, string> = {
        op: `Commande "op ${player}" envoyée via WebSocket`,
        deop: `Commande "deop ${player}" envoyée via WebSocket`,
        kick: `Joueur ${player} expulsé`,
        ban: `Joueur ${player} banni`,
        pardon: `Joueur ${player} débanni`,
      };
      setActionToast(`✅ ${actionLabels[action]}`);
      setTimeout(() => {
        fetchPlayers();
      }, 900);
    } else {
      setActionToast('⚠️ WebSocket non connecté.');
    }
    setTimeout(() => setActionToast(null), 3500);
  };

  // --- ACTIONS ONGLET FICHIERS (WEB FTP) ---
  const openFileInEditor = async (filePath: string, fileName: string) => {
    if (!serverName) return;
    if (editorContent !== originalContent && selectedFilePath) {
      const discard = window.confirm('Vous avez des modifications non sauvegardées. Voulez-vous vraiment changer de fichier ?');
      if (!discard) return;
    }

    setIsLoadingFileContent(true);
    setFileFeedback(null);
    try {
      const res = await fetch(
        `${API_BASE}/api/servers/${serverName}/files/content?path=${encodeURIComponent(filePath)}`
      );
      const data = await res.json();
      if (res.ok) {
        setSelectedFilePath(filePath);
        setSelectedFileName(fileName);
        setEditorContent(data.content);
        setOriginalContent(data.content);
      } else {
        setFileFeedback({ type: 'error', text: data.detail || 'Impossible de lire ce fichier.' });
      }
    } catch {
      setFileFeedback({ type: 'error', text: 'Erreur réseau lors de la lecture du fichier.' });
    } finally {
      setIsLoadingFileContent(false);
    }
  };

  const handleSaveFile = async () => {
    if (!serverName || !selectedFilePath) return;
    setIsSavingFile(true);
    setFileFeedback(null);
    try {
      const res = await fetch(`${API_BASE}/api/servers/${serverName}/files/content`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: selectedFilePath,
          content: editorContent,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setOriginalContent(editorContent);
        setFileFeedback({ type: 'success', text: data.message });
        fetchDirectory(currentDir);
      } else {
        setFileFeedback({ type: 'error', text: data.detail || 'Erreur lors de la sauvegarde.' });
      }
    } catch {
      setFileFeedback({ type: 'error', text: 'Erreur réseau lors de la sauvegarde.' });
    } finally {
      setIsSavingFile(false);
    }
  };

  const handleCreateNewFile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newFileName.trim() || !serverName) return;
    const targetRelPath = currentDir ? `${currentDir}/${newFileName.trim()}` : newFileName.trim();
    setIsSavingFile(true);
    try {
      const res = await fetch(`${API_BASE}/api/servers/${serverName}/files/content`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          path: targetRelPath,
          content: '',
        }),
      });
      if (res.ok) {
        setShowNewFileInput(false);
        const createdName = newFileName.trim();
        setNewFileName('');
        await fetchDirectory(currentDir);
        openFileInEditor(targetRelPath, createdName);
      } else {
        const err = await res.json();
        setFileFeedback({ type: 'error', text: err.detail || 'Impossible de créer le fichier.' });
      }
    } catch {
      setFileFeedback({ type: 'error', text: 'Erreur réseau.' });
    } finally {
      setIsSavingFile(false);
    }
  };

  const navigateUpDirectory = () => {
    if (!currentDir) return;
    const parts = currentDir.split('/').filter(Boolean);
    parts.pop();
    fetchDirectory(parts.join('/'));
  };

  if (!server) return <div className="text-white p-8">Chargement ou serveur introuvable...</div>;

  const tabs: {
    id: TabType;
    label: string;
    subtitle: string;
    fullTitle: string;
    description: string;
    icon: string;
    badge?: string | number;
  }[] = [
    {
      id: 'console',
      label: 'Console',
      subtitle: 'Terminal & RCON',
      fullTitle: 'Console Temps Réel & Commandes RCON',
      description: 'Suivez les logs du conteneur en direct via WebSocket et exécutez vos commandes administrateur.',
      icon: '💻',
    },
    {
      id: 'settings',
      label: 'Paramètres',
      subtitle: 'Docker & Propriétés',
      fullTitle: 'Configuration du Serveur & Moteur Docker',
      description: 'Ajustez le port, la mémoire RAM, la version du jeu et les règles de server.properties.',
      icon: '⚙️',
    },
    {
      id: 'players',
      label: 'Joueurs',
      subtitle: 'En ligne & Modération',
      fullTitle: 'Joueurs Connectés & Modération en Direct',
      description: 'Visualisez les joueurs actifs sur le serveur et appliquez des actions rapides (OP, Kick, Ban).',
      icon: '👥',
      badge: isRunning ? `${playersData.count}/${playersData.max}` : undefined,
    },
    {
      id: 'files',
      label: 'Fichiers',
      subtitle: 'Explorateur Web FTP',
      fullTitle: 'Explorateur de Fichiers & Éditeur de Configuration',
      description: 'Parcourez l’arborescence du serveur (/data) et modifiez vos fichiers .yml, .json ou .properties.',
      icon: '📁',
    },
  ];

  const currentTabInfo = tabs.find((t) => t.id === activeTab) || tabs[0];
  const hasUnsavedFileChanges = selectedFilePath !== null && editorContent !== originalContent;
  const breadcrumbs = currentDir ? currentDir.split('/').filter(Boolean) : [];

  return (
    <div className="p-6 md:p-8 max-w-6xl mx-auto h-screen flex flex-col">
      {/* HEADER DU SERVEUR */}
      <header className="mb-4 flex flex-col md:flex-row md:items-center justify-between bg-[#2B2D31] p-5 rounded-xl border border-[#1E1F22] shrink-0">
        <div className="flex items-center space-x-4 mb-4 md:mb-0">
          <button
            onClick={() => navigate('/')}
            className="text-gray-400 hover:text-white bg-[#1E1F22] px-3 py-1.5 rounded-lg transition-colors text-sm"
          >
            ← Retour
          </button>
          <div>
            <div className="flex items-center space-x-3">
              <h1 className="text-2xl font-bold text-white">{server.name}</h1>
              <span
                className={`px-2.5 py-0.5 rounded-full text-xs font-bold uppercase tracking-wider flex items-center space-x-1.5 ${
                  isRunning ? 'bg-[#23A559]/20 text-[#23A559]' : 'bg-[#DA373C]/20 text-[#DA373C]'
                }`}
              >
                <span className={`w-2 h-2 rounded-full ${isRunning ? 'bg-[#23A559]' : 'bg-[#DA373C]'}`}></span>
                <span>{isRunning ? 'En ligne' : 'Hors ligne'}</span>
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2 mt-1.5 text-xs text-gray-400">
              <span className="bg-[#1E1F22] px-2.5 py-1 rounded border border-[#111214] font-mono">
                Port: <strong className="text-gray-200">{server.port}</strong>
              </span>
              <span className="bg-[#1E1F22] px-2.5 py-1 rounded border border-[#111214] font-mono">
                Moteur: <strong className="text-[#5865F2]">{server.server_type || 'PAPER'}</strong> ({server.version || 'LATEST'})
              </span>
              <span className="bg-[#1E1F22] px-2.5 py-1 rounded border border-[#111214] font-mono">
                RAM: <strong className="text-gray-200">{server.ram || '2G'}</strong>
              </span>
              <span className="hidden lg:inline text-gray-500 truncate max-w-xs" title={server.path}>
                {server.path}
              </span>
            </div>
          </div>
        </div>

        {/* BOUTONS D'ACTION (Démarrer, Arrêter, Supprimer) */}
        <div className="flex items-center space-x-3">
          <button
            onClick={() => startServer(server)}
            disabled={isRunning}
            className="bg-[#23A559] hover:bg-[#1D8B4A] disabled:opacity-40 disabled:cursor-not-allowed text-white px-5 py-2 rounded-md font-medium transition-colors shadow text-sm"
          >
            ▶ Démarrer
          </button>
          <button
            onClick={() => stopServer(server.name)}
            disabled={!isRunning}
            className="bg-[#DA373C] hover:bg-[#C92B30] disabled:opacity-40 disabled:cursor-not-allowed text-white px-5 py-2 rounded-md font-medium transition-colors shadow text-sm"
          >
            ■ Arrêter
          </button>

          <div className="w-px h-8 bg-[#1E1F22] mx-1"></div>

          <button
            onClick={handleDelete}
            className="text-gray-400 hover:text-[#DA373C] hover:bg-[#DA373C]/10 px-3.5 py-2 rounded-md font-medium transition-colors text-sm border border-transparent hover:border-[#DA373C]/50"
          >
            Supprimer
          </button>
        </div>
      </header>

      {/* BARRE D'ONGLETS REDESIGNÉE */}
      <nav className="grid grid-cols-2 md:grid-cols-4 gap-2.5 mb-4 shrink-0">
        {tabs.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center justify-between p-3.5 rounded-xl border text-left transition-all ${
                isActive
                  ? 'bg-[#5865F2] border-[#5865F2] text-white shadow-lg'
                  : 'bg-[#2B2D31] border-[#1E1F22] text-gray-300 hover:bg-[#35373C] hover:text-white'
              }`}
            >
              <div className="flex items-center space-x-3 min-w-0">
                <span
                  className={`w-10 h-10 rounded-lg flex items-center justify-center text-lg shrink-0 ${
                    isActive ? 'bg-white/20' : 'bg-[#1E1F22]'
                  }`}
                >
                  {tab.icon}
                </span>
                <div className="min-w-0">
                  <div className="font-bold text-sm truncate">{tab.label}</div>
                  <div className={`text-xs truncate ${isActive ? 'text-indigo-100' : 'text-gray-400'}`}>
                    {tab.subtitle}
                  </div>
                </div>
              </div>
              {tab.badge !== undefined && (
                <span
                  className={`ml-2 px-2 py-0.5 text-xs rounded-full font-mono font-bold shrink-0 ${
                    isActive ? 'bg-white/25 text-white' : 'bg-[#1E1F22] text-[#23A559]'
                  }`}
                >
                  {tab.badge}
                </span>
              )}
            </button>
          );
        })}
      </nav>

      {/* BANNIÈRE DE TITRE DE L'ONGLET ACTIF */}
      <div className="mb-4 px-5 py-3.5 bg-[#1E1F22] rounded-xl border border-[#2B2D31] flex flex-col sm:flex-row sm:items-center justify-between gap-2 shrink-0">
        <div className="flex items-center space-x-3">
          <span className="text-xl">{currentTabInfo.icon}</span>
          <div>
            <h2 className="text-base font-bold text-white tracking-wide">{currentTabInfo.fullTitle}</h2>
            <p className="text-xs text-gray-400">{currentTabInfo.description}</p>
          </div>
        </div>
        <div className="text-xs font-mono text-gray-400 shrink-0 bg-[#2B2D31] px-3 py-1 rounded-md border border-[#111214]">
          Conteneur: <span className="text-gray-200">ourcraft_{server.name}</span>
        </div>
      </div>

      {/* CONTENU DE L'ONGLET ACTIF */}
      <div className="flex-grow flex flex-col overflow-hidden min-h-0">
        {/* ========================================== */}
        {/* ONGLET 1 : CONSOLE                         */}
        {/* ========================================== */}
        {activeTab === 'console' && (
          <div className="flex-grow bg-[#111214] rounded-xl border border-[#1E1F22] flex flex-col overflow-hidden shadow-lg">
            <div className="bg-[#1E1F22] p-2.5 px-4 border-b border-[#2B2D31] text-xs font-mono text-gray-400 uppercase tracking-wider flex justify-between items-center shrink-0">
              <span>Terminal Serveur ({server.name})</span>
              <span className={isRunning ? 'text-[#23A559]' : 'text-gray-500'}>
                {isRunning ? '● Flux WebSocket actif' : '○ Hors ligne'}
              </span>
            </div>

            <div className="flex-grow p-4 font-mono text-sm overflow-y-auto space-y-1">
              {logs.map((log, index) => {
                let colorClass = 'text-gray-300';
                const lower = log.toLowerCase();
                if (lower.includes('error') || lower.includes('exception') || lower.includes('failed')) {
                  colorClass = 'text-red-400';
                } else if (lower.includes('warn')) {
                  colorClass = 'text-yellow-400';
                } else if (lower.includes('done') || lower.includes('joined the game')) {
                  colorClass = 'text-[#23A559]';
                } else if (lower.includes('info')) {
                  colorClass = 'text-blue-300';
                }

                return (
                  <p key={index} className={`break-words leading-relaxed ${colorClass}`}>
                    {log}
                  </p>
                );
              })}
              <div ref={logsEndRef} />
            </div>

            <form onSubmit={handleSendCommand} className="p-3 bg-[#1E1F22] border-t border-[#2B2D31] flex gap-2 shrink-0">
              <input
                type="text"
                value={command}
                onChange={(e) => setCommand(e.target.value)}
                placeholder={
                  isRunning
                    ? 'Tapez une commande Minecraft (ex: say Bonjour, gamemode creative, list)...'
                    : 'Démarrez le serveur pour envoyer des commandes...'
                }
                className="flex-grow bg-[#111214] text-white border border-[#2B2D31] rounded-md px-4 py-2 font-mono text-sm focus:outline-none focus:border-[#5865F2] disabled:opacity-50"
                disabled={!isRunning}
              />
              <button
                type="submit"
                disabled={!isRunning || !command.trim()}
                className="bg-[#5865F2] hover:bg-[#4752C4] disabled:opacity-40 text-white px-5 py-2 rounded-md text-sm font-medium transition-colors"
              >
                Envoyer
              </button>
            </form>
          </div>
        )}

        {/* ========================================== */}
        {/* ONGLET 2 : PARAMÈTRES                      */}
        {/* ========================================== */}
        {activeTab === 'settings' && (
          <div className="flex-grow overflow-y-auto space-y-6 pr-1">
            {/* Carte 1 : Configuration Conteneur Docker & Jeu */}
            <form
              onSubmit={handleSaveDockerSettings}
              className="bg-[#2B2D31] rounded-xl border border-[#1E1F22] p-6 shadow-lg text-white"
            >
              <div className="flex flex-col md:flex-row md:items-center justify-between mb-6 pb-4 border-b border-[#1E1F22]">
                <div>
                  <h2 className="text-xl font-bold flex items-center gap-2">
                    <span>🐳</span>
                    <span>Moteur de jeu & Conteneur Docker</span>
                  </h2>
                  <p className="text-gray-400 text-sm mt-1">
                    Modifiez le port, la RAM allouée et le moteur Minecraft (variables d'environnement Docker{' '}
                    <code className="text-gray-300 bg-[#1E1F22] px-1.5 py-0.5 rounded">TYPE</code>,{' '}
                    <code className="text-gray-300 bg-[#1E1F22] px-1.5 py-0.5 rounded">VERSION</code>,{' '}
                    <code className="text-gray-300 bg-[#1E1F22] px-1.5 py-0.5 rounded">MEMORY</code>).
                  </p>
                </div>
                <button
                  type="submit"
                  disabled={isSavingDocker}
                  className="mt-4 md:mt-0 bg-[#5865F2] hover:bg-[#4752C4] disabled:opacity-50 text-white px-5 py-2.5 rounded-lg font-medium transition-colors shadow text-sm shrink-0"
                >
                  {isSavingDocker
                    ? 'Application en cours...'
                    : isRunning
                    ? 'Sauvegarder & Redémarrer le conteneur'
                    : 'Sauvegarder la configuration'}
                </button>
              </div>

              {dockerFeedback && (
                <div
                  className={`mb-6 p-3.5 rounded-lg text-sm border ${
                    dockerFeedback.type === 'success'
                      ? 'bg-[#23A559]/15 border-[#23A559]/50 text-[#23A559]'
                      : 'bg-[#DA373C]/15 border-[#DA373C]/50 text-[#DA373C]'
                  }`}
                >
                  {dockerFeedback.text}
                </div>
              )}

              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
                {/* Port */}
                <div>
                  <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">
                    Port du serveur
                  </label>
                  <input
                    type="number"
                    min={1024}
                    max={65535}
                    value={portInput}
                    onChange={(e) => setPortInput(Number(e.target.value))}
                    className="w-full bg-[#1E1F22] text-white border border-[#111214] rounded-lg px-4 py-2.5 font-mono text-sm focus:outline-none focus:border-[#5865F2]"
                    required
                  />
                  <span className="text-xs text-gray-500 mt-1 block">Défaut Minecraft : 25565</span>
                </div>

                {/* RAM */}
                <div>
                  <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">
                    RAM allouée (MEMORY)
                  </label>
                  <div className="flex gap-2">
                    <select
                      value={RAM_PRESETS.includes(ramInput) ? ramInput : 'CUSTOM'}
                      onChange={(e) => {
                        if (e.target.value !== 'CUSTOM') setRamInput(e.target.value);
                      }}
                      className="bg-[#1E1F22] text-white border border-[#111214] rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-[#5865F2]"
                    >
                      {RAM_PRESETS.map((preset) => (
                        <option key={preset} value={preset}>
                          {preset}
                        </option>
                      ))}
                      <option value="CUSTOM">Autre</option>
                    </select>
                    <input
                      type="text"
                      value={ramInput}
                      onChange={(e) => setRamInput(e.target.value.toUpperCase())}
                      placeholder="ex: 4G ou 4096M"
                      className="w-full bg-[#1E1F22] text-white border border-[#111214] rounded-lg px-3 py-2.5 font-mono text-sm focus:outline-none focus:border-[#5865F2]"
                      required
                    />
                  </div>
                  <span className="text-xs text-gray-500 mt-1 block">Format: 2G, 4G, 6G, 4096M...</span>
                </div>

                {/* Type du serveur */}
                <div>
                  <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">
                    Type de serveur (TYPE)
                  </label>
                  <select
                    value={typeInput}
                    onChange={(e) => setTypeInput(e.target.value)}
                    className="w-full bg-[#1E1F22] text-white border border-[#111214] rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-[#5865F2]"
                  >
                    {SERVER_TYPES.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </select>
                  <span className="text-xs text-gray-500 mt-1 block">Image itzg/minecraft-server</span>
                </div>

                {/* Version du jeu */}
                <div>
                  <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">
                    Version Minecraft (VERSION)
                  </label>
                  <div className="flex gap-2">
                    <select
                      value={VERSION_PRESETS.includes(versionInput) ? versionInput : 'CUSTOM'}
                      onChange={(e) => {
                        if (e.target.value !== 'CUSTOM') setVersionInput(e.target.value);
                      }}
                      className="bg-[#1E1F22] text-white border border-[#111214] rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-[#5865F2]"
                    >
                      {VERSION_PRESETS.map((v) => (
                        <option key={v} value={v}>
                          {v}
                        </option>
                      ))}
                      <option value="CUSTOM">Précise...</option>
                    </select>
                    <input
                      type="text"
                      value={versionInput}
                      onChange={(e) => setVersionInput(e.target.value)}
                      placeholder="ex: 1.20.4"
                      className="w-full bg-[#1E1F22] text-white border border-[#111214] rounded-lg px-3 py-2.5 font-mono text-sm focus:outline-none focus:border-[#5865F2]"
                      required
                    />
                  </div>
                  <span className="text-xs text-gray-500 mt-1 block">LATEST ou version exacte</span>
                </div>
              </div>
            </form>

            {/* Carte 2 : Éditeur server.properties */}
            <form
              onSubmit={handleSaveProperties}
              className="bg-[#2B2D31] rounded-xl border border-[#1E1F22] p-6 shadow-lg text-white"
            >
              <div className="flex flex-col md:flex-row md:items-center justify-between mb-6 pb-4 border-b border-[#1E1F22]">
                <div>
                  <div className="flex items-center gap-3">
                    <h2 className="text-xl font-bold">📄 Fichier server.properties</h2>
                    <span
                      className={`text-xs px-2.5 py-0.5 rounded-full ${
                        propsExist ? 'bg-[#23A559]/20 text-[#23A559]' : 'bg-yellow-500/20 text-yellow-300'
                      }`}
                    >
                      {propsExist ? 'Fichier détecté sur le disque' : 'Pré-configuration (sera créé à la sauvegarde)'}
                    </span>
                  </div>
                  <p className="text-gray-400 text-sm mt-1">
                    Personnalisez les règles du monde, le nombre de joueurs, la difficulté et l'authentification.
                  </p>
                </div>

                <div className="flex items-center gap-3 mt-4 md:mt-0">
                  {propsExist && (
                    <button
                      type="button"
                      onClick={() => {
                        setActiveTab('files');
                        openFileInEditor('server.properties', 'server.properties');
                      }}
                      className="bg-[#1E1F22] hover:bg-[#111214] text-gray-300 px-4 py-2.5 rounded-lg text-sm border border-[#111214] transition-colors"
                    >
                      Ouvrir dans l'éditeur brut →
                    </button>
                  )}
                  <button
                    type="submit"
                    disabled={isSavingProps || isLoadingProps}
                    className="bg-[#23A559] hover:bg-[#1D8B4A] disabled:opacity-50 text-white px-5 py-2.5 rounded-lg font-medium transition-colors shadow text-sm"
                  >
                    {isSavingProps ? 'Sauvegarde...' : 'Enregistrer server.properties'}
                  </button>
                </div>
              </div>

              {propsFeedback && (
                <div
                  className={`mb-6 p-3.5 rounded-lg text-sm border ${
                    propsFeedback.type === 'success'
                      ? 'bg-[#23A559]/15 border-[#23A559]/50 text-[#23A559]'
                      : 'bg-[#DA373C]/15 border-[#DA373C]/50 text-[#DA373C]'
                  }`}
                >
                  {propsFeedback.text}
                </div>
              )}

              {isLoadingProps ? (
                <div className="text-gray-400 py-8 text-center">Chargement de server.properties...</div>
              ) : (
                <div className="space-y-6">
                  {/* Champs principaux */}
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
                    <div className="md:col-span-2 lg:col-span-3">
                      <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">
                        Message du jour (motd)
                      </label>
                      <input
                        type="text"
                        value={serverProps['motd'] ?? ''}
                        onChange={(e) => handlePropChange('motd', e.target.value)}
                        className="w-full bg-[#1E1F22] text-white border border-[#111214] rounded-lg px-4 py-2.5 text-sm focus:outline-none focus:border-[#5865F2]"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">
                        Mode de jeu (gamemode)
                      </label>
                      <select
                        value={serverProps['gamemode'] ?? 'survival'}
                        onChange={(e) => handlePropChange('gamemode', e.target.value)}
                        className="w-full bg-[#1E1F22] text-white border border-[#111214] rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-[#5865F2]"
                      >
                        <option value="survival">Survie (survival)</option>
                        <option value="creative">Créatif (creative)</option>
                        <option value="adventure">Aventure (adventure)</option>
                        <option value="spectator">Spectateur (spectator)</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">
                        Difficulté (difficulty)
                      </label>
                      <select
                        value={serverProps['difficulty'] ?? 'normal'}
                        onChange={(e) => handlePropChange('difficulty', e.target.value)}
                        className="w-full bg-[#1E1F22] text-white border border-[#111214] rounded-lg px-3 py-2.5 text-sm focus:outline-none focus:border-[#5865F2]"
                      >
                        <option value="peaceful">Paisible (peaceful)</option>
                        <option value="easy">Facile (easy)</option>
                        <option value="normal">Normal (normal)</option>
                        <option value="hard">Difficile (hard)</option>
                      </select>
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">
                        Joueurs Max (max-players)
                      </label>
                      <input
                        type="number"
                        min={1}
                        max={1000}
                        value={serverProps['max-players'] ?? '20'}
                        onChange={(e) => handlePropChange('max-players', e.target.value)}
                        className="w-full bg-[#1E1F22] text-white border border-[#111214] rounded-lg px-4 py-2.5 font-mono text-sm focus:outline-none focus:border-[#5865F2]"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">
                        Distance d'affichage (view-distance)
                      </label>
                      <input
                        type="number"
                        min={2}
                        max={32}
                        value={serverProps['view-distance'] ?? '10'}
                        onChange={(e) => handlePropChange('view-distance', e.target.value)}
                        className="w-full bg-[#1E1F22] text-white border border-[#111214] rounded-lg px-4 py-2.5 font-mono text-sm focus:outline-none focus:border-[#5865F2]"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">
                        Protection du Spawn (spawn-protection)
                      </label>
                      <input
                        type="number"
                        min={0}
                        value={serverProps['spawn-protection'] ?? '16'}
                        onChange={(e) => handlePropChange('spawn-protection', e.target.value)}
                        className="w-full bg-[#1E1F22] text-white border border-[#111214] rounded-lg px-4 py-2.5 font-mono text-sm focus:outline-none focus:border-[#5865F2]"
                      />
                    </div>

                    <div>
                      <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">
                        Graine du monde (level-seed)
                      </label>
                      <input
                        type="text"
                        value={serverProps['level-seed'] ?? ''}
                        onChange={(e) => handlePropChange('level-seed', e.target.value)}
                        placeholder="Laisser vide pour aléatoire"
                        className="w-full bg-[#1E1F22] text-white border border-[#111214] rounded-lg px-4 py-2.5 font-mono text-sm focus:outline-none focus:border-[#5865F2]"
                      />
                    </div>
                  </div>

                  {/* Interrupteurs booléens */}
                  <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 pt-2">
                    {BOOLEAN_PROPS.map((item) => {
                      const isEnabled = (serverProps[item.key] ?? 'false').toLowerCase() === 'true';
                      return (
                        <div
                          key={item.key}
                          onClick={() => handlePropChange(item.key, isEnabled ? 'false' : 'true')}
                          className="bg-[#1E1F22] border border-[#111214] hover:border-[#5865F2]/50 rounded-lg p-4 flex items-center justify-between cursor-pointer transition-colors"
                        >
                          <div className="pr-3">
                            <div className="text-sm font-semibold text-white">{item.label}</div>
                            <div className="text-xs text-gray-400 mt-0.5">{item.desc}</div>
                          </div>
                          <button
                            type="button"
                            className={`w-11 h-6 flex items-center rounded-full p-1 transition-colors shrink-0 ${
                              isEnabled ? 'bg-[#23A559]' : 'bg-gray-600'
                            }`}
                          >
                            <div
                              className={`bg-white w-4 h-4 rounded-full shadow-md transform transition-transform ${
                                isEnabled ? 'translate-x-5' : 'translate-x-0'
                              }`}
                            />
                          </button>
                        </div>
                      );
                    })}
                  </div>

                  {/* Ajout ou modification d'une propriété personnalisée */}
                  <div className="pt-4 border-t border-[#1E1F22]">
                    <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">
                      Ajouter / Modifier une clé spécifique dans server.properties
                    </label>
                    <div className="flex flex-col sm:flex-row gap-2">
                      <input
                        type="text"
                        value={customPropKey}
                        onChange={(e) => setCustomPropKey(e.target.value)}
                        placeholder="Clé (ex: max-tick-time)"
                        className="bg-[#1E1F22] text-white border border-[#111214] rounded-lg px-3.5 py-2 font-mono text-sm focus:outline-none focus:border-[#5865F2]"
                      />
                      <input
                        type="text"
                        value={customPropVal}
                        onChange={(e) => setCustomPropVal(e.target.value)}
                        placeholder="Valeur (ex: 60000)"
                        className="bg-[#1E1F22] text-white border border-[#111214] rounded-lg px-3.5 py-2 font-mono text-sm focus:outline-none focus:border-[#5865F2]"
                      />
                      <button
                        type="button"
                        onClick={handleAddCustomProp}
                        className="bg-[#1E1F22] hover:bg-[#111214] text-white border border-[#111214] px-4 py-2 rounded-lg text-sm font-medium transition-colors"
                      >
                        + Définir la clé
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </form>
          </div>
        )}

        {/* ========================================== */}
        {/* ONGLET 3 : JOUEURS                         */}
        {/* ========================================== */}
        {activeTab === 'players' && (
          <div className="flex-grow overflow-y-auto space-y-6 pr-1">
            {actionToast && (
              <div className="bg-[#5865F2]/20 border border-[#5865F2] text-white px-4 py-3 rounded-xl text-sm flex items-center justify-between shadow">
                <span>{actionToast}</span>
                <button onClick={() => setActionToast(null)} className="text-gray-300 hover:text-white">
                  ✕
                </button>
              </div>
            )}

            {/* Carte principale : Joueurs connectés en temps réel */}
            <div className="bg-[#2B2D31] rounded-xl border border-[#1E1F22] p-6 text-white shadow-lg">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-6 pb-4 border-b border-[#1E1F22]">
                <div>
                  <h2 className="text-xl font-bold flex items-center gap-3">
                    <span>Joueurs en ligne</span>
                    <span className="bg-[#1E1F22] border border-[#111214] px-3 py-0.5 rounded-full text-sm font-mono text-[#5865F2]">
                      {playersData.count} / {playersData.max}
                    </span>
                  </h2>
                  <p className="text-gray-400 text-sm mt-1">
                    Liste actualisée en temps réel. Les boutons d'action envoient directement les commandes dans le WebSocket.
                  </p>
                </div>

                <button
                  onClick={fetchPlayers}
                  disabled={isLoadingPlayers}
                  className="bg-[#1E1F22] hover:bg-[#111214] border border-[#111214] text-gray-200 px-4 py-2 rounded-lg text-sm font-medium transition-colors self-start sm:self-auto"
                >
                  {isLoadingPlayers ? 'Actualisation...' : '↻ Actualiser'}
                </button>
              </div>

              {!isRunning ? (
                <div className="bg-[#1E1F22] border border-[#111214] rounded-xl p-8 text-center text-gray-400">
                  <p className="text-lg font-medium text-white mb-1">Le serveur est actuellement arrêté</p>
                  <p className="text-sm">Démarrez le serveur pour voir les joueurs connectés en direct et utiliser les actions rapides.</p>
                </div>
              ) : playersData.players.length === 0 ? (
                <div className="bg-[#1E1F22] border border-[#111214] rounded-xl p-8 text-center text-gray-400">
                  <p className="text-lg font-medium text-white mb-1">Aucun joueur connecté pour le moment</p>
                  <p className="text-sm">Dès qu'un joueur rejoint la partie, il apparaîtra automatiquement ici.</p>
                </div>
              ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {playersData.players.map((player) => {
                    const isOp = playersData.ops.some((op) => op.toLowerCase() === player.toLowerCase());
                    return (
                      <div
                        key={player}
                        className="bg-[#1E1F22] border border-[#111214] rounded-xl p-4 flex items-center justify-between gap-4"
                      >
                        <div className="flex items-center space-x-3.5 min-w-0">
                          <img
                            src={`https://mc-heads.net/avatar/${encodeURIComponent(player)}/40`}
                            alt={player}
                            className="w-10 h-10 rounded-lg bg-[#111214] shrink-0"
                          />
                          <div className="min-w-0">
                            <div className="flex items-center space-x-2">
                              <span className="font-bold text-white truncate">{player}</span>
                              {isOp && (
                                <span className="bg-amber-500/20 text-amber-400 border border-amber-500/40 text-[11px] font-bold px-2 py-0.5 rounded uppercase">
                                  OP
                                </span>
                              )}
                            </div>
                            <span className="text-xs text-[#23A559] flex items-center gap-1 mt-0.5">
                              <span className="w-1.5 h-1.5 rounded-full bg-[#23A559]"></span> Connecté
                            </span>
                          </div>
                        </div>

                        <div className="flex items-center space-x-2 shrink-0">
                          {isOp ? (
                            <button
                              onClick={() => triggerPlayerAction('deop', player)}
                              className="bg-amber-600/20 hover:bg-amber-600/40 text-amber-300 border border-amber-500/30 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors"
                              title="Retirer les droits d'opérateur"
                            >
                              De-OP
                            </button>
                          ) : (
                            <button
                              onClick={() => triggerPlayerAction('op', player)}
                              className="bg-[#5865F2]/20 hover:bg-[#5865F2] text-[#8EA1E1] hover:text-white border border-[#5865F2]/40 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors"
                              title="Donner les droits d'opérateur (OP)"
                            >
                              OP
                            </button>
                          )}
                          <button
                            onClick={() => triggerPlayerAction('kick', player)}
                            className="bg-orange-500/20 hover:bg-orange-500 text-orange-300 hover:text-white border border-orange-500/40 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors"
                            title="Expulser du serveur (Kick)"
                          >
                            Kick
                          </button>
                          <button
                            onClick={() => triggerPlayerAction('ban', player)}
                            className="bg-[#DA373C]/20 hover:bg-[#DA373C] text-red-300 hover:text-white border border-[#DA373C]/40 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors"
                            title="Bannir du serveur (Ban)"
                          >
                            Ban
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Action rapide sur un pseudo même s'il n'est pas encore dans la liste */}
              <div className="mt-6 pt-5 border-t border-[#1E1F22] flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
                <div className="text-xs text-gray-400">
                  Action rapide par pseudo (OP, Kick ou Ban via WebSocket) :
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="text"
                    value={manualPlayerInput}
                    onChange={(e) => setManualPlayerInput(e.target.value)}
                    placeholder="Pseudo du joueur..."
                    className="bg-[#1E1F22] text-white border border-[#111214] rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:border-[#5865F2]"
                  />
                  <button
                    type="button"
                    disabled={!manualPlayerInput.trim() || !isRunning}
                    onClick={() => {
                      triggerPlayerAction('op', manualPlayerInput.trim());
                      setManualPlayerInput('');
                    }}
                    className="bg-[#5865F2] hover:bg-[#4752C4] disabled:opacity-40 text-white px-3 py-1.5 rounded-lg text-xs font-semibold"
                  >
                    OP
                  </button>
                  <button
                    type="button"
                    disabled={!manualPlayerInput.trim() || !isRunning}
                    onClick={() => {
                      triggerPlayerAction('kick', manualPlayerInput.trim());
                      setManualPlayerInput('');
                    }}
                    className="bg-orange-500 hover:bg-orange-600 disabled:opacity-40 text-white px-3 py-1.5 rounded-lg text-xs font-semibold"
                  >
                    Kick
                  </button>
                  <button
                    type="button"
                    disabled={!manualPlayerInput.trim() || !isRunning}
                    onClick={() => {
                      triggerPlayerAction('ban', manualPlayerInput.trim());
                      setManualPlayerInput('');
                    }}
                    className="bg-[#DA373C] hover:bg-[#C92B30] disabled:opacity-40 text-white px-3 py-1.5 rounded-lg text-xs font-semibold"
                  >
                    Ban
                  </button>
                </div>
              </div>
            </div>

            {/* Listes Opérateurs (ops.json) et Bannis (banned-players.json) */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              <div className="bg-[#2B2D31] rounded-xl border border-[#1E1F22] p-5 text-white shadow-lg">
                <h3 className="text-base font-bold mb-3 flex items-center justify-between">
                  <span>👑 Opérateurs (ops.json)</span>
                  <span className="text-xs bg-[#1E1F22] px-2.5 py-0.5 rounded-full text-gray-400">
                    {playersData.ops.length}
                  </span>
                </h3>
                {playersData.ops.length === 0 ? (
                  <p className="text-sm text-gray-400">Aucun opérateur enregistré.</p>
                ) : (
                  <div className="space-y-2">
                    {playersData.ops.map((op) => (
                      <div
                        key={op}
                        className="bg-[#1E1F22] px-3.5 py-2 rounded-lg flex items-center justify-between text-sm"
                      >
                        <span className="font-medium text-amber-300">{op}</span>
                        <button
                          onClick={() => triggerPlayerAction('deop', op)}
                          disabled={!isRunning}
                          className="text-xs text-gray-400 hover:text-[#DA373C] disabled:opacity-40"
                        >
                          Retirer OP
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <div className="bg-[#2B2D31] rounded-xl border border-[#1E1F22] p-5 text-white shadow-lg">
                <h3 className="text-base font-bold mb-3 flex items-center justify-between">
                  <span>🚫 Joueurs bannis (banned-players.json)</span>
                  <span className="text-xs bg-[#1E1F22] px-2.5 py-0.5 rounded-full text-gray-400">
                    {playersData.banned.length}
                  </span>
                </h3>
                {playersData.banned.length === 0 ? (
                  <p className="text-sm text-gray-400">Aucun joueur banni.</p>
                ) : (
                  <div className="space-y-2">
                    {playersData.banned.map((bannedName) => (
                      <div
                        key={bannedName}
                        className="bg-[#1E1F22] px-3.5 py-2 rounded-lg flex items-center justify-between text-sm"
                      >
                        <span className="font-medium text-red-300">{bannedName}</span>
                        <button
                          onClick={() => triggerPlayerAction('pardon', bannedName)}
                          disabled={!isRunning}
                          className="text-xs text-[#23A559] hover:underline disabled:opacity-40"
                        >
                          Débannir (Pardon)
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ========================================== */}
        {/* ONGLET 4 : FICHIERS (WEB FTP)              */}
        {/* ========================================== */}
        {activeTab === 'files' && (
          <div className="flex-grow grid grid-cols-1 lg:grid-cols-12 gap-4 overflow-hidden min-h-0">
            {/* COLONNE GAUCHE : Explorateur d'arborescence */}
            <div className="lg:col-span-5 bg-[#2B2D31] rounded-xl border border-[#1E1F22] flex flex-col overflow-hidden shadow-lg">
              {/* Barre d'outils & Fil d'Ariane */}
              <div className="p-3.5 bg-[#1E1F22] border-b border-[#2B2D31] flex flex-col gap-2 shrink-0">
                <div className="flex items-center justify-between">
                  <div className="flex items-center flex-wrap gap-1 text-xs font-mono text-gray-300">
                    <button
                      onClick={() => fetchDirectory('')}
                      className="hover:text-[#5865F2] font-bold px-1.5 py-0.5 rounded bg-[#2B2D31]"
                    >
                      /data
                    </button>
                    {breadcrumbs.map((segment, idx) => {
                      const subPath = breadcrumbs.slice(0, idx + 1).join('/');
                      return (
                        <span key={subPath} className="flex items-center gap-1">
                          <span className="text-gray-500">/</span>
                          <button
                            onClick={() => fetchDirectory(subPath)}
                            className="hover:text-[#5865F2] px-1 py-0.5 rounded hover:bg-[#2B2D31]"
                          >
                            {segment}
                          </button>
                        </span>
                      );
                    })}
                  </div>

                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={() => setShowNewFileInput((v) => !v)}
                      className="bg-[#5865F2] hover:bg-[#4752C4] text-white px-2.5 py-1 rounded text-xs font-medium transition-colors"
                      title="Nouveau fichier dans ce dossier"
                    >
                      + Fichier
                    </button>
                    <button
                      onClick={() => fetchDirectory(currentDir)}
                      className="bg-[#2B2D31] hover:bg-[#111214] text-gray-300 px-2.5 py-1 rounded text-xs transition-colors"
                      title="Rafraîchir le dossier"
                    >
                      ↻
                    </button>
                  </div>
                </div>

                {showNewFileInput && (
                  <form onSubmit={handleCreateNewFile} className="flex gap-2 pt-1">
                    <input
                      type="text"
                      value={newFileName}
                      onChange={(e) => setNewFileName(e.target.value)}
                      placeholder="ex: config.yml"
                      className="flex-grow bg-[#111214] text-white border border-[#2B2D31] rounded px-2.5 py-1 text-xs font-mono focus:outline-none focus:border-[#5865F2]"
                      autoFocus
                    />
                    <button
                      type="submit"
                      className="bg-[#23A559] text-white px-3 py-1 rounded text-xs font-medium"
                    >
                      Créer
                    </button>
                  </form>
                )}
              </div>

              {/* Liste des dossiers et fichiers */}
              <div className="flex-grow overflow-y-auto divide-y divide-[#1E1F22]/60">
                {currentDir && (
                  <button
                    onClick={navigateUpDirectory}
                    className="w-full px-4 py-2.5 text-left text-sm text-gray-300 hover:bg-[#1E1F22] flex items-center space-x-3 transition-colors"
                  >
                    <span>↩️</span>
                    <span className="font-mono">.. (Dossier parent)</span>
                  </button>
                )}

                {isLoadingFiles ? (
                  <div className="p-8 text-center text-gray-400 text-sm">Chargement de l'arborescence...</div>
                ) : fileItems.length === 0 ? (
                  <div className="p-8 text-center text-gray-400 text-sm">
                    Ce dossier est vide. (Lancez le serveur une première fois pour générer les fichiers Minecraft).
                  </div>
                ) : (
                  fileItems.map((item) => {
                    const isSelected = selectedFilePath === item.path;
                    let icon = '📄';
                    if (item.is_dir) icon = '📁';
                    else if (item.name.endsWith('.yml') || item.name.endsWith('.yaml') || item.name.endsWith('.json') || item.name.endsWith('.properties')) icon = '⚙️';
                    else if (item.name.endsWith('.jar') || item.name.endsWith('.gz')) icon = '📦';
                    else if (item.name.endsWith('.log') || item.name.endsWith('.txt')) icon = '📝';

                    return (
                      <div
                        key={item.path}
                        onClick={() => {
                          if (item.is_dir) {
                            fetchDirectory(item.path);
                          } else if (item.editable) {
                            openFileInEditor(item.path, item.name);
                          } else {
                            setFileFeedback({
                              type: 'error',
                              text: `Le fichier "${item.name}" est un fichier binaire et ne peut pas être édité en mode texte.`,
                            });
                          }
                        }}
                        className={`px-4 py-2.5 flex items-center justify-between text-sm cursor-pointer transition-colors ${
                          isSelected
                            ? 'bg-[#5865F2]/25 text-white border-l-4 border-[#5865F2]'
                            : 'text-gray-200 hover:bg-[#1E1F22]'
                        }`}
                      >
                        <div className="flex items-center space-x-3 min-w-0 pr-2">
                          <span className="shrink-0">{icon}</span>
                          <span className={`truncate ${item.is_dir ? 'font-semibold text-white' : 'font-mono text-xs'}`}>
                            {item.name}
                          </span>
                        </div>
                        <div className="flex items-center space-x-2 shrink-0 text-xs text-gray-400">
                          {!item.is_dir && <span>{formatBytes(item.size)}</span>}
                          {!item.is_dir && item.editable && (
                            <span className="text-[10px] bg-[#1E1F22] border border-[#111214] px-1.5 py-0.5 rounded text-gray-300">
                              Éditable
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* COLONNE DROITE : Éditeur de code intégré */}
            <div className="lg:col-span-7 bg-[#111214] rounded-xl border border-[#1E1F22] flex flex-col overflow-hidden shadow-lg">
              {/* Header de l'éditeur */}
              <div className="p-3 px-4 bg-[#1E1F22] border-b border-[#2B2D31] flex items-center justify-between shrink-0">
                <div className="flex items-center space-x-2 min-w-0">
                  <span className="text-xs font-mono text-gray-300 truncate">
                    {selectedFilePath ? selectedFilePath : 'Aucun fichier sélectionné'}
                  </span>
                  {hasUnsavedFileChanges && (
                    <span className="text-xs bg-amber-500/20 text-amber-300 px-2 py-0.5 rounded-full font-medium shrink-0">
                      ● Non sauvegardé
                    </span>
                  )}
                </div>

                {selectedFilePath && (
                  <div className="flex items-center space-x-2 shrink-0">
                    <button
                      type="button"
                      onClick={() => setEditorContent(originalContent)}
                      disabled={!hasUnsavedFileChanges}
                      className="text-xs text-gray-400 hover:text-white disabled:opacity-40 px-2.5 py-1.5 rounded"
                    >
                      Annuler
                    </button>
                    <button
                      type="button"
                      onClick={handleSaveFile}
                      disabled={isSavingFile || !hasUnsavedFileChanges}
                      className="bg-[#23A559] hover:bg-[#1D8B4A] disabled:opacity-40 text-white px-4 py-1.5 rounded-lg text-xs font-semibold transition-colors shadow"
                    >
                      {isSavingFile ? 'Sauvegarde...' : '💾 Sauvegarder (Ctrl+S)'}
                    </button>
                  </div>
                )}
              </div>

              {fileFeedback && (
                <div
                  className={`px-4 py-2 text-xs border-b shrink-0 flex items-center justify-between ${
                    fileFeedback.type === 'success'
                      ? 'bg-[#23A559]/20 border-[#23A559]/40 text-[#23A559]'
                      : 'bg-[#DA373C]/20 border-[#DA373C]/40 text-[#DA373C]'
                  }`}
                >
                  <span>{fileFeedback.text}</span>
                  <button onClick={() => setFileFeedback(null)} className="hover:opacity-75">
                    ✕
                  </button>
                </div>
              )}

              {/* Corps de l'éditeur */}
              {isLoadingFileContent ? (
                <div className="flex-grow flex items-center justify-center text-gray-400 text-sm">
                  Chargement de {selectedFileName}...
                </div>
              ) : !selectedFilePath ? (
                <div className="flex-grow flex flex-col items-center justify-center text-gray-500 p-8 text-center">
                  <span className="text-4xl mb-3">📝</span>
                  <p className="text-white font-medium mb-1">Éditeur de code intégré</p>
                  <p className="text-xs max-w-md">
                    Sélectionnez un fichier <code className="text-gray-300">.yml</code>,{' '}
                    <code className="text-gray-300">.json</code>, <code className="text-gray-300">.properties</code> ou{' '}
                    <code className="text-gray-300">.txt</code> dans l'explorateur à gauche pour l'éditer directement.
                  </p>
                </div>
              ) : (
                <textarea
                  value={editorContent}
                  onChange={(e) => setEditorContent(e.target.value)}
                  onKeyDown={(e) => {
                    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
                      e.preventDefault();
                      if (hasUnsavedFileChanges && !isSavingFile) {
                        handleSaveFile();
                      }
                    }
                  }}
                  spellCheck={false}
                  className="flex-grow w-full bg-[#111214] text-gray-100 p-4 font-mono text-sm leading-relaxed focus:outline-none resize-none"
                />
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
