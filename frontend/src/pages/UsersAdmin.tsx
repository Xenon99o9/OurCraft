import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useServerStore } from '../store/useServerStore';
import { type AuthUser, type ServerPermKey } from '../store/useAuthStore';
import { ArrowLeftIcon, UsersIcon, CrownIcon, UserIcon, TrashIcon, ServerIcon } from '../components/Icons';

const API_BASE = '';

const PERM_LABELS: { key: ServerPermKey; label: string; desc: string }[] = [
  { key: 'view', label: 'Voir', desc: 'Accès au serveur' },
  { key: 'power', label: 'Power', desc: 'Démarrer / Arrêter' },
  { key: 'console', label: 'Console & Joueurs', desc: 'RCON, Logs, OP/Kick/Ban' },
  { key: 'addons', label: 'Mods & Backups', desc: 'Modrinth, Snapshots, Cron' },
  { key: 'files', label: 'Web FTP', desc: 'Explorateur & Éditeur code' },
  { key: 'settings', label: 'Paramètres', desc: 'Port, RAM, server.properties' },
];

export default function UsersAdmin() {
  const navigate = useNavigate();
  const { servers, fetchServers } = useServerStore();

  const [users, setUsers] = useState<AuthUser[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  // Formulaire de création / édition
  const [editingId, setEditingId] = useState<number | null>(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'admin' | 'subuser'>('subuser');
  const [permissions, setPermissions] = useState<Record<string, Record<string, boolean>>>({});
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const fetchUsers = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await fetch(`${API_BASE}/api/users`);
      if (res.ok) {
        const data = await res.json();
        setUsers(data || []);
      }
    } catch (err) {
      console.error('Erreur chargement utilisateurs:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchServers();
    fetchUsers();
  }, [fetchServers, fetchUsers]);

  const resetForm = () => {
    setEditingId(null);
    setUsername('');
    setPassword('');
    setRole('subuser');
    setPermissions({});
  };

  const startEditUser = (u: AuthUser) => {
    setEditingId(u.id);
    setUsername(u.username);
    setPassword('');
    setRole(u.role);
    setPermissions(u.permissions || {});
    setFeedback(null);
  };

  const toggleServerPerm = (serverName: string, permKey: ServerPermKey) => {
    setPermissions((prev) => {
      const currentSrv = prev[serverName] || {};
      const nextVal = !currentSrv[permKey];
      const updatedSrv = { ...currentSrv, [permKey]: nextVal };
      // Si on active n'importe quel droit, on active automatiquement 'view'
      if (nextVal && permKey !== 'view') {
        updatedSrv.view = true;
      }
      // Si on retire 'view', on retire tous les droits de ce serveur
      if (!nextVal && permKey === 'view') {
        return { ...prev, [serverName]: {} };
      }
      return { ...prev, [serverName]: updatedSrv };
    });
  };

  const grantAllOnServer = (serverName: string, grant: boolean) => {
    const emptyPerms: Record<string, boolean> = {};
    setPermissions((prev) => ({
      ...prev,
      [serverName]: grant
        ? { view: true, power: true, console: true, addons: true, files: true, settings: true }
        : emptyPerms,
    }));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFeedback(null);

    const url = editingId ? `${API_BASE}/api/users/${editingId}` : `${API_BASE}/api/users`;
    const method = editingId ? 'PUT' : 'POST';

    try {
      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username,
          password: password || undefined,
          role,
          permissions,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setFeedback({
          type: 'success',
          text: editingId
            ? `Compte "${username}" mis à jour avec succès !`
            : `Sous-compte "${username}" créé avec succès !`,
        });
        resetForm();
        fetchUsers();
      } else {
        setFeedback({ type: 'error', text: data.detail || 'Erreur lors de la sauvegarde.' });
      }
    } catch {
      setFeedback({ type: 'error', text: 'Erreur réseau.' });
    }
  };

  const handleDelete = async (u: AuthUser) => {
    if (!window.confirm(`Supprimer le compte "${u.username}" ?`)) return;
    setFeedback(null);
    const res = await fetch(`${API_BASE}/api/users/${u.id}`, { method: 'DELETE' });
    const data = await res.json();
    if (res.ok) {
      setFeedback({ type: 'success', text: data.message });
      fetchUsers();
    } else {
      setFeedback({ type: 'error', text: data.detail || 'Impossible de supprimer ce compte.' });
    }
  };

  return (
    <div className="p-6 md:p-8 max-w-6xl mx-auto">
      <header className="mb-8 flex items-center justify-between border-b border-[#1E1F22] pb-6">
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
              <UsersIcon className="w-7 h-7 text-[#8EA1E1]" />
              <span>Comptes & Droits Multi-Utilisateurs</span>
            </h1>
            <p className="text-gray-400 text-sm mt-1">
              Créez des sous-comptes pour vos modérateurs ou amis et attribuez des droits précis par serveur.
            </p>
          </div>
        </div>
      </header>

      {feedback && (
        <div
          className={`mb-6 p-4 rounded-xl text-sm border ${
            feedback.type === 'success'
              ? 'bg-[#23A559]/15 border-[#23A559]/50 text-[#23A559]'
              : 'bg-[#DA373C]/15 border-[#DA373C]/50 text-[#DA373C]'
          }`}
        >
          {feedback.text}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* COLONNE GAUCHE : Liste des comptes existants */}
        <div className="lg:col-span-5 space-y-4">
          <div className="bg-[#2B2D31] rounded-xl border border-[#1E1F22] p-5 text-white shadow-lg">
            <div className="flex items-center justify-between mb-4">
              <h2 className="text-lg font-bold">Comptes enregistrés ({users.length})</h2>
              {editingId && (
                <button
                  onClick={resetForm}
                  className="text-xs bg-[#5865F2] text-white px-2.5 py-1 rounded-md font-medium"
                >
                  + Nouveau compte
                </button>
              )}
            </div>

            {isLoading ? (
              <p className="text-sm text-gray-400 py-6 text-center">Chargement...</p>
            ) : (
              <div className="space-y-3">
                {users.map((u) => (
                  <div
                    key={u.id}
                    className={`bg-[#1E1F22] border rounded-xl p-4 flex items-center justify-between ${
                      editingId === u.id ? 'border-[#5865F2]' : 'border-[#111214]'
                    }`}
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold text-white">{u.username}</span>
                        <span
                          className={`text-[10px] px-2 py-0.5 rounded-full font-bold uppercase flex items-center gap-1 ${
                            u.role === 'admin'
                              ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                              : 'bg-[#5865F2]/20 text-[#8EA1E1] border border-[#5865F2]/40'
                          }`}
                        >
                          {u.role === 'admin' ? <CrownIcon className="w-3 h-3" /> : <UserIcon className="w-3 h-3" />}
                          <span>{u.role === 'admin' ? 'Admin Central' : 'Sous-compte'}</span>
                        </span>
                      </div>
                      <p className="text-xs text-gray-400 mt-1">
                        {u.role === 'admin'
                          ? 'Accès complet à tous les serveurs et paramètres'
                          : `${
                              Object.values(u.permissions || {}).filter((p) => p?.view).length
                            } serveur(s) autorisé(s)`}
                      </p>
                    </div>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => startEditUser(u)}
                        className="bg-[#2B2D31] hover:bg-[#35373C] text-gray-200 px-3 py-1.5 rounded-lg text-xs font-medium"
                      >
                        Modifier
                      </button>
                      <button
                        onClick={() => handleDelete(u)}
                        className="text-gray-400 hover:text-[#DA373C] px-2 py-1.5 text-xs"
                        title="Supprimer"
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

        {/* COLONNE DROITE : Formulaire Création / Édition & Matrice des Droits par Serveur */}
        <div className="lg:col-span-7">
          <form
            onSubmit={handleSubmit}
            className="bg-[#2B2D31] rounded-xl border border-[#1E1F22] p-6 text-white shadow-lg space-y-6"
          >
            <div>
              <h2 className="text-xl font-bold">
                {editingId ? `Modifier le compte "${username}"` : 'Créer un nouveau sous-compte'}
              </h2>
              <p className="text-xs text-gray-400 mt-1">
                Définissez les identifiants puis cochez les permissions accordées sur chaque serveur.
              </p>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <div>
                <label className="block text-xs font-bold text-gray-400 uppercase mb-1.5">Identifiant</label>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="ex: modo-alex"
                  className="w-full bg-[#1E1F22] text-white border border-[#111214] rounded-lg px-3.5 py-2 text-sm focus:outline-none focus:border-[#5865F2]"
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-400 uppercase mb-1.5">
                  {editingId ? 'Nouveau mot de passe (optionnel)' : 'Mot de passe'}
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={editingId ? 'Laisser vide pour conserver' : '••••••••'}
                  className="w-full bg-[#1E1F22] text-white border border-[#111214] rounded-lg px-3.5 py-2 text-sm focus:outline-none focus:border-[#5865F2]"
                  required={!editingId}
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-gray-400 uppercase mb-1.5">Rôle global</label>
                <select
                  value={role}
                  onChange={(e) => setRole(e.target.value as 'admin' | 'subuser')}
                  className="w-full bg-[#1E1F22] text-white border border-[#111214] rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-[#5865F2]"
                >
                  <option value="subuser">👤 Sous-compte (Droits par serveur)</option>
                  <option value="admin">👑 Administrateur complet</option>
                </select>
              </div>
            </div>

            {role === 'subuser' && (
              <div>
                <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-3">
                  Matrice des droits par serveur ({servers.length} serveur(s))
                </label>

                {servers.length === 0 ? (
                  <div className="bg-[#1E1F22] rounded-xl p-6 text-center text-gray-400 text-sm">
                    Aucun serveur créé pour le moment.
                  </div>
                ) : (
                  <div className="space-y-3 max-h-96 overflow-y-auto pr-1">
                    {servers.map((srv) => {
                      const srvPerms = permissions[srv.name] || {};
                      return (
                        <div key={srv.name} className="bg-[#1E1F22] border border-[#111214] rounded-xl p-4">
                          <div className="flex items-center justify-between mb-3 pb-2 border-b border-[#2B2D31]">
                            <span className="font-bold text-sm text-white flex items-center gap-2">
                              <ServerIcon className="w-4 h-4 text-[#8EA1E1]" />
                              <span>{srv.name}</span>
                              <span className="text-xs font-mono text-gray-400">({srv.server_type})</span>
                            </span>
                            <div className="flex gap-2 text-xs">
                              <button
                                type="button"
                                onClick={() => grantAllOnServer(srv.name, true)}
                                className="text-[#5865F2] hover:underline"
                              >
                                Tout autoriser
                              </button>
                              <button
                                type="button"
                                onClick={() => grantAllOnServer(srv.name, false)}
                                className="text-gray-400 hover:underline"
                              >
                                Aucun accès
                              </button>
                            </div>
                          </div>

                          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                            {PERM_LABELS.map((p) => {
                              const checked = Boolean(srvPerms[p.key]);
                              return (
                                <button
                                  key={p.key}
                                  type="button"
                                  onClick={() => toggleServerPerm(srv.name, p.key)}
                                  className={`p-2.5 rounded-lg border text-left transition-all ${
                                    checked
                                      ? 'bg-[#23A559]/15 border-[#23A559] text-white'
                                      : 'bg-[#2B2D31]/50 border-[#111214] text-gray-400 hover:text-gray-200'
                                  }`}
                                >
                                  <div className="flex items-center justify-between text-xs font-bold">
                                    <span>{p.label}</span>
                                    <span>{checked ? '✓' : '○'}</span>
                                  </div>
                                  <div className="text-[10px] text-gray-400 mt-0.5">{p.desc}</div>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            <div className="flex items-center justify-end gap-3 pt-4 border-t border-[#1E1F22]">
              {editingId && (
                <button
                  type="button"
                  onClick={resetForm}
                  className="px-4 py-2 text-sm text-gray-400 hover:text-white"
                >
                  Annuler
                </button>
              )}
              <button
                type="submit"
                className="bg-[#23A559] hover:bg-[#1D8B4A] text-white px-6 py-2.5 rounded-lg font-semibold text-sm transition-colors shadow-md"
              >
                {editingId ? 'Enregistrer les modifications' : 'Créer le compte'}
              </button>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
