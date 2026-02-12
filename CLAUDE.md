# Guide de Développement - Application E-Commerce

> **Contexte :** Architecture simplifiée issue de la méthodologie Wardley Map. Ce fichier définit les règles de développement, l'architecture, et les invariants critiques à respecter.

---

## 📋 Vue d'Ensemble

**Objectif :** Système de commande e-commerce avec 6 features : création commande, promotions, réservation stock, transitions d'état, libération stock, relance paniers abandonnés.

**Principe directeur :** Simplicité maximale tout en préservant les invariants critiques (atomicité, idempotence, cohérence des données).

---

## 🛠️ Stack Technique

```yaml
Backend: Node.js + Express
ORM: Prisma
Base de données: PostgreSQL
Frontend: React
Tests: Jest + supertest
Package Manager: pnpm (OBLIGATOIRE - jamais npm ou yarn)
Jobs: setInterval en mémoire (pas de cron externe)
Cache: Map en mémoire (pas de Redis)
Patterns: Transaction Prisma, Lock optimiste/pessimiste, Enum + Map
Architecture: Service Layer simple (pas de Domain-Driven Design complet)
```

**Dépendances Node.js principales :**

```json
{
  "dependencies": {
    "express": "^4.18.0",
    "@prisma/client": "^5.0.0",
    "dotenv": "^16.0.0",
    "cors": "^2.8.5"
  },
  "devDependencies": {
    "prisma": "^5.0.0",
    "nodemon": "^3.0.0",
    "jest": "^29.0.0",
    "supertest": "^6.3.0"
  }
}
```

**Commandes Prisma essentielles :**

```bash
npx prisma init                    # Initialiser Prisma
npx prisma migrate dev --name init # Créer migration
npx prisma generate                # Générer client Prisma
npx prisma studio                  # Interface admin DB
```

---

## 🏗️ Architecture - Règles Strictes

### Composants et Responsabilités

**RÈGLE 1 : Séparation stricte des responsabilités**

- Chaque service a une responsabilité unique
- Pas de logique métier dans les controllers/routes
- Pas d'appels Prisma directs hors des services

**RÈGLE 2 : Ordre de dépendance respecté**

```
OrderStateMachine (F4) ← Base pour tous
    ↓
PromotionService (F2) + StockReservationService (F3)
    ↓
OrderService (F1) ← Orchestre F2 + F3 + F4
    ↓
PaymentService (F5) ← Utilise F3 + F4

CartRecoveryService (F6) ← Indépendant
```

**RÈGLE 3 : Pas de dépendances circulaires**

- ❌ INTERDIT : Service A appelle Service B qui appelle Service A
- ✅ AUTORISÉ : Service A appelle Service B qui est autonome

**RÈGLE 4 : Services appelables**

- `OrderStateMachine` : Appelé par OrderService, PaymentService, StateTimeoutJob
- `StockReservationService` : Appelé par OrderService, PaymentService, ReservationExpirationJob
- `PromotionService` : Appelé uniquement par OrderService
- `CartRecoveryService` : Appelé uniquement par CartReminderJob

**RÈGLE 5 : Tests unitaires obligatoires avant validation feature**

- Toute feature DOIT avoir des tests unitaires couvrant TOUS les critères de réussite définis
- Tests obligatoires :
  - ✅ Cas nominaux (happy path)
  - ✅ Cas d'erreur (validations, préconditions)
  - ✅ Cas limites (edge cases)
  - ✅ Invariants critiques (atomicité, idempotence, cohérence)
- Framework : Jest + supertest (pour routes API)
- Couverture minimale : 80% des lignes de code du service
- Une feature n'est considérée comme VALIDÉE que si tous les tests passent

---

## 🔒 Invariants Critiques - À TOUJOURS Respecter

### Invariants Globaux (Niveau Application)

**INV-GLOBAL-1 : Cohérence du stock**

```prisma
À TOUT INSTANT : stock_available + stock_reserved = stock_total
Implémentation : Validation dans StockReservationService + @@ custom SQL constraint
```

