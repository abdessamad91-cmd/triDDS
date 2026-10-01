# Configuration R2 pour les images TriDDS

## 1. Créer le bucket R2

Dans le dashboard Cloudflare :
- Workers & Pages → R2 → Créer un bucket
- Nom : `tridds-images`
- Région : Auto

## 2. Ajouter le binding dans wrangler.toml

```toml
[[r2_buckets]]
binding = "IMAGES_BUCKET"
bucket_name = "tridds-images"
```

## 3. Redéployer le worker

```bash
wrangler deploy
```

## Fonctionnement

- L'admin uploade une image via le formulaire (drag & drop ou sélection)
- L'image est envoyée en base64 au worker
- Le worker la stocke dans R2 sous la clé `{CODE_SITE}/{ID}.{ext}`
- L'URL de consultation est `/api/img/{CODE_SITE}/{ID}.{ext}`
- Les métadonnées (produit, ordre, principale) restent dans KV

## Limites gratuites R2

- 10 Go de stockage
- 1 million de lectures/mois
- 10 millions d'écritures/mois
- Pas de frais de sortie (egress)

## Sans R2

Si IMAGES_BUCKET n'est pas configuré, le système fonctionne toujours en mode URL externe (l'admin peut coller une URL).
