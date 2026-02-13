# Développement App - Traçabilité Wardley Map

---

# Phase Globale - Exploration Initiale

> Cette phase couvre l'exploration globale du système : invariants, périmètre, hypothèses de conception, analyse des failles et remédiation. Les décisions prises ici servent de fondation pour le développement des features individuelles.

## Phase : Exploration

### P1 - Identification des invariants critiques

**Prompt :**

Liste les invariants critiques pour un système de commande e-commerce. Justifie chaque invariant en une ou deux phrases

**Résumé de la réponse :**
8 invariants critiques identifiés : cohérence du stock, idempotence des transactions, atomicité commande-paiement-stock, immutabilité du montant, unicité de l'ID, séquentialité des états, isolation des paniers, et traçabilité totale. Chaque invariant est justifié par sa protection contre des risques métier ou techniques spécifiques.

**Décision :** Garde tous les invariants identifiés

---

## Phase : Décision

### P2 - Définition du périmètre projet

**Prompt :**
Maintenant, définis le périmètre exact du projet: quels éléments sont inclus (ex: réservation de stock) et exclus (ex: livraison par le transporteur)? Justifie chaque inclusion ou exclusion par une ou deux phrases max

**Résumé de la réponse :**
Périmètre défini avec 8 éléments inclus (catalogue, panier, réservation stock, validation commande, paiement API tierce, gestion états, notifications, admin simple) et 8 exclus (logistique transporteur, retours/SAV, fidélité, promotions avancées, multi-devises, gestion fine stocks, marketplace, BI avancé). Chaque choix justifié par la valeur/complexité.

**Décision :** Périmètre validé avec ajout de 2 éléments : relance des paniers abandonnés (24h) et gestion de promotions (codes promo + remises automatiques). Total : 10 éléments inclus, 8 exclus.

---

### P3 - Critères de réussite mesurables

**Prompt :**
Liste les critères de réussite pour ce workflow de commande e-commerce. Chaque critère doit être expliqué en une ou deux phrases max, être mesurable (indique comment vérifier que le critère est atteint), et donne moi un exemple de succès ou d'échec pour chaque critère

**Résumé de la réponse :**
10 critères mesurables définis : taux conversion tunnel (>35%), temps réponse API (<500ms p95), zéro survente, idempotence paiements (100%), récupération paniers abandonnés (>15%), cohérence états commandes, disponibilité (99.5%), taux erreur checkout (<1%), traçabilité complète (100%), et application promotions correcte (>95%). Chaque critère inclut méthode de mesure et exemples succès/échec.

**Décision :** Critères validés avec retrait du critère "Disponibilité du Service (99.5% uptime)". Total : 9 critères de réussite mesurables retenus.

---

## Phase : Hypothèse

### P4 - Évaluation réservation stock 15min sur panier

**Prompt :**
Concernant la réservation du stock, j'envisage de mettre en place un système qui réserve dans le stock un article mis dans un panier pendant 15min. Évalue cette hypothèse et donne moi le pour et le contre avec des justifications brèves (une ou deux phrases max)

**Résumé de la réponse :**
3 arguments POUR (protection frustration client, réduction conflits concurrence, pression psychologique positive) et 5 arguments CONTRE (immobilisation stock inutile avec 65% abandon, complexité technique, risque abus/bots, problème multi-device, gestion extensions temps). Alternative proposée : réservation uniquement au checkout (10min) plutôt qu'au panier, pour réduire l'immobilisation inutile.

**Décision :** Hypothèse rejetée. Adoption de l'alternative : réservation de stock uniquement au checkout (durée : 10min) plutôt qu'au panier.

---

### P5 - Évaluation système de tags pour promotions

**Prompt :**
Pour la gestion des promotions, j'envisage de les catégoriser avec un système de tag afin de pouvoir valider ou refuser l'accumulation de promotions dans un panier. Évalue cette hypothèse et donne moi le pour et le contre avec des justifications brèves (une ou deux phrases max)

**Résumé de la réponse :**
4 arguments POUR (flexibilité règles accumulation, gestion centralisée lisible, évolutivité/A/B testing, audit/traçabilité) et 4 arguments CONTRE (complexité initiale pour cas simples, matrice compatibilité explosive avec beaucoup de tags, risque erreurs config, difficulté communication client). Recommandation d'approche progressive : V1 avec règle simple (1 code promo max), V2 avec 2-3 tags de base, V3 avec système complet si besoin avéré.

**Décision :** Adoption de l'approche V2 : système avec 2-3 tags de base (EXCLUSIVE, STACKABLE, AUTO) et matrice de compatibilité réduite.

---

### P6 - Évaluation State Pattern pour transitions d'état commande

**Prompt :**
Pour la transition d'état d'une commande, je pense qu'il serait bon d'utiliser le state pattern. Évalue cette hypothèse et donne moi le pour et le contre avec des justifications brèves (une ou deux phrases max)

**Résumé de la réponse :**
5 arguments POUR (encapsulation comportements par état, respect Open/Closed, transitions explicites validées, testabilité accrue, lisibilité code métier) et 5 arguments CONTRE (overhead pour workflow simple, prolifération classes, difficulté persistance, courbe apprentissage, debug complexe). Recommandation : enum + map de transitions pour workflow simple (4-5 états linéaires), State Pattern seulement si workflow complexe (7+ états, logique métier riche, transitions conditionnelles).

**Décision :** Adoption de l'approche simplifiée : enum + map de transitions pour les états de commande. State Pattern reporté si complexité augmente.

---

### P7 - Évaluation centralisation calcul total dans module unique

**Prompt :**
Pour la centralisation du calcul du total, je pense qu'il doit être centralisé dans un seul module (ex: TotalCalculator) pour garantir la cohérence de l'application. Évalue cette hypothèse et donne moi le pour et le contre avec des justifications brèves (une ou deux phrases max)

**Résumé de la réponse :**
5 arguments POUR (source unique vérité, cohérence règles métier, testabilité maximale, facilité audit/traçabilité, évolutivité pricing) et 5 arguments CONTRE (point contention dev, risque God Object, performance si mal optimisé, couplage fort entités, difficulté versioning). Recommandation : centraliser via un Domain Service avec stratégies (ProductPricing, Shipping, Tax, Promotion) plutôt qu'une classe monolithique, pour garder modularité et testabilité.

**Décision :** Adoption de la centralisation via Domain Service avec stratégies (ProductPricing, Shipping, Tax, Promotion). Approche modulaire validée.

---

### P8 - Évaluation expiration réservation 15min après paiement refusé

**Prompt :**
Concernant l'expiration des réservations, je pense qu'il faut qu'elles expirent après 15min en cas de paiement refusé pour éviter de bloquer le stock indéfiniment. Évalue cette hypothèse et donne moi le pour et le contre avec des justifications brèves (une ou deux phrases max)

**Résumé de la réponse :**
4 arguments POUR (libération rapide stock, gestion automatique sans intervention, équité clients, pression positive retry rapide) et 5 arguments CONTRE (frustration problème technique légitime, cycle infernal re-réservation, risque rupture entre-temps, complexité UX, gestion cas limites). Recommandation : approche graduée selon type d'échec (TECHNICAL_ERROR = 15min extension, INSUFFICIENT_FUNDS/CARD_DECLINED = libération immédiate) ou alternative simple (5min pour tous les échecs).

**Décision :** Adoption de l'approche graduée selon type d'échec : TECHNICAL_ERROR = extension 15min, INSUFFICIENT_FUNDS/CARD_DECLINED/FRAUD_SUSPECTED = libération immédiate.

---

## Phase : Exploration

### P9 - Approches de solution pour relance paniers abandonnés

**Prompt :**
Propose moi 3 approches de solutions pour la relance des paniers abandonnés après 24h

**Résumé de la réponse :**
3 approches proposées : 1) Job Batch Quotidien Simple (cron 1x/jour, simplicité max, timing imprécis ±1h), 2) Event-Driven avec Delayed Jobs (timing précis, scalable, complexité infra élevée), 3) Hybride Batch + Fenêtre Glissante (cron horaire, bon compromis complexité/précision, personnalisation possible). Recommandation : approche 3 pour démarrer, migration vers approche 2 si volume >50k paniers/jour.

**Décision :** Adoption de l'approche 3 (Hybride Batch + Fenêtre Glissante) : cron horaire avec fenêtre 23-25h, personnalisation possible via preferred_reminder_hour.

---

### P10 - Approches de solution pour création commande depuis panier

**Prompt :**
Propose moi maintenant 3 approches pour la création de commande à partir d'un panier

**Résumé de la réponse :**
3 approches proposées : 1) Transformation Directe In-Place (une seule entité avec statut, simplicité max, modèle hybride confus), 2) Copie Complète Snapshot (entités séparées Cart/Order, snapshot prix figé, standard industrie e-commerce, conformité légale), 3) Référence avec Agrégation (Order référence produits sans copie, jointures à la volée, économie espace mais complexité). Recommandation forte : approche 2 (Snapshot) pour conformité légale, évolutivité, séparation concepts claire.

**Décision :** Adoption de l'approche 1 (Transformation Directe In-Place) : une seule entité CartOrder avec champ status (ACTIVE → CONVERTED). Priorité à la simplicité pour le MVP.

---

## Phase : Conversation

### P11 - Analyse failles potentielles de l'application

**Prompt :**
Analyse le fichier prompt.md et fait moi un rapport des failles potentielles de l'application

**Résumé de la réponse :**
9 failles identifiées : 1 CRITIQUE (P10 transformation in-place viole invariants P1, non-conformité légale), 4 MAJEURES (absence monitoring uptime, fenêtre réservation 10min trop courte, complexité tags promotions, détection type échec paiement peu fiable), 2 MOYENNES (spam potentiel relance paniers, race conditions stock non gérées), 2 MINEURES (enum→state pattern si évolution, risque surcouplage domain service). Actions prioritaires : reconsidérer P10 pour snapshot, ajouter monitoring, implémenter locks stock.

---

### P12 - Analyse scénarios problématiques et cas limites des failles

**Prompt :**
Pour chaque faille moyenne, majeure ou critique, explique moi les scénarios problématiques et les cas limites

**Résumé de la réponse :**
7 failles détaillées avec 3 scénarios problématiques et 3-4 cas limites chacune : P10 in-place (modification prix post-conversion, perte traçabilité, corruption données), absence monitoring (panne silencieuse, dégradation progressive), réservation 10min (3D Secure lent, virement bancaire, indécision client), tags promo (règles ambiguës, ordre application, messages erreur), détection échec paiement (classification erronée, gateway incohérent, fraude faux positif), spam relance (boucle infinie, fuseau horaire, multiples paniers), race conditions stock (double réservation, libération pendant paiement, admin override). Tableau criticité par risque CA et légal.

---

### P13 - Solutions techniques pour remédier aux failles

**Prompt :**
Propose moi des solutions pour remédier à ces failles et cas limites

**Résumé de la réponse :**
7 solutions détaillées : 1) P10 Snapshot avec immutabilité DB, 2) monitoring via UptimeRobot + healthcheck endpoint + métriques temps réel, 3) réservation avec extension dynamique + durées adaptatives par moyen paiement, 4) tags promo avec matrice compatibilité explicite + tests exhaustifs + messages erreur clairs, 5) classification échec paiement via mapping gateway-specific + fallback safe, 6) anti-spam relance avec 6 règles (reminded_at, seuil minimum, stock dispo, consent, timezone, unsubscribe), 7) race conditions via lock optimiste (version DB) + retry + job réconciliation. Tableau effort/impact par solution.

**Décision :** Adoption des solutions P10 Snapshot avec immutabilité, réservation avec extension dynamique + durées adaptatives par moyen paiement, race conditions via lock optimiste (version DB) + retry + job réconciliation et tags promo avec matrice compatibilité explicite + tests exhaustifs + messages erreur clairs

---

### P14 - Logique machine à états de la commande en pseudo-code

**Prompt :**
en pseudo-code, montre moi la logique de la machine à états de la commande

**Résumé de la réponse :**
Pseudo-code complet de la machine à états avec 9 états (CART, CHECKOUT, PAYMENT_PENDING, PAYMENT_FAILED, PAID, PREPARING, SHIPPED, DELIVERED, CANCELLED), matrice de transitions valides, handlers par transition (checkout avec réservation + snapshot prix, payment_failed avec logique graduée, paid avec confirmation stock), durées adaptatives de réservation par moyen paiement (10min défaut, 15min 3DS, 30min virement), lock optimiste via version DB, 2 jobs (expiration réservations chaque minute, réconciliation stock chaque heure), gestion événements asynchrones, et exemple d'utilisation complet du cycle de vie.

---

### P15 - Évaluation transition retry directe pour paiement échoué

**Prompt :**
Je ne vois pas de transition pour le retry d'un paiement échoué. Donne moi le pour et le contre à ajouter une transition de retry plutôt que de redémarrer tout le processus de paiement en cas de paiement refusé

**Résumé de la réponse :**
5 arguments POUR retry direct PAYMENT_FAILED → PAYMENT_PENDING (UX fluide, conservation réservation stock, performance, optimisation conversion, conservation contexte paiement) et 5 arguments CONTRE (risque boucle infinie, données obsolètes violant invariants P1, complexité gestion état, risque sécurité/fraude, non-conformité légale EU si prix changé). Recommandation approche hybride : retry rapide (<5min, max 3 tentatives, conservation snapshot) pour TECHNICAL_ERROR/CARD_DECLINED uniquement, retry tardif (>5min) force revalidation complète via CHECKOUT.

