# Worker TriDDS v2

API de TriDDS (Cloudflare Worker `wild-morning-f974`). Ce dossier contient le code source complet,
qui n'était jusqu'ici que dans le tableau de bord Cloudflare.

## Ce qui change par rapport à la version en ligne

- **Accès sur demande uniquement** : plus de création d'essai (`/api/create-trial`) ni de paiement Stripe
  (`/api/create-checkout`, `/api/payment-success`) en libre-service. Ces routes répondent `410`.
  Les accès se créent dans l'admin (`admin.html`).
- **Demandes d'accès** : `POST /api/request-access` enregistre la demande (clé KV `_requests`),
  vous envoie un email (`NOTIFY_EMAIL`) et envoie un accusé de réception au prospect.
  Limite de 5 demandes par heure et par adresse IP, champ piège anti-robot.
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
  Comparaison de la clé admin à temps constant.
- **Coûts et vitesse IA** : les consignes métier sont envoyées en cache de prompt Anthropic.
  Une seconde passe (Sonnet) n'est pas décomptée, une seule fois par scan, dans les 3 minutes.
- **Photos publiques** mises en cache 5 minutes en périphérie, cache vidé à chaque modification.

## Vérifier avant de déployer

```bash
cd worker
node test/api.test.mjs        # 50 vérifications sur un environnement simulé
node test/dev-server.mjs 8787 # API locale avec des données d'exemple
```

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

- Sites existants en offre `multisite` : leur quota passe de 750 à 150 scans par site.
  Si un client a besoin de plus, renseigner un « quota mensuel spécifique » dans sa fiche.
- Abonnements Stripe en cours : ils continuent d'être prélevés au tarif de l'époque.
  À ajuster ou résilier depuis le tableau de bord Stripe ; les secrets `STRIPE_*` ne servent plus.
- Les anciens accès d'essai (`TRY-…`) restent valides avec leurs scans restants.