**INV-GLOBAL-2 : Stock jamais négatif**

```prisma
À TOUT INSTANT : stock_available >= 0
Implémentation : Validation JS avant update + @@ custom SQL constraint
```

**INV-GLOBAL-3 : Atomicité des transactions**

```javascript
TOUTE opération multi-étapes DOIT être dans prisma.$transaction([...])
Exemple : Réservation stock + Transition état = 1 transaction
```

**INV-GLOBAL-4 : Idempotence garantie**

```prisma
TOUTE opération peut être retryée sans effet de bord
Implémentation : @@unique constraints, WHERE conditions dans updates
```

**INV-GLOBAL-5 : Traçabilité complète**

```prisma
TOUTE mutation DOIT être loggée avec timestamp + actor + reason
Implémentation : Models *AuditLog, champs DateTime @default(now())
```

### Invariants par Feature

**Feature 1 (OrderService) :**

- `INV-F1-1` : Snapshot prix immutable (itemsSnapshot Json figé au checkout)
- `INV-F1-2` : 1 seul panier CART actif par user (@@unique([userId, status]) where status = CART)
- `INV-F1-3` : Lock optimiste via `version` pour transition CART → CHECKOUT

**Feature 2 (PromotionService) :**

- `INV-F2-1` : Max 1 promo EXCLUSIVE, incompatible avec autres tags
- `INV-F2-2` : Ordre déterministe : AUTO → STACKABLE → EXCLUSIVE
- `INV-F2-3` : Montant final >= 0 (protection total négatif)

**Feature 3 (StockReservationService) :**

- `INV-F3-1` : 1 order_id = max 1 réservation active (@@unique([orderId]))
- `INV-F3-2` : Libération idempotente (WHERE status = ACTIVE)
- `INV-F3-3` : Atomicité réservation : décrément + increment + create en 1 transaction

**Feature 4 (OrderStateMachine) :**

- `INV-F4-1` : Transitions autorisées définies dans TRANSITIONS_MAP hardcodée
- `INV-F4-2` : Préconditions validées (PAID exige paymentId != null)
- `INV-F4-3` : Audit log créé pour TOUTE transition

**Feature 5 (PaymentService) :**

- `INV-F5-1` : Classification erreur déterministe (ERROR_CLASSIFICATION map)
- `INV-F5-2` : Libération stock si échec DEFINITIVE uniquement
- `INV-F5-3` : 1 order_id = max 1 payment_attempt actif (@@unique([orderId]))

**Feature 6 (CartRecoveryService) :**

- `INV-F6-1` : 1 panier = max 1 relance (flag recoveryEmailSent)
- `INV-F6-2` : Opt-out RGPD respecté (WHERE marketingConsent = true)
- `INV-F6-3` : Token expiration validée (recoveryTokenExpiresAt > now())

---

## ✅ Patterns de Développement - À Suivre

### Pattern 1 : Transaction Atomique Obligatoire (Prisma)

**RÈGLE :** Toute opération qui modifie plusieurs tables DOIT être dans une transaction.

```javascript
// ✅ BON - Transaction avec Prisma
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

async function reserveStock(items, orderId) {
    return await prisma.$transaction(async (tx) => {
        for (const item of items) {
            // 1. Récupérer product (lock implicite dans transaction)
            const product = await tx.product.findUnique({
                where: { id: item.productId }
            });

            // 2. Validate
            if (product.stockAvailable < item.quantity) {
                throw new Error('INSUFFICIENT_STOCK');
            }

            // 3. Update stock atomiquement
            await tx.product.update({
                where: { id: item.productId },
                data: {
                    stockAvailable: { decrement: item.quantity },
                    stockReserved: { increment: item.quantity }
                }
            });

            // 4. Create reservation
            const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
            await tx.stockReservation.create({
                data: {
                    orderId,
                    productId: item.productId,
                    quantity: item.quantity,
                    expiresAt,
                    status: 'ACTIVE'
                }
            });
        }

        return { success: true };
        // Si erreur n'importe où → ROLLBACK automatique
    });
}

// ❌ MAUVAIS - Pas de transaction
async function reserveStockBAD(items, orderId) {
    await prisma.product.update({
        where: { id: item.productId },
        data: { stockAvailable: { decrement: item.quantity } }
    });
    // Si erreur ici, stock déjà modifié mais pas de réservation créée → INCOHÉRENCE
    await prisma.stockReservation.create({ data: { ... } });
}
```