**Décision :** Adoption de l'approche hybride : retry rapide PAYMENT_FAILED → PAYMENT_PENDING (<5min, max 3 tentatives) pour TECHNICAL_ERROR/CARD_DECLINED, retry tardif (>5min) force PAYMENT_FAILED → CHECKOUT pour revalidation complète.

---

---

# Développement par Feature

> Chaque feature suit un cycle itératif :
>
> - **Cycle Rouge** : Exploration, identification des invariants spécifiques, analyse des failles, hypothèses de conception
> - **Cycle Bleu** : Implémentation, tests, validation

---

## Feature 1 : Création d'une commande à partir d'un panier

### Contexte

- Décisions globales applicables : P1 (invariants), P10 (snapshot), P13 (immutabilité DB), P14 (machine à états), P15 (retry hybride)
- Composants impliqués : CartOrder, StockReservation, TotalCalculator, OrderStateMachine

### Cycle Rouge - Décision

#### F1.P1 - Invariants critiques création commande depuis panier

**Prompt :**
Liste les invariants critiques de la fonctionnalité de création de commande à partir d'un panier

**Résumé de la réponse :**
10 invariants identifiés : snapshot immuable des prix (figés à CART→CHECKOUT), atomicité panier-réservation-snapshot (tout ou rien), validation pré-checkout obligatoire (items/quantités/stock valides), unicité de conversion (idempotence anti-double-commande), préservation historique (auditabilité), cohérence mathématique du total (∑ prix×qty + promo + taxes), horodatage snapshots (traçabilité temporelle ±1s), non-régression panier (CHECKOUT ne revient jamais à CART), isolation snapshots par tentative (nouveau snapshot à chaque retry), durée de vie minimale données checkout (conservation 7j post-PAID/CANCELLED). Catégorisés en 5 groupes : intégrité, atomicité, sécurité métier, conformité légale, cohérence d'état.

**Décision :** Garde tous les invariants identifiés.

---

#### F1.P2 - Périmètre de la fonctionnalité création commande

**Prompt :**
Définis maintenant le périmètre exact de la fonctionnalité, ce qui est inclus et exclus. Justifie chaque choix par une ou deux phrases max

**Résumé de la réponse :**
Périmètre défini avec 10 éléments INCLUS (validation pré-checkout, transition CART→CHECKOUT, snapshot prix/promos, réservation stock automatique, calcul et snapshot total, détection doubles conversions, conservation historique panier, rollback atomique erreurs, horodatage snapshots) et 11 éléments EXCLUS (gestion paiement, calcul frais livraison initial, validation adresses, application nouveaux codes promo, modification post-checkout, réapprovisionnement stock, notifications client, gestion expiration réservations, analytics, génération facture, gestion retours/annulations). Catégorisés en 5 groupes : validation/snapshot (4 inclus, 2 exclus), gestion état (2 inclus, 2 exclus), stock/calculs (2 inclus, 1 exclus), sécurité/intégrité (2 inclus, 1 exclus), systèmes externes (0 inclus, 5 exclus).

**Décision :** Périmètre validé.

---

#### F1.P3 - Critères de réussite de la feature

**Prompt :**
Identifie maintenant les critères de réussite de cette feature

**Résumé de la réponse :**
11 critères mesurables identifiés : taux conversion checkout ≥98% (tentatives valides réussies), latence P95 <800ms (validation+snapshot+réservation), idempotence 100% (zéro double conversion), cohérence mathématique total 100% (écart ≤0.01€), atomicité garantie 0% états partiels (status cohérent avec réservation/snapshot), traçabilité complète 100% (tous timestamps+historique), détection paniers invalides ≥99% (avant transition), réussite réservation stock ≥95% (échecs légitimes exclus), conservation données ≥7j post-PAID/CANCELLED, performance calcul total P99 <100ms, rollback complet 100% en cas échec. Catégorisés en 4 groupes : fiabilité (98-100%), performance (P95 <800ms, P99 <100ms), intégrité données (100%), robustesse (95-99%). Tableau seuils objectif/alerte/échec fourni.

**Décision :** Critères validés.

---

### Cycle Rouge - Hypothèse

#### F1.P4 - Évaluation check stock avant création commande

**Prompt :**
Pour cette feature, je pense qu'il faut faire un check du stock disponible avant de créer la commande à partir du panier. Évalue cette hypothèse et donne moi le pour et le contre avec des justifications brèves (une ou deux phrases max)

**Résumé de la réponse :**
5 arguments POUR check stock préalable (détection précoce fail-fast, retour immédiat <100ms, respect invariant validation F1.P1 #3, optimisation UX, réduction charge réservation) et 5 arguments CONTRE (race condition TOCTOU inévitable, latence +50-100ms, faux positifs possibles, double vérification redondante, complexité gestion erreur). Recommandation approche hybride "soft check" : vérification rapide non-bloquante avec fallback gracieux (retour immédiat si confidence >95%, sinon continue vers réservation atomique qui fait la vraie validation), timeout 100ms max, résilience si check échoue. Meilleur compromis performance/UX/fiabilité.

**Décision :** Adoption de l'approche hybride "soft check" non-bloquant avec fallback vers réservation atomique.

---

### Cycle Rouge - Exploration

#### F1.P5 - Approches de solution pour création commande depuis panier

**Prompt :**
Propose moi 3 approches pour réaliser cette feature

**Résumé de la réponse :**
3 approches proposées : 1) Service Orchestrateur Monolithique avec transaction DB globale (simplicité max, ACID natif, rollback auto, latence P95 700-900ms, scalabilité 50-100 req/s, MVP 2-3j, couplage fort, lock DB longue), 2) Event-Driven avec Saga Pattern choreography (scalabilité excellente 1000+ req/s, résilience max, découplage fort, latence P95 1000-1200ms ⚠️ dépasse critère, complexité élevée, infra lourde Kafka/Redis, eventual consistency, TTM 2-3 semaines), 3) Domain Service avec Command Pattern et Stratégies injectables (équilibre optimal, testabilité max, extensibilité Open/Closed, lock optimiste, latence P95 600-750ms ✅, scalabilité 200-300 req/s, complexité modérée DDD, compensation manuelle, TTM 1 semaine). Tableau comparatif sur 8 critères. Recommandation : Approche 3 pour production standard (1000-10000 cmd/j), Approche 1 pour MVP, Approche 2 pour échelle massive.

**Décision :** Adoption de l'Approche 3 (Domain Service avec Command Pattern et Stratégies injectables). Meilleur compromis maintenabilité/scalabilité.

---

### Cycle Rouge - Conversation

#### F1.P6 - Analyse failles potentielles de l'approche choisie

**Prompt :**
Identifie les failles potentielles à la solution qui a été choisie, explique moi les scénarios problématiques et les cas limites

**Résumé de la réponse :**
7 failles identifiées : 3 MAJEURES (compensation manuelle réservation avec scénarios crash serveur/timeout DB/exception non catchée + CL double libération/expiration pendant tx/network split/retry post-compensation, race condition lock optimiste avec scénarios double-clic/retry auto/admin override + CL version skew cache/boucle infinie conflits/rollback vs version, erreur partielle stratégies avec scénarios snapshot 2/3 items/réservation multi-produits partielle/calcul total promo invalide + CL orphelins snapshots/idempotence), 4 MOYENNES (stratégies désynchronisées cache vs DB avec scénarios prix cache vs DB/promo expirée/stock validation vs réservation + CL état mutable/injection mauvaise stratégie/bloquante vs non-bloquante, complexité Command Pattern avec scénarios nouveau dev/debugging multi-stratégies/prolifération classes + CL config prod/cyclic dependency, soft check non fiable avec scénarios OK puis échec/échec puis OK/timeout fallback + CL confidence threshold/multi-région, performance externes avec scénarios API lente/cascade timeouts/bloquante séquentielle + CL retry exponentiel/down sans fallback). Tableau synthèse criticité/probabilité/impacts business et technique.

**Décision :** Failles identifiées et analysées.

---

#### F1.P7 - Solutions de remédiation aux failles identifiées

**Prompt :**
comment pourrais t'on se prémunir de ces failles et de ces edges cases?

**Résumé de la réponse :**
7 solutions détaillées par faille : 1) Compensation réservation via Pattern Outbox transaction log + idempotency keys + circuit breaker fallback (élimine 95% orphelins, +50ms, effort 3j), 2) Race condition via retry auto backoff exponentiel + lock optimiste avec timestamp + pessimistic lock hybride + rate limiting 3 req/10s (résout 95% conflits, +200-900ms si conflit, effort 1j), 3) Erreur partielle via transaction wrapper savepoints + idempotence forcée stratégies + cleanup job orphelins quotidien (garantit atomicité, +30ms, effort 2j), 4) Stratégies désync via cache-aside TTL 30s + versioning données cachées + circuit breaker cache (réduit incohérence 90%, effort 1j), 5) Complexité Pattern via documentation ADR + distributed tracing OpenTelemetry/Jaeger (améliore debug x3, +5-10ms overhead, effort 2j), 6) Soft check via dual check cache/DB confidence-based + message UX adaptatif (réduit faux pos/neg 80%, +50-100ms si confidence basse, effort 1j), 7) Performance externes via parallélisation async/await + circuit breaker fallback dégradé (-20% latence, 680ms vs 850ms, effort 2j). Tableau synthèse effort/impact/priorité par solution. Total 12j dev, impact cumulé 70-90% réduction risques.

**Décision :** Adoption des solutions 1.2 (Idempotency Key pour Réservation - évite double réservation/libération), 2.2 (Lock Optimiste avec Timestamp - messages erreur informatifs, détection modifications récentes), 3.2 (Idempotence Forcée dans Stratégies - safe de retry, cleanup automatique, aucun orphelin).

---

---

## Feature 2 : Application de promotions

### Contexte

- Décisions globales applicables : P1 (invariants), P5 (tags EXCLUSIVE/STACKABLE/AUTO), P13 (matrice compatibilité + tests exhaustifs)
- Composants impliqués : PromotionEngine, PromotionValidator, TotalCalculator, PromotionTag

### Cycle Rouge - Décision

#### F2.P1 - Invariants critiques application de promotions

**Prompt :**
Liste moi les invariants critiques de cette feature

**Résumé de la réponse :**
12 invariants identifiés : exclusivité mutuelle promos EXCLUSIVE (max 1), ordre application déterministe (AUTO→STACKABLE→EXCLUSIVE puis priorité), montant final ≥0€ (jamais négatif), traçabilité complète (code/type/tag/montant/timestamp/ordre), validation stricte codes promo manuels (existant/actif/non-expiré/conditions), idempotence application (N fois = 1 fois), immutabilité règles promo au checkout (snapshot), respect limites usage par user (1x/client, 3x/mois), compatibilité selon matrice explicite P5, conservation historique tentatives refusées (détection fraude), unicité code promo manuel par panier, calcul avant taxes (HT puis TVA sur réduit). Catégorisés en 4 groupes : règles métier (3), intégrité calcul (3), sécurité/fraude (4), conformité/audit (3). Tableau risques/impacts business et technique par invariant.

**Décision :** Garde tous les invariants identifiés.

---

#### F2.P2 - Périmètre de la fonctionnalité application promotions

**Prompt :**
Définis maintenant le périmètre de la feature

**Résumé de la réponse :**
Périmètre défini avec 10 éléments INCLUS (validation codes promo manuels, application auto promos AUTO, calcul réductions 3 types %/fixe/livraison, vérification matrice compatibilité P5, détection doublons idempotence, snapshot promos au checkout, vérification limites usage par user, traçabilité logs+historique, messages erreur explicites, ordre application déterministe) et 10 éléments EXCLUS (création/modif règles promo backoffice, analytics performance, A/B testing, recommandation perso ML, gestion budget promo, notifications push, programme fidélité points/cashback, livraison coupons PDF/QR, fraud detection ML avancée, multi-devises). Catégorisés en 5 groupes : application/calcul (4 inclus, 0 exclus), validation/sécurité (3 inclus, 2 exclus), conformité/audit (3 inclus, 0 exclus), systèmes externes (0 inclus, 6 exclus), features connexes (0 inclus, 2 exclus).

**Décision :** Périmètre validé.

---

#### F2.P3 - Critères de réussite de la feature

**Prompt :**
Définis les critères de réussite

**Résumé de la réponse :**
12 critères mesurables identifiés : taux application réussie ≥99% (promos valides), latence calcul P95 <100ms, exactitude calcul 100% (écart ≤0.01€), détection fraude codes ≥95%, respect limites usage 100% (1x/client, 3x/mois), traçabilité complète 100% (logs code/type/tag/montant/timestamp/ordre), clarté messages erreur ≥90% compréhension (enquête UX), ordre application déterministe 100% (recalculs identiques), idempotence 100% (N fois = 1 fois), montant final ≥0€ toujours (protection active), performance validation matrice P99 <10ms (lookup rapide), impact conversion +10% (avec promo vs sans). Catégorisés en 6 groupes : fiabilité (99-100%), performance (P95 <100ms, P99 <10ms), exactitude (100%), sécurité (≥95%), conformité (100%), UX (≥90%, +10%). Tableau seuils objectif/alerte/échec fourni.

**Décision :** Critères validés.

---

### Cycle Rouge - Hypothèse

#### F2.P4 - Évaluation système de tags pour promotions

**Prompt :**
Pour la gestion des promotions, j'envisage de les catégoriser avec un système de tag afin de pouvoir valider ou refuser l'accumulation de promotions dans un panier. Évalue cette hypothèse et donne moi le pour et le contre avec des justifications brèves (une ou deux phrases max)

