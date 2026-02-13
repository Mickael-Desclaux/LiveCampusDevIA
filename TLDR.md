# TLDR: Développement avec IA en suivant la méthode Wardley map

Le but de ce fichier est de recencer brièvement mon utilisation de l'IA sur ce projet, la méthodologie que j'ai expérimenté ainsi que les difficultés rencontrées.

## Approche et méthodologie

**Avant de commencer un cycle rouge dédié pour chaque feature, j'ai expérimenté une approche un peu différente qui consiste à faire un cycle rouge global.**

Mon idée était de donner un contexte global à l'IA pour qu'elle puisse être plus précise et efficace sur les réponses qu'elle me donnerait lors du cycle rouge d'une feature dédiée, et faire en sorte que chaque solution proposée sur ces cycles soient compatibles avec les autres.

J'ai aussi décidé de terminer le cycle rouge de chaque feature avant de commencer le cycle bleu, afin de valider l'architecture du projet et m'assurer que toutes les solutions sont compatibles et permettent de garder une logique cohérente sur toute la codebase.

## Wardley map: Cycle rouge

Au cours de ce cycle et de ceux dédiés à chaque feature, j'ai un peu perdu de vue le temps qu'il me restait de disponible pour implémenter les solutions dans un cycle bleu et je me suis rendu compte que je partais sur une solution trop complexe, qui était par conséquent trop longue à mettre en place.

Pour corriger cela, je suis passé par une phase de simplification de la logique des différents service de chaque feature, que j'ai validé un à un à l'aide de l'IA, en lui demandant de me fournir du pseudo code pour chaque solution. La phase de simplification est documentée à partir de la ligne 785 de `prompts.md`

### Difficultés rencontrées et remarques sur mon application de la Wardley map

**Concernant le cycle rouge, j'ai l'impression d'avoir rencontré pas mal de difficultées lorsque je demandais à l'IA de trouver des failles potentielles à la solution qui avait été pré-approuvée.**

Peut-être que mes prompts n'était pas assez précis sur ce sujet, car elle me retournait constamment de nouvelles failles potentielles dont je souhaitais me prémunir (même des failles avec de très faibles chances de survenir), ce qui m'a conduit a accepté des solutions toujours plus complexes.

Je pense que ma phase de simplification a été un peu trop rapide, j'aurais probablement dû découper chaque simplification en plusieurs prompts afin d'avoir une vision plus large des possibilités, mais la première version que l'IA me proposait pour chaque feature me semblait valide et cohérente.

## Wardley map: Cycle bleu

### Implémentation de chaque service

**Avant de commencer le cycle bleu des différents services, j'ai généré un fichier claude.md qui m'a permis de définir toutes les règles de code et toutes les conventions que je souhaitais appliquer** (par exemple, l'utilisation de pnpm comme package manager ou l'utilisation de l'anglais pour les commentaires ajoutés dans le code).

J'ai pu implémenter les différents services sans rencontrer de bugs particulier, je n'ai pas eu besoin de beaucoup de prompts pour corriger l'IA (j'ai essayé de les documenter dans le fichier prompts.md, mais je pense en avoir oublié quelques uns).

Je me suis rendu compte à l'implémentation du deuxième service que le code pourrait être plus clean avec un peu de refactor (par exemple en déplaçant les fonctions utilitaires ou dupliquées entre les services dans des fichier **utils**), mais j'ai décidé de générer dans un premier temps tout les services avant de commencer cette étape. Cependant, je n'ai pas pu la mettre en place car je n'avait plus vraiment de temps et que j'avait atteint ma limite de tokens.

Dans le cas où j'aurais eu le temps et les tokens suffisants, voici le prompt que j'aurai envoyé:

`"Je veux refactor les services que tu as généré en appliquant les règles suivantes:`

- `Créer un dossier par service, avec un fichier "const.js", un fichier "utils" et le service en lui-même`
- `Déplacer toutes les constantes globales incluses dans le service dans le fichier "const.js"`
- `Déplacer les fonctions utilitaires dans le dossier "utils" dédié`
- `Si deux services possèdent une fonction utilitaire identique qui pourrait être mutualisé, l'extraire du service pour la déplacer dans un fichier "misc" à la racine du dossier "services"`

`On ne valide le refactor d'un service qu'après avoir respecté ces règles et que tous les tests restent valides pour la fonctionnalité.`

`Commençons par le fichier orderService (F1)"`

PS: J'ai aussi créé un dossier `client` avec une app react à l'intérieur, je voulais faire une partie front pour faire une démo de l'application mais je n'en ai pas eu le temps non plus.
