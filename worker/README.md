# Worker TriDDS v2

API de TriDDS (Cloudflare Worker `wild-morning-f974`). Ce dossier contient le code source complet,
qui n'était jusqu'ici que dans le tableau de bord Cloudflare.

## Ce qui change par rapport à la version en ligne

- **Accès sur demande uniquement** : plus de création d'essai (`/api/create-trial`) ni de paiement Stripe
  (`/api/create-checkout`, `/api/payment-success`) en libre-service. Ces routes répondent `410`.
  Les accès se créent dans l'admin (`admin.html`).
- **Demandes d'accès** : `POST /api/request-access` enregistre la demande (clé KV `_requests`),
  et vous envoie un email (`NOTIFY_EMAIL`, réponse directe au prospect). Aucun email n'est envoyé à l'adresse
  saisie par le visiteur (pas de relais de spam). Limite de 5 demandes par heure et par adresse IP, champ piège anti-robot.
- **Offres** (`src/plans.js`) : Découverte (0 scan, essai possible), Essentiel 19 € (50 scans, 3 agents),
  Pro 29 € (200 scans, 10 agents), Réseau 69 € (5 sites, 150 scans par site, agents illimités),
  Groupe sur devis (1000 scans). Les clés techniques des sites existants (`free`, `pro`, `multisite`,
  `enterprise`) sont conservées.
- **Contrôle des équipes** : un site peut être « verrouillé » (`teamLocked`, activé par défaut à la création) :
  le responsable ne peut alors ni ajouter ni retirer d'agent. Sinon il le peut dans la limite de l'offre.
  L'auto-inscription d'un agent avec le seul code du site (`register-agent`) est supprimée.
- **Réglages par site** : quota mensuel spécifique, nombre d'agents max, scans d'essai, facturation,
  date « payé jusqu'au », notes. Changement de code d'un site (mémoire, fiches et photos suivent).
- **Sécurité** : l'analyse IA, l'écriture dans la mémoire et l'ajout de photos exigent une session agent valide
  (code + nom + identifiant de session). Les photos globales et les suppressions exigent la clé admin.
  Photos : JPEG, PNG ou WebP uniquement, contenu vérifié, 40 par jour et par site pour les agents.
  20 codes inconnus par quart d'heure et par IP. Comparaison de la clé admin à temps constant.
- **IA** : les consignes (`src/prompt.js`, copiées de `data.js`) et la mémoire du site sont ajoutées côté
  serveur : l'API n'accepte que des photos, ce n'est pas un accès libre à Claude. Consignes en cache de prompt
  Anthropic. Le scan est réservé avant l'appel et remboursé si l'IA ne répond pas. Une seconde lecture (Sonnet)
  de la même photo n'est pas décomptée, une seule fois, dans les 3 minutes.
- **Sites existants** : migrés à la lecture sans rien perdre (quotas Réseau/Groupe d'origine, mémoire et fiches,
  équipe verrouillée par défaut).
- **Photos publiques** mises en cache 5 minutes en périphérie, cache vidé à chaque modification.

## Vérifier avant de déployer

```bash
cd worker
node test/api.test.mjs        # 63 vérifications sur un environnement simulé
node test/dev-server.mjs 8787 # API locale avec des données d'exemple
```

Après une modification des consignes dans `data.js` : `node scripts/build-prompt.mjs`.

## Déployer

1. Ajouter l'adresse qui reçoit les demandes (une seule fois) :
   ```bash
   cd worker
   npx wrangler secret put NOTIFY_EMAIL
   ```
   Les autres secrets (`TRIDDS_ADMIN_KEY`, `ANTHROPIC_API_KEY`, `RESEND_API_KEY`, `RESEND_FROM`) restent ceux
   déjà configurés. Vérifier que `RESEND_FROM` utilise un domaine validé dans Resend.
2. Vérifier `SITE_BASE_URL` dans `wrangler.toml` (lien envoyé dans les emails).
3. Déployer **juste après** la mise en ligne du nouveau site (GitHub Pages), de préférence hors des heures
   d'ouverture des déchèteries :
   ```bash
   npx wrangler deploy
   ```
   L'ancienne appli n'envoie pas l'identifiant de session : tant qu'un agent n'a pas rechargé la page,
   ses scans seraient refusés. Le nouveau site fonctionne, lui, avec l'ancien et le nouveau Worker.
4. Retour arrière possible à tout moment depuis Cloudflare (Workers › wild-morning-f974 › Déploiements).

## Après le déploiement

- Sites existants en offre `multisite` ou `enterprise` : leur quota d'origine (750 ou illimité) est conservé
  sous forme de « quota mensuel spécifique », modifiable dans leur fiche.
- Équipes existantes : verrouillées par défaut. Décochez « Je gère les profils moi-même » dans la fiche d'un site
  pour rendre la main à son responsable.
- Abonnements Stripe en cours : ils continuent d'être prélevés au tarif de l'époque.
  À ajuster ou résilier depuis le tableau de bord Stripe ; les secrets `STRIPE_*` ne servent plus.
- Les anciens accès d'essai (`TRY-…`) restent valides avec leurs scans restants.