**Résumé de la réponse :**
(Référence P5) 4 arguments POUR (flexibilité règles accumulation, gestion centralisée lisible, évolutivité/A/B testing, audit/traçabilité) et 4 arguments CONTRE (complexité initiale pour cas simples, matrice compatibilité explosive avec beaucoup de tags, risque erreurs config, difficulté communication client). Recommandation d'approche progressive : V1 avec règle simple (1 code promo max), V2 avec 2-3 tags de base, V3 avec système complet si besoin avéré.

**Décision :** (Référence P5) Adoption de l'approche V2 : système avec 2-3 tags de base (EXCLUSIVE, STACKABLE, AUTO) et matrice de compatibilité réduite.

---

### Cycle Rouge - Exploration

#### F2.P5 - Approches de solution pour application promotions

**Prompt :**
Propose moi 3 approches pour cette feature

**Résumé de la réponse :**
3 approches proposées : 1) Service avec Logique Conditionnelle Séquentielle if/else + matrice compatibilité HashMap (simplicité max, performance excellente P95 50-80ms, débogage trivial, pas dépendances, maintenabilité difficile si >10 règles, couplage fort, pas hot-reload, TTM 3-5j), 2) Chain of Responsibility Pattern avec 1 handler par tag (extensibilité Open/Closed, testabilité isolation, ordre explicite, responsabilité unique, complexité modérée, P95 70-100ms, maintenabilité bonne jusqu'à 20+ règles, TTM 5-7j), 3) Rule Engine Dédié Drools-like avec règles JSON externalisées (flexibilité max hot-reload, évolutivité 100+ règles, A/B testing facile, séparation concerns, complexité élevée infra DB/cache/admin, P95 100-150ms avec cache, débogage difficile, TTM 2-3 semaines). Tableau comparatif 9 critères. Recommandation : Approche 2 pour contexte P5 V2 (3 tags = 3 handlers parfaits), extensible future V3, respect critères F2.P3. Alternative : Approche 1 si MVP <1 semaine, Approche 3 si 20+ promos dès V1.

**Décision :** Adoption de l'Approche 2 (Chain of Responsibility Pattern). Alignée avec contexte P5 V2 (3 tags), extensible, testable.

---

### Cycle Rouge - Conversation

#### F2.P6 - Analyse failles potentielles de l'approche choisie

**Prompt :**
Analyse maintenant les failles et edges cases potentiels de cette solution

**Résumé de la réponse :**
7 failles identifiées : 4 MAJEURES (ordre chaîne critique avec scénarios handlers mal configurés/ajoutés dynamiquement/priorités inversées + CL chaîne circulaire/handler manquant/ordre différent dev-prod, état partagé context avec scénarios double application concurrente/context singleton réutilisé + CL context non immutable/deep copy oublié, handler défaillant casse chaîne avec scénarios exception AutoHandler/timeout service externe/erreur silencieuse return null + CL exception setNext/mauvais type retour, rollback partiel impossible avec scénarios ExclusiveHandler échoue après AUTO+STACKABLE/montant négatif détecté tard + CL transaction DB partielle/compensation oubliée), 3 MOYENNES (matrice compatibilité incohérente avec scénarios règle non symétrique/règle manquante/matrice explosée 10+ tags + CL update prod sans validation/cache vs DB, performance chaîne longue avec scénarios Black Friday 50 promos/client 30 éligibles + CL filtrage inefficace N+1/cache miss, idempotence handler avec scénarios retry network/context pas nettoyé + CL partial success/idempotency key oublié). Tableau synthèse criticité/probabilité/impacts.

**Décision :** Failles identifiées et analysées.

---

#### F2.P7 - Solutions de remédiation aux failles identifiées

**Prompt :**
Comment pourrais-t-on se prémunir de ces failles et de ces edges cases?

**Résumé de la réponse :**
7 solutions détaillées par faille : 1) Ordre chaîne via 1.1 config déclarative avec validation topologique (effort 3j), 1.2 priority-based routing dynamique (2j), 1.3 Pipeline immutable avec phases EXCLUSIVE/STACKABLE/AUTO (2j, ordre garanti); 2) État partagé via 2.1 Context immutable copy-on-write (1j, thread-safe), 2.2 version locking (2j), 2.3 Event Sourcing (5j, audit complet); 3) Handler défaillant via 3.1 try-catch graceful + distinction critical/non-critical (1j, chaîne continue), 3.2 Circuit Breaker auto-recovery (3j), 3.3 Compensation Transaction (4j, rollback complet); 4) Rollback impossible via 4.1 Two-Phase Commit validate+commit atomique (3j, atomicité garantie), 4.2 Command Pattern avec undo() (4j); 5) Matrice incohérente via 5.1 génération auto depuis annotations (2j, single source truth), 5.2 property-based testing symétrie/transitivité (1j); 6) Performance via 6.1 lazy evaluation short-circuit (2j), 6.2 indexation handlers par critères (2j, scaling excellent); 7) Idempotence via 7.1 idempotency key par handler (1j), 7.2 state machine transitions (2j). Recommandations P0 : 1.3 + 2.1 + 3.1 + 4.1 ensemble cohérent (7j), P1 : 5.1 + 6.2 + 7.1 (5j). Total 12j.

**Décision :** Adoption des solutions 1.3 (Pipeline immutable avec phases), 2.1 (Context immutable copy-on-write), 3.1 (Try-catch avec fallback graceful), 4.1 (Two-Phase Commit Pattern).

---

---

## Feature 3 : Réservation temporaire du stock pendant le paiement

### Contexte

- Décisions globales applicables : P1 (invariants), P10 (snapshot), P13 (immutabilité DB), P14 (machine à états), P15 (retry hybride)
- Composants impliqués : StockReservation, PaymentProcessor, OrderStateMachine, ReservationExpirationManager

### Cycle Rouge - Décision

#### F3.P1 - Invariants critiques réservation temporaire stock

**Prompt :**
Liste les invariants critiques de la fonctionnalité de réservation temporaire du stock pendant le paiement

**Résumé de la réponse :**
13 invariants identifiés : atomicité réservation-checkout (réservation réussie ⇔ CHECKOUT créé), durée de vie adaptative réservation (15min paiement CB, 1h virement, 5min wallet, ajustée selon historique user), libération automatique expiration garantie (job toutes les 30s, tombstone si échec, max 2min délai), unicité réservation par item+commande (1 réservation = 1 OrderID, idempotence anti-double-réservation), stock jamais négatif (constraint DB CHECK stock_quantity ≥ 0), cohérence stock réservé vs disponible (stock_total = stock_available + ∑ stock_reserved), libération immédiate si paiement réussi/annulé (PAID → libération instantanée, CANCELLED → libération <5s), traçabilité complète opérations (reservation_id/order_id/product_id/quantity/timestamp_start/timestamp_end/reason), détection fuite réservations orphelines (reconciliation quotidienne, alerte si >1% orphelins), priorité FIFO réservations (premier arrivé = premier servi, pas de préemption sauf admin), re-réservation possible après expiration (retry payment autorisé si stock disponible), isolation transactions réservation (lock optimiste row-level, pas de deadlock), protection contre sur-réservation concurrente (race conditions gérées par lock DB ou distributed lock Redis). Catégorisés en 5 groupes : intégrité stock (4), gestion cycle de vie (3), concurrence/atomicité (3), conformité/audit (2), résilience (1).

**Décision :** Garde tous les invariants identifiés.

---

#### F3.P2 - Périmètre de la fonctionnalité réservation temporaire stock

**Prompt :**
Définis maintenant le périmètre de la feature

**Résumé de la réponse :**
Périmètre défini avec 11 éléments INCLUS (création réservation atomique avec checkout, calcul durée expiration adaptative selon méthode paiement, job libération automatique expirations toutes les 30s, libération immédiate PAID/CANCELLED, détection et rollback sur-réservation concurrente, traçabilité logs réservation/libération/expiration, gestion unicité réservation par OrderID, validation stock disponible avant réservation, reconciliation quotidienne détection orphelins, retry réservation après expiration si stock disponible, métriques temps réel stock disponible/réservé) et 10 éléments EXCLUS (réapprovisionnement stock automatique, prédiction demande ML, gestion précommandes backorders, transfert stock inter-entrepôts, notifications client expiration imminente, prolongation manuelle réservation par admin, priorité réservations VIP/fidélité, système enchères stock limité, gestion lots/numéros série, multi-devises/géolocalisation stock). Catégorisés en 5 groupes : réservation/libération (5 inclus, 2 exclus), intégrité/validation (3 inclus, 1 exclus), monitoring/audit (3 inclus, 1 exclus), fonctionnalités avancées (0 inclus, 4 exclus), systèmes externes (0 inclus, 2 exclus).

**Décision :** Périmètre validé.

---

#### F3.P3 - Critères de réussite de la feature

**Prompt :**
Définis les critères de réussite

**Résumé de la réponse :**
14 critères mesurables identifiés : taux réussite réservation ≥99% (tentatives valides, stock disponible), latence création réservation P95 <200ms (validation+lock+write), exactitude stock temps réel 100% (stock_available + stock_reserved = stock_total, écart 0), détection sur-réservation concurrente 100% (0 violation constraint stock ≥ 0), libération expiration garantie ≤2min post-expiration (job 30s + tombstone), libération immédiate PAID/CANCELLED 100% réussite (PAID instantané, CANCELLED <5s), taux orphelins réservations ≤1% (reconciliation quotidienne), traçabilité complète 100% (logs reservation_id/order_id/product_id/quantity/timestamps/reason), durée expiration adaptative conforme 100% (15min CB, 1h virement, 5min wallet + ajustement historique), idempotence réservation 100% (1 OrderID = max 1 réservation active), performance reconciliation quotidienne P99 <5min (scan complet + cleanup), disponibilité métriques temps réel ≥99.9% (dashboard stock disponible/réservé), retry réservation post-expiration ≥95% réussite (si stock disponible), rollback atomique 100% sur échec (réservation partielle impossible). Catégorisés en 6 groupes : fiabilité (99-100%), performance (P95 <200ms, P99 <5min), exactitude (100%), résilience (≤1-2% échecs légitimes), conformité (100%), monitoring (≥99.9%).

**Décision :** Critères validés.

---

### Cycle Rouge - Hypothèse

#### F3.P4 - Évaluation job schedulé pour libération automatique réservations

**Prompt :**
Pour la libération automatique des réservations expirées, je pense qu'il faut utiliser un job schedulé qui tourne toutes les 30 secondes pour scanner et libérer les réservations expirées. Évalue cette hypothèse et donne moi le pour et le contre avec des justifications brèves (une ou deux phrases max)

**Résumé de la réponse :**
5 arguments POUR job schedulé (simplicité implémentation standard cron/scheduler, contrôle fin fréquence et batch size, observabilité facile logs/métriques, retry automatique si échec job, économie ressources vs listeners permanents) et 5 arguments CONTRE (délai libération max 30s + temps scan inacceptable si pic, scalabilité limitée single-threaded avec 100k+ réservations, pas temps réel pénalise UX, single point of failure si job crash, dérive clock multi-serveurs cause double libération). Recommandation approche hybride : job schedulé 30s pour cleanup bulk + TTL Redis pour expirations critiques temps réel (<5s), fallback tombstone DB si Redis down, reconciliation quotidienne détection dérive.

**Décision :** Adoption de l'approche hybride : job schedulé 30s pour cleanup bulk + TTL Redis pour expirations critiques temps réel (<5s), fallback tombstone DB si Redis down, reconciliation quotidienne.

---

### Cycle Rouge - Exploration

#### F3.P5 - Approches de solution pour réservation temporaire stock

**Prompt :**
Propose moi 3 approches pour cette feature

**Résumé de la réponse :**
3 approches proposées : 1) Service Réservation Monolithique avec lock DB pessimiste (simplicité max transaction ACID native, rollback auto, latence P95 150-250ms, scalabilité 50-150 req/s lock contention, MVP 2-3j, couplage fort, deadlock risque élevé, TTM 3j), 2) Service avec Distributed Lock Redis + Event Sourcing libérations (scalabilité excellente 500+ req/s lock distribué, résilience max event replay, traçabilité complète historique, latence P95 180-220ms Redis overhead, complexité élevée infra Redis+event store, eventual consistency libérations, TTM 2 semaines), 3) Service avec Lock Optimiste DB + Job Hybride + Cache Redis TTL (équilibre optimal, testabilité isolation composants, extensibilité ajout durées adaptatives, lock optimiste minimal contention, latence P95 120-180ms ✅, scalabilité 200-400 req/s, complexité modérée 3 systèmes coordonnés, compensation si Redis fail, TTM 1 semaine). Tableau comparatif 9 critères. Recommandation : Approche 3 pour contexte production standard respecte F3.P3 latence <200ms, extensible durées adaptatives F3.P1, résilience hybride job+Redis. Alternative : Approche 1 si MVP <1 semaine, Approche 2 si échelle massive 10000+ req/s.

**Décision :** Adoption de l'Approche 3 (Lock Optimiste DB + Job Hybride + Cache Redis TTL). Meilleur compromis latence/scalabilité/résilience, respect F3.P3.

---

### Cycle Rouge - Conversation

#### F3.P6 - Analyse failles potentielles de l'approche choisie

**Prompt :**
Identifie les failles potentielles à la solution qui a été choisie, explique moi les scénarios problématiques et les cas limites

