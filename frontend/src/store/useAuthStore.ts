import { create } from 'zustand';

const API_BASE = '';
const TOKEN_KEY = 'ourcraft_auth_token';

export type ServerPermKey = 'view' | 'power' | 'console' | 'addons' | 'files' | 'settings';

export type AppThemeId = 'discord' | 'emerald' | 'amethyst' | 'ocean' | 'crimson';

export const APP_THEMES: { id: AppThemeId; label: string; color: string }[] = [
  { id: 'discord', label: 'Obsidian Indigo', color: '#5865F2' },
  { id: 'emerald', label: 'Émeraude', color: '#10b981' },
  { id: 'amethyst', label: 'Améthyste', color: '#8b5cf6' },
  { id: 'ocean', label: 'Océan Nordique', color: '#0ea5e9' },
  { id: 'crimson', label: 'Nether Crimson', color: '#f43f5e' },
];

function applyDomTheme(theme?: string) {
  const validTheme = theme || 'discord';
  document.documentElement.setAttribute('data-theme', validTheme);
}

export interface AuthUser {
  id: number;
  username: string;
  role: 'admin' | 'subuser';
  permissions: Record<string, Record<string, boolean>>;
  theme?: AppThemeId;
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
  updateTheme: (theme: AppThemeId) => Promise<void>;
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
          applyDomTheme(meData.user?.theme);
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

      applyDomTheme('discord');
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
        applyDomTheme(data.user?.theme);
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
        applyDomTheme(data.user?.theme);
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
    applyDomTheme('discord');
    set({ user: null, token: null });
  },

  updateTheme: async (theme) => {
    applyDomTheme(theme);
    const currentUser = get().user;
    const savedToken = get().token || localStorage.getItem(TOKEN_KEY);
    if (currentUser) {
      set({ user: { ...currentUser, theme } });
    }
    if (!savedToken) return;
    try {
      const res = await fetch(`${API_BASE}/api/auth/theme`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${savedToken}`,
        },
        body: JSON.stringify({ theme }),
      });
      if (res.ok) {
        const data = await res.json();
        set({ user: data.user });
      }
    } catch (err) {
      console.error('Erreur sauvegarde thème:', err);
    }
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
