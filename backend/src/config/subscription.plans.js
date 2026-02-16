/**
 * Plans d'abonnement IPTV - Prix en FCFA
 * Afrique de l'Ouest (XOF) et Afrique Centrale (XAF)
 */

export const SUBSCRIPTION_PLANS = {
  ANNUAL: {
    name: "Abonnement Annuel",
    duration: 365, // jours
    price: {
      XOF: 25000, // FCFA Afrique de l'Ouest
      XAF: 25000, // FCFA Afrique Centrale
      EUR: 38,
    },
    features: {
      channels: "Toutes les chaînes",
      quality: "HD/Full HD",
      devices: 3,
      support: "Support client",
      updates: "Mises à jour gratuites",
    },
  },

  TRIAL: {
    name: "Essai 3 jours",
    duration: 3,
    price: { XOF: 1000, XAF: 1000 },
    features: {
      channels: "Toutes",
      quality: "SD",
      devices: 1,
    },
  },
};

/** Récupère le plan par son type */
export function getPlan(planType) {
  const plan = SUBSCRIPTION_PLANS[planType];
  if (!plan) throw new Error(`Plan inconnu: ${planType}`);
  return plan;
}

/** Calcule la date de fin à partir de la durée en jours */
export function getEndDate(startDate, durationDays) {
  const end = new Date(startDate);
  end.setDate(end.getDate() + durationDays);
  return end;
}