**Résumé de la réponse :**
8 failles identifiées : 4 MAJEURES (désynchronisation Redis vs DB avec scénarios Redis TTL expire mais DB pas libérée/DB libérée mais Redis persiste + CL cache invalidation oubliée/network partition split-brain/reconciliation quotidienne trop tardive, conflit lock optimiste boucle infinie retry avec scénarios Black Friday 1000 users même produit/retry exponentiel mal configuré + CL version incrémentation atomique cassée/cache version stale/deadlock logique retry, job cleanup crash perd réservations orphelines avec scénarios OOM job/exception non catchée/DB timeout long scan + CL job non idempotent double libération/tombstone échoue aussi/alerting ops manquant, compensation Redis fail laisse état incohérent avec scénarios transaction DB commit puis Redis down/rollback partiel transaction + CL compensation manuelle oubliée/event ordering incorrect), 4 MOYENNES (durée adaptative mal calculée cause expiration prématurée avec scénarios historique user biaisé/A/B test fausse calcul + CL durée min/max non respectée/timezone dérive, performance dégradée Redis cache miss avec scénarios Redis eviction LRU/cold start après deploy + CL N+1 queries DB/batch get inefficace, race condition libération double avec scénarios job + Redis TTL simultanés/retry payment + job simultanés + CL idempotence libération absente/double decrement stock, traçabilité incomplète si logs partiels avec scénarios exception avant log/log asynchrone perd messages + CL correlation ID manquant/timestamp drift). Tableau synthèse criticité/probabilité/impacts business et technique.

**Décision :** Failles identifiées et analysées.

---

#### F3.P7 - Solutions de remédiation aux failles identifiées

**Prompt :**
Donne moi des solutions pour résoudre ces failles et edge cases

**Résumé de la réponse :**
8 solutions détaillées par faille : 1) Désync Redis/DB via 1.1 Write-Through Cache pattern (2j), 1.2 Reconciliation incrémentale 5min (2j), 1.3 Event-Driven Sync avec CDC Debezium (1 semaine, résilience max); 2) Boucle retry via 2.1 backoff exponentiel + circuit breaker (1j), 2.2 queue FIFO réservations avec rate limiting (2j), 2.3 pessimistic lock hybride fallback (2j); 3) Job crash via 3.1 job idempotent + distributed lock coordination (2j), 3.2 segmentation parallèle job avec checkpoints (3j), 3.3 message queue dead-letter avec retry (3j, garantie traitement); 4) Compensation Redis via 4.1 Two-Phase Commit pattern DB+Redis (2j), 4.2 Transaction Outbox pattern avec polling (3j, at-least-once delivery), 4.3 saga orchestration avec compensation (1 semaine); 5) Durée adaptative via 5.1 ML simple régression linéaire historique (3j), 5.2 règles métier bornes min/max (1j), 5.3 A/B testing framework durées (1 semaine); 6) Cache miss via 6.1 cache warming proactif (1j), 6.2 batch loading avec DataLoader pattern (2j), 6.3 cache aside avec stampede protection (1j); 7) Race libération via 7.1 idempotence key libération (1j), 7.2 distributed lock libération atomique (2j), 7.3 compare-and-swap DB optimiste (1j); 8) Traçabilité via 8.1 structured logging correlation ID (1j), 8.2 distributed tracing Jaeger (2j), 8.3 audit log immutable event store (3j). Recommandations P0 : 1.2 + 2.1 + 3.1 + 4.1 (7j), P1 : 5.2 + 6.3 + 7.1 + 8.1 (4j). Total 11j.

**Décision :** Adoption des solutions 1.1 (Write-Through Cache pattern), 2.1 (Backoff exponentiel + Circuit Breaker), 3.1 (Job idempotent + Distributed Lock), 4.1 (Two-Phase Commit pattern DB+Redis).

---

---

## Feature 4 : Gestion des transitions d'état de commande

### Contexte

- Décisions globales applicables : P1 (invariants), P13 (immutabilité DB), P14 (machine à états), P15 (retry hybride)
- Composants impliqués : OrderStateMachine, StateTransitionValidator, EventPublisher, AuditLogger

### Cycle Rouge - Décision

#### F4.P1 - Invariants critiques machine à états commande

**Prompt :**
Liste les invariants critiques de la fonctionnalité de gestion des transitions d'état de commande (créée -> payée -> préparée -> expédiée)

**Résumé de la réponse :**
15 invariants identifiés : transitions autorisées déterministes (graphe orienté acyclique strict CREATED→CHECKOUT→PAID→PREPARING→SHIPPED→DELIVERED, retours arrière interdits sauf CANCELLED depuis états pré-SHIPPED), atomicité transition + side effects (changement état ⇔ libération stock/envoi email/appel webhook atomique, tout ou rien), unicité état actif par commande (1 commande = 1 état à instant T, pas d'états multiples simultanés), traçabilité complète transitions (audit log order_id/from_state/to_state/timestamp/actor/reason immutable), validation préconditions obligatoire (CHECKOUT→PAID exige payment_confirmed=true, PAID→PREPARING exige stock_reserved=true), idempotence transitions (retry transition déjà effectuée retourne succès sans side effect, évite double webhook), impossibilité skip états (CREATED→PREPARING interdit, respect séquence obligatoire), états terminaux immutables (DELIVERED/CANCELLED/REFUNDED finaux, aucune transition sortante), timeout états temporaires (CHECKOUT max 15min, PREPARING max 48h, auto-transition CANCELLED si expiré), cohérence état vs données associées (état PAID ⇒ payment_id NOT NULL, état SHIPPED ⇒ tracking_number NOT NULL), détection états incohérents (reconciliation détecte PREPARING avec stock_reserved=false, alerte + correction), événements publiés garantis (transition réussie ⇒ event OrderStateChanged publié at-least-once), rollback atomique échec transition (si webhook échoue après update état, rollback DB complet), protection concurrence transitions (lock optimiste ou distributed lock, race condition CHECKOUT→PAID vs timeout→CANCELLED gérée), isolation états par commande (transition commande A n'affecte jamais commande B, isolation DB garantie). Catégorisés en 5 groupes : intégrité machine à états (5), atomicité/cohérence (4), traçabilité/audit (2), résilience (3), conformité métier (1).

**Décision :** Garde tous les invariants identifiés.

---

#### F4.P2 - Périmètre de la fonctionnalité gestion transitions d'état

**Prompt :**
Définis maintenant le périmètre de la feature

**Résumé de la réponse :**
Périmètre défini avec 12 éléments INCLUS (validation graphe transitions autorisées avant exécution, exécution atomique transition avec side effects DB+événements, gestion préconditions par état vérification payment_confirmed/stock_reserved/tracking_number, publication événements OrderStateChanged avec outbox pattern, audit log immutable toutes transitions avec from/to/timestamp/actor/reason, idempotence détection transition déjà effectuée via version ou état actuel, timeout automatique états temporaires job CHECKOUT 15min/PREPARING 48h, rollback automatique échec transition DB+webhooks+emails, lock optimiste version prévention race conditions simultanées, validation cohérence état-données PAID⇒payment_id/SHIPPED⇒tracking_number, API transition REST POST /orders/:id/transition avec body target_state/reason, reconciliation quotidienne détection états incohérents alerte ops) et 10 éléments EXCLUS (orchestration saga multi-services compensations distribuées, workflow builder visuel configuration transitions métier, états personnalisables par tenant multi-tenant SaaS, machine à états parallèles sous-états simultanés, undo/redo transitions historique rollback manuel, prédiction état futur ML estimation SHIPPED date, notifications temps réel client push websocket, validation règles métier complexes moteur règles externe Drools, gestion permissions granulaires RBAC qui peut faire quelle transition, intégration ERP externe sync états SAP/Salesforce). Catégorisés en 5 groupes : exécution transitions (5 inclus, 1 exclus), traçabilité/audit (2 inclus, 0 exclus), résilience/cohérence (3 inclus, 2 exclus), interface/API (2 inclus, 3 exclus), intégrations avancées (0 inclus, 4 exclus).

**Décision :** Périmètre validé.

---

#### F4.P3 - Critères de réussite de la feature

**Prompt :**
Définis les critères de réussite

**Résumé de la réponse :**
13 critères mesurables identifiés : taux réussite transitions valides ≥99.5% (transitions autorisées avec préconditions remplies), latence transition P95 <300ms (validation+update DB+event publish), atomicité transitions 100% (update état ⇔ side effects, 0 état incohérent), validation graphe transitions 100% (0 transition interdite exécutée, skip états impossible), traçabilité audit log 100% (tous changements loggés avec from/to/timestamp/actor/reason), idempotence transitions 100% (retry transition déjà faite = succès sans double side effect), détection race conditions 100% (lock optimiste évite 2 transitions simultanées, first-wins garanti), timeout états temporaires ≤2min délai (CHECKOUT 15min→CANCELLED, PREPARING 48h→CANCELLED, job 30s), publication événements garantie ≥99.9% (OrderStateChanged publié at-least-once, outbox pattern), rollback échec transition 100% (webhook fail → rollback DB complet, état inchangé), cohérence état-données 100% (PAID⇒payment_id NOT NULL, SHIPPED⇒tracking_number NOT NULL, constraints DB), performance reconciliation quotidienne P99 <10min (scan états incohérents + correction auto), disponibilité API transitions ≥99.95% (POST /orders/:id/transition uptime). Catégorisés en 5 groupes : fiabilité (99.5-100%), performance (P95 <300ms, P99 <10min), exactitude (100%), résilience (≥99.9%), conformité (100%).

**Décision :** Critères validés.

---

### Cycle Rouge - Hypothèse

#### F4.P4 - Évaluation exécution side effects synchrone vs asynchrone

**Prompt :**
Pour l'exécution des side effects lors d'une transition d'état (envoi webhooks, emails, publication événements), je pense qu'il faut utiliser une approche hybride : outbox pattern pour les événements critiques (garantie at-least-once) et exécution asynchrone via queue pour les webhooks/emails non-bloquants. Évalue cette hypothèse et donne moi le pour et le contre avec des justifications brèves (une ou deux phrases max)

**Résumé de la réponse :**
5 arguments POUR approche hybride (découplage latence API <300ms événements async, garantie livraison at-least-once outbox pattern événements critiques, résilience retry automatique queue si webhook fail, scalabilité traitement async 1000+ transitions/s sans bloquer, observabilité traçabilité queue/outbox dédiés) et 5 arguments CONTRE (complexité architecture 3 systèmes DB+outbox+queue, eventual consistency webhook reçu après état changé visible API, ordering non garanti événements multiples transitions rapides, compensation difficile webhook envoyé mais transition rollback DB, débogage distribué correlation events async complexe). Recommandation approche hybride validée avec optimisations : outbox pattern polling 1s pour événements OrderStateChanged (critiques intégrations), queue async RabbitMQ/SQS pour webhooks/emails (retry DLQ 3x), side effects critiques bloquants synchrones dans transaction (libération stock PAID→PREPARING), monitoring correlation ID propagé DB→outbox→queue, reconciliation quotidienne détection événements perdus.

**Décision :** Adoption de l'approche hybride avec optimisations : outbox pattern polling 1s pour événements critiques, queue async pour webhooks/emails, side effects critiques synchrones in-transaction, catégorisation claire CRITIQUE vs NON-CRITIQUE.

---

### Cycle Rouge - Exploration

#### F4.P5 - Approches de solution pour gestion transitions d'état

**Prompt :**
Propose moi 3 approches pour cette feature

**Résumé de la réponse :**
3 approches proposées : 1) State Pattern Orienté Objet avec classes State concrètes (simplicité code POO standard, extensibilité ajout nouveaux états facile, testabilité isolation unit tests par état, encapsulation logique transition dans état, latence P95 100-150ms overhead objet minimal, scalabilité 300-500 req/s standard, complexité faible pattern GoF classique, couplage fort états hardcodés code, graphe implicite navigation code difficile, TTM 1 semaine), 2) Table-Driven State Machine avec config DB (flexibilité graphe modifiable runtime sans deploy, validation centralisée règles transitions DB, observabilité graphe visible SQL query, découplage logique vs config, latence P95 200-300ms query DB validation, scalabilité 200-400 req/s cache config, complexité modérée schéma DB transitions, migration config délicate erreur casse tout, performance cache invalidation complexe, TTM 2 semaines), 3) Event Sourcing avec State reconstruit depuis événements (auditabilité complète replay historique, résilience rollback temporel, extensibilité projections multiples, découplage fort événements immuables, latence P95 250-350ms replay événements, scalabilité 100-300 req/s write event store, complexité élevée infra event store+snapshots, eventual consistency projections async, migration schéma événements breaking, TTM 3-4 semaines). Tableau comparatif 9 critères. Recommandation : Approche 1 State Pattern pour contexte production standard graphe stable, respect F4.P3 latence <300ms, simplicité maintenance équipe. Alternative : Approche 2 si graphe change fréquemment, Approche 3 si audit réglementaire critique.

**Décision :** Adoption de l'Approche 1 (State Pattern Orienté Objet). Meilleur compromis simplicité/performance, respect F4.P3 latence <300ms.

---

### Cycle Rouge - Conversation

#### F4.P6 - Analyse failles potentielles de l'approche choisie

**Prompt :**
Identifie les failles potentielles à la solution qui a été choisie, explique moi les scénarios problématiques et les cas limites

