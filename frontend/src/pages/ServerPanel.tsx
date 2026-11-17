import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useServerStore } from '../store/useServerStore';
import { useAuthStore, type ServerPermKey } from '../store/useAuthStore';
import {
  TerminalIcon,
  ActivityIcon,
  PuzzleIcon,
  UsersIcon,
  FolderIcon,
  ArchiveIcon,
  ClockIcon,
  SettingsIcon,
  PlayIcon,
  SquareIcon,
  TrashIcon,
  ArrowLeftIcon,
  FileTextIcon,
  SearchIcon,
  SaveIcon,
  DownloadIcon,
  PlusIcon,
  RefreshIcon,
  ServerIcon,
  CrownIcon,
  BanIcon,
  UploadIcon,
} from '../components/Icons';

const API_BASE = `http://${window.location.hostname}:8000`;
const WS_BASE = `ws://${window.location.hostname}:8000`;

type TabType =
  | 'console'
  | 'monitoring'
  | 'addons'
  | 'players'
  | 'files'
  | 'backups'
  | 'schedules'
  | 'settings';

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
  whitelist?: string[];
  whitelist_enabled?: boolean;
}

interface ServerStats {
  online: boolean;
  cpu_percent: number;
  ram_used_mb: number;
  ram_limit_mb: number;
  ram_percent: number;
  net_rx_mb: number;
  net_tx_mb: number;
  pids: number;
}

interface InstalledAddon {
  filename: string;
  size: number;
  modified: number;
  enabled: boolean;
}

interface ModrinthResult {
  project_id: string;
  slug: string;
  title: string;
  description: string;
  author: string;
  downloads: number;
  icon_url: string | null;
  categories: string[];
}

interface BackupEntry {
  name: string;
  size: number;
  created_at: number;
}

