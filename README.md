# TriDDS

Assistant de tri des déchets diffus spécifiques (DDS) pour les agents de déchèterie :
recherche d'un produit ou scan de son étiquette, puis bac EcoDDS, hors EcoDDS ou refus,
avec le seuil du contenant et les consignes de sécurité.

Site statique (GitHub Pages, `tridds.com`) + API Cloudflare Worker (`worker/`).
Aucune étape de compilation : les fichiers sont servis tels quels.

## Pages

| Page | Pour qui | Rôle |
|---|---|---|
| `index.html` | Agents et responsables de site | L'appli : connexion par code du site, recherche, scan, journal, guide, profil |
| `pricing.html` | Prospects | Offres, démo de recherche en direct, demande d'accès |
| `admin.html` | Vous uniquement | Demandes, création et réglage des accès, photos, fiches, mémoire IA |

`admin-base.html`, `admin-knowledge.html` et `bulk-upload.html` redirigent vers les sections de `admin.html`.

## Parcours d'un client

1. Le prospect envoie une demande depuis la page Offres. Vous recevez un email, la demande apparaît dans l'admin.
2. Vous créez l'accès depuis la demande : site, responsable, agents, offre, scans d'essai éventuels.
   Le code est généré à partir du nom de la commune ; l'email d'accès part au responsable si vous le cochez,
   et un message prêt à copier est proposé.
3. Les agents ouvrent l'appli, saisissent le code et choisissent leur nom.
4. Par défaut, vous gérez seul les profils. Vous pouvez autoriser le responsable à gérer son équipe,
   dans la limite de son offre.

Le lien `admin.html` ne doit jamais être communiqué à un client.

## Organisation du code

```
config.js            adresse de l'API, version
data.js              base produits (482 fiches) ; les consignes IA sont dans worker/src/prompt.js
css/                 fonts.css, base.css (commun), app.css, site.css, admin.css
js/shared/           plans (offres), catalogue et recherche, appels API, outils d'interface
js/app/              appli agent (un fichier par écran)
js/site/offres.js    page Offres
js/admin/            administration
sw.js                hors ligne : appli et recherche disponibles sans réseau
worker/              API Cloudflare (voir worker/README.md)
data/                fichier source de la base produits
```

Les offres sont définies dans `js/shared/plans.js` et `worker/src/plans.js` : garder les deux identiques.

## Mettre en ligne une modification

1. Augmenter la version dans `config.js`, dans `sw.js` (`VERSION`) et dans les `?v=` des pages.
2. Pousser sur `main` : GitHub Pages publie le site.
3. Si le Worker change : `cd worker && node test/api.test.mjs && npx wrangler deploy`.

## Tester en local

```bash
python3 -m http.server 8765          # site sur http://localhost:8765
node worker/test/dev-server.mjs 8787 # API simulée (Anthropic et Resend interceptés)
```