**Résumé de la réponse :**
7 failles identifiées : 4 MAJEURES (graphe transitions hardcodé code nécessite redeploy avec scénarios nouveau métier PARTIAL_REFUND ajouté/transition SHIPPED→PREPARING retour SAV/A/B test durée CHECKOUT 10min vs 15min + CL hot-reload impossible/downtime deploy prod/rollback deploy complexe si bug, duplication logique validation entre états avec scénarios payment_id validé PaidState et PreparingState/stock_reserved check 3 états/tracking_number validé 2 fois + CL maintenance cohérence difficile/refactoring extract common oublié/tests unitaires dupliqués, side effects async non-idempotents avec scénarios retry transition webhook envoyé 2x/email dupliqué paiement réussi/event OrderStateChanged publié 3x + CL idempotency key absent webhooks/queue exactly-once impossible/correlation ID manquant, outbox polling 1s perd événements si crash avec scénarios serveur crash après commit DB avant polling/transaction rollback après insert outbox/outbox table corruption + CL at-least-once garanti cassé/événements critiques perdus/reconciliation tardive 24h), 3 MOYENNES (graphe implicite navigation difficile avec scénarios nouvel dev comprend pas canTransitionTo/documentation états outdated/graphe visuel absent + CL onboarding lent/debugging transitions complexe, couplage fort OrderState vs Order entity avec scénarios changement schéma Order casse 7 states/migration DB impacte tous états/mock Order difficile tests + CL testabilité dégradée/refactoring risqué, performance dégradée instanciation états avec scénarios 1000 req/s créé 7000 objets états/GC pressure élevé/latence P95 150ms→250ms + CL pooling objets complexe/cache états stateful risqué). Tableau synthèse criticité/probabilité/impacts.

**Décision :** Failles identifiées et analysées.

---

#### F4.P7 - Solutions de remédiation aux failles identifiées

**Prompt :**
Quelles solutions me propose tu ?

**Résumé de la réponse :**
7 solutions détaillées par faille : 1) Graphe hardcodé via 1.1 configuration YAML externe (2j), 1.2 feature flags transitions conditionnelles (3j), 1.3 State Registry avec validation graphe runtime (2j, équilibre flexibilité/simplicité); 2) Duplication validation via 2.1 abstract base class validators communs (1j), 2.2 decorator pattern @RequiresPrecondition (2j), 2.3 specification pattern composable (3j, réutilisabilité max); 3) Side effects non-idempotents via 3.1 idempotency key header webhooks (1j), 3.2 deduplication window Redis 5min (1j), 3.3 exactly-once semantic Kafka/Kinesis (1 semaine, garantie forte); 4) Outbox perd events via 4.1 transaction listener commit hook (2j), 4.2 CDC Debezium capture changes (1 semaine), 4.3 dual write compensation job (2j, fallback robuste); 5) Graphe implicite via 5.1 documentation Mermaid auto-générée (1j), 5.2 graphe visualization dashboard (2j), 5.3 tests contrat graphe (1j); 6) Couplage fort via 6.1 DTO pattern interface states (2j), 6.2 adapter pattern Order→StateData (2j), 6.3 dependency injection IoC (1j); 7) Perf instanciation via 7.1 singleton states stateless (0.5j), 7.2 flyweight pattern shared states (1j), 7.3 object pooling (2j). Recommandations P0 : 1.3 + 2.1 + 3.2 + 4.3 (7.5j), P1 : 5.1 + 6.1 + 7.1 (3.5j). Total 11j.

**Décision :** Adoption des solutions 1.3 (State Registry avec validation runtime), 2.1 (Abstract base class validators communs), 3.2 (Deduplication window Redis 5min), 4.3 (Dual write + compensation job).

---

---

## Feature 5 : Libération du stock si paiement échoue ou expire

### Contexte

- Décisions globales applicables : P1 (invariants), P13 (immutabilité DB), P14 (machine à états), P15 (retry hybride)
- Features liées : F3 (réservation temporaire stock), F4 (transitions d'état)
- Composants impliqués : StockReleaseService, PaymentFailureHandler, OrderStateMachine, ReservationExpirationManager

### Cycle Rouge - Décision

#### F5.P1 - Invariants critiques libération stock échec/expiration paiement

**Prompt :**
Liste les invariants critiques de la fonctionnalité de libération du stock si le paiement échoue ou expire

**Résumé de la réponse :**
14 invariants identifiés : atomicité libération stock + transition état (libération stock ⇔ transition CHECKOUT→CANCELLED atomique, tout ou rien), idempotence libération stock (multiple calls libération même OrderID = succès sans double increment stock_available), cohérence stock après libération (stock_available + stock_reserved = stock_total toujours vérifié post-libération), distinction échec définitif vs temporaire (échec carte insuffisante = définitif libération immédiate, timeout gateway = temporaire retry avant libération), délai maximum libération après échec (échec paiement → libération <30s, expiration timeout → libération ≤2min via job), traçabilité complète raison libération (audit log order_id/reason PAYMENT_FAILED/PAYMENT_EXPIRED/TIMEOUT/timestamp), libération garantie même si webhook fail (webhook payment failed échoue → libération stock quand même via fallback), détection double libération (protection contre race condition job expiration + webhook failure simultanés), synchronisation réservation Redis + DB (libération update DB stock ET delete clé Redis reservation:order_id), rollback impossible après libération (stock libéré = irréversible, retry paiement = nouvelle réservation), notification client échec/expiration (email/push optionnel mais libération stock jamais bloquée par notification), cohérence état commande post-libération (état CANCELLED ⇒ stock_reserved = 0, payment_attempt_count > 0), priorité libération vs nouveaux checkouts (stock libéré immédiatement disponible pour autres clients FIFO), timeout adaptatif retry paiement (3DS challenge 5min, virement 1h, retry autorisé pendant timeout, libération après).

**Décision :** Garde tous les invariants identifiés.

---

#### F5.P2 - Périmètre de la fonctionnalité libération stock échec/expiration

**Prompt :**
Définis maintenant le périmètre de la feature

**Résumé de la réponse :**
Périmètre défini avec 11 éléments INCLUS (libération atomique stock+transition CHECKOUT→CANCELLED transaction DB, webhook listener payment.failed/payment.expired avec retry 3x, job expiration timeout polling 30s réservations expirées, distinction échec définitif vs temporaire selon code erreur gateway, idempotence key libération protection double release, synchronisation libération DB stock_available/reserved + Redis delete, traçabilité audit log raison PAYMENT_FAILED/EXPIRED/TIMEOUT, notification asynchrone client email échec non-bloquante, validation cohérence post-libération stock_reserved=0, timeout adaptatif selon méthode paiement 3DS 5min/virement 1h, reconciliation quotidienne détection libérations manquées) et 9 éléments EXCLUS (re-tentative automatique paiement retry smart, compensation partielle stock items individuels, réservation prioritaire client VIP après libération, analytics prédictifs taux échec paiement, notification temps réel push websocket, gestion remboursement partiel si pré-autorisé, rollback libération si retry réussit <1min, transfert réservation autre client waitlist, intégration fraud detection blocage libération suspect). Catégorisés en 5 groupes : libération stock (4 inclus, 2 exclus), détection échec/expiration (3 inclus, 1 exclus), traçabilité/notification (2 inclus, 2 exclus), résilience (2 inclus, 1 exclus), fonctionnalités avancées (0 inclus, 3 exclus).

**Décision :** Périmètre validé.

---

#### F5.P3 - Critères de réussite de la feature

**Prompt :**
Définis les critères de réussite

**Résumé de la réponse :**
12 critères mesurables identifiés : taux réussite libération échec paiement ≥99.9% (webhook payment.failed reçu → libération complète), latence libération échec paiement P95 <30s (réception webhook → stock libéré), délai libération expiration timeout ≤2min (expiration détectée → stock libéré par job 30s), atomicité libération+transition 100% (stock libéré ⇔ état CANCELLED, 0 incohérence), idempotence libération 100% (retry libération même order = succès sans double increment stock), cohérence stock post-libération 100% (stock_available + stock_reserved = stock_total vérifié), distinction échec définitif/temporaire ≥95% précision (classification code erreur correcte), traçabilité libération 100% (audit log raison PAYMENT_FAILED/EXPIRED/TIMEOUT complet), synchronisation DB+Redis ≥99.9% (libération update DB ET delete Redis réservation), détection libérations manquées ≤1% (reconciliation quotidienne écart acceptable), disponibilité webhook listener ≥99.95% (uptime traitement payment.failed/expired), notification client non-bloquante 100% (échec email n'empêche pas libération stock). Catégorisés en 5 groupes : fiabilité (99.9-100%), performance (P95 <30s, délai ≤2min), exactitude (100%), résilience (≥99.9%), conformité (100%).

**Décision :** Critères validés.

---

### Cycle Rouge - Exploration

#### F5.P4 - Approches de solution pour libération stock échec/expiration

**Prompt :**
Propose moi 3 approches pour cette feature

**Résumé de la réponse :**
3 approches proposées : 1) Réutilisation job expiration F3 uniquement (simplicité max réutilise code existant F3, cohérence logique expiration=libération, latence 0-30s variable job polling, scalabilité 200-400 req/s, complexité faible aucun code nouveau, pas distinction échec définitif/temporaire, UX dégradée stock bloqué 30s, TTM 1j), 2) Webhook listener payment gateway primary (réactivité <5s libération immédiate, distinction échec riche code erreur INSUFFICIENT_FUNDS vs TIMEOUT, UX optimale stock disponible instantané, latence P95 3-8s, scalabilité 500+ req/s async, complexité modérée webhook endpoint+retry, dépendance gateway qualité webhooks, pas de fallback webhooks perdus, TTM 1 semaine), 3) Hybride webhook primary + job fallback (résilience max webhook 95% + job 5% fallback, latence P95 <10s webhook ou <30s job, garantie 0 libération manquée, observabilité ratio webhook/job, scalabilité 400-600 req/s, complexité élevée coordination 2 systèmes, idempotence critique lock Redis, coût infra double, TTM 2 semaines). Tableau comparatif 9 critères. Recommandation : Approche 1 si business tolère 30s délai simplicité prime, Approche 2 si latence <5s critique et webhooks gateway fiables, Approche 3 si résilience absolue requise environnement prod critique.

**Décision :** Adoption de l'Approche 2 (Webhook Listener Payment Gateway Primary). Latence <5s critique pour UX, webhooks gateway fiables.

---

### Cycle Rouge - Conversation

#### F5.P5 - Analyse failles potentielles de l'approche choisie

**Prompt :**
Identifie les failles potentielles à la solution qui a été choisie, explique moi les scénarios problématiques et les cas limites

**Résumé de la réponse :**
6 failles identifiées : 3 MAJEURES (webhooks perdus network failure avec scénarios gateway timeout 5s webhook jamais reçu/serveur down 2min restart/DDoS attack drop packets + CL stock jamais libéré blocage permanent/client frustré abandon/cascade failure 100+ commandes, signature webhook non-validée spoofing avec scénarios attaquant forge webhook payment.failed/replay attack ancien webhook/man-in-middle modifie payload + CL libération frauduleuse stock/commande légitime annulée tort/survente par libération multiple, idempotence webhook absente double libération avec scénarios webhook redelivery 2x Stripe retry/load balancer duplique requête/client spam endpoint + CL double increment stock_available/survente invisible/stock_total corruption), 3 MOYENNES (classification code erreur incorrecte avec scénarios nouveau code erreur CARD_BLOCKED inconnu/gateway retourne code generic PAYMENT_ERROR/mapping codes obsolète + CL libération prématurée retry possible/client frustré échec définitif classé temporaire, latence webhook >30s pic charge avec scénarios Black Friday 10000 webhooks simultanés/queue webhook saturée/processing webhook lent DB lock + CL viole F5.P3 latence <30s/UX dégradée stock bloqué, webhook ordering non-garanti avec scénarios webhook payment.expired arrive avant payment.failed/retry payment réussit webhook fail arrive après + CL libération alors que payé/incohérence état). Tableau synthèse criticité/probabilité/impacts.

**Décision :** Failles identifiées et analysées.

---

#### F5.P6 - Solutions de remédiation aux failles majeures

**Prompt :**
Quelles sont les solutions pour remédier aux failles majeures?

**Résumé de la réponse :**
3 solutions pour failles majeures : 1) Webhooks perdus via 1.1 job fallback polling 5min détection manquées (2j), 1.2 webhook retry exponential backoff gateway (1j config), 1.3 dead letter queue + alerting (1j, observabilité); 2) Signature non-validée via 2.1 validation HMAC SHA256 header (1j), 2.2 mutual TLS certificat client (3j), 2.3 API key + IP whitelist (0.5j, basique); 3) Idempotence absente via 3.1 idempotency key order_id+version DB unique (1j), 3.2 Redis distributed lock TTL 30s (1j), 3.3 status field processed check (0.5j, simple). Recommandations : 1.1 job fallback + 2.1 HMAC validation + 3.1 idempotency key DB (4j effort total). Ensemble cohérent couvre 3 failles critiques, effort raisonnable, production-ready.

**Décision :** Adoption des solutions 1.1 (Job fallback polling 5min détection webhooks manqués), 2.1 (Validation HMAC SHA256 header + anti-replay timestamp), 3.1 (Idempotency key DB unique webhook_id).

---

---

## Feature 6 : Relance des paniers abandonnés après 24h

### Contexte

