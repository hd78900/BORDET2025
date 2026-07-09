# Description métier — Enrichissement de la base de connaissances & Reporting

Ce document décrit, du point de vue **métier**, deux fonctions clés du back-office de l'assistant Bordet : l'**enrichissement de la base de connaissances** (ce qui nourrit le chatbot) et le **reporting** (ce qui mesure son usage). Il s'adresse à un lecteur non technique (direction, équipe commerciale/marketing).

---

## 1. Enrichissement de la base de connaissances

### Enjeu métier

L'assistant répond aux clients **uniquement** à partir d'une base de connaissances (fiches produits, guides, documentation). Sa pertinence dépend donc entièrement de la **fraîcheur** et de la **qualité** de cette base. La fonction d'enrichissement permet aux équipes Bordet de **maintenir et compléter cette base en toute autonomie**, sans intervention technique ni développeur : un nouveau produit, un guide, une FAQ, une information de service après-vente peuvent être ajoutés en quelques minutes.

### Trois façons d'ajouter du contenu

| Voie | Usage métier |
|---|---|
| **Coller du texte** | Rédiger ou coller directement une note, une FAQ, une réponse type, un argumentaire. |
| **Importer un PDF** | Verser une documentation existante (notice, fiche technique, catalogue fournisseur, mode d'emploi). Le texte est extrait automatiquement. |
| **Récupérer une page bordet.fr** | Reprendre une fiche produit ou un article de blog déjà en ligne : le contenu et les informations (prix, référence, marque) sont récupérés automatiquement. |

### Une relecture avant publication

Quelle que soit la voie choisie, le contenu **n'est jamais publié directement**. Il est d'abord **nettoyé automatiquement** (mise en forme, suppression des éléments parasites d'une page web : menus, en-têtes, coordonnées…) puis présenté à l'utilisateur pour **relecture et correction**. Rien n'entre dans la base tant que l'utilisateur n'a pas validé. Ce garde-fou garantit qu'aucun contenu approximatif ne se retrouve dans les réponses aux clients.

### Des contrôles qualité automatiques

À la validation, le système protège la base contre les erreurs qui dégraderaient les réponses :

- **Anti-doublon** : refuse un contenu déjà présent (même reformulé), pour ne pas diluer les réponses.
- **Qualité du texte** : bloque un contenu vide de sens ou au texte corrompu.
- **Cohérence catalogue** : alerte si un prix est saisi hors d'une fiche produit (risque de contradiction future) ou si un lien est mort (risque de renvoyer le client vers une page inexistante).

L'utilisateur reste maître : les alertes demandent une **confirmation**, elles ne bloquent pas arbitrairement.

### Gestion du contenu ajouté

Un onglet dédié liste tout ce qui a été ajouté depuis l'interface. Chaque élément peut être **relu, modifié ou supprimé** à tout moment — la base reste sous contrôle.

### Deux niveaux de visibilité

Chaque contenu est publié à l'un des deux niveaux :

- **Public** : utilisable par l'assistant dans ses réponses aux **clients** (site, widget).
- **Marketing / interne** : visible **uniquement** en mode marketing par un administrateur (documents internes, informations commerciales sensibles), **jamais exposé aux clients**.

### Bénéfices métier

- **Autonomie** : les équipes Bordet enrichissent l'assistant sans dépendre d'un prestataire technique.
- **Fraîcheur** : le discours de l'assistant suit l'évolution du catalogue et des offres.
- **Maîtrise de la qualité** : relecture obligatoire + contrôles automatiques = pas de mauvaise information servie au client.
- **Sécurité de l'information** : séparation claire entre ce qui est public et ce qui reste interne.

---

## 2. Reporting (analytics des conversations)

### Enjeu métier

Chaque conversation avec l'assistant est une **remontée directe de la voix du client**. Le reporting transforme ces échanges en **informations exploitables par la direction** : que cherchent les visiteurs, l'assistant y répond-il, quels produits suscitent l'intérêt, où sont les manques ? C'est un outil d'aide à la décision commerciale et éditoriale.

> Auparavant, aucune conversation du widget public n'était conservée : ces échanges — et l'information qu'ils contiennent — étaient **perdus**. Le reporting capte désormais **100 % des conversations**, y compris celles des visiteurs anonymes.

### Ce que le tableau de bord donne à voir

**Indicateurs de pilotage (sur 7 jours)**
- Nombre de conversations et volume d'échanges — l'activité réelle de l'assistant.
- **Taux « sans réponse »** — la part des questions auxquelles l'assistant n'a pas su répondre : l'indicateur de couverture de la base.
- **Coût estimé** — la dépense associée à l'IA, pour maîtriser le budget.
- Temps de réponse médian — la qualité de service perçue.
- Produit le plus recommandé et nombre de conversations à **intention d'achat**.

**Analyse thématique (sur 30 jours)**
- Répartition des conversations par **thème métier** (affûtage, tournage, scies, essences de bois, prix & livraison, SAV…) : où se porte la demande.
- Courbe d'activité dans le temps.

**Questions sans réponse — le cœur de la valeur**
La liste des questions auxquelles l'assistant n'a pas su répondre, **classées par fréquence**. Chacune peut être transformée en contenu **d'un clic** (elle ouvre la base de connaissances pré-remplie). C'est la **boucle d'amélioration continue** : chaque manque détecté devient une occasion d'enrichir l'assistant.

**Produits les plus recommandés**
Les fiches que l'assistant met le plus en avant — un **signal de demande** exploitable côté commercial et marketing.

**Explorateur de conversations**
La liste des derniers échanges (thème, issue : répondu / sans réponse / insatisfait) avec accès au **transcript complet** de chaque conversation, pour comprendre en détail les cas concrets.

### La boucle vertueuse

```
Le client pose une question  →  l'assistant ne sait pas répondre
        →  la question remonte dans le reporting
        →  un clic ouvre la base de connaissances pré-remplie
        →  l'équipe ajoute la réponse
        →  l'assistant répond correctement la fois suivante.
```

Plus l'assistant est utilisé, plus le reporting révèle de manques, plus la base s'enrichit, meilleur devient l'assistant.

### Bénéfices métier

- **Voix du client** : savoir précisément ce que demandent les visiteurs, en volume et par thème.
- **Détection des manques** : identifier et combler les trous de la base, en continu.
- **Signal commercial** : repérer les produits et sujets qui intéressent, orienter l'offre et le contenu.
- **Maîtrise du budget** : suivre le coût et l'activité de l'assistant.
- **Pilotage de la qualité** : mesurer le taux de réponse et repérer les conversations insatisfaisantes.
- **Conformité** : les échanges sont anonymes et automatiquement effacés après 90 jours.

---

*En résumé : l'enrichissement garde l'assistant **à jour et fiable**, le reporting le rend **mesurable et améliorable** — les deux fonctions forment un cercle vertueux qui fait progresser la pertinence de l'assistant au fil de son usage.*
