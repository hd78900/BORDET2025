# Guide fonctionnel (back-office)

Guide d'utilisation de l'interface d'administration de l'assistant Bordet. Réservé aux comptes **administrateurs**.

## Sommaire
- [Se connecter & naviguer](#se-connecter--naviguer)
- [Le chat (Dashboard)](#le-chat-dashboard)
- [Base de connaissances](#base-de-connaissances)
- [Analytics](#analytics)
- [Paramètres & prompts](#paramètres--prompts)
- [Gestion des utilisateurs](#gestion-des-utilisateurs)
- [Embarquer le widget](#embarquer-le-widget)

---

## Se connecter & naviguer

- Connexion sur `/login` avec email + mot de passe.
- La barre de navigation (en haut à droite, pour un admin) donne accès à :
  - 💬 **Chat** → le Dashboard (racine `/`)
  - 🛢️ **Base de connaissances** (`/knowledge`)
  - 📊 **Analytics** (`/analytics`)
  - ⚙️ **Paramètres** (`/settings`) — inclut la gestion des utilisateurs
- La session est **conservée au rechargement** de la page (pas de déconnexion intempestive).

---

## Le chat (Dashboard)

L'espace de test interne. On y dialogue avec l'assistant en mode **client** ou **marketing** :
- **Client** : le comportement exact du widget public (modèle standard, livres exclus).
- **Marketing** : réservé aux admins, ajoute les **ouvrages** au contexte et utilise un modèle plus puissant, pour rédiger du contenu.

---

## Base de connaissances

Onglet **Ajouter du contenu** — trois modes, tous suivis d'une **relecture** avant écriture.

### 1. Coller du texte
Formulaire complet : **type de contenu**, titre, URL (optionnelle mais recommandée pour être citable), corps. Un bouton **✨ Nettoyer avec l'IA** reformate le texte sans en changer le fond. Le **type** détermine la visibilité :

| Type | Visibilité |
|---|---|
| Note / FAQ (`manual`) | Public |
| Guide / Article (`article`) | Public |
| Fiche produit (`product`, URL requise) | Public |
| Document interne / Livre (`book`) | **Marketing seulement** |

### 2. Importer un PDF
Déposez un fichier : le texte est **extrait dans le navigateur** (le PDF ne part pas au serveur), **nettoyé par l'IA**, puis affiché dans le formulaire pour **relecture** — vous validez avant l'ajout. Une bascule **Public / Marketing seulement** règle la visibilité. ⚠️ Pas d'OCR : les PDF scannés (images) ne sont pas pris en charge.

### 3. Crawl d'une URL bordet.fr
Collez l'URL d'une fiche produit (`…-c2x…`) ou d'un article (`…-c1200x…`) → **Récupérer pour relecture**. Le contenu est récupéré, **le HTML est décodé/nettoyé** (entités, balises), passé au nettoyage IA, et **les champs structurés** (titre, marque, prix, référence, disponibilité) sont pré-remplis. Vous relisez, corrigez, puis **Ajouter à la base**.

### Validation & garde-fous
Au clic **Ajouter à la base**, le serveur peut :
- **refuser** (doublon exact, contenu trop court, encodage cassé) — message explicite ;
- **demander confirmation** (« très proche d'un contenu existant », « prix hors fiche », « lien mort ») → vous choisissez d'ajouter quand même.

### Onglet Gérer
Liste des contenus ajoutés via l'interface. Pour chaque source :
- ✏️ **crayon** — rouvre le **contenu complet** dans le formulaire pour relecture/édition (ré-ajouter avec le même titre = écrasement) ;
- 🗑️ **corbeille** — supprime la source (tous ses chunks).

---

## Analytics

Tableau de bord des conversations (widget public **et** back-office). À l'ouverture, une **classification IA** des nouvelles conversations se lance automatiquement (thème, intention, issue).

- **KPIs (7 j)** : conversations, taux « sans réponse », coût estimé, latence médiane, produit n°1 recommandé, conversations à intention d'achat.
- **Graphiques (30 j)** : activité (échanges/conversations/sans-réponse) et répartition par **thèmes** métier.
- **Questions sans réponse** : triées par fréquence, chacune avec un bouton **« Ajouter »** qui ouvre la Base de connaissances **préremplie** → chaque trou détecté se comble en deux clics.
- **Produits les plus recommandés** : signaux de demande (liens vers les fiches).
- **Explorateur** : les dernières conversations (origine, thème, issue) ; clic → **transcript** complet.

> RGPD : les transcripts sont purgés après 90 jours ; aucun identifiant client n'est stocké.

---

## Paramètres & prompts

Page **Paramètres** :
- **Prompts éditables** — deux éditeurs (assistant **client** / contenu **marketing**). Ils pilotent réellement le chatbot (lus côté serveur à chaque réponse) ; **effet immédiat, sans redéploiement**. Le contexte (produits/articles trouvés) est ajouté automatiquement après le prompt.
- **Statut** — état de l'IA et de la base vectorielle (rafraîchi périodiquement).
- **Widget** — titre et message d'accueil, et le **code d'intégration** à copier.
- **Modèle de chat** — se change via `widget_settings.chat_model` (identifiant OpenRouter, ex. `openai/gpt-5.4-nano`) sans redéploiement.

---

## Gestion des utilisateurs

En bas de la page **Paramètres**, section **Gestion des utilisateurs** :
- **Créer un utilisateur** : email + mot de passe, avec ou sans droit **administrateur**.
- **Liste** des comptes, avec pour les non-admins les **cases d'accès** aux bots.

> L'ancienne page `/admin` redirige désormais vers `/settings`.

---

## Embarquer le widget

Le chatbot public s'intègre sur n'importe quelle page via un `<script>` (disponible à copier dans **Paramètres**) :

```html
<script>
  (function () {
    var s = document.createElement('script');
    s.src = 'https://chatbordet.netlify.app/widget.js?v=' + Date.now();
    s.async = true;
    document.head.appendChild(s);
  })();
</script>
```

Le script charge une **iframe** vers `/widget/bot1`. Côté public, le widget interroge le `mistral-proxy` en clé anon : il ne voit **que** le contenu public (produits/articles), jamais les ouvrages ni les documents marketing.
