// Offres TriDDS — copie côté Worker de js/shared/plans.js : garder les deux alignées.
// Les clés techniques (free, pro, multisite, enterprise) restent celles déjà enregistrées
// dans les sites existants ; seuls les libellés et quotas changent.

export const PLANS = {
  free: {
    key: "free",
    label: "Découverte",
    price: 0,
    scans: 0,
    agents: 2,
    pitch: "Recherche dans la base, sans scan photo. Un essai photo peut être ajouté par TriDDS.",
    features: ["Recherche des 480+ produits", "Guide de tri", "Essai photo sur demande"],
    public: false
  },
  essentiel: {
    key: "essentiel",
    label: "Essentiel",
    price: 19,
    scans: 50,
    agents: 3,
    pitch: "Pour une petite déchèterie qui scanne les cas douteux.",
    features: ["1 site", "50 scans photo par mois", "3 profils agents", "Recherche illimitée", "Journal des tris"],
    public: true
  },
  pro: {
    key: "pro",
    label: "Pro",
    price: 29,
    scans: 200,
    agents: 10,
    pitch: "Le scan photo au quotidien, avec la mémoire de l'équipe.",
    features: ["1 site", "200 scans photo par mois", "10 profils agents", "Mémoire partagée des marques", "Photos de référence", "Base produits du site"],
    public: true,
    featured: true
  },
  multisite: {
    key: "multisite",
    label: "Réseau",
    price: 69,
    scans: 150,
    agents: null,
    sites: 5,
    pitch: "Jusqu'à 5 déchèteries, un seul interlocuteur.",
    features: ["Jusqu'à 5 sites", "750 scans photo par mois au total", "Agents illimités", "Tout le plan Pro", "Suivi centralisé"],
    public: true
  },
  enterprise: {
    key: "enterprise",
    label: "Groupe",
    price: null,
    scans: 1000,
    agents: null,
    pitch: "Collectivités et exploitants au-delà de 5 sites.",
    features: ["Sites illimités", "Quotas adaptés", "Base produits personnalisée", "Accompagnement au déploiement"],
    public: true
  }
};

export const PLAN_ORDER = ["free", "essentiel", "pro", "multisite", "enterprise"];

export function planOf(key) {
  return PLANS[key] || PLANS.free;
}

export function planLabel(key, trialTotal) {
  if ((key || "free") === "free" && trialTotal > 0) return "Essai";
  return planOf(key).label;
}

export function formatPrice(plan, { yearly = false } = {}) {
  if (plan.price == null) return "Sur devis";
  if (plan.price === 0) return "0 €";
  const v = yearly ? plan.price * 10 : plan.price;
  return v + " €";
}
