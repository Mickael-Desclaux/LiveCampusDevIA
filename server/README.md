# VibeCoding Server

Backend Node.js + Express + Prisma pour application e-commerce MVP.

## Installation

```bash
npm install
```

## Configuration

1. Copier `.env.example` vers `.env`
2. Modifier `DATABASE_URL` avec vos credentials PostgreSQL

```env
DATABASE_URL="postgresql://user:password@localhost:5432/ecommerce?schema=public"
PORT=3000
```

## Prisma

```bash
# Générer le client Prisma (après modification schema)
npm run prisma:generate

# Créer une migration
npm run prisma:migrate

# Ouvrir Prisma Studio (GUI DB)
npm run prisma:studio

# Reset DB (ATTENTION: supprime toutes les données)
npm run prisma:reset
```

## Lancement

```bash
# Dev avec hot reload
npm run dev

# Production
npm start
```

## Health Check

```
GET http://localhost:3000/health
```

## Architecture

Voir `CLAUDE.md` à la racine du projet pour les règles de développement complètes.

## Features (à implémenter)

- [ ] F1 - Création commande depuis panier
- [ ] F2 - Application promotions
- [ ] F3 - Réservation temporaire stock
- [ ] F4 - Gestion transitions d'état
- [ ] F5 - Libération stock échec paiement
- [ ] F6 - Relance paniers abandonnés