- Décisions globales applicables : P1 (invariants), P14 (machine à états), P15 (retry hybride)
- Features liées : F3 (réservation temporaire stock), F4 (transitions d'état), F5 (libération stock)
- Composants impliqués : AbandonedCartService, NotificationService, OrderStateMachine, CartRecoveryJob

### Cycle Rouge - Décision

#### F6.P1 - Invariants critiques relance paniers abandonnés

**Prompt :**
Liste les invariants critiques de la fonctionnalité de relance des paniers abandonnés après 24h

**Résumé de la réponse :**
12 invariants identifiés : délai relance fixe 24h précises (relance envoyée exactement 24h après abandon, tolérance ±15min acceptable), unicité relance par panier (1 panier = max 1 relance envoyée, pas de spam multiple), opt-out respecté RGPD (client désinscrit notifications = 0 relance, consentement marketing vérifié), snapshot panier immutable relance (email contient prix/promo/stock au moment abandon, pas prix actuels), lien relance sécurisé avec token (URL email contient token unique expiration 7j, anti-hijacking), idempotence relance (retry job envoi email = succès sans doublon, déduplication garantie), exclusion paniers convertis (panier devenu commande PAID = pas de relance, état vérifié avant envoi), personnalisation contenu email (nom client/produits/montant total/code promo optionnel), traçabilité relances envoyées (audit log cart_id/email/timestamp/conversion tracking), taux conversion mesurable (UTM tracking lien email, attribution relance→achat), stock non-réservé relance (produits panier pas réservés après 24h, disponibilité temps réel), pas de relance panier vide (cart items > 0 requis, validation avant envoi). Catégorisés en 5 groupes : timing et fréquence (2), conformité RGPD (2), contenu et sécurité (3), tracking et analytics (2), business logic (3).

**Décision :** Garde tous les invariants identifiés.

---

#### F6.P2 - Périmètre de la fonctionnalité relance paniers abandonnés

**Prompt :**
Définis maintenant le périmètre de la feature

**Résumé de la réponse :**
Périmètre défini avec 10 éléments INCLUS (job polling 1h détection paniers abandonnés 24h, validation opt-in marketing_consent avant envoi, snapshot panier JSON prix/promo/stock au moment abandon, génération token sécurisé URL recovery unique expiration 7j, template email personnalisé nom/produits/montant/CTA, envoi email asynchrone queue non-bloquant, traçabilité audit log cart_recovery_log avec timestamp/token/conversion, exclusion paniers convertis état PAID vérifiée, UTM tracking lien email utm_source=cart_recovery, endpoint recovery GET /cart/recover/:token restore panier session) et 8 éléments EXCLUS (relances multiples séquence J+1/J+3/J+7, A/B testing contenu email variants, segmentation client VIP vs standard, prédiction ML probabilité conversion, notification push mobile alternative email, code promo dynamique -10% automatique, intégration CRM Salesforce sync événements, analytics avancées funnel abandon détaillé). Catégorisés en 5 groupes : détection et éligibilité (3 inclus, 1 exclus), contenu et envoi (3 inclus, 3 exclus), tracking et analytics (2 inclus, 2 exclus), recovery et conversion (2 inclus, 1 exclus), intégrations (0 inclus, 1 exclus).

**Décision :** Périmètre validé.

---

#### F6.P3 - Critères de réussite de la feature

**Prompt :**
Définis les critères de réussite

**Résumé de la réponse :**
11 critères mesurables identifiés : précision délai 24h ±15min (95% emails envoyés 23h45-24h15 après abandon), taux envoi réussi ≥99% (emails relance envoyés sans échec technique), respect opt-out 100% (0 email envoyé si marketing_consent=false), unicité relance 100% (1 panier = max 1 email, flag recovery_email_sent vérifié), taux ouverture email ≥20% (benchmark industrie e-commerce 18-25%), taux clic lien recovery ≥8% (ouverture → clic CTA checkout), taux conversion panier→commande ≥5% (relance → achat finalisé 7j), token sécurité 100% (0 hijacking token prévisible/expiré accepté), traçabilité complète 100% (audit log cart_recovery_log tous envois avec conversion tracking), exclusion convertis ≥99.9% (race condition panier payé avant envoi détectée), performance job polling P99 <5min (scan paniers abandonnés + envoi batch). Catégorisés en 5 groupes : fiabilité technique (99-100%), timing (95% précision ±15min), engagement email (20% ouverture, 8% clic), conversion business (5% panier→commande), conformité (100%).

**Décision :** Critères validés.

---

### Cycle Rouge - Exploration

#### F6.P4 - Approches de solution pour relance paniers abandonnés

**Prompt :**
Propose moi 3 approches pour cette feature

**Résumé de la réponse :**
3 approches proposées : 1) Job cron 1h polling DB simple (simplicité max query SQL standard, cohérence logique scan batch horaire, latence précision 24h ±30min acceptable, scalabilité 5000-10000 paniers/h, complexité faible aucun système externe, pas temps réel délai fixe 1h, performance scan full table si 100k+ paniers, TTM 1 semaine), 2) Event-driven abandon tracking temps réel (réactivité email envoyé exactement 24h, scalabilité excellente 50k+ paniers/j async, observabilité événements tracés, latence précision 24h ±1min, complexité élevée event bus + scheduler, dépendance Redis/event store critique, TTM 2 semaines), 3) Hybrid job 1h + cache Redis abandoned_at (équilibre performance index Redis abandoned_at rapide, précision 24h ±30min acceptable, simplicité modérée Redis simple, scalabilité 20k-30k paniers/h, cohérence cache Redis + DB sync, complexité modérée 2 systèmes coordonnés, coût Redis mémoire additionnelle, TTM 1.5 semaine). Tableau comparatif 9 critères. Recommandation : Approche 1 si simplicité prime MVP <1 semaine, Approche 2 si précision temps réel critique et infra event-driven existante, Approche 3 si équilibre performance/simplicité pour prod standard.

**Décision :** Adoption de l'Approche 1 (Job Cron 1h Polling DB Simple). Simplicité maximale, MVP rapide, précision ±30min acceptable.

---

### Cycle Rouge - Conversation

#### F6.P5 - Analyse failles potentielles de l'approche choisie

**Prompt :**
Identifie les failles potentielles à la solution qui a été choisie, explique moi les scénarios problématiques et les cas limites

**Résumé de la réponse :**
5 failles identifiées : 3 MAJEURES (performance scan full table 100k+ paniers avec scénarios Black Friday pic 50k paniers abandonnés/query timeout >30s/DB CPU 90% + CL index absent last_modified/job bloque autres queries/latency cascade, double envoi retry job avec scénarios job crash après envoi avant flag update/transaction rollback partiel/network glitch duplicate + CL flag recovery_email_sent pas set/client spam 2-3 emails/désinscription, token prévisible sequential ID avec scénarios attaquant devine pattern token=cart_id+timestamp/brute force 1000 tokens/hijack panier concurrent + CL crypto.randomBytes absent/token court 8 chars/pas expiration vérifiée), 2 MOYENNES (précision ±30min viole F6.P3 95% avec scénarios job 1h dernière exécution 10h05/panier abandonné 10h10/envoi 11h05 = 24h55min + CL seuil 95% pas respecté/conversion réduite timing sous-optimal, race condition panier converti avec scénarios client paie 23h59/job scan 24h00 1s avant commit/email envoyé tort + CL EXISTS subquery pas transaction lock/eventual consistency). Tableau synthèse criticité/probabilité/impacts.

**Décision :** Failles identifiées et analysées.

---

#### F6.P6 - Solutions de remédiation aux failles identifiées

**Prompt :**
Quelles solution me propose tu pour remédier à ces failles?

**Résumé de la réponse :**
5 solutions pour failles : 1) Scan full table via 1.1 index composite (last_modified, recovery_email_sent) + pagination cursor (1j), 1.2 partitioning table carts par date (3j), 1.3 materialized view carts_abandoned refresh 5min (2j, performance max); 2) Double envoi via 2.1 transaction atomique flag + outbox email (1j), 2.2 idempotency key Redis dedup 24h (1j), 2.3 two-phase commit email provider (2j); 3) Token prévisible via 3.1 crypto.randomBytes(32) + expiration 7j (0.5j), 3.2 JWT signed token claims (1j), 3.3 HMAC token + rate limiting endpoint (1j, sécurité max); 4) Précision ±30min via 4.1 job 15min fenêtres glissantes (0.5j), 4.2 job horaire tolérance ±45min acceptable (0j config), 4.3 event-driven scheduler (1 semaine, précision ±1min); 5) Race condition via 5.1 FOR UPDATE lock subquery (0.5j), 5.2 retry-after-commit pattern (1j), 5.3 eventual consistency acceptable délai 5s (0j, toléré). Recommandations P0 : 1.1 + 2.1 + 3.3 (2.5j), P1 : 4.1 + 5.1 (1j). Total 3.5j.

**Décision :** Adoption des solutions 1.1 (Index composite + pagination cursor), 2.1 (Transaction atomique flag + outbox email), 3.3 (HMAC token + rate limiting endpoint).

---

---

# Phase Simplification -

> **Démarche de simplification** : Après avoir un peu perdu de vue qu'il fallait implémenter ces features en cycle bleu avant vendredi soir, j'ai décidé de revoir mes solutions en demandant à l'IA de les simplifier, maintenant qu'elle a une vision globale de ce que je veux faire ainsi que sur les solutions qui ont été validées jusque là (ça devrait être plus simple de générer des solutions de simplification du système et de l'architecture maintenant qu'elle a tout le contexte de ce fichier)

---

## Feature 1 : Création d'une commande à partir d'un panier (Simplifiée)

### Cycle Bleu - Implémentation Simplifiée

#### F1.IMPL - Architecture simplifiée création commande

**Prompt :**
Détaille la création de commande en pseudo-code simplifié. Focus sur les invariants critiques : snapshot prix immutable, atomicité panier-réservation, validation pré-checkout, idempotence.

**Résumé de la réponse :**
Architecture simplifiée avec transaction DB native remplaçant Command Pattern. Modèle : table orders unique avec status enum + items_snapshot JSON, table products avec stock_available/reserved + reserved_until. Algorithme : (1) récupération panier avec lock pessimiste, (2) soft check stock, (3) snapshot prix figés dans JSON, (4) application promotions F2, (5) réservation stock F3, (6) transition atomique CART→CHECKOUT avec lock optimiste version, (7) rollback automatique via transaction si échec. Idempotence garantie par lock optimiste. Estimation 2h implémentation.

**Décision :** Validé. Architecture simplifiée adoptée pour F1.

---

## Feature 2 : Application de promotions (Simplifiée)

### Cycle Bleu - Implémentation Simplifiée

#### F2.IMPL - Architecture simplifiée application promotions

**Prompt :**
Détaille l'application des promotions en pseudo-code simplifié. Focus sur : tags EXCLUSIVE/STACKABLE/AUTO, matrice compatibilité, ordre déterministe, idempotence calcul.

**Résumé de la réponse :**
Architecture simplifiée avec if/else séquentiel remplaçant Chain of Responsibility. Modèle : table promotions avec tag enum, table promotion_usage pour limites, matrice compatibilité hardcodée (6 règles constantes). Algorithme : (1) récupération promos AUTO actives, (2) validation codes manuels + limites usage, (3) validation matrice (max 1 EXCLUSIVE, incompatible avec autres), (4) tri déterministe AUTO→STACKABLE→EXCLUSIVE, (5) calcul réductions séquentielles avec protection montant >= 0, (6) two-phase validate/apply pour idempotence. Estimation 3h implémentation.

**Décision :** Validé. Architecture simplifiée adoptée pour F2.

---

## Feature 3 : Réservation temporaire du stock pendant le paiement (Simplifiée)

### Cycle Bleu - Implémentation Simplifiée

#### F3.IMPL - Architecture simplifiée réservation stock

**Prompt :**
Détaille la réservation temporaire de stock en pseudo-code simplifié. Focus sur : atomicité réservation, durée adaptative, libération automatique, idempotence.

**Résumé de la réponse :**
Architecture simplifiée avec transaction DB + job setInterval en mémoire remplaçant Redis TTL. Modèle : table stock_reservations avec UNIQUE(order_id) pour idempotence, champs stock_available/reserved dans products. Algorithme réservation : (1) check idempotence via order_id, (2) lock pessimiste FOR UPDATE + validation stock, (3) décrément stock_available + increment stock_reserved atomique, (4) insert réservation avec expires_at. Algorithme libération : (1) SELECT réservations actives, (2) increment stock_available + décrément reserved, (3) update status RELEASED. Job : setInterval 30s scan expires_at <= NOW() et appel releaseStock avec idempotence. Estimation 2h implémentation.

**Décision :** Validé. Architecture simplifiée adoptée pour F3.

---

## Feature 4 : Gestion des transitions d'état de commande (Simplifiée)

### Cycle Bleu - Implémentation Simplifiée

#### F4.IMPL - Architecture simplifiée machine à états

**Prompt :**
Détaille la gestion des transitions d'état en pseudo-code simplifié. Focus sur : graphe transitions autorisé, validation préconditions, side effects critiques, atomicité, audit log.

**Résumé de la réponse :**
Architecture simplifiée avec enum + Map constante remplaçant State Pattern OO. Modèle : OrderStatus enum (CART, CHECKOUT, PAID, PREPARING, SHIPPED, DELIVERED, CANCELLED), TRANSITIONS_MAP hardcodée (ex: CHECKOUT→[PAID, CANCELLED]), table order_state_audit pour traçabilité. Algorithme : (1) SELECT order FOR UPDATE avec lock, (2) validation transition autorisée via Map, (3) validation préconditions selon toState (PAID exige payment_id, PREPARING exige stock_reserved), (4) side effects synchrones critiques in-transaction (libération stock si CANCELLED), (5) UPDATE status avec lock optimiste version, (6) INSERT audit log, (7) side effects async non-critiques après commit (emails). Job timeout : setInterval 60s pour CHECKOUT 15min→CANCELLED, PREPARING 48h→alerte ops. Estimation 2h implémentation.

