# Wardley Map - Workflow E-Commerce

Application e-commerce développée avec la méthodologie Wardley Map.

## 📖 À lire dans un premier temps

J'ai ajouté un fichier `TLDR.md` que j'ai rédigé afin d'expliquer de manière plus digeste mes choix, la méthodologie appliquée ainsi que les difficultés rencontrées au cour de ce projet (le fichier prompts.md étant assez lourd, je voulais synthétiser la chose pour plus de clarté)

## 📋 Architecture

**Stack Technique :**

- **Backend** : Node.js + Express + Prisma + PostgreSQL
- **Frontend** : React + Vite
- **Méthodologie** : Wardley Map

## 🎯 Features

6 features principales à implémenter :

1. **F1** - Création commande depuis panier
2. **F2** - Application promotions (EXCLUSIVE/STACKABLE/AUTO)
3. **F3** - Réservation temporaire stock pendant paiement
4. **F4** - Gestion transitions d'état commande
5. **F5** - Libération stock si paiement échoue/expire
6. **F6** - Relance paniers abandonnés après 24h

## 🚀 Installation

### Prérequis

- Node.js >= 18
- PostgreSQL >= 14
- npm ou pnpm

### 1. Server

```bash
cd server
npm install
cp .env.example .env
# Modifier DATABASE_URL dans .env

# Initialiser Prisma
npm run prisma:generate
npm run prisma:migrate

# Lancer le serveur
npm run dev
```

Serveur accessible sur `http://localhost:3000`

### 2. Client

```bash
cd client
npm install

# Lancer le client
npm run dev
```

Client accessible sur `http://localhost:5173`

## 📚 Documentation

- **[TLDR.md](./TLDR.md)** - Récapitulatif global de mon avancement et de mes réflexions sur le projet
- **[CLAUDE.md](./CLAUDE.md)** - Guide de développement complet (règles, patterns, invariants)
- **[prompts.md](./prompts.md)** - Documentation Wardley Map (analyse, décisions, architecture)
- **[server/README.md](./server/README.md)** - Documentation backend
- **[client/README.md](./client/README.md)** - Documentation frontend

## 🏗️ Structure Projet

```
VibeCoding/
├── server/              # Backend Node.js + Express + Prisma
│   ├── prisma/          # Schema et migrations Prisma
│   ├── src/
│   │   ├── services/    # Business logic (F1-F6)
│   │   ├── jobs/        # Background jobs (setInterval)
│   │   ├── routes/      # Routes Express
│   │   └── index.js     # Entry point
│   └── package.json
│
├── client/              # Frontend React + Vite
│   ├── src/
│   │   ├── components/  # Components React
│   │   ├── services/    # API calls
│   │   └── App.jsx
│   └── package.json
│
├── CLAUDE.md            # Guide de développement
├── prompts.md           # Documentation Wardley Map
└── README.md            # Ce fichier
```

## 🔒 Invariants Critiques

Les invariants suivants DOIVENT être respectés :

- **Stock** : `stock_available + stock_reserved = stock_total`
- **Atomicité** : Toute opération multi-tables dans une transaction
- **Idempotence** : Toute opération peut être retryée sans effet de bord
- **Snapshots** : Prix immutables après checkout
- **Traçabilité** : Audit logs pour toutes les mutations

Voir `CLAUDE.md` pour la liste complète.

## 🧪 Tests

```bash
# À implémenter
```

## 📝 Logs de Développement

Tous les prompts, réponses et décisions sont loggés dans `prompts.md` :

- **Phase Globale** : Exploration, hypothèses, analyse architecture
- **Phase Simplification** : Architecture simplifiée pour MVP
- **Cycle Bleu** : Implémentation feature par feature

## 🤝 Contribution

Suivre strictement les règles définies dans `CLAUDE.md`.
