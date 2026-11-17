import { create } from 'zustand';

const API_BASE = `http://${window.location.hostname}:8000`;
const TOKEN_KEY = 'ourcraft_auth_token';

export type ServerPermKey = 'view' | 'power' | 'console' | 'addons' | 'files' | 'settings';

export interface AuthUser {
  id: number;
  username: string;
  role: 'admin' | 'subuser';
  permissions: Record<string, Record<string, boolean>>;
}

interface AuthStore {
  user: AuthUser | null;
  token: string | null;
  hasUsers: boolean | null;
  isChecking: boolean;
  checkAuth: () => Promise<void>;
  setupInitialAdmin: (username: string, password: string) => Promise<{ ok: boolean; message: string }>;
  login: (username: string, password: string) => Promise<{ ok: boolean; message: string }>;
  logout: () => void;
  hasPermission: (serverName: string, perm: ServerPermKey) => boolean;
}

export const useAuthStore = create<AuthStore>((set, get) => ({
  user: null,
  token: localStorage.getItem(TOKEN_KEY),
  hasUsers: null,
  isChecking: true,

  checkAuth: async () => {
    set({ isChecking: true });
    try {
      const statusRes = await fetch(`${API_BASE}/api/auth/status`);
      const statusData = await statusRes.json();
      const hasUsers = Boolean(statusData.has_users);

      const savedToken = localStorage.getItem(TOKEN_KEY);
      if (hasUsers && savedToken) {
        const meRes = await fetch(`${API_BASE}/api/auth/me`, {
          headers: { Authorization: `Bearer ${savedToken}` },
        });
        if (meRes.ok) {
          const meData = await meRes.json();
          set({
            user: meData.user,
            token: savedToken,
            hasUsers,
            isChecking: false,
          });
          return;
        }
        localStorage.removeItem(TOKEN_KEY);
      }

      set({ user: null, token: null, hasUsers, isChecking: false });
    } catch (error) {
      console.error('Erreur vérification auth:', error);
      set({ isChecking: false });
    }
  },

  setupInitialAdmin: async (username, password) => {
    try {
      const res = await fetch(`${API_BASE}/api/auth/setup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (res.ok) {
        localStorage.setItem(TOKEN_KEY, data.token);
        set({ user: data.user, token: data.token, hasUsers: true });
        return { ok: true, message: 'Compte administrateur créé !' };
      }
      return { ok: false, message: data.detail || 'Erreur de configuration.' };
    } catch {
      return { ok: false, message: 'Impossible de contacter le backend.' };
    }
  },

  login: async (username, password) => {
    try {
      const res = await fetch(`${API_BASE}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (res.ok) {
        localStorage.setItem(TOKEN_KEY, data.token);
        set({ user: data.user, token: data.token, hasUsers: true });
        return { ok: true, message: 'Connecté !' };
      }
      return { ok: false, message: data.detail || 'Identifiants incorrects.' };
    } catch {
      return { ok: false, message: 'Impossible de contacter le backend.' };
    }
  },

  logout: () => {
    localStorage.removeItem(TOKEN_KEY);
    set({ user: null, token: null });
  },

  hasPermission: (serverName, perm) => {
    const currentUser = get().user;
    if (!currentUser) return false;
    if (currentUser.role === 'admin') return true;
    const srvPerms = currentUser.permissions?.[serverName];
    if (!srvPerms) return false;
    return Boolean(srvPerms[perm]);
  },
}));