### Pattern 2 : Idempotence via WHERE Condition (Prisma)

**RÈGLE :** Les updates doivent être idempotents via WHERE conditions.

```javascript
// ✅ BON - Idempotent via WHERE
async function markRecoverySent(cartId, token) {
  const result = await prisma.order.updateMany({
    where: {
      id: cartId,
      recoveryEmailSent: false, // Idempotence : update seulement si false
    },
    data: {
      recoveryEmailSent: true,
      recoveryToken: token,
      recoveryTokenExpiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
    },
  });

  if (result.count === 0) {
    // Déjà traité, skip silencieusement
    return { success: true, idempotent: true };
  }

  return { success: true, idempotent: false };
}

// ❌ MAUVAIS - Pas idempotent
async function markRecoverySentBAD(cartId, token) {
  await prisma.order.update({
    where: { id: cartId },
    data: { recoveryEmailSent: true },
  });
  // Si appelé 2x, pas de détection que c'était déjà fait
}
```

### Pattern 3 : Lock Optimiste pour Race Conditions (Prisma)

**RÈGLE :** Utiliser `version` field pour détecter modifications concurrentes.

```javascript
// ✅ BON - Lock optimiste avec Prisma
async function transitionState(orderId, toState, reason) {
  return await prisma.$transaction(async (tx) => {
    // 1. Récupérer état actuel
    const order = await tx.order.findUnique({
      where: { id: orderId },
    });

    if (!order) {
      throw new Error("ORDER_NOT_FOUND");
    }

    const currentState = order.status;
    const currentVersion = order.version;

    // 2. Update avec lock optimiste
    const result = await tx.order.updateMany({
      where: {
        id: orderId,
        status: currentState,
        version: currentVersion, // Lock optimiste
      },
      data: {
        status: toState,
        version: { increment: 1 },
      },
    });

    if (result.count === 0) {
      throw new Error("CONCURRENT_MODIFICATION"); // Détecté !
    }

    // 3. Audit log
    await tx.orderStateAudit.create({
      data: {
        orderId,
        fromState: currentState,
        toState,
        reason,
      },
    });

    return { success: true };
  });
}

// ❌ MAUVAIS - Pas de lock optimiste
async function transitionStateBAD(orderId, toState) {
  await prisma.order.update({
    where: { id: orderId },
    data: { status: toState },
  });
  // Si 2 requêtes simultanées, pas de détection de conflit
}
```

### Pattern 4 : Validation Préconditions AVANT Mutation

**RÈGLE :** Valider TOUTES les préconditions avant toute modification.

```javascript
// ✅ BON - Validation complète avant mutation
async function processPayment(orderId, paymentDetails) {
  // 1. VALIDATION (lecture seule)
  const order = await prisma.order.findFirst({
    where: {
      id: orderId,
      status: "CHECKOUT",
    },
  });

  if (!order) {
    throw new Error("INVALID_ORDER_STATE");
  }

  const checkoutTime = new Date(order.checkoutAt);
  const now = Date.now();

  if (now - checkoutTime.getTime() > 10 * 60 * 1000) {
    throw new Error("RESERVATION_EXPIRED");
  }

  // 2. MUTATION (après validation)
  return await prisma.$transaction(async (tx) => {
    // ... mutations
  });
}

// ❌ MAUVAIS - Mutation avant validation complète
async function processPaymentBAD(orderId) {
  await prisma.order.update({
    where: { id: orderId },
    data: { paymentAttempt: { increment: 1 } },
  });
  // Si ensuite on découvre que order.status != 'CHECKOUT', trop tard
  const order = await prisma.order.findUnique({ where: { id: orderId } });
  if (order.status !== "CHECKOUT") throw new Error("INVALID_STATE");
}
```