interface ScheduleEntry {
  id: number;
  name: string;
  action_type: string;
  schedule_type: string;
  schedule_value: string;
  payload: string;
  enabled: boolean;
  last_run: string;
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

function formatDate(timestampSec: number): string {
  return new Date(timestampSec * 1000).toLocaleString('fr-FR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function AreaSparkline({
  data,
  maxVal,
  colorHex,
}: {
  data: number[];
  maxVal: number;
  colorHex: string;
}) {
  const width = 420;
  const height = 110;
  const padded = data.length < 2 ? [0, ...data] : data;
  const safeMax = Math.max(maxVal, ...padded, 1);

  const points = padded.map((v, idx) => {
    const x = (idx / Math.max(1, padded.length - 1)) * width;
    const y = height - Math.min(1, Math.max(0, v / safeMax)) * (height - 14) - 4;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  const polylinePoints = points.join(' ');
  const areaPoints = `0,${height} ${polylinePoints} ${width},${height}`;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-28 overflow-visible">
      <polygon points={areaPoints} fill={colorHex} fillOpacity="0.18" />
      <polyline
        fill="none"
        stroke={colorHex}
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        points={polylinePoints}
      />
    </svg>
  );
}

export default function ServerPanel() {
  const { serverName } = useParams();
  const navigate = useNavigate();
  const { servers, startServer, stopServer, fetchServers, deleteServer, updateServerSettings } = useServerStore();
  const { user, hasPermission } = useAuthStore();

  const [activeTab, setActiveTab] = useState<TabType>('console');
  const [logs, setLogs] = useState<string[]>([]);
  const [command, setCommand] = useState('');
  const [cmdHistory, setCmdHistory] = useState<string[]>([]);
  const [cmdHistoryIdx, setCmdHistoryIdx] = useState<number>(-1);

  // --- ÉTATS MONITORING (BLOC 2.1) ---
  const [stats, setStats] = useState<ServerStats>({
    online: false,
    cpu_percent: 0,
    ram_used_mb: 0,
    ram_limit_mb: 2048,
    ram_percent: 0,
    net_rx_mb: 0,
    net_tx_mb: 0,
    pids: 0,
  });
  const [cpuHistory, setCpuHistory] = useState<number[]>(Array(20).fill(0));
  const [ramHistory, setRamHistory] = useState<number[]>(Array(20).fill(0));

  // --- ÉTATS MODS & PLUGINS (BLOC 2.2) ---
  const [addonLabel, setAddonLabel] = useState('Mods / Plugins');
  const [addonFolder, setAddonFolder] = useState('mods');
  const [installedAddons, setInstalledAddons] = useState<InstalledAddon[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [modrinthResults, setModrinthResults] = useState<ModrinthResult[]>([]);
  const [isSearchingAddons, setIsSearchingAddons] = useState(false);
  const [installingId, setInstallingId] = useState<string | null>(null);
  const [addonFeedback, setAddonFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // --- ÉTATS SAUVEGARDES / SNAPSHOTS (BLOC 2.3) ---
  const [backups, setBackups] = useState<BackupEntry[]>([]);
  const [backupLabelInput, setBackupLabelInput] = useState('');
  const [isLoadingBackups, setIsLoadingBackups] = useState(false);
  const [isCreatingBackup, setIsCreatingBackup] = useState(false);
  const [restoringBackupName, setRestoringBackupName] = useState<string | null>(null);
  const [backupFeedback, setBackupFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // --- ÉTATS PLANIFICATEUR / CRON (BLOC 2.4) ---
  const [schedules, setSchedules] = useState<ScheduleEntry[]>([]);
  const [schedName, setSchedName] = useState('');
  const [schedAction, setSchedAction] = useState('restart');
  const [schedType, setSchedType] = useState('daily');
  const [schedValue, setSchedValue] = useState('04:00');
  const [schedPayload, setSchedPayload] = useState('Redémarrage automatique dans 5 secondes...');
  const [isSavingSchedule, setIsSavingSchedule] = useState(false);
  const [scheduleFeedback, setScheduleFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  // --- ÉTATS ONGLET PARAMÈTRES ---
  const [portInput, setPortInput] = useState<number>(25565);
  const [ramInput, setRamInput] = useState<string>('2G');
  const [typeInput, setTypeInput] = useState<string>('VANILLA');
  const [versionInput, setVersionInput] = useState<string>('LATEST');
  const [backupBeforeConvert, setBackupBeforeConvert] = useState<boolean>(true);
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
    whitelist: [],
    whitelist_enabled: false,
  });
  const [isLoadingPlayers, setIsLoadingPlayers] = useState(false);
  const [actionToast, setActionToast] = useState<string | null>(null);
  const [manualPlayerInput, setManualPlayerInput] = useState('');
  const [whitelistInput, setWhitelistInput] = useState('');

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
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [isUploadingFile, setIsUploadingFile] = useState(false);
  const [isImportingWorld, setIsImportingWorld] = useState(false);
  const fileUploadInputRef = useRef<HTMLInputElement>(null);
  const worldUploadInputRef = useRef<HTMLInputElement>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const logsEndRef = useRef<HTMLDivElement>(null);

  const server = servers.find((s) => s.name === serverName);
  const isRunning = server?.status.includes('running') || false;

  useEffect(() => {
    if (servers.length === 0) fetchServers();
  }, [servers.length, fetchServers]);

  useEffect(() => {
    if (server) {
      setPortInput(server.port || 25565);
      setRamInput(server.ram || '2G');
      setTypeInput(server.server_type || 'PAPER');
      setVersionInput(server.version || 'LATEST');
    }
  }, [server]);

  useEffect(() => {
    if (activeTab === 'console') {
      logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs, activeTab]);

  // --- FETCHERS ---
  const fetchStats = useCallback(async () => {
    if (!serverName || !isRunning) return;
    try {
      const res = await fetch(`${API_BASE}/api/servers/${serverName}/stats`);
      if (res.ok) {
        const data: ServerStats = await res.json();
        setStats(data);
        setCpuHistory((prev) => [...prev.slice(-29), data.cpu_percent]);
        setRamHistory((prev) => [...prev.slice(-29), data.ram_used_mb]);
      }
    } catch {
      // ignore
    }
  }, [serverName, isRunning]);

  const fetchInstalledAddons = useCallback(async () => {
    if (!serverName) return;
    try {
      const res = await fetch(`${API_BASE}/api/servers/${serverName}/addons/installed`);
      if (res.ok) {
        const data = await res.json();
        setInstalledAddons(data.items || []);
        if (data.context) {
          setAddonLabel(data.context.label);
          setAddonFolder(data.context.folder);
        }
      }
    } catch (err) {
      console.error('Erreur addons installés:', err);
    }
  }, [serverName]);

  const searchModrinth = useCallback(
    async (queryStr: string) => {
      if (!serverName) return;
      setIsSearchingAddons(true);
      try {
        const res = await fetch(
          `${API_BASE}/api/servers/${serverName}/addons/search?q=${encodeURIComponent(queryStr)}`
        );
        if (res.ok) {
          const data = await res.json();
          setModrinthResults(data.results || []);
          if (data.context) {
            setAddonLabel(data.context.label);
            setAddonFolder(data.context.folder);
          }
        }
      } catch (err) {
        console.error('Erreur recherche Modrinth:', err);
      } finally {
        setIsSearchingAddons(false);
      }
    },
    [serverName]
  );

  const fetchBackups = useCallback(async () => {
    if (!serverName) return;
    setIsLoadingBackups(true);
    try {
      const res = await fetch(`${API_BASE}/api/servers/${serverName}/backups`);
      if (res.ok) {
        const data = await res.json();
        setBackups(data.backups || []);
      }
    } catch (err) {
      console.error('Erreur backups:', err);
    } finally {
      setIsLoadingBackups(false);
    }
  }, [serverName]);

  const fetchSchedules = useCallback(async () => {
    if (!serverName) return;
    try {
      const res = await fetch(`${API_BASE}/api/servers/${serverName}/schedules`);
      if (res.ok) {
        const data = await res.json();
        setSchedules(data || []);
      }
    } catch (err) {
      console.error('Erreur schedules:', err);
    }
  }, [serverName]);

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

  // Sondage régulier des stats CPU/RAM quand le serveur est en ligne
  useEffect(() => {
    if (!isRunning) {
      setStats((prev) => ({ ...prev, online: false, cpu_percent: 0, ram_used_mb: 0, ram_percent: 0 }));
      return;
    }
    fetchStats();
    const interval = setInterval(fetchStats, 3000);
    return () => clearInterval(interval);
  }, [isRunning, fetchStats]);

  // Connexion WebSocket
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
    } else if (activeTab === 'addons') {
      fetchInstalledAddons();
      if (modrinthResults.length === 0) {
        searchModrinth('');
      }
    } else if (activeTab === 'backups') {
      fetchBackups();
    } else if (activeTab === 'schedules') {
      fetchSchedules();
    }
  }, [
    activeTab,
    fetchServerProperties,
    fetchPlayers,
    fetchDirectory,
    currentDir,
    fetchInstalledAddons,
    searchModrinth,
    modrinthResults.length,
    fetchBackups,
    fetchSchedules,
  ]);

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
    const trimmed = command.trim();
    if (trimmed && sendWsCommand(trimmed)) {
      setCmdHistory((prev) => (prev[prev.length - 1] === trimmed ? prev : [...prev, trimmed]));
      setCmdHistoryIdx(-1);
      setCommand('');
    }
  };

  const handleConsoleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (cmdHistory.length === 0) return;
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      const nextIdx = cmdHistoryIdx === -1 ? cmdHistory.length - 1 : Math.max(0, cmdHistoryIdx - 1);
      setCmdHistoryIdx(nextIdx);
      setCommand(cmdHistory[nextIdx]);
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (cmdHistoryIdx === -1) return;
      if (cmdHistoryIdx >= cmdHistory.length - 1) {
        setCmdHistoryIdx(-1);
        setCommand('');
      } else {
        const nextIdx = cmdHistoryIdx + 1;
        setCmdHistoryIdx(nextIdx);
        setCommand(cmdHistory[nextIdx]);
      }
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

  // --- ACTIONS MODS & PLUGINS ---
  const handleInstallAddon = async (mod: ModrinthResult) => {
    if (!serverName) return;
    setInstallingId(mod.project_id);
    setAddonFeedback(null);
    try {
      const res = await fetch(`${API_BASE}/api/servers/${serverName}/addons/install`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ project_id: mod.project_id, title: mod.title }),
      });
      const data = await res.json();
      if (res.ok) {
        setAddonFeedback({ type: 'success', text: data.message });
        fetchInstalledAddons();
      } else {
        setAddonFeedback({ type: 'error', text: data.detail || "Erreur d'installation." });
      }
    } catch {
      setAddonFeedback({ type: 'error', text: 'Erreur réseau lors du téléchargement.' });
    } finally {
      setInstallingId(null);
    }
  };

  const handleToggleAddon = async (filename: string) => {
    if (!serverName) return;
    await fetch(`${API_BASE}/api/servers/${serverName}/addons/${encodeURIComponent(filename)}/toggle`, {
      method: 'PUT',
    });
    fetchInstalledAddons();
  };

  const handleDeleteAddon = async (filename: string) => {
    if (!serverName) return;
    if (!window.confirm(`Supprimer définitivement "${filename}" ?`)) return;
    await fetch(`${API_BASE}/api/servers/${serverName}/addons/${encodeURIComponent(filename)}`, {
      method: 'DELETE',
    });
    fetchInstalledAddons();
  };

  // --- ACTIONS SAUVEGARDES (SNAPSHOTS) ---
  const handleCreateBackup = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!serverName) return;
    setIsCreatingBackup(true);
    setBackupFeedback(null);
    try {
      const res = await fetch(`${API_BASE}/api/servers/${serverName}/backups`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ label: backupLabelInput.trim() || 'snapshot' }),
      });
      const data = await res.json();
      if (res.ok) {
        setBackupFeedback({ type: 'success', text: data.message });
        setBackupLabelInput('');
        fetchBackups();
      } else {
        setBackupFeedback({ type: 'error', text: data.detail || 'Erreur lors de la création du snapshot.' });
      }
    } catch {
      setBackupFeedback({ type: 'error', text: 'Erreur réseau.' });
    } finally {
      setIsCreatingBackup(false);
    }
  };

  const handleRestoreBackup = async (backupName: string) => {
    if (!serverName) return;
    const confirm = window.confirm(
      `Restaurer le snapshot "${backupName}" ?\n\nAttention : les fichiers actuels du serveur seront remplacés par ceux de cette archive.`
    );
    if (!confirm) return;

    setRestoringBackupName(backupName);
    setBackupFeedback(null);
    try {
      const res = await fetch(
        `${API_BASE}/api/servers/${serverName}/backups/${encodeURIComponent(backupName)}/restore`,
        { method: 'POST' }
      );
      const data = await res.json();
      if (res.ok) {
        setBackupFeedback({ type: 'success', text: data.message });
      } else {
        setBackupFeedback({ type: 'error', text: data.detail || 'Erreur de restauration.' });
      }
    } catch {
      setBackupFeedback({ type: 'error', text: 'Erreur réseau.' });
    } finally {
      setRestoringBackupName(null);
    }
  };

  const handleDeleteBackup = async (backupName: string) => {
    if (!serverName) return;
    if (!window.confirm(`Supprimer l'archive "${backupName}" ?`)) return;
    await fetch(`${API_BASE}/api/servers/${serverName}/backups/${encodeURIComponent(backupName)}`, {
      method: 'DELETE',
    });
    fetchBackups();
  };

  // --- ACTIONS PLANIFICATEUR (CRON) ---
  const handleCreateSchedule = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!serverName || !schedName.trim()) return;
    setIsSavingSchedule(true);
    setScheduleFeedback(null);
    try {
      const res = await fetch(`${API_BASE}/api/servers/${serverName}/schedules`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: schedName,
          action_type: schedAction,
          schedule_type: schedType,
          schedule_value: schedValue,
          payload: schedPayload,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setScheduleFeedback({ type: 'success', text: data.message });
        setSchedName('');
        fetchSchedules();
      } else {
        setScheduleFeedback({ type: 'error', text: data.detail || 'Erreur création tâche.' });
      }
    } catch {
      setScheduleFeedback({ type: 'error', text: 'Erreur réseau.' });
    } finally {
      setIsSavingSchedule(false);
    }
  };

  const handleToggleSchedule = async (id: number) => {
    if (!serverName) return;
    await fetch(`${API_BASE}/api/servers/${serverName}/schedules/${id}/toggle`, { method: 'PUT' });
    fetchSchedules();
  };

  const handleRunScheduleNow = async (id: number) => {
    if (!serverName) return;
    const res = await fetch(`${API_BASE}/api/servers/${serverName}/schedules/${id}/run`, { method: 'POST' });
    const data = await res.json();
    if (res.ok) {
      setScheduleFeedback({ type: 'success', text: data.message });
      fetchSchedules();
    }
  };

  const handleDeleteSchedule = async (id: number) => {
    if (!serverName) return;
    await fetch(`${API_BASE}/api/servers/${serverName}/schedules/${id}`, { method: 'DELETE' });
    fetchSchedules();
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
      backup_before_convert: backupBeforeConvert,
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

  const handleUploadFiles = async (files: FileList | null) => {
    if (!files || files.length === 0 || !serverName) return;
    setIsUploadingFile(true);
    setFileFeedback(null);
    try {
      for (const file of Array.from(files)) {
        const targetRelPath = currentDir ? `${currentDir}/${file.name}` : file.name;
        const buf = await file.arrayBuffer();
        const res = await fetch(
          `${API_BASE}/api/servers/${serverName}/files/upload?path=${encodeURIComponent(targetRelPath)}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/octet-stream' },
            body: buf,
          }
        );
        if (!res.ok) {
          const err = await res.json();
          setFileFeedback({ type: 'error', text: err.detail || `Erreur upload ${file.name}` });
        } else {
          setFileFeedback({ type: 'success', text: `Fichier "${file.name}" importé dans /${currentDir || 'data'} !` });
        }
      }
      await fetchDirectory(currentDir);
    } catch {
      setFileFeedback({ type: 'error', text: "Erreur réseau lors de l'importation du fichier." });
    } finally {
      setIsUploadingFile(false);
    }
  };

  const handleImportWorldZip = async (file: File | null) => {
    if (!file || !serverName) return;
    if (
      !window.confirm(
        `Importer la map "${file.name}" dans le dossier /world ?\n\nUne sauvegarde (.zip) de votre monde actuel sera créée automatiquement avant le remplacement.`
      )
    ) {
      return;
    }
    setIsImportingWorld(true);
    setBackupFeedback(null);
    try {
      const buf = await file.arrayBuffer();
      const res = await fetch(`${API_BASE}/api/servers/${serverName}/world/import`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/zip' },
        body: buf,
      });
      const data = await res.json();
      if (res.ok) {
        setBackupFeedback({ type: 'success', text: data.message });
        fetchBackups();
      } else {
        setBackupFeedback({ type: 'error', text: data.detail || "Erreur lors de l'importation de la map." });
      }
    } catch {
      setBackupFeedback({ type: 'error', text: "Erreur réseau lors de l'envoi de l'archive." });
    } finally {
      setIsImportingWorld(false);
    }
  };

  if (!server) return <div className="text-white p-8">Chargement ou serveur introuvable...</div>;

  const isModdedServer = ['FORGE', 'FABRIC', 'NEOFORGE'].includes((server.server_type || 'PAPER').toUpperCase());
  const canPower = hasPermission(server.name, 'power');
  const isAdmin = user?.role === 'admin';

  const allTabs: {
    id: TabType;
    perm: ServerPermKey;
    label: string;
    subtitle: string;
    fullTitle: string;
    description: string;
    icon: React.ReactNode;
    badge?: string | number;
  }[] = [
    {
      id: 'console',
      perm: 'console',
      label: 'Console',
      subtitle: 'Terminal & RCON',
      fullTitle: 'Console Temps Réel & Commandes RCON',
      description: 'Suivez les logs du conteneur en direct via WebSocket et exécutez vos commandes administrateur.',
      icon: <TerminalIcon className="w-4 h-4" />,
    },
    {
      id: 'monitoring',
      perm: 'view',
      label: 'Monitoring',
      subtitle: 'CPU & RAM Live',
      fullTitle: 'Monitoring des Ressources en Direct',
      description: 'Jauges et courbes temps réel de consommation CPU, mémoire RAM et trafic réseau du conteneur.',
      icon: <ActivityIcon className="w-4 h-4" />,
      badge: isRunning ? `${stats.cpu_percent}%` : undefined,
    },
    {
      id: 'addons',
      perm: 'addons',
      label: isModdedServer ? 'Mods' : 'Plugins',
      subtitle: 'Catalogue Modrinth',
      fullTitle: `Gestionnaire de ${isModdedServer ? 'Mods' : 'Plugins'} & Téléchargeur Modrinth`,
      description: `Recherchez et installez des ${isModdedServer ? 'mods' : 'plugins'} compatibles (${server.server_type} ${server.version}) en un clic.`,
      icon: <PuzzleIcon className="w-4 h-4" />,
      badge: installedAddons.length || undefined,
    },
    {
      id: 'players',
      perm: 'console',
      label: 'Joueurs',
      subtitle: 'Modération Live',
      fullTitle: 'Joueurs Connectés & Modération en Direct',
      description: 'Visualisez les joueurs actifs sur le serveur et appliquez des actions rapides (OP, Kick, Ban).',
      icon: <UsersIcon className="w-4 h-4" />,
      badge: isRunning ? `${playersData.count}/${playersData.max}` : undefined,
    },
    {
      id: 'files',
      perm: 'files',
      label: 'Fichiers',
      subtitle: 'Web FTP & Code',
      fullTitle: 'Explorateur de Fichiers & Éditeur de Configuration',
      description: 'Parcourez l’arborescence du serveur (/data) et modifiez vos fichiers .yml, .json ou .properties.',
      icon: <FolderIcon className="w-4 h-4" />,
    },
    {
      id: 'backups',
      perm: 'addons',
      label: 'Sauvegardes',
      subtitle: 'Snapshots .zip',
      fullTitle: 'Gestionnaire de Sauvegardes (Snapshots)',
      description: 'Compressez l’intégralité du serveur en un clic et restaurez une archive en cas de problème.',
      icon: <ArchiveIcon className="w-4 h-4" />,
      badge: backups.length || undefined,
    },
    {
      id: 'schedules',
      perm: 'addons',
      label: 'Planificateur',
      subtitle: 'Tâches Cron',
      fullTitle: 'Planificateur de Tâches Automatisées (Cron)',
      description: 'Programmez des redémarrages automatiques, des sauvegardes ou des annonces régulières.',
      icon: <ClockIcon className="w-4 h-4" />,
      badge: schedules.filter((s) => s.enabled).length || undefined,
    },
    {
      id: 'settings',
      perm: 'settings',
      label: 'Paramètres',
      subtitle: 'Docker & Règles',
      fullTitle: 'Configuration du Serveur & Moteur Docker',
      description: 'Ajustez le port, la mémoire RAM, la version du jeu et les règles de server.properties.',
      icon: <SettingsIcon className="w-4 h-4" />,
    },
  ];

  const tabs = allTabs.filter((t) => hasPermission(server.name, t.perm));
  const currentTabInfo = tabs.find((t) => t.id === activeTab) || tabs[0] || allTabs[1];
  const hasUnsavedFileChanges = selectedFilePath !== null && editorContent !== originalContent;
  const breadcrumbs = currentDir ? currentDir.split('/').filter(Boolean) : [];

  return (
    <div className="p-4 md:p-6 max-w-7xl mx-auto h-screen flex flex-col">
      {/* HEADER DU SERVEUR */}
      <header className="mb-3 flex flex-col lg:flex-row lg:items-center justify-between bg-[#2B2D31] p-4 rounded-xl border border-[#1E1F22] shrink-0 gap-4">
        <div className="flex items-center space-x-4">
          <button
            onClick={() => navigate('/')}
            className="text-gray-400 hover:text-white bg-[#1E1F22] px-3 py-1.5 rounded-lg transition-colors text-sm shrink-0 flex items-center gap-1.5"
          >
            <ArrowLeftIcon className="w-4 h-4" />
            <span>Accueil</span>
          </button>
          <div>
            <div className="flex flex-wrap items-center gap-2.5">
              <h1 className="text-xl md:text-2xl font-bold text-white">{server.name}</h1>
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
              <span className="bg-[#1E1F22] px-2.5 py-0.5 rounded border border-[#111214] font-mono">
                Port: <strong className="text-gray-200">{server.port}</strong>
              </span>
              <span className="bg-[#1E1F22] px-2.5 py-0.5 rounded border border-[#111214] font-mono">
                Moteur: <strong className="text-[#8EA1E1]">{server.server_type || 'PAPER'}</strong> ({server.version || 'LATEST'})
              </span>
              <span className="bg-[#1E1F22] px-2.5 py-0.5 rounded border border-[#111214] font-mono">
                RAM: <strong className="text-gray-200">{server.ram || '2G'}</strong>
              </span>
              {isRunning && (
                <span className="bg-[#1E1F22] px-2.5 py-0.5 rounded border border-[#111214] font-mono text-[#23A559]">
                  CPU: {stats.cpu_percent}% | RAM: {stats.ram_used_mb} Mo ({stats.ram_percent}%)
                </span>
              )}
            </div>
          </div>
        </div>

        {/* BOUTONS D'ACTION (Démarrer, Arrêter, Supprimer) */}
        <div className="flex items-center space-x-2.5 self-end lg:self-auto">
          {canPower && (
            <>
              <button
                onClick={() => startServer(server)}
                disabled={isRunning}
                className="bg-[#23A559] hover:bg-[#1D8B4A] disabled:opacity-40 disabled:cursor-not-allowed text-white px-4 py-2 rounded-lg font-semibold transition-colors shadow text-xs flex items-center gap-1.5"
              >
                <PlayIcon className="w-3.5 h-3.5" />
                <span>Démarrer</span>
              </button>
              <button
                onClick={() => stopServer(server.name)}
                disabled={!isRunning}
                className="bg-[#DA373C] hover:bg-[#C92B30] disabled:opacity-40 disabled:cursor-not-allowed text-white px-4 py-2 rounded-lg font-semibold transition-colors shadow text-xs flex items-center gap-1.5"
              >
                <SquareIcon className="w-3.5 h-3.5" />
                <span>Arrêter</span>
              </button>
            </>
          )}

          {isAdmin && (
            <>
              <div className="w-px h-7 bg-[#1E1F22] mx-1"></div>
              <button
                onClick={handleDelete}
                className="text-gray-400 hover:text-[#DA373C] hover:bg-[#DA373C]/10 px-3 py-2 rounded-lg font-medium transition-colors text-xs border border-transparent hover:border-[#DA373C]/50 flex items-center gap-1.5"
              >
                <TrashIcon className="w-3.5 h-3.5" />
                <span>Supprimer</span>
              </button>
            </>
          )}
        </div>
      </header>

      {/* BARRE D'ONGLETS (8 ONGLETS PRO) */}
      <nav className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-8 gap-2 mb-3 shrink-0">
        {tabs.map((tab) => {
          const isActive = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex flex-col justify-between p-2.5 rounded-xl border text-left transition-all ${
                isActive
                  ? 'bg-[#5865F2] border-[#5865F2] text-white shadow-lg'
                  : 'bg-[#2B2D31] border-[#1E1F22] text-gray-300 hover:bg-[#35373C] hover:text-white'
              }`}
            >
              <div className="flex items-center justify-between w-full mb-1">
                <span className="text-base">{tab.icon}</span>
                {tab.badge !== undefined && (
                  <span
                    className={`px-1.5 py-0.5 text-[10px] rounded-full font-mono font-bold ${
                      isActive ? 'bg-white/25 text-white' : 'bg-[#1E1F22] text-[#8EA1E1]'
                    }`}
                  >
                    {tab.badge}
                  </span>
                )}
              </div>
              <div>
                <div className="font-bold text-xs truncate">{tab.label}</div>
                <div className={`text-[10px] truncate ${isActive ? 'text-indigo-100' : 'text-gray-400'}`}>
                  {tab.subtitle}
                </div>
              </div>
            </button>
          );
        })}
      </nav>

      {/* BANNIÈRE DE TITRE DE L'ONGLET ACTIF */}
      <div className="mb-3 px-4 py-2.5 bg-[#1E1F22] rounded-xl border border-[#2B2D31] flex flex-col sm:flex-row sm:items-center justify-between gap-2 shrink-0">
        <div className="flex items-center space-x-3">
          <span className="text-xl">{currentTabInfo.icon}</span>
          <div>
            <h2 className="text-sm md:text-base font-bold text-white tracking-wide">{currentTabInfo.fullTitle}</h2>
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
                onKeyDown={handleConsoleKeyDown}
                placeholder={
                  isRunning
                    ? 'Tapez une commande (flèches ↑/↓ pour l’historique)...'
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
        {/* ONGLET 2 : MONITORING (JAUGES & GRAPHS)    */}
        {/* ========================================== */}
        {activeTab === 'monitoring' && (
          <div className="flex-grow overflow-y-auto space-y-5 pr-1">
            {!isRunning ? (
              <div className="bg-[#2B2D31] rounded-xl border border-[#1E1F22] p-10 text-center text-gray-400">
                <p className="text-lg font-bold text-white mb-1">Serveur hors ligne</p>
                <p className="text-sm">Démarrez le serveur pour visualiser les jauges CPU, RAM et Réseau en direct.</p>
              </div>
            ) : (
              <>
                {/* 4 Cartes KPIs Temps Réel */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                  {/* Jauge CPU */}
                  <div className="bg-[#2B2D31] p-5 rounded-xl border border-[#1E1F22] text-white">
                    <div className="flex justify-between items-center text-xs text-gray-400 uppercase font-bold mb-2">
                      <span>Charge CPU</span>
                      <span className="text-[#5865F2] font-mono text-sm">{stats.cpu_percent}%</span>
                    </div>
                    <div className="text-2xl font-extrabold font-mono mb-3">{stats.cpu_percent}%</div>
                    <div className="w-full h-2.5 bg-[#111214] rounded-full overflow-hidden">
                      <div
                        className="h-full bg-[#5865F2] transition-all duration-500"
                        style={{ width: `${Math.min(100, stats.cpu_percent)}%` }}
                      />
                    </div>
                  </div>

                  {/* Jauge RAM */}
                  <div className="bg-[#2B2D31] p-5 rounded-xl border border-[#1E1F22] text-white">
                    <div className="flex justify-between items-center text-xs text-gray-400 uppercase font-bold mb-2">
                      <span>Mémoire RAM</span>
                      <span className="text-[#23A559] font-mono text-sm">{stats.ram_percent}%</span>
                    </div>
                    <div className="text-2xl font-extrabold font-mono mb-3">
                      {stats.ram_used_mb} <span className="text-sm font-normal text-gray-400">/ {stats.ram_limit_mb} Mo</span>
                    </div>
                    <div className="w-full h-2.5 bg-[#111214] rounded-full overflow-hidden">
                      <div
                        className="h-full bg-[#23A559] transition-all duration-500"
                        style={{ width: `${Math.min(100, stats.ram_percent)}%` }}
                      />
                    </div>
                  </div>

                  {/* Trafic Réseau */}
                  <div className="bg-[#2B2D31] p-5 rounded-xl border border-[#1E1F22] text-white">
                    <div className="text-xs text-gray-400 uppercase font-bold mb-2">Trafic Réseau Conteneur</div>
                    <div className="flex items-baseline justify-between mt-3">
                      <div>
                        <span className="text-xs text-gray-400 block">↓ Reçu (RX)</span>
                        <span className="text-lg font-bold font-mono text-blue-400">{stats.net_rx_mb} Mo</span>
                      </div>
                      <div>
                        <span className="text-xs text-gray-400 block">↑ Envoyé (TX)</span>
                        <span className="text-lg font-bold font-mono text-purple-400">{stats.net_tx_mb} Mo</span>
                      </div>
                    </div>
                  </div>

                  {/* Processus / Threads */}
                  <div className="bg-[#2B2D31] p-5 rounded-xl border border-[#1E1F22] text-white">
                    <div className="text-xs text-gray-400 uppercase font-bold mb-2">Threads JVM Actifs</div>
                    <div className="text-2xl font-extrabold font-mono mt-2">{stats.pids}</div>
                    <p className="text-xs text-gray-400 mt-2">Actualisation toutes les 3 secondes</p>
                  </div>
                </div>

                {/* Courbes Temps Réel CPU & RAM */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
                  <div className="bg-[#2B2D31] p-5 rounded-xl border border-[#1E1F22] text-white">
                    <div className="flex items-center justify-between mb-4">
                      <div>
                        <h3 className="font-bold text-base">Historique CPU (%)</h3>
                        <p className="text-xs text-gray-400">Évolution sur les 30 derniers relevés</p>
                      </div>
                      <span className="font-mono text-sm font-bold text-[#5865F2] bg-[#1E1F22] px-3 py-1 rounded-lg">
                        Actuel : {stats.cpu_percent}%
                      </span>
                    </div>
                    <div className="bg-[#111214] p-4 rounded-xl border border-[#1E1F22]">
                      <AreaSparkline data={cpuHistory} maxVal={100} colorHex="#5865F2" />
                    </div>
                  </div>

                  <div className="bg-[#2B2D31] p-5 rounded-xl border border-[#1E1F22] text-white">
                    <div className="flex items-center justify-between mb-4">
                      <div>
                        <h3 className="font-bold text-base">Historique Mémoire RAM (Mo)</h3>
                        <p className="text-xs text-gray-400">Plafond alloué : {stats.ram_limit_mb} Mo</p>
                      </div>
                      <span className="font-mono text-sm font-bold text-[#23A559] bg-[#1E1F22] px-3 py-1 rounded-lg">
                        Actuel : {stats.ram_used_mb} Mo
                      </span>
                    </div>
                    <div className="bg-[#111214] p-4 rounded-xl border border-[#1E1F22]">
                      <AreaSparkline data={ramHistory} maxVal={stats.ram_limit_mb} colorHex="#23A559" />
                    </div>
                  </div>
                </div>
              </>
            )}
          </div>
        )}

        {/* ========================================== */}
        {/* ONGLET 3 : MODS & PLUGINS (MODRINTH)       */}
        {/* ========================================== */}
        {activeTab === 'addons' && (
          <div className="flex-grow grid grid-cols-1 lg:grid-cols-12 gap-5 overflow-hidden min-h-0">
            {/* COLONNE GAUCHE : Catalogue Modrinth & Téléchargeur */}
            <div className="lg:col-span-7 bg-[#2B2D31] rounded-xl border border-[#1E1F22] flex flex-col overflow-hidden shadow-lg text-white">
              <div className="p-4 bg-[#1E1F22] border-b border-[#2B2D31] shrink-0">
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    searchModrinth(searchQuery);
                  }}
                  className="flex gap-2"
                >
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder={`Rechercher un ${addonLabel.toLowerCase()} sur Modrinth (ex: JEI, WorldEdit, Lithium, EssentialsX)...`}
                    className="flex-grow bg-[#111214] text-white border border-[#2B2D31] rounded-lg px-3.5 py-2 text-sm focus:outline-none focus:border-[#5865F2]"
                  />
                  <button
                    type="submit"
                    disabled={isSearchingAddons}
                    className="bg-[#5865F2] hover:bg-[#4752C4] text-white px-4 py-2 rounded-lg text-sm font-semibold transition-colors shrink-0 flex items-center gap-1.5"
                  >
                    <SearchIcon className="w-4 h-4" />
                    <span>{isSearchingAddons ? 'Recherche...' : 'Chercher'}</span>
                  </button>
                </form>

                {addonFeedback && (
                  <div
                    className={`mt-3 p-2.5 rounded-lg text-xs border ${
                      addonFeedback.type === 'success'
                        ? 'bg-[#23A559]/15 border-[#23A559]/50 text-[#23A559]'
                        : 'bg-[#DA373C]/15 border-[#DA373C]/50 text-[#DA373C]'
                    }`}
                  >
                    {addonFeedback.text}
                  </div>
                )}
              </div>

              <div className="flex-grow overflow-y-auto p-4 space-y-3">
                {isSearchingAddons ? (
                  <div className="text-center text-gray-400 py-10 text-sm">Interrogation du catalogue Modrinth...</div>
                ) : modrinthResults.length === 0 ? (
                  <div className="text-center text-gray-400 py-10 text-sm">Aucun résultat trouvé.</div>
                ) : (
                  modrinthResults.map((mod) => {
                    const isInstalling = installingId === mod.project_id;
                    return (
                      <div
                        key={mod.project_id}
                        className="bg-[#1E1F22] border border-[#111214] rounded-xl p-3.5 flex items-center justify-between gap-4 hover:border-[#5865F2]/50 transition-colors"
                      >
                        <div className="flex items-center space-x-3.5 min-w-0">
                          {mod.icon_url ? (
                            <img src={mod.icon_url} alt={mod.title} className="w-11 h-11 rounded-lg bg-[#111214] shrink-0" />
                          ) : (
                            <div className="w-11 h-11 rounded-lg bg-[#111214] flex items-center justify-center text-[#8EA1E1] shrink-0">
                              <PuzzleIcon className="w-5 h-5" />
                            </div>
                          )}
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-bold text-sm text-white truncate">{mod.title}</span>
                              <span className="text-[11px] text-gray-400">par {mod.author}</span>
                            </div>
                            <p className="text-xs text-gray-400 line-clamp-2 mt-0.5">{mod.description}</p>
                          </div>
                        </div>

                        <button
                          onClick={() => handleInstallAddon(mod)}
                          disabled={isInstalling}
                          className="bg-[#23A559] hover:bg-[#1D8B4A] disabled:opacity-50 text-white px-3.5 py-2 rounded-lg text-xs font-semibold transition-colors shrink-0 shadow flex items-center gap-1.5"
                        >
                          <DownloadIcon className="w-3.5 h-3.5" />
                          <span>{isInstalling ? 'Installation...' : 'Installer'}</span>
                        </button>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* COLONNE DROITE : Fichiers .jar installés */}
            <div className="lg:col-span-5 bg-[#2B2D31] rounded-xl border border-[#1E1F22] flex flex-col overflow-hidden shadow-lg text-white">
              <div className="p-4 bg-[#1E1F22] border-b border-[#2B2D31] flex items-center justify-between shrink-0">
                <div>
                  <h3 className="font-bold text-sm">
                    Installés dans <code className="text-[#8EA1E1]">/{addonFolder}</code>
                  </h3>
                  <p className="text-xs text-gray-400">Redémarrez le serveur après l'ajout d'un fichier .jar</p>
                </div>
                <span className="bg-[#2B2D31] px-2.5 py-1 rounded-full text-xs font-mono">
                  {installedAddons.length} fichier(s)
                </span>
              </div>

              <div className="flex-grow overflow-y-auto p-4 space-y-2.5">
                {installedAddons.length === 0 ? (
                  <div className="text-center text-gray-400 py-10 text-sm">
                    Aucun fichier <code className="text-gray-300">.jar</code> dans <code className="text-gray-300">/{addonFolder}</code>.
                  </div>
                ) : (
                  installedAddons.map((item) => (
                    <div
                      key={item.filename}
                      className="bg-[#1E1F22] border border-[#111214] rounded-xl p-3 flex items-center justify-between gap-2"
                    >
                      <div className="min-w-0">
                        <div className={`font-mono text-xs font-semibold truncate ${item.enabled ? 'text-white' : 'text-gray-500 line-through'}`}>
                          {item.filename}
                        </div>
                        <div className="text-[11px] text-gray-400 mt-0.5">{formatBytes(item.size)}</div>
                      </div>

                      <div className="flex items-center gap-1.5 shrink-0">
                        <button
                          onClick={() => handleToggleAddon(item.filename)}
                          className={`px-2.5 py-1 rounded text-xs font-medium ${
                            item.enabled
                              ? 'bg-[#23A559]/20 text-[#23A559]'
                              : 'bg-gray-600/30 text-gray-400'
                          }`}
                        >
                          {item.enabled ? 'Actif' : 'Désactivé'}
                        </button>
                        <button
                          onClick={() => handleDeleteAddon(item.filename)}
                          className="text-gray-400 hover:text-[#DA373C] px-2 py-1 text-xs"
                          title="Supprimer"
                        >
                          <TrashIcon className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        )}

        {/* ========================================== */}
        {/* ONGLET 4 : JOUEURS                         */}
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
                            >
                              De-OP
                            </button>
                          ) : (
                            <button
                              onClick={() => triggerPlayerAction('op', player)}
                              className="bg-[#5865F2]/20 hover:bg-[#5865F2] text-[#8EA1E1] hover:text-white border border-[#5865F2]/40 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors"
                            >
                              OP
                            </button>
                          )}
                          <button
                            onClick={() => triggerPlayerAction('kick', player)}
                            className="bg-orange-500/20 hover:bg-orange-500 text-orange-300 hover:text-white border border-orange-500/40 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors"
                          >
                            Kick
                          </button>
                          <button
                            onClick={() => triggerPlayerAction('ban', player)}
                            className="bg-[#DA373C]/20 hover:bg-[#DA373C] text-red-300 hover:text-white border border-[#DA373C]/40 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors"
                          >
                            Ban
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

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

            <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
              {/* Opérateurs */}
              <div className="bg-[#2B2D31] rounded-xl border border-[#1E1F22] p-5 text-white shadow-lg">
                <h3 className="text-base font-bold mb-3 flex items-center justify-between">
                  <span className="flex items-center gap-2">
                    <CrownIcon className="w-4 h-4 text-amber-400" />
                    <span>Opérateurs (ops.json)</span>
                  </span>
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

              {/* Whitelist (whitelist.json) */}
              <div className="bg-[#2B2D31] rounded-xl border border-[#1E1F22] p-5 text-white shadow-lg flex flex-col">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-base font-bold flex items-center gap-2">
                    <UsersIcon className="w-4 h-4 text-[#23A559]" />
                    <span>Whitelist</span>
                  </span>
                  <button
                    type="button"
                    disabled={!isRunning}
                    onClick={() => {
                      const nextCmd = playersData.whitelist_enabled ? 'whitelist off' : 'whitelist on';
                      if (sendWsCommand(nextCmd)) {
                        setActionToast(`Commande "${nextCmd}" envoyée`);
                        setTimeout(fetchPlayers, 800);
                      }
                    }}
                    className={`text-[11px] px-2.5 py-0.5 rounded-full font-bold transition-colors ${
                      playersData.whitelist_enabled
                        ? 'bg-[#23A559]/20 text-[#23A559]'
                        : 'bg-[#1E1F22] text-gray-400'
                    }`}
                  >
                    {playersData.whitelist_enabled ? 'Activée' : 'Désactivée'}
                  </button>
                </div>

                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    if (!whitelistInput.trim() || !isRunning) return;
                    if (sendWsCommand(`whitelist add ${whitelistInput.trim()}`)) {
                      setActionToast(`Joueur ${whitelistInput.trim()} ajouté à la Whitelist`);
                      setWhitelistInput('');
                      setTimeout(fetchPlayers, 800);
                    }
                  }}
                  className="flex gap-1.5 mb-3"
                >
                  <input
                    type="text"
                    value={whitelistInput}
                    onChange={(e) => setWhitelistInput(e.target.value)}
                    placeholder="Ajouter un pseudo..."
                    disabled={!isRunning}
                    className="flex-grow bg-[#1E1F22] text-white border border-[#111214] rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:border-[#5865F2] disabled:opacity-50"
                  />
                  <button
                    type="submit"
                    disabled={!isRunning || !whitelistInput.trim()}
                    className="bg-[#23A559] hover:bg-[#1D8B4A] disabled:opacity-40 text-white px-2.5 py-1.5 rounded-lg text-xs font-semibold shrink-0"
                  >
                    +
                  </button>
                </form>

                {(playersData.whitelist || []).length === 0 ? (
                  <p className="text-sm text-gray-400">Aucun joueur sur la liste blanche.</p>
                ) : (
                  <div className="space-y-2 max-h-44 overflow-y-auto">
                    {(playersData.whitelist || []).map((wlName) => (
                      <div
                        key={wlName}
                        className="bg-[#1E1F22] px-3.5 py-2 rounded-lg flex items-center justify-between text-sm"
                      >
                        <span className="font-medium text-emerald-300">{wlName}</span>
                        <button
                          onClick={() => {
                            if (sendWsCommand(`whitelist remove ${wlName}`)) {
                              setActionToast(`Joueur ${wlName} retiré de la Whitelist`);
                              setTimeout(fetchPlayers, 800);
                            }
                          }}
                          disabled={!isRunning}
                          className="text-xs text-gray-400 hover:text-[#DA373C] disabled:opacity-40"
                        >
                          Retirer
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Joueurs bannis */}
              <div className="bg-[#2B2D31] rounded-xl border border-[#1E1F22] p-5 text-white shadow-lg">
                <h3 className="text-base font-bold mb-3 flex items-center justify-between">
                  <span className="flex items-center gap-2">
                    <BanIcon className="w-4 h-4 text-[#DA373C]" />
                    <span>Bannis (banned-players)</span>
                  </span>
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
        {/* ONGLET 5 : FICHIERS (WEB FTP)              */}
        {/* ========================================== */}
        {activeTab === 'files' && (
          <div className="flex-grow grid grid-cols-1 lg:grid-cols-12 gap-4 overflow-hidden min-h-0">
            <div
              onDragOver={(e) => {
                e.preventDefault();
                setIsDraggingOver(true);
              }}
              onDragLeave={() => setIsDraggingOver(false)}
              onDrop={(e) => {
                e.preventDefault();
                setIsDraggingOver(false);
                handleUploadFiles(e.dataTransfer.files);
              }}
              className={`lg:col-span-5 bg-[#2B2D31] rounded-xl border flex flex-col overflow-hidden shadow-lg transition-colors ${
                isDraggingOver ? 'border-[#23A559] bg-[#23A559]/10' : 'border-[#1E1F22]'
              }`}
            >
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
                    <input
                      ref={fileUploadInputRef}
                      type="file"
                      multiple
                      className="hidden"
                      onChange={(e) => {
                        handleUploadFiles(e.target.files);
                        e.target.value = '';
                      }}
                    />
                    <button
                      type="button"
                      disabled={isUploadingFile}
                      onClick={() => fileUploadInputRef.current?.click()}
                      className="bg-[#23A559] hover:bg-[#1D8B4A] text-white px-2.5 py-1 rounded text-xs font-medium transition-colors flex items-center gap-1"
                      title="Importer un fichier depuis votre PC (ou glisser-déposer)"
                    >
                      <UploadIcon className="w-3 h-3" />
                      <span>{isUploadingFile ? '...' : 'Importer'}</span>
                    </button>
                    <button
                      onClick={() => setShowNewFileInput((v) => !v)}
                      className="bg-[#5865F2] hover:bg-[#4752C4] text-white px-2.5 py-1 rounded text-xs font-medium transition-colors"
                    >
                      + Fichier
                    </button>
                    <button
                      onClick={() => fetchDirectory(currentDir)}
                      className="bg-[#2B2D31] hover:bg-[#111214] text-gray-300 px-2.5 py-1 rounded text-xs transition-colors"
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
                    else if (
                      item.name.endsWith('.yml') ||
                      item.name.endsWith('.yaml') ||
                      item.name.endsWith('.json') ||
                      item.name.endsWith('.properties')
                    )
                      icon = '⚙️';
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

            <div className="lg:col-span-7 bg-[#111214] rounded-xl border border-[#1E1F22] flex flex-col overflow-hidden shadow-lg">
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
                      className="bg-[#23A559] hover:bg-[#1D8B4A] disabled:opacity-40 text-white px-4 py-1.5 rounded-lg text-xs font-semibold transition-colors shadow flex items-center gap-1.5"
                    >
                      <SaveIcon className="w-3.5 h-3.5" />
                      <span>{isSavingFile ? 'Sauvegarde...' : 'Sauvegarder (Ctrl+S)'}</span>
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

              {isLoadingFileContent ? (
                <div className="flex-grow flex items-center justify-center text-gray-400 text-sm">
                  Chargement de {selectedFileName}...
                </div>
              ) : !selectedFilePath ? (
                <div className="flex-grow flex flex-col items-center justify-center text-gray-500 p-8 text-center">
                  <FileTextIcon className="w-10 h-10 mb-3 text-gray-500" />
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

        {/* ========================================== */}
        {/* ONGLET 6 : SAUVEGARDES (SNAPSHOTS .ZIP)    */}
        {/* ========================================== */}
        {activeTab === 'backups' && (
          <div className="flex-grow overflow-y-auto space-y-6 pr-1">
            <div className="bg-[#2B2D31] rounded-xl border border-[#1E1F22] p-6 text-white shadow-lg">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 pb-5 border-b border-[#1E1F22]">
                <div>
                  <h3 className="text-lg font-bold">Créer un Snapshot instantané</h3>
                  <p className="text-xs text-gray-400 mt-1">
                    Exécute automatiquement un <code className="text-gray-300">save-all</code> puis compresse le serveur dans une archive <code className="text-gray-300">.zip</code>.
                  </p>
                </div>

                <form onSubmit={handleCreateBackup} className="flex flex-wrap gap-2">
                  <input
                    ref={worldUploadInputRef}
                    type="file"
                    accept=".zip"
                    className="hidden"
                    onChange={(e) => {
                      handleImportWorldZip(e.target.files?.[0] || null);
                      e.target.value = '';
                    }}
                  />
                  <button
                    type="button"
                    disabled={isImportingWorld}
                    onClick={() => worldUploadInputRef.current?.click()}
                    className="bg-[#1E1F22] hover:bg-[#111214] border border-[#111214] text-gray-200 px-4 py-2 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5 shrink-0"
                    title="Importer une map externe (.zip) dans /world"
                  >
                    <UploadIcon className="w-3.5 h-3.5 text-[#8EA1E1]" />
                    <span>{isImportingWorld ? 'Import de la map...' : 'Importer une Map (.zip)'}</span>
                  </button>
                  <input
                    type="text"
                    value={backupLabelInput}
                    onChange={(e) => setBackupLabelInput(e.target.value)}
                    placeholder="Nom (ex: avant-boss, v1...)"
                    className="bg-[#1E1F22] text-white border border-[#111214] rounded-lg px-3.5 py-2 text-sm focus:outline-none focus:border-[#5865F2]"
                  />
                  <button
                    type="submit"
                    disabled={isCreatingBackup}
                    className="bg-[#23A559] hover:bg-[#1D8B4A] disabled:opacity-50 text-white px-5 py-2 rounded-lg text-sm font-semibold transition-colors shadow shrink-0 flex items-center gap-1.5"
                  >
                    <PlusIcon className="w-4 h-4" />
                    <span>{isCreatingBackup ? 'Compression en cours...' : 'Nouveau Snapshot'}</span>
                  </button>
                </form>
              </div>

              {backupFeedback && (
                <div
                  className={`mt-4 p-3.5 rounded-lg text-sm border ${
                    backupFeedback.type === 'success'
                      ? 'bg-[#23A559]/15 border-[#23A559]/50 text-[#23A559]'
                      : 'bg-[#DA373C]/15 border-[#DA373C]/50 text-[#DA373C]'
                  }`}
                >
                  {backupFeedback.text}
                </div>
              )}

              <div className="mt-6">
                <h4 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">
                  Archives disponibles ({backups.length})
                </h4>

                {isLoadingBackups ? (
                  <div className="text-center text-gray-400 py-8 text-sm">Chargement des snapshots...</div>
                ) : backups.length === 0 ? (
                  <div className="bg-[#1E1F22] rounded-xl p-8 text-center text-gray-400 text-sm">
                    Aucune sauvegarde pour le moment. Créez votre premier snapshot ci-dessus !
                  </div>
                ) : (
                  <div className="space-y-2.5">
                    {backups.map((b) => {
                      const isRestoring = restoringBackupName === b.name;
                      return (
                        <div
                          key={b.name}
                          className="bg-[#1E1F22] border border-[#111214] rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                        >
                          <div>
                            <div className="font-mono font-bold text-sm text-white flex items-center gap-2">
                              <ArchiveIcon className="w-4 h-4 text-[#8EA1E1]" />
                              <span>{b.name}</span>
                            </div>
                            <div className="text-xs text-gray-400 mt-1">
                              Créé le {formatDate(b.created_at)} • Taille :{' '}
                              <strong className="text-gray-200">{formatBytes(b.size)}</strong>
                            </div>
                          </div>

                          <div className="flex items-center gap-2">
                            <a
                              href={`${API_BASE}/api/servers/${server.name}/backups/${encodeURIComponent(b.name)}/download`}
                              download={b.name}
                              className="bg-[#2B2D31] hover:bg-[#35373C] text-gray-200 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors flex items-center gap-1.5"
                              title="Télécharger cette sauvegarde .zip sur votre PC"
                            >
                              <DownloadIcon className="w-3.5 h-3.5 text-[#8EA1E1]" />
                              <span>Télécharger</span>
                            </a>
                            <button
                              onClick={() => handleRestoreBackup(b.name)}
                              disabled={isRestoring}
                              className="bg-[#5865F2] hover:bg-[#4752C4] disabled:opacity-50 text-white px-4 py-1.5 rounded-lg text-xs font-semibold transition-colors"
                            >
                              {isRestoring ? 'Restauration...' : 'Restaurer'}
                            </button>
                            <button
                              onClick={() => handleDeleteBackup(b.name)}
                              className="bg-[#DA373C]/20 hover:bg-[#DA373C] text-red-300 hover:text-white px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors"
                            >
                              Supprimer
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ========================================== */}
        {/* ONGLET 7 : PLANIFICATEUR (TÂCHES CRON)     */}
        {/* ========================================== */}
        {activeTab === 'schedules' && (
          <div className="flex-grow overflow-y-auto space-y-6 pr-1">
            {/* Formulaire création de tâche Cron */}
            <form
              onSubmit={handleCreateSchedule}
              className="bg-[#2B2D31] rounded-xl border border-[#1E1F22] p-6 text-white shadow-lg"
            >
              <h3 className="text-lg font-bold mb-1">Programmer une nouvelle tâche automatisée</h3>
              <p className="text-xs text-gray-400 mb-5">
                Le démon OurCraft exécute vos tâches en arrière-plan (reboot quotidien, sauvegarde auto, message RCON).
              </p>

              {scheduleFeedback && (
                <div
                  className={`mb-5 p-3.5 rounded-lg text-sm border ${
                    scheduleFeedback.type === 'success'
                      ? 'bg-[#23A559]/15 border-[#23A559]/50 text-[#23A559]'
                      : 'bg-[#DA373C]/15 border-[#DA373C]/50 text-[#DA373C]'
                  }`}
                >
                  {scheduleFeedback.text}
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
                <div>
                  <label className="block text-xs font-bold text-gray-400 uppercase mb-1.5">Nom de la tâche</label>
                  <input
                    type="text"
                    value={schedName}
                    onChange={(e) => setSchedName(e.target.value)}
                    placeholder="ex: Reboot 4h du matin"
                    className="w-full bg-[#1E1F22] text-white border border-[#111214] rounded-lg px-3.5 py-2 text-sm focus:outline-none focus:border-[#5865F2]"
                    required
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-400 uppercase mb-1.5">Action à exécuter</label>
                  <select
                    value={schedAction}
                    onChange={(e) => {
                      setSchedAction(e.target.value);
                      if (e.target.value === 'restart')
                        setSchedPayload('Redémarrage automatique dans 5 secondes...');
                      else if (e.target.value === 'backup') setSchedPayload('Sauvegarde automatique du monde...');
                      else if (e.target.value === 'command') setSchedPayload('say Bienvenue sur le serveur !');
                    }}
                    className="w-full bg-[#1E1F22] text-white border border-[#111214] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#5865F2]"
                  >
                    <option value="restart">🔄 Redémarrer le serveur</option>
                    <option value="backup">💾 Créer un Snapshot (.zip)</option>
                    <option value="command">💬 Exécuter une commande RCON</option>
                    <option value="stop">🛑 Arrêter le serveur</option>
                    <option value="start">▶ Démarrer le serveur</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-400 uppercase mb-1.5">Fréquence</label>
                  <select
                    value={schedType}
                    onChange={(e) => {
                      setSchedType(e.target.value);
                      setSchedValue(e.target.value === 'daily' ? '04:00' : '60');
                    }}
                    className="w-full bg-[#1E1F22] text-white border border-[#111214] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#5865F2]"
                  >
                    <option value="daily">Tous les jours à heure fixe</option>
                    <option value="interval">Intervalle régulier (minutes)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-gray-400 uppercase mb-1.5">
                    {schedType === 'daily' ? 'Heure (HH:MM)' : 'Toutes les X minutes'}
                  </label>
                  {schedType === 'daily' ? (
                    <input
                      type="time"
                      value={schedValue}
                      onChange={(e) => setSchedValue(e.target.value)}
                      className="w-full bg-[#1E1F22] text-white border border-[#111214] rounded-lg px-3.5 py-2 font-mono text-sm focus:outline-none focus:border-[#5865F2]"
                      required
                    />
                  ) : (
                    <input
                      type="number"
                      min={5}
                      value={schedValue}
                      onChange={(e) => setSchedValue(e.target.value)}
                      placeholder="ex: 60"
                      className="w-full bg-[#1E1F22] text-white border border-[#111214] rounded-lg px-3.5 py-2 font-mono text-sm focus:outline-none focus:border-[#5865F2]"
                      required
                    />
                  )}
                </div>
              </div>

              <div className="flex flex-col sm:flex-row gap-3 items-end">
                <div className="flex-grow w-full">
                  <label className="block text-xs font-bold text-gray-400 uppercase mb-1.5">
                    {schedAction === 'command'
                      ? 'Commande RCON à envoyer (ex: say Bonjour, save-all)'
                      : 'Message d’annonce en jeu avant l’action (optionnel)'}
                  </label>
                  <input
                    type="text"
                    value={schedPayload}
                    onChange={(e) => setSchedPayload(e.target.value)}
                    className="w-full bg-[#1E1F22] text-white border border-[#111214] rounded-lg px-3.5 py-2 font-mono text-sm focus:outline-none focus:border-[#5865F2]"
                  />
                </div>
                <button
                  type="submit"
                  disabled={isSavingSchedule}
                  className="bg-[#5865F2] hover:bg-[#4752C4] text-white px-5 py-2 rounded-lg text-sm font-semibold transition-colors shadow shrink-0"
                >
                  ＋ Ajouter la tâche
                </button>
              </div>
            </form>

            {/* Liste des tâches programmées */}
            <div className="bg-[#2B2D31] rounded-xl border border-[#1E1F22] p-6 text-white shadow-lg">
              <h3 className="text-base font-bold mb-4">Tâches planifiées ({schedules.length})</h3>
              {schedules.length === 0 ? (
                <div className="bg-[#1E1F22] rounded-xl p-8 text-center text-gray-400 text-sm">
                  Aucune tâche automatisée configurée sur ce serveur.
                </div>
              ) : (
                <div className="space-y-3">
                  {schedules.map((t) => (
                    <div
                      key={t.id}
                      className="bg-[#1E1F22] border border-[#111214] rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                    >
                      <div>
                        <div className="flex items-center gap-2.5">
                          <span className="font-bold text-white text-sm">{t.name}</span>
                          <span className="text-xs font-mono bg-[#2B2D31] text-[#8EA1E1] px-2.5 py-0.5 rounded">
                            {t.schedule_type === 'daily'
                              ? `Tous les jours à ${t.schedule_value}`
                              : `Toutes les ${t.schedule_value} min`}
                          </span>
                          <span className="text-xs bg-[#2B2D31] text-gray-300 px-2 py-0.5 rounded uppercase">
                            {t.action_type}
                          </span>
                        </div>
                        <div className="text-xs text-gray-400 mt-1 font-mono">
                          {t.payload && <span>Payload: "{t.payload}" • </span>}
                          <span>Dernière exécution : {t.last_run || 'Jamais'}</span>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          onClick={() => handleRunScheduleNow(t.id)}
                          className="bg-[#2B2D31] hover:bg-[#35373C] text-gray-200 px-3 py-1.5 rounded-lg text-xs font-medium flex items-center gap-1.5"
                          title="Tester et exécuter immédiatement"
                        >
                          <PlayIcon className="w-3 h-3" />
                          <span>Tester</span>
                        </button>
                        <button
                          onClick={() => handleToggleSchedule(t.id)}
                          className={`px-3 py-1.5 rounded-lg text-xs font-semibold ${
                            t.enabled
                              ? 'bg-[#23A559]/20 text-[#23A559]'
                              : 'bg-gray-600/30 text-gray-400'
                          }`}
                        >
                          {t.enabled ? 'Actif' : 'En pause'}
                        </button>
                        <button
                          onClick={() => handleDeleteSchedule(t.id)}
                          className="text-gray-400 hover:text-[#DA373C] px-2 py-1.5 text-xs"
                        >
                          <TrashIcon className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ========================================== */}
        {/* ONGLET 8 : PARAMÈTRES                      */}
        {/* ========================================== */}
        {activeTab === 'settings' && (
          <div className="flex-grow overflow-y-auto space-y-6 pr-1">
            <form
              onSubmit={handleSaveDockerSettings}
              className="bg-[#2B2D31] rounded-xl border border-[#1E1F22] p-6 shadow-lg text-white"
            >
              <div className="flex flex-col md:flex-row md:items-center justify-between mb-6 pb-4 border-b border-[#1E1F22]">
                <div>
                  <h2 className="text-xl font-bold flex items-center gap-2">
                    <ServerIcon className="w-5 h-5 text-[#8EA1E1]" />
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
                </div>

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
                      className="w-full bg-[#1E1F22] text-white border border-[#111214] rounded-lg px-3 py-2.5 font-mono text-sm focus:outline-none focus:border-[#5865F2]"
                      required
                    />
                  </div>
                </div>

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
                </div>

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
                      className="w-full bg-[#1E1F22] text-white border border-[#111214] rounded-lg px-3 py-2.5 font-mono text-sm focus:outline-none focus:border-[#5865F2]"
                      required
                    />
                  </div>
                </div>
              </div>

              {typeInput !== (server.server_type || 'VANILLA') && (
                <div className="mt-5 p-4 rounded-xl bg-amber-500/15 border border-amber-500/40 text-amber-200 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div>
                    <div className="font-bold text-sm flex items-center gap-2">
                      <RefreshIcon className="w-4 h-4" />
                      <span>
                        Conversion de moteur détectée : {server.server_type || 'VANILLA'} → {typeInput}
                      </span>
                    </div>
                    <p className="text-xs text-amber-100/80 mt-1">
                      OurCraft va automatiquement adapter la structure de vos dimensions (Nether <code className="font-mono">DIM-1</code> & End <code className="font-mono">DIM1</code>) et remplacer l'exécutable du serveur sans perdre votre monde.
                    </p>
                  </div>
                  <label className="flex items-center gap-2 text-xs font-semibold cursor-pointer shrink-0 bg-[#1E1F22] px-3 py-2 rounded-lg border border-amber-500/30">
                    <input
                      type="checkbox"
                      checked={backupBeforeConvert}
                      onChange={(e) => setBackupBeforeConvert(e.target.checked)}
                      className="w-4 h-4 accent-[#23A559] rounded"
                    />
                    <span>Créer un Snapshot .zip avant conversion</span>
                  </label>
                </div>
              )}
            </form>

            <form
              onSubmit={handleSaveProperties}
              className="bg-[#2B2D31] rounded-xl border border-[#1E1F22] p-6 shadow-lg text-white"
            >
              <div className="flex flex-col md:flex-row md:items-center justify-between mb-6 pb-4 border-b border-[#1E1F22]">
                <div>
                  <div className="flex items-center gap-3">
                    <FileTextIcon className="w-5 h-5 text-[#8EA1E1]" />
                    <h2 className="text-xl font-bold">Fichier server.properties</h2>
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
      </div>
    </div>
  );
}
