import { useState, useEffect } from 'react';
import './App.css';

function App() {
  const [serverStatus, setServerStatus] = useState('Checking...');

  useEffect(() => {
    // Test connexion serveur
    fetch('http://localhost:3000/health')
      .then(res => res.json())
      .then(data => setServerStatus(data.message))
      .catch(() => setServerStatus('Server offline'));
  }, []);

  return (
    <div className="App">
      <header className="App-header">
        <h1>🛒 VibeCoding E-Commerce</h1>
        <p className="subtitle">MVP - Wardley Map Architecture</p>

        <div className="status-card">
          <h2>Status Serveur</h2>
          <p className={serverStatus.includes('running') ? 'status-ok' : 'status-error'}>
            {serverStatus}
          </p>
        </div>

        <div className="features">
          <h2>Features à implémenter</h2>
          <ul>
            <li>F1 - Création commande depuis panier</li>
            <li>F2 - Application promotions</li>
            <li>F3 - Réservation temporaire stock</li>
            <li>F4 - Gestion transitions d'état</li>
            <li>F5 - Libération stock échec paiement</li>
            <li>F6 - Relance paniers abandonnés</li>
          </ul>
        </div>
      </header>
    </div>
  );
}

export default App;