### Pattern 5 : Side Effects Critiques vs Non-Critiques

**RÈGLE :** Distinguer side effects qui doivent être dans la transaction (critiques) vs après commit (non-critiques).

```javascript
// ✅ BON - Séparation claire
async function transitionToPaid(orderId) {
  // Side effects CRITIQUES : dans transaction
  await prisma.$transaction(async (tx) => {
    await tx.order.update({
      where: { id: orderId },
      data: { status: "PAID" },
    });

    await tx.stockReservation.updateMany({
      where: { orderId },
      data: { status: "CONFIRMED" },
    });

    await tx.orderStateAudit.create({
      data: {
        orderId,
        fromState: "CHECKOUT",
        toState: "PAID",
      },
    });
  });

  // Side effects NON-CRITIQUES : après commit (échec non bloquant)
  try {
    await sendEmail(orderId, "payment_confirmation");
  } catch (err) {
    console.error("Email failed but order is PAID", {
      orderId,
      error: err.message,
    });
    // État déjà committé, on ne rollback pas pour un email
  }
}

// ❌ MAUVAIS - Email dans transaction (bloquant)
async function transitionToPaidBAD(orderId) {
  await prisma.$transaction(async (tx) => {
    await tx.order.update({
      where: { id: orderId },
      data: { status: "PAID" },
    });
    await sendEmail(orderId, "payment_confirmation"); // Si timeout → rollback commande !
  });
}
```

---

## ❌ Anti-Patterns - À ÉVITER Absolument

### Anti-Pattern 1 : Modification État Sans Transaction

```javascript
// ❌ INTERDIT
async function checkout(userId) {
  const cart = await getCart(userId);
  await applyPromotions(cart); // Modifie cart
  await reserveStock(cart); // Si erreur ici, promotions déjà appliquées
  await updateCartStatus(cart.id, "CHECKOUT"); // Incohérence
}

// ✅ CORRECT
async function checkout(userId) {
  return await prisma.$transaction(async (tx) => {
    const cart = await getCart(userId, tx);
    const promos = await applyPromotions(cart, tx);
    await reserveStock(cart, tx);
    await updateCartStatus(cart.id, "CHECKOUT", tx);
  });
}
```

### Anti-Pattern 2 : Logique Métier dans Controller

```javascript
// ❌ INTERDIT
app.post("/cart/checkout", async (req, res) => {
  const cart = await prisma.order.findFirst({ where: { userId: req.user.id } });
  const promos = await prisma.promotion.findMany({ where: { tag: "AUTO" } });
  let total = 0;
  for (const item of cart.itemsSnapshot) {
    total += item.price * item.quantity;
  }
  // ... 50 lignes de logique métier
});

// ✅ CORRECT
const orderService = require("./services/orderService");

app.post("/cart/checkout", async (req, res) => {
  try {
    const result = await orderService.createOrderFromCart(req.user.id);
    res.json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});
```

### Anti-Pattern 3 : Modification Snapshot Après Checkout

```javascript
// ❌ INTERDIT - Viole INV-F1-1
async function updateOrderPrice(orderId, newPrice) {
  await prisma.order.update({
    where: { id: orderId },
    data: { totalSnapshot: newPrice },
  });
  // Les snapshots sont IMMUTABLES après checkout
}

// ✅ CORRECT - Pas de modification snapshot
// Si besoin d'ajuster, créer une nouvelle transaction/refund, pas modifier l'original
```

### Anti-Pattern 4 : N+1 Queries (Prisma)

```javascript
// ❌ INTERDIT
async function getOrdersWithProducts(userIds) {
  const orders = await prisma.order.findMany({
    where: { userId: { in: userIds } },
  });

  for (const order of orders) {
    order.products = await prisma.product.findMany({
      where: { id: { in: order.productIds } },
    });
    // N+1 queries
  }
}

// ✅ CORRECT - Use Prisma include
async function getOrdersWithProducts(userIds) {
  const orders = await prisma.order.findMany({
    where: { userId: { in: userIds } },
    include: {
      items: {
        include: {
          product: true,
        },
      },
    },
  });
  // 1 query avec join
}
```

