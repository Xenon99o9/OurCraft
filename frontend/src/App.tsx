import { useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Home from './pages/Home';
import ServerPanel from './pages/ServerPanel';
import Settings from './pages/Settings';
import Login from './pages/Login';
import UsersAdmin from './pages/UsersAdmin';
import SecurityShield from './pages/SecurityShield';
import { useAuthStore } from './store/useAuthStore';

function App() {
  const { user, isChecking, checkAuth } = useAuthStore();

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  if (isChecking) {
    return (
      <div className="min-h-screen bg-[#313338] flex items-center justify-center text-white">
        <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-[#5865F2]"></div>
      </div>
    );
  }

  if (!user) {
    return <Login />;
  }

  const isAdmin = user.role === 'admin';

  return (
    <div className="min-h-screen bg-[#313338] text-gray-100 font-sans">
      <Router>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/server/:serverName" element={<ServerPanel />} />
          <Route path="/settings" element={isAdmin ? <Settings /> : <Navigate to="/" />} />
          <Route path="/users" element={isAdmin ? <UsersAdmin /> : <Navigate to="/" />} />
          <Route path="/security" element={isAdmin ? <SecurityShield /> : <Navigate to="/" />} />
        </Routes>
      </Router>
    </div>
  );
}

export default App;