**Décision :** Validé. Architecture simplifiée adoptée pour F4.

---

## Feature 5 : Libération du stock si paiement échoue ou expire (Simplifiée)

### Cycle Bleu - Implémentation Simplifiée

#### F5.IMPL - Architecture simplifiée libération stock échec paiement

**Prompt :**
Détaille la libération de stock en cas d'échec/expiration paiement en pseudo-code simplifié. Focus sur : classification erreur définitive/temporaire, libération conditionnelle, retry window, idempotence.

**Résumé de la réponse :**
Architecture simplifiée avec callback synchrone remplaçant webhooks externes. Modèle : table payment_attempts avec status/error_type, ERROR_CLASSIFICATION map hardcodée (DEFINITIVE: insufficient_funds/card_declined, TEMPORAIRE: timeout/network_error). Algorithme : (1) validation ordre CHECKOUT + expiration, (2) tentative paiement via gateway synchrone, (3) si SUCCESS → transition PAID, (4) si FAILED → classification erreur puis libération immédiate si DEFINITIVE ou différée (expiration naturelle F3) si TEMPORAIRE, (5) retry autorisé <5min après échec temporaire. Job backup : réutilise job timeout F4 pour détecter CHECKOUT expirés. Estimation 1h implémentation.

**Décision :** Validé. Architecture simplifiée adoptée pour F5.

---

## Feature 6 : Relance des paniers abandonnés après 24h (Simplifiée)

### Cycle Bleu - Implémentation Simplifiée

#### F6.IMPL - Architecture simplifiée relance paniers abandonnés

**Prompt :**
Détaille la relance des paniers abandonnés en pseudo-code simplifié. Focus sur : délai 24h, unicité relance, opt-out RGPD, token sécurisé, tracking conversion.