### Anti-Pattern 5 : Catch Sans Logging

```javascript
// ❌ INTERDIT
try {
  await processPayment(orderId);
} catch (err) {
  // Erreur silencieuse, impossible à débugger
}

// ✅ CORRECT
try {
  await processPayment(orderId);
} catch (err) {
  console.error("Payment processing failed", {
    orderId,
    error: err.message,
    stack: err.stack,
  });
  throw err; // Re-throw si critique
}
```

---

## 📝 Conventions de Code

### Nommage

```javascript
// Services : camelCase + "Service" suffix
const orderService = require('./services/orderService');
const promotionService = require('./services/promotionService');

// Fonctions : camelCase, verbe d'action
async function createOrderFromCart(userId) { }
async function reserveStock(items, orderId) { }

// Constantes : SCREAMING_SNAKE_CASE
const TRANSITIONS_MAP = { /* ... */ };
const ERROR_CLASSIFICATION = { /* ... */ };

// Variables : camelCase descriptif
const orderDetails = await getOrder(orderId);
const appliedPromos = await applyPromotions(items);

// Prisma models : PascalCase
model Order { }
model Product { }

// Prisma fields : camelCase
model Order {
  id String
  userId String
  itemsSnapshot Json
}
```

### Commentaires et Documentation

**RÈGLE STRICTE : Tous les commentaires de code DOIVENT être en anglais.**

```javascript
// ✅ BON - Commentaires en anglais
// Validate stock availability before reservation
const product = await prisma.product.findUnique({ where: { id: productId } });

// Check if user has exceeded promotion usage limit
if (usage.count >= promotion.usageLimitPerUser) {
  throw new Error("PROMO_LIMIT_EXCEEDED");
}

// ❌ MAUVAIS - Commentaires en français
// Valider la disponibilité du stock avant réservation
const product = await prisma.product.findUnique({ where: { id: productId } });
```

**Application :**

- Code JavaScript/TypeScript : Commentaires en anglais
- Prisma schema : Commentaires en anglais
- README.md : Français (documentation utilisateur)
- CLAUDE.md : Français (documentation projet)
- prompts.md : Français (logs Wardley Map)

### Structure Projet

```
VibeCoding/
├── server/                          # Backend Node.js + Express
│   ├── prisma/
│   │   ├── schema.prisma            # Schema Prisma
│   │   └── migrations/              # Migrations auto-générées
│   ├── src/
│   │   ├── services/
│   │   │   ├── orderService.js          (F1)
│   │   │   ├── promotionService.js      (F2)
│   │   │   ├── stockReservationService.js (F3)
│   │   │   ├── orderStateMachine.js     (F4)
│   │   │   ├── paymentService.js        (F5)
│   │   │   └── cartRecoveryService.js   (F6)
│   │   ├── jobs/
│   │   │   ├── reservationExpirationJob.js
│   │   │   ├── stateTimeoutJob.js
│   │   │   └── cartReminderJob.js
│   │   ├── routes/
│   │   │   ├── cartRoutes.js
│   │   │   ├── paymentRoutes.js
│   │   │   └── recoveryRoutes.js
│   │   ├── middleware/
│   │   │   └── auth.js
│   │   ├── prisma.js                # PrismaClient instance
│   │   └── index.js                 # Entry point
│   ├── .env
│   ├── package.json
│   └── README.md
│
├── client/                          # Frontend React
│   ├── src/
│   │   ├── components/
│   │   │   ├── Cart.jsx
│   │   │   ├── Checkout.jsx
│   │   │   └── Payment.jsx
│   │   ├── services/
│   │   │   └── api.js
│   │   ├── App.jsx
│   │   └── index.js
│   ├── package.json
│   └── README.md
│
├── CLAUDE.md                        # Ce fichier
├── prompts.md                       # Documentation Wardley Map
└── README.md                        # Documentation projet
```

