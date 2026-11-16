import { BrowserRouter as Router, Routes, Route } from 'react-router-dom';
import Home from './pages/Home';
import ServerPanel from './pages/ServerPanel';
import Settings from './pages/Settings';

function App() {
  return (
    <div className="min-h-screen bg-[#313338] text-gray-100 font-sans">
      <Router>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/server/:serverName" element={<ServerPanel />} />
          <Route path="/settings" element={<Settings />} />
        </Routes>
      </Router>
    </div>
  );
}

export default App;