**Résumé de la réponse :**
Architecture simplifiée avec setInterval 5min remplaçant job cron 1h. Modèle : champs recovery_email_sent/recovery_token/recovery_token_expires_at dans table orders, table cart_recovery_log pour tracking. Algorithme : (1) SELECT paniers CART créés entre 23-25h (tolérance ±1h) avec marketing_consent=TRUE et recovery_email_sent=FALSE LIMIT 100, (2) UPDATE flag + génération token UUID simple avec expiration 7j (idempotence via WHERE condition), (3) envoi email non-bloquant après commit (échec email n'annule pas flag évite spam), (4) endpoint recovery validation token + restauration panier session + vérification stock disponible optionnelle, (5) tracking clicked_at et converted_at. Job : setInterval 5min scan batch 100. Estimation 2h implémentation.

**Décision :** Validé. Architecture simplifiée adoptée pour F6.

---

---

# Phase Validation Architecture - Analyse Globale

## Analyse Cohérence et Compatibilité

### ARCH.P1 - Vérification architecture globale et incompatibilités

**Prompt :**
Avant de passer à la phase bleue, montre moi l'architecture du projet et ses composants principaux. Il y a t'il des incompatibilités de logique entre les différentes solutions validées? Pour chaque composant, liste moi ses responsabilités et les invariants codifiés.

**Réponse détaillée :**

## Architecture Globale du Projet

```
┌─────────────────────────────────────────────────────────────────┐
│                         API Layer (Express/FastAPI)              │
│  POST /cart/checkout  │ POST /payment  │ GET /cart/recover/:token│
└────────────┬──────────────────┬──────────────────┬──────────────┘
             │                  │                  │
┌────────────▼──────────────────▼──────────────────▼──────────────┐
│                      Service Layer                               │
│                                                                   │
│  ┌──────────────┐  ┌──────────────┐  ┌──────────────┐          │
│  │OrderService  │  │PaymentService│  │CartRecovery  │          │
│  │    (F1)      │  │    (F5)      │  │Service (F6)  │          │
│  └──────┬───────┘  └──────┬───────┘  └──────────────┘          │
│         │                  │                                      │
│  ┌──────▼───────┐  ┌──────▼───────┐  ┌──────────────┐          │
│  │Promotion     │  │StockReserv   │  │OrderState    │          │
│  │Service (F2)  │  │Service (F3)  │  │Machine (F4)  │          │
│  └──────────────┘  └──────────────┘  └──────────────┘          │
└───────────────────────────────┬─────────────────────────────────┘
                                │
┌───────────────────────────────▼─────────────────────────────────┐
│                      Data Layer (PostgreSQL)                     │
│                                                                   │
│  orders  │ products │ stock_reservations │ promotions           │
│  payment_attempts │ order_state_audit │ cart_recovery_log       │
└───────────────────────────────┬─────────────────────────────────┘
                                │
┌───────────────────────────────▼─────────────────────────────────┐
│                      Background Jobs (setInterval)               │
│                                                                   │
│  ReservationExpirationJob (30s) │ StateTimeoutJob (60s)         │
│  CartReminderJob (5min)                                          │
└─────────────────────────────────────────────────────────────────┘
```

## Composants Principaux et Responsabilités

### 1. OrderService (F1)

**Responsabilités :** Créer commande depuis panier (CART → CHECKOUT), orchestrer snapshot prix + promotions + réservation stock, garantir atomicité, gérer idempotence anti-double-checkout.

**Invariants Codifiés :**

- Snapshot immutable : Prix figés dans items_snapshot JSON au checkout
- Atomicité panier-réservation : Transaction DB garantit tout-ou-rien
- Validation pré-checkout : Vérification stock disponible avant transition
- Idempotence : Lock optimiste via version + WHERE status = 'CART'
- 1 panier actif/user : UNIQUE(user_id, status) WHERE status = 'CART'

**Dépendances :** → PromotionService, StockReservationService, OrderStateMachine

### 2. PromotionService (F2)

**Responsabilités :** Récupérer promos AUTO, valider codes manuels + limites usage, valider matrice compatibilité EXCLUSIVE/STACKABLE/AUTO, calculer réductions ordre déterministe, garantir montant >= 0.

**Invariants Codifiés :**

- Exclusivité mutuelle : Max 1 promo EXCLUSIVE, incompatible avec autres
- Ordre déterministe : AUTO → STACKABLE → EXCLUSIVE toujours
- Montant >= 0 : Protection contre total négatif
- Limites usage : Vérification count < usage_limit_per_user
- Idempotence calcul : Même input = même output (fonction pure)
- Traçabilité : Retour applied_promos[] avec code/type/tag/amount

**Dépendances :** Aucune (service isolé)

### 3. StockReservationService (F3)

**Responsabilités :** Réserver stock atomiquement (décrément stock_available, increment stock_reserved), créer réservation avec expires_at, libérer stock (inverse), garantir idempotence réservation/libération, garantir cohérence stock_available + stock_reserved = stock_total.

**Invariants Codifiés :**

- Stock jamais négatif : CHECK constraint stock_available >= 0
- Cohérence stock : stock_available + stock_reserved = stock_total toujours
- Atomicité réservation : Transaction DB + lock FOR UPDATE
- Idempotence réservation : UNIQUE(order_id) dans stock_reservations
- Idempotence libération : WHERE status = 'ACTIVE' + retour success si vide
- Traçabilité : reserved_at, expires_at, status (ACTIVE/RELEASED/EXPIRED)

**Dépendances :** Appelé par OrderService, PaymentService, ReservationExpirationJob

### 4. OrderStateMachine (F4)

**Responsabilités :** Valider transitions via TRANSITIONS_MAP, valider préconditions par état, exécuter side effects critiques synchrones (libération stock si CANCELLED), mettre à jour état avec lock optimiste, créer audit log immutable, déclencher side effects non-critiques async (emails).

**Invariants Codifiés :**

- Graphe déterministe : Transitions hardcodées dans TRANSITIONS_MAP
- Validation préconditions : État cible exige données requises
- Atomicité transition + side effects : Transaction DB
- Lock optimiste : WHERE status = currentState AND version = X
- Traçabilité complète : Audit log (from_state, to_state, timestamp, actor, reason)
- États terminaux immutables : DELIVERED/CANCELLED sans transitions sortantes

**Dépendances :** → StockReservationService.releaseStock() si CANCELLED

### 5. PaymentService (F5)

**Responsabilités :** Valider ordre CHECKOUT + expiration, appeler gateway paiement synchrone, classifier erreur DEFINITIVE/TEMPORAIRE, libérer stock si échec définitif, transition état (CHECKOUT → PAID ou CANCELLED), gérer retry window < 5min.

**Invariants Codifiés :**

- Classification erreur déterministe : Map hardcodée ERROR_CLASSIFICATION
- Libération conditionnelle : Immédiate si DEFINITIVE, différée si TEMPORAIRE
- Idempotence tentative : UNIQUE(order_id) dans payment_attempts
- Atomicité état + side effects : Transaction DB
- Retry window 5min : Validation délai < INTERVAL '5 minutes'
- Traçabilité : payment_attempts avec status/error_code/error_type/timestamps

**Dépendances :** → StockReservationService, OrderStateMachine

### 6. CartRecoveryService (F6)

**Responsabilités :** Détecter paniers abandonnés 23-25h, vérifier opt-in marketing_consent, générer token UUID + expiration 7j, envoyer email non-bloquant, garantir unicité relance, valider token recovery + restaurer panier, tracker conversions.

**Invariants Codifiés :**

- Délai 24h ±1h : Fenêtre 23-25h pour tolérance
- Unicité relance : Flag recovery_email_sent + WHERE condition
- Opt-out RGPD : Filtre marketing_consent = TRUE
- Token expiration : Validation recovery_token_expires_at > NOW()
- Non-bloquant : Échec email n'annule pas flag (évite spam retry)
- Traçabilité : cart_recovery_log avec email_sent_at/clicked_at/converted_at

**Dépendances :** Aucune (service isolé)

## Background Jobs

**ReservationExpirationJob (30s) :** Scanner stock_reservations expirées, appeler releaseStock(), batch LIMIT 100. Invariant : Délai libération ≤ 2min.

**StateTimeoutJob (60s) :** Scanner orders CHECKOUT > 15min → transition CANCELLED, scanner orders PREPARING > 48h → alerte ops. Invariants : Timeout CHECKOUT 15min auto, alerte PREPARING 48h.

**CartReminderJob (5min) :** Scanner paniers abandonnés 23-25h, appeler sendReminders(), batch LIMIT 100. Invariant : Précision ±1h.

## Analyse des Incompatibilités

**✅ COMPATIBILITÉS VÉRIFIÉES :**

1. F1 → F2 → F3 ordre cohérent : OrderService appelle d'abord PromotionService puis StockReservationService, ordre séquentiel garanti
2. F3 ↔ F5 libération stock : F3 libère via job expiration, F5 via échec paiement, idempotence garantie releaseStock() check status = 'ACTIVE'
3. F4 ↔ F1, F5 machine états partagée : Transitions disjointes (F1: CART→CHECKOUT, F5: CHECKOUT→PAID/CANCELLED)
4. Jobs multiples : 3 jobs indépendants (30s, 60s, 5min), pas de race condition, entités différentes

**⚠️ POINTS D'ATTENTION (Gérés) :**

1. Race condition expiration job F3 vs paiement F5 : Solution = PaymentService valide d'abord expiration + transaction atomique
2. Double libération StateTimeoutJob F4 vs ReservationExpirationJob F3 : Solution = Idempotence releaseStock() retourne success si déjà libéré
3. Snapshot prix vs promotions actuelles : Solution = F1 snapshot promotions au moment checkout, pas ajout panier
4. Stock réservé mais promo changée : Solution = F2 valide active=TRUE AND expires_at>NOW() au checkout

## Flux de Données Principaux

**Flux 1 Checkout Success :** User → OrderService (appel PromotionService + StockReservationService + OrderStateMachine CART→CHECKOUT) → PaymentService (gateway SUCCESS + OrderStateMachine CHECKOUT→PAID)

**Flux 2 Checkout échec paiement définitif :** User → OrderService (CHECKOUT, stock réservé) → PaymentService (gateway FAILED insufficient_funds → classify DEFINITIVE → releaseStock() + transition CANCELLED)

**Flux 3 Checkout expiration timeout :** User → OrderService (CHECKOUT, expires_at +10min) → 10min passent → ReservationExpirationJob (releaseStock) → StateTimeoutJob (transition CANCELLED)

**Flux 4 Panier abandonné recovery :** User → Ajoute items (CART) → 24h passent → CartReminderJob (UPDATE recovery_email_sent=TRUE, send email) → User clique lien → recoverCart(token) → Restore session

**Conclusion :** ✅ Pas d'incompatibilité majeure, tous invariants critiques préservés, idempotence garantie partout, race conditions gérées, architecture cohérente et implémentable en 12h.

**Décision :** Validé. Architecture globale cohérente, prête pour implémentation. Passage au Cycle Bleu (implémentation feature par feature).

---

---

# Cycle Bleu - Implémentation

> Cette phase couvre l'implémentation concrète des 6 features définies et validées dans les phases précédentes. Chaque étape est loggée : prompt, résumé réponse (quelques phrases), décision.

---

## Phase Initialisation - Setup Projet

### INIT.P1 - Initialisation structure projet de base

**Prompt :**
On va passer au cycle bleu de chaque feature pas à pas. Pour le moment, procède juste à l'initialisation du projet sans implémenter la moindre feature, je veux juste la base du projet (init express avec prisma et react).

**Résumé de la réponse :**
Structure complète créée avec 3 dossiers principaux : (1) **server/** - Backend Node.js + Express avec package.json (express, prisma, dotenv, cors, nodemon), fichiers config (.env.example, .gitignore), prisma/schema.prisma vide (commenté pour ajout progressif models), src/index.js (entry point Express avec health check + error handler + logging), src/prisma.js (PrismaClient singleton), README.md avec instructions setup ; (2) **client/** - Frontend React + Vite avec package.json (react, axios, vite), vite.config.js (proxy /api vers localhost:3000), index.html, src/main.jsx, src/App.jsx (test connexion server + liste features), fichiers CSS (gradient purple, cards glassmorphism), src/services/api.js (axios instance + interceptors + méthodes à ajouter), README.md avec instructions ; (3) **Racine/** - README.md global (architecture, stack, installation server + client, documentation, structure projet, invariants critiques). Aucune feature implémentée, seulement le squelette prêt pour développement progressif.

**Décision :** Validé. Structure de base prête.

---

### INIT.P2 - Création schéma Prisma complet

**Prompt :**
Commence par mettre en place le schéma prisma. (Avec ajout règle dans CLAUDE.md : tous les commentaires en anglais, puis modification schéma pour respecter cette règle)

**Résumé de la réponse :**
Schéma Prisma complet créé avec 6 enums (OrderStatus, ReservationStatus, PromotionType, PromotionTag, PaymentStatus, PaymentErrorType) et 9 models (User, Order, Product, StockReservation, Promotion, PromotionUsage, PaymentAttempt, OrderStateAudit, CartRecoveryLog). Chaque model documenté avec invariants codifiés (INV-F1-1, INV-F3-1, etc.), relations Prisma, contraintes UNIQUE pour idempotence, indexes pour performance (status, expiresAt, createdAt), lock optimiste via version fields. Tous commentaires en anglais (règle ajoutée dans CLAUDE.md section Conventions de Code). Schema couvre toutes les 6 features : Order/Product pour F1, Promotion pour F2, StockReservation pour F3, OrderStateAudit pour F4, PaymentAttempt pour F5, CartRecoveryLog pour F6.

**Décision :**
**Décision :** Validé. Schéma Prisma complet prêt pour génération client et migration.

---

### IMPL-F4.P1 - Implémentation OrderStateMachine service + StateTimeoutJob + Tests

**Prompt :**
Passe à l'implémentation du service OrderStateMachine (F4). Ajoute des tests unitaires pour valider toutes les conditions de réussite de la feature (règle ajoutée dans CLAUDE.md).

**Résumé de la réponse :**
Implémentation complète de F4 avec architecture simplifiée enum + Map + tests unitaires couvrant 100% des critères de réussite :

**1. Service orderStateMachine.js** (253 lignes) :

- TRANSITIONS_MAP constante hardcodée (CART→[CHECKOUT, CANCELLED], CHECKOUT→[PAID, CANCELLED], PAID→[PREPARING, CANCELLED], PREPARING→[SHIPPED, CANCELLED], SHIPPED→[DELIVERED], terminal states [])
- STATE_TIMEOUTS config (CHECKOUT 15min, PREPARING 48h)
- transitionOrderState() function principale avec algorithme 7 étapes :
  1. Lock order (transaction Prisma avec isolation Serializable)
  2. Idempotence check (si déjà dans état cible, retourne succès)
  3. Validation transition autorisée via TRANSITIONS_MAP
  4. Validation préconditions (PAID exige paymentId, PREPARING exige stock_reserved actif)
  5. Side effects critiques synchrones in-transaction (CANCELLED libère stock, PAID confirme réservations)
  6. UPDATE status avec lock optimiste version + checkoutAt timestamp si CHECKOUT
  7. INSERT audit log (orderId/fromState/toState/reason/actor/timestamp)
- Side effects non-critiques async après commit (emails, webhooks) avec catch silencieux
- Helpers : isTransitionAllowed(), validatePreconditions(), executeCriticalSideEffects(), executeNonCriticalSideEffects()
- Commentaires en anglais selon CLAUDE.md

**2. Job stateTimeoutJob.js** (152 lignes) :

- setInterval 60s polling ordres expirés
- processExpiredCheckouts() : CHECKOUT > 15min → auto-transition CANCELLED via OrderStateMachine
- alertExpiredPreparing() : PREPARING > 48h → log alerte ops (pas de transition auto)
- startJob(intervalMs) / stopJob() pour lifecycle management
- Intégré dans index.js au démarrage serveur avec graceful shutdown (SIGINT)
- Gestion erreurs continue (une erreur n'arrête pas le traitement des autres ordres)

**3. Tests unitaires** (33 tests, 100% pass, 96.77% coverage) :

- **orderStateMachine.test.js** (29 tests) :
  - Valid Transitions (3 tests) : CART→CHECKOUT, CHECKOUT→PAID, CHECKOUT→CANCELLED
  - Invalid Transitions (3 tests) : CART→PAID rejeté, terminal states rejettés
  - Preconditions (2 tests) : PAID sans paymentId rejeté, PREPARING sans reservations rejeté
  - Idempotence (1 test) : transition vers état actuel retourne succès
  - Optimistic Lock (1 test) : concurrent modification détectée (version mismatch)
  - Audit Log (1 test) : audit log créé pour toute transition
  - Critical Side Effects (2 tests) : libération stock sur CANCELLED, confirmation sur PAID
  - Error Handling (1 test) : ORDER_NOT_FOUND error
  - TRANSITIONS_MAP Structure (4 tests) : validation graphe hardcodé
  - isTransitionAllowed Helper (3 tests) : validation fonction helper
  - Mock Prisma avec jest.mock pour isolation

- **stateTimeoutJob.test.js** (4 tests lifecycle ajoutés) :
  - Expired CHECKOUT Orders (3 tests) : transition auto vers CANCELLED, pas de faux positifs, continue si erreur
  - Expired PREPARING Orders (2 tests) : alert ops sans transition, pas de faux positifs
  - Error Handling (2 tests) : database errors, transition errors
  - Job Execution Flow (1 test) : exécute CHECKOUT + PREPARING en un run
  - Job Lifecycle (4 tests) : startJob default interval, double start warning, stopJob, custom interval
  - Utilisation jest.useFakeTimers() pour tester setInterval

**4. Configuration Jest** :

- jest.config.js créé : testEnvironment node, coverageThreshold 80%, testMatch **/**tests**/**/\*.test.js
- package.json mis à jour : scripts test/test:watch/test:coverage, devDeps jest + supertest
- CLAUDE.md mis à jour : Stack technique (Tests: Jest + supertest), Package Manager: pnpm, RÈGLE 5 : Tests unitaires obligatoires avant validation feature

**5. Patterns respectés** :

- INV-F4-1 : Transitions autorisées définies dans TRANSITIONS_MAP ✅
- INV-F4-2 : Préconditions validées (PAID/PREPARING/SHIPPED) ✅
- INV-F4-3 : Audit log créé pour TOUTE transition ✅
- INV-GLOBAL-3 : Atomicité transaction Prisma ✅
- INV-GLOBAL-4 : Idempotence garantie (check état actuel + updateMany WHERE) ✅
- INV-GLOBAL-5 : Traçabilité complète (OrderStateAudit) ✅

**6. Coverage Report** :

```
-----------------------|---------|----------|---------|---------|-------------------
File                   | % Stmts | % Branch | % Funcs | % Lines | Uncovered Line #s
-----------------------|---------|----------|---------|---------|-------------------
All files              |   96.77 |    91.17 |     100 |   96.77 |
 jobs                  |     100 |      100 |     100 |     100 |
  stateTimeoutJob.js   |     100 |      100 |     100 |     100 |
 services              |   94.11 |       88 |     100 |   94.11 |
  orderStateMachine.js |   94.11 |       88 |     100 |   94.11 | 66-70,145
-----------------------|---------|----------|---------|---------|-------------------
Test Suites: 2 passed
Tests:       33 passed, 33 total
```

**Décision :** ✅ Validé. F4 implémenté avec 33 tests unitaires passants et 96.77% de couverture. Tous les critères de réussite respectés. Prochaine étape : F2 (PromotionService).

---

### IMPL-F2.P1 - Implémentation PromotionService + Tests

**Prompt :**
Passe à l'implémentation de PromotionService (F2).

**Résumé de la réponse :**
Implémentation complète de F2 avec architecture simplifiée if/else séquentiel + tests unitaires couvrant 100% des critères de réussite :

**1. Service promotionService.js** (302 lignes) :
- PROMOTION_ORDER constante hardcodée (AUTO: 1, STACKABLE: 2, EXCLUSIVE: 3)
- Matrice compatibilité (6 règles) : max 1 EXCLUSIVE, EXCLUSIVE incompatible avec autres, STACKABLE+AUTO combinables
- validateAndApplyPromotions() function principale avec two-phase validate/apply :
  **Phase 1 VALIDATE :**
  1. Récupération AUTO promotions actives non expirées
  2. Validation codes manuels (existence, active, expiration, limite usage)
  3. Validation matrice compatibilité
  4. Tri déterministe AUTO→STACKABLE→EXCLUSIVE
  **Phase 2 APPLY :**
  5. Calcul réductions séquentielles (PERCENTAGE/FIXED_AMOUNT/FREE_SHIPPING)
  6. Protection montant final >= 0 (Math.max(0, amount - discount))
  7. Stop application si montant atteint 0
- incrementPromotionUsage() : upsert PromotionUsage.count avec increment atomique
- getUserPromotionUsage() : stats usage par user (count/limit/remaining)
- Helpers exportés pour tests : validatePromotionCompatibility(), sortPromotionsByOrder(), calculateSingleDiscount()
- Commentaires en anglais selon CLAUDE.md

**2. Tests unitaires** (33 tests, 100% pass, 98.59% coverage) :
- **Promotion Compatibility Matrix** (7 tests) :
  - Multiple STACKABLE autorisés ✅
  - AUTO + STACKABLE combinables ✅
  - Multiple AUTO autorisés ✅
  - Single EXCLUSIVE autorisé ✅
  - Multiple EXCLUSIVE rejetés ❌
  - EXCLUSIVE + STACKABLE rejetés ❌
  - EXCLUSIVE + AUTO rejetés ❌

- **Deterministic Ordering** (3 tests) :
  - Sort order AUTO→STACKABLE→EXCLUSIVE ✅
  - Order stability pour même tag ✅
  - PROMOTION_ORDER constants vérifiées ✅

- **Discount Calculation** (4 tests) :
  - PERCENTAGE calcul exact (10% de 100 = 10) ✅
  - FIXED_AMOUNT calcul exact ✅
  - FREE_SHIPPING retourne 0 ✅
  - Unknown type throw error ❌

- **Final Amount Protection** (2 tests) :
  - Protection montant < 0 (100% discount → 0) ✅
  - Protection total discounts > subtotal → 0 ✅

- **Sequential Application** (2 tests) :
  - Application séquentielle ordre correct (AUTO 10% puis STACK 20 fixed) ✅
  - EXCLUSIVE seul appliqué correctement ✅

- **Usage Limit Validation** (2 tests) :
  - Rejet si limite dépassée (count >= usageLimitPerUser) ❌
  - Autorisation si dans limite (count < usageLimitPerUser) ✅

- **Validation Errors** (5 tests) :
  - Subtotal = 0 rejeté ❌
  - Subtotal < 0 rejeté ❌
  - Code non existant → PROMOTION_NOT_FOUND ❌
  - Inactive promotion → PROMOTION_INACTIVE ❌
  - Expired promotion → PROMOTION_EXPIRED ❌

- **Idempotence** (1 test) :
  - N appels identiques = même résultat (pure calculation) ✅

- **Increment Usage** (3 tests) :
  - Create usage première utilisation ✅
  - Increment usage existant ✅
  - Multiple promotions incrémentées ✅

- **Get User Usage** (2 tests) :
  - Stats usage retournées (code/count/limit/remaining) ✅
  - Empty array si pas d'usage ✅

- **Edge Cases** (2 tests) :
  - Empty codes array → pas de discount ✅
  - Stop application si montant atteint 0 ✅

**3. Patterns respectés** :
- INV-F2-1 : Max 1 promo EXCLUSIVE, incompatible avec autres ✅
- INV-F2-2 : Ordre déterministe AUTO→STACKABLE→EXCLUSIVE ✅
- INV-F2-3 : Montant final >= 0 (protection Math.max) ✅
- INV-GLOBAL-4 : Idempotence garantie (two-phase validate/apply pure) ✅
- INV-GLOBAL-5 : Traçabilité complète (PromotionUsage tracking) ✅

**4. Coverage Report** :
```
-----------------------|---------|----------|---------|---------|-------------------
File                   | % Stmts | % Branch | % Funcs | % Lines | Uncovered Line #s 
-----------------------|---------|----------|---------|---------|-------------------
All files              |   97.56 |    93.84 |     100 |    97.5 |                   
 jobs                  |     100 |      100 |     100 |     100 |                   
  stateTimeoutJob.js   |     100 |      100 |     100 |     100 |                   
 services              |   96.72 |    92.85 |     100 |   96.61 |                   
  orderStateMachine.js |   94.11 |       88 |     100 |   94.11 | 68-72,153         
  promotionService.js  |   98.59 |    96.77 |     100 |    98.5 | 227               
-----------------------|---------|----------|---------|---------|-------------------
Test Suites: 3 passed
Tests:       66 passed, 66 total
```

**Décision :** ✅ Validé. F2 implémenté avec 33 tests unitaires passants et 98.59% de couverture. Tous les critères de réussite respectés. Prochaine étape : F3 (StockReservationService).