### Configuration Prisma

```javascript
// server/src/prisma.js
const { PrismaClient } = require("@prisma/client");

const prisma = new PrismaClient({
  log: ["query", "info", "warn", "error"], // Logging SQL queries
});

module.exports = prisma;
```

```env
# server/.env
DATABASE_URL="postgresql://user:password@localhost:5432/ecommerce?schema=public"
PORT=3000
```

### Gestion Erreurs

```javascript
// ✅ Erreurs métier typées
class InsufficientStockError extends Error {
  constructor(productId, requested, available) {
    super(`Insufficient stock for product ${productId}`);
    this.name = "InsufficientStockError";
    this.productId = productId;
    this.requested = requested;
    this.available = available;
  }
}

// ✅ Middleware error handler Express
app.use((err, req, res, next) => {
  console.error(err.stack);

  if (err instanceof InsufficientStockError) {
    return res.status(400).json({
      error: "INSUFFICIENT_STOCK",
      details: {
        productId: err.productId,
        requested: err.requested,
        available: err.available,
      },
    });
  }

  // Prisma errors
  if (err.code === "P2002") {
    return res.status(400).json({ error: "UNIQUE_CONSTRAINT_VIOLATION" });
  }

  res.status(500).json({ error: "INTERNAL_SERVER_ERROR" });
});
```

---

## 🧪 Checklist Avant Commit

**Pour TOUTE modification de service :**

- [ ] Transaction Prisma utilisée pour opérations multi-tables ? (`prisma.$transaction`)
- [ ] Idempotence garantie (@@unique constraints, WHERE dans updateMany) ?
- [ ] Lock optimiste via `version` si race condition possible ?
- [ ] Validation préconditions AVANT mutation ?
- [ ] Invariants feature respectés (voir section Invariants) ?
- [ ] Side effects critiques dans transaction, non-critiques après ?
- [ ] Audit log créé pour traçabilité ?
- [ ] Gestion erreurs avec logging ?
- [ ] Utilisation de `include` Prisma pour éviter N+1 queries ?
- [ ] Pas de logique métier dans controller ?

**Pour modifications Prisma schema :**

- [ ] @@unique constraints pour idempotence (orderId, etc.) ?
- [ ] @@index sur colonnes fréquemment filtrées (status, expiresAt) ?
- [ ] Champs DateTime @default(now()) pour traçabilité ?
- [ ] Field `version Int @default(0)` pour lock optimiste ?
- [ ] Validation custom pour stock_available >= 0 dans service ?

---

## 🎯 Priorités de Développement

**Ordre d'implémentation recommandé :**

1. **Prisma Schema** (models + constraints + indexes) → 1h
2. **OrderStateMachine (F4)** → 2h (Base pour F1 et F5)
3. **PromotionService (F2)** → 3h (Indépendant)
4. **StockReservationService (F3)** → 2h (Indépendant)
5. **OrderService (F1)** → 2h (Orchestre F2 + F3 + F4)
6. **PaymentService (F5)** → 1h (Utilise F3 + F4)
7. **CartRecoveryService (F6)** → 2h (Indépendant)
8. **Jobs** → Intégrés dans features respectives
9. **Routes Express** → 30min (Wrappers simples)
10. **Frontend React** → 2h (Components Cart, Checkout, Payment)

**Total Backend : 12.5h | Total Frontend : 2h | Total : 14.5h**

---

## 📚 Références

- **Architecture complète :** Voir `prompts.md` section "Phase Validation Architecture"
- **Pseudo-code features :** Voir `prompts.md` sections F1.IMPL à F6.IMPL
- **Invariants détaillés :** Voir `prompts.md` phases "Cycle Rouge - Décision" pour chaque feature
- **Prisma documentation :** https://www.prisma.io/docs
- **Express.js documentation :** https://expressjs.com/

---

_Ce guide est la référence absolue pour le développement de ce projet. Tout code qui viole ces règles DOIT être refactoré._
