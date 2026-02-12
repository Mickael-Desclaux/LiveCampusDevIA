# VibeCoding Client

Frontend React + Vite pour application e-commerce MVP.

## Installation

```bash
npm install
```

## Configuration

Créer un fichier `.env` (optionnel, valeur par défaut : http://localhost:3000)

```env
VITE_API_URL=http://localhost:3000
```

## Lancement

```bash
# Dev avec hot reload
npm run dev

# Build production
npm run build

# Preview build
npm run preview
```

## Accès

```
http://localhost:5173
```

## Architecture

- **Vite** : Build tool rapide
- **React 18** : Framework UI
- **Axios** : HTTP client
- **Proxy API** : Configuré dans `vite.config.js` pour `/api/*`

## Components (à implémenter)

- [ ] Cart - Panier (F1)
- [ ] Checkout - Validation commande (F1)
- [ ] Payment - Paiement (F5)
- [ ] CartRecovery - Récupération panier abandonné (F6)

## Services API

Voir `src/services/api.js` pour centraliser les appels backend.
