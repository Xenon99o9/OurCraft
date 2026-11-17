import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeftIcon, ShieldIcon, LockIcon, RefreshIcon, BanIcon } from '../components/Icons';

const API_BASE = '';

interface BlockedIPEntry {
  id: number;
  ip_address: string;
  reason: string;
  source_server: string;
  created_at: string;
}

interface IPSummaryEntry {
  ip: string;
  total_connections: number;
  rejected_attempts: number;
  players: string[];
  servers: string[];
  risk: 'normal' | 'elevated' | 'critical' | 'blocked';
  is_blocked: boolean;
}

interface ConnectionHistoryEntry {
  time: string;
  server: string;
  player: string;
  ip: string;
  port: number;
  status: 'accepted' | 'rejected' | 'blocked';
  details: string;
}

interface SecurityOverview {
  threat_level: 'normal' | 'critical';
  suspicious_ips_count: number;
  blocked_ips: BlockedIPEntry[];
  ip_summary: IPSummaryEntry[];
  connection_history: ConnectionHistoryEntry[];
  lockdown_active: boolean;
  total_servers: number;
}

export default function SecurityShield() {
  const navigate = useNavigate();

  const [overview, setOverview] = useState<SecurityOverview>({
    threat_level: 'normal',
    suspicious_ips_count: 0,
    blocked_ips: [],
    ip_summary: [],
    connection_history: [],
    lockdown_active: false,
    total_servers: 0,
  });
  const [isLoading, setIsLoading] = useState(false);
  const [manualIp, setManualIp] = useState('');
  const [manualReason, setManualReason] = useState('');
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const fetchOverview = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/security/overview`);
      if (res.ok) {
        const data = await res.json();
        setOverview(data);
      }
    } catch (err) {
      console.error('Erreur chargement Bouclier Réseau:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchOverview();
    const interval = setInterval(fetchOverview, 6000);
    return () => clearInterval(interval);
  }, [fetchOverview]);

  const handleBlockIp = async (ip: string, reason?: string) => {
    if (!ip.trim()) return;
    setFeedback(null);
    try {
      const res = await fetch(`${API_BASE}/api/security/block-ip`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ip_address: ip.trim(),
          reason: reason?.trim() || 'Bloquée par le Bouclier Réseau OurCraft',
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setFeedback({ type: 'success', text: data.message });
        setManualIp('');
        setManualReason('');
        fetchOverview();
      } else {
        setFeedback({ type: 'error', text: data.detail || 'Erreur lors du blocage.' });
      }
    } catch {
      setFeedback({ type: 'error', text: 'Erreur réseau.' });
    }
  };

  const handleUnblockIp = async (ip: string) => {
    setFeedback(null);
    const res = await fetch(`${API_BASE}/api/security/block-ip/${encodeURIComponent(ip)}`, {
      method: 'DELETE',
    });
    const data = await res.json();
    if (res.ok) {
      setFeedback({ type: 'success', text: data.message });
      fetchOverview();
    }
  };

  const handleToggleLockdown = async () => {
    const nextState = !overview.lockdown_active;
    setFeedback(null);
    const res = await fetch(`${API_BASE}/api/security/lockdown`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: nextState }),
    });
    const data = await res.json();
    if (res.ok) {
      setFeedback({ type: 'success', text: data.message });
      fetchOverview();
    }
  };

  return (
    <div className="p-6 md:p-8 max-w-6xl mx-auto space-y-6">
      {/* HEADER */}
      <header className="flex flex-col md:flex-row md:items-center justify-between border-b border-[#1E1F22] pb-6 gap-4">
        <div className="flex items-center space-x-4">
          <button
            onClick={() => navigate('/')}
            className="text-gray-400 hover:text-white bg-[#2B2D31] px-3.5 py-2 rounded-lg transition-colors text-sm flex items-center gap-1.5"
          >
            <ArrowLeftIcon className="w-4 h-4" />
            <span>Retour</span>
          </button>
          <div>
            <h1 className="text-3xl font-bold text-white tracking-wide flex items-center gap-3">
              <ShieldIcon className="w-7 h-7 text-amber-400" />
              <span>Bouclier Réseau & Anti-Attaques</span>
            </h1>
            <p className="text-gray-400 text-sm mt-1">
              Analyse du trafic, historique des connexions IP et pare-feu RCON / Liste noire globale.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={handleToggleLockdown}
            className={`px-4 py-2.5 rounded-lg text-sm font-bold transition-colors shadow flex items-center gap-2 ${
              overview.lockdown_active
                ? 'bg-[#DA373C] hover:bg-[#C92B30] text-white'
                : 'bg-[#2B2D31] hover:bg-[#35373C] border border-[#1E1F22] text-amber-300'
            }`}
          >
            <LockIcon className="w-4 h-4" />
            <span>
              {overview.lockdown_active
                ? 'Lockdown Actif (Désactiver)'
                : "Activer Mode Lockdown d'Urgence"}
            </span>
          </button>
          <button
            onClick={fetchOverview}
            disabled={isLoading}
            className="bg-[#5865F2] hover:bg-[#4752C4] text-white px-4 py-2.5 rounded-lg text-sm font-medium transition-colors flex items-center gap-1.5"
          >
            <RefreshIcon className="w-4 h-4" />
            <span>Actualiser</span>
          </button>
        </div>
      </header>

      {feedback && (
        <div
          className={`p-4 rounded-xl text-sm border ${
            feedback.type === 'success'
              ? 'bg-[#23A559]/15 border-[#23A559]/50 text-[#23A559]'
              : 'bg-[#DA373C]/15 border-[#DA373C]/50 text-[#DA373C]'
          }`}
        >
          {feedback.text}
        </div>
      )}

      {/* CARTES KPI SÉCURITÉ */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-[#2B2D31] p-5 rounded-xl border border-[#1E1F22] text-white">
          <span className="text-xs font-bold uppercase text-gray-400">État du Bouclier</span>
          <div className="flex items-center gap-2.5 mt-2">
            <span
              className={`w-3 h-3 rounded-full ${
                overview.threat_level === 'critical' ? 'bg-[#DA373C] animate-pulse' : 'bg-[#23A559]'
              }`}
            />
            <span className="text-xl font-extrabold">
              {overview.threat_level === 'critical' ? 'Activité Suspecte Détectée' : 'Trafic Normal & Protégé'}
            </span>
          </div>
          <p className="text-xs text-gray-400 mt-1">
            {overview.suspicious_ips_count} IP(s) présentant un taux élevé de rejets ou de connexions.
          </p>
        </div>

        <div className="bg-[#2B2D31] p-5 rounded-xl border border-[#1E1F22] text-white">
          <span className="text-xs font-bold uppercase text-gray-400">Adresses IP Bloquées</span>
          <div className="text-2xl font-extrabold font-mono mt-2 text-[#DA373C]">
            {overview.blocked_ips.length}
          </div>
          <p className="text-xs text-gray-400 mt-1">Synchronisées avec banned-ips.json & RCON</p>
        </div>

        <div className="bg-[#2B2D31] p-5 rounded-xl border border-[#1E1F22] text-white">
          <span className="text-xs font-bold uppercase text-gray-400">Adresses IP Uniques Tracées</span>
          <div className="text-2xl font-extrabold font-mono mt-2 text-[#8EA1E1]">
            {overview.ip_summary.length}
          </div>
          <p className="text-xs text-gray-400 mt-1">
            {overview.connection_history.length} événements de connexion récents analysés
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* COLONNE GAUCHE : Radar des IPs & Liste Noire */}
        <div className="lg:col-span-5 space-y-6">
          {/* Blocage manuel d'une IP */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleBlockIp(manualIp, manualReason);
            }}
            className="bg-[#2B2D31] p-5 rounded-xl border border-[#1E1F22] text-white shadow-lg space-y-3"
          >
            <h2 className="text-base font-bold">🚫 Bloquer une adresse IP manuellement</h2>
            <input
              type="text"
              value={manualIp}
              onChange={(e) => setManualIp(e.target.value)}
              placeholder="Adresse IP (ex: 192.168.1.45 ou 45.33.x.x)"
              className="w-full bg-[#1E1F22] text-white border border-[#111214] rounded-lg px-3.5 py-2 font-mono text-sm focus:outline-none focus:border-[#5865F2]"
              required
            />
            <div className="flex gap-2">
              <input
                type="text"
                value={manualReason}
                onChange={(e) => setManualReason(e.target.value)}
                placeholder="Motif (ex: Tentative de flood / attaque)"
                className="flex-grow bg-[#1E1F22] text-white border border-[#111214] rounded-lg px-3.5 py-2 text-sm focus:outline-none focus:border-[#5865F2]"
              />
              <button
                type="submit"
                className="bg-[#DA373C] hover:bg-[#C92B30] text-white px-4 py-2 rounded-lg text-xs font-bold transition-colors shrink-0"
              >
                Bloquer l'IP
              </button>
            </div>
          </form>

          {/* Radar de réputation par IP */}
          <div className="bg-[#2B2D31] p-5 rounded-xl border border-[#1E1F22] text-white shadow-lg">
            <h2 className="text-base font-bold mb-3">🔍 Analyse du trafic par IP ({overview.ip_summary.length})</h2>
            {overview.ip_summary.length === 0 ? (
              <p className="text-sm text-gray-400 py-4 text-center">
                Aucune connexion IP détectée dans les logs pour le moment.
              </p>
            ) : (
              <div className="space-y-2.5 max-h-64 overflow-y-auto pr-1">
                {overview.ip_summary.map((item) => (
                  <div
                    key={item.ip}
                    className="bg-[#1E1F22] border border-[#111214] rounded-xl p-3 flex items-center justify-between gap-2"
                  >
                    <div className="min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-bold text-sm text-white">{item.ip}</span>
                        <span
                          className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase ${
                            item.risk === 'blocked'
                              ? 'bg-[#DA373C]/20 text-[#DA373C]'
                              : item.risk === 'critical'
                              ? 'bg-red-500/30 text-red-200'
                              : item.risk === 'elevated'
                              ? 'bg-amber-500/20 text-amber-300'
                              : 'bg-[#23A559]/20 text-[#23A559]'
                          }`}
                        >
                          {item.risk === 'blocked'
                            ? 'Bloquée'
                            : item.risk === 'critical'
                            ? 'Suspect / Flood'
                            : item.risk === 'elevated'
                            ? 'Surveillée'
                            : 'Sûre'}
                        </span>
                      </div>
                      <div className="text-xs text-gray-400 mt-1 truncate">
                        Pseudos : <strong className="text-gray-200">{item.players.join(', ') || 'Inconnu'}</strong> •{' '}
                        {item.total_connections} conn. ({item.rejected_attempts} rejetées)
                      </div>
                    </div>

                    {item.is_blocked ? (
                      <button
                        onClick={() => handleUnblockIp(item.ip)}
                        className="text-xs text-[#23A559] hover:underline shrink-0"
                      >
                        Débloquer
                      </button>
                    ) : (
                      <button
                        onClick={() => handleBlockIp(item.ip, 'Activité suspecte détectée')}
                        className="bg-[#DA373C]/20 hover:bg-[#DA373C] text-red-300 hover:text-white px-2.5 py-1.5 rounded-lg text-xs font-semibold transition-colors shrink-0"
                      >
                        Bloquer
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Liste noire des IPs bloquées */}
          <div className="bg-[#2B2D31] p-5 rounded-xl border border-[#1E1F22] text-white shadow-lg">
            <h2 className="text-base font-bold mb-3">🛡️ Liste Noire IP ({overview.blocked_ips.length})</h2>
            {overview.blocked_ips.length === 0 ? (
              <p className="text-sm text-gray-400">Aucune adresse IP bloquée.</p>
            ) : (
              <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
                {overview.blocked_ips.map((b) => (
                  <div
                    key={b.ip_address}
                    className="bg-[#1E1F22] border border-[#111214] rounded-lg p-3 flex items-center justify-between text-xs"
                  >
                    <div>
                      <span className="font-mono font-bold text-red-300">{b.ip_address}</span>
                      <p className="text-gray-400 mt-0.5">{b.reason}</p>
                    </div>
                    <button
                      onClick={() => handleUnblockIp(b.ip_address)}
                      className="text-[#23A559] hover:underline font-semibold ml-2 shrink-0"
                    >
                      Débloquer
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* COLONNE DROITE : Historique en direct des connexions IP */}
        <div className="lg:col-span-7 bg-[#2B2D31] p-6 rounded-xl border border-[#1E1F22] text-white shadow-lg flex flex-col">
          <div className="flex items-center justify-between mb-4 pb-3 border-b border-[#1E1F22]">
            <div>
              <h2 className="text-lg font-bold">📜 Historique des Connexions IP</h2>
              <p className="text-xs text-gray-400">
                Connexions entrantes et tentatives rejetées extraites en direct des journaux de vos serveurs.
              </p>
            </div>
            <span className="text-xs font-mono bg-[#1E1F22] px-3 py-1 rounded-full text-gray-300">
              {overview.connection_history.length} entrée(s)
            </span>
          </div>

          {overview.connection_history.length === 0 ? (
            <div className="bg-[#1E1F22] rounded-xl p-10 text-center text-gray-400 text-sm">
              Aucun historique de connexion IP disponible pour le moment. Dès qu'un joueur se connecte à un serveur, son adresse IP et son statut apparaissent ici.
            </div>
          ) : (
            <div className="space-y-2.5 max-h-[540px] overflow-y-auto pr-1">
              {overview.connection_history.map((entry, idx) => (
                <div
                  key={`${entry.ip}-${entry.time}-${idx}`}
                  className="bg-[#1E1F22] border border-[#111214] rounded-xl p-3.5 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                >
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs text-gray-400">[{entry.time}]</span>
                      <span className="bg-[#2B2D31] text-[#8EA1E1] text-xs font-semibold px-2 py-0.5 rounded">
                        {entry.server}
                      </span>
                      <span className="font-bold text-sm text-white">{entry.player}</span>
                      <span className="font-mono text-xs bg-[#111214] text-amber-300 px-2 py-0.5 rounded border border-[#2B2D31]">
                        {entry.ip}:{entry.port}
                      </span>
                      <span
                        className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase ${
                          entry.status === 'accepted'
                            ? 'bg-[#23A559]/20 text-[#23A559]'
                            : 'bg-[#DA373C]/20 text-[#DA373C]'
                        }`}
                      >
                        {entry.status === 'accepted' ? 'Acceptée' : entry.status === 'blocked' ? 'Bloquée' : 'Rejetée'}
                      </span>
                    </div>
                    <p className="text-xs text-gray-400 mt-1 truncate">{entry.details}</p>
                  </div>

                  {entry.status !== 'blocked' && (
                    <button
                      onClick={() => handleBlockIp(entry.ip, `Bloquée suite à connexion de ${entry.player}`)}
                      className="bg-[#DA373C]/20 hover:bg-[#DA373C] text-red-300 hover:text-white px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors shrink-0 self-end sm:self-auto flex items-center gap-1.5"
                    >
                      <BanIcon className="w-3.5 h-3.5" />
                      <span>Bloquer l'IP</span>
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
