import { useState } from 'react';
import { useAuthStore } from '../store/useAuthStore';
import { CrownIcon, LockIcon } from '../components/Icons';

export default function Login() {
  const { hasUsers, setupInitialAdmin, login } = useAuthStore();
  const isSetupMode = hasUsers === false;

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!username.trim() || !password) return;

    setIsSubmitting(true);
    setError(null);

    const res = isSetupMode
      ? await setupInitialAdmin(username.trim(), password)
      : await login(username.trim(), password);

    if (!res.ok) {
      setError(res.message);
    }
    setIsSubmitting(false);
  };

  return (
    <div className="min-h-screen bg-[#1E1F22] flex items-center justify-center p-4">
      <div className="bg-[#2B2D31] border border-[#111214] rounded-2xl shadow-2xl w-full max-w-md p-8">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-[#5865F2]/20 border border-[#5865F2]/40 text-[#8EA1E1] mb-3">
            {isSetupMode ? <CrownIcon className="w-7 h-7" /> : <LockIcon className="w-7 h-7" />}
          </div>
          <h1 className="text-2xl font-extrabold text-white tracking-tight">OurCraft</h1>
          <p className="text-sm text-gray-400 mt-1">
            {isSetupMode
              ? 'Première connexion : créez le compte Administrateur Central'
              : 'Connectez-vous à votre espace d’administration'}
          </p>
        </div>

        {error && (
          <div className="mb-5 p-3.5 rounded-lg bg-[#DA373C]/15 border border-[#DA373C]/50 text-[#DA373C] text-sm">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">
              Nom d'utilisateur
            </label>
            <input
              type="text"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder={isSetupMode ? 'ex: admin' : 'Votre identifiant'}
              className="w-full bg-[#1E1F22] text-white border border-[#111214] rounded-lg px-4 py-3 text-sm focus:outline-none focus:border-[#5865F2]"
              required
              autoFocus
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">
              Mot de passe
            </label>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••"
              className="w-full bg-[#1E1F22] text-white border border-[#111214] rounded-lg px-4 py-3 text-sm focus:outline-none focus:border-[#5865F2]"
              required
            />
          </div>

          <button
            type="submit"
            disabled={isSubmitting}
            className="w-full bg-[#5865F2] hover:bg-[#4752C4] disabled:opacity-50 text-white py-3 rounded-lg font-semibold text-sm transition-colors shadow-lg"
          >
            {isSubmitting
              ? 'Vérification...'
              : isSetupMode
              ? 'Créer le compte Administrateur & Entrer'
              : 'Se connecter'}
          </button>
        </form>
      </div>
    </div>
  );
}
