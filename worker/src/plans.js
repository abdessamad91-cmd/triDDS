// Offres TriDDS — copie côté Worker de js/shared/plans.js : garder les deux alignées.
// Les clés techniques (free, essentiel, pro, multisite, enterprise) restent celles enregistrées
// dans les sites existants ; seules deux offres sont proposées à la vente.

export const PLANS = {
  free: {
    key: "free",
    label: "Découverte",
    price: 0,
    scans: 0,
    agents: 2,
    pitch: "Recherche seule, pour les démonstrations.",
    features: ["Recherche des 480+ produits", "Guide de tri"],
    public: false
  },
  essentiel: {
    key: "essentiel",
    label: "Essentiel (ancienne offre)",
    price: 19,
    scans: 50,
    agents: 3,
    pitch: "",
    features: [],
    public: false
  },
  pro: {
    key: "pro",
    label: "Déchèterie",
    price: 29,
    scans: 200,
    agents: null,
    pitch: "Tout TriDDS pour une déchèterie, agents illimités.",
    features: ["Agents illimités", "200 photos analysées par mois", "Recherche illimitée, même sans réseau", "Mémoire de l'équipe", "Photos de référence et fiches du site", "Journal des tris"],
    public: true,
    featured: true
  },
  multisite: {
    key: "multisite",
    label: "Réseau (ancienne offre)",
    price: 69,
    scans: 150,
    agents: null,
    sites: 5,
    pitch: "",
    features: [],
    public: false
  },
  enterprise: {
    key: "enterprise",
    label: "Collectivité ou réseau",
    price: null,
    scans: 200,
    agents: null,
    pitch: "À partir de 3 déchèteries, tarif dégressif par site.",
    features: ["Tout l'offre Déchèterie, sur chaque site", "24 € par site dès 3 sites, 19 € dès 10", "Un seul interlocuteur, une seule facture", "Déploiement accompagné : profils créés, agents formés", "Quotas ajustés à l'activité"],
    public: true
  }
};

export const PLAN_ORDER = ["free", "essentiel", "pro", "multisite", "enterprise"];
export const TRIAL_DAYS = 30;

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
