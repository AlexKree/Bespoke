'use strict';

/**
 * Calcul du cout d'import "landed cost" vers la France.
 *
 * IMPORTANT — separation des roles :
 *   - CE FICHIER calcule. Aucun montant ne vient du modele de langage.
 *   - Le modele ne fait qu'extraire les parametres du texte libre et rediger
 *     l'explication. Il ne peut pas modifier un taux.
 *
 * Les taux ci-dessous sont des parametres, pas des constantes de la loi.
 * Ils doivent etre revus chaque annee (loi de finances) et valides par un
 * professionnel avant d'etre opposes a un client.
 */

const RATES = {
  // Revision : loi de finances annuelle. Derniere mise a jour du fichier : 2026-09.
  reference_year: 2026,

  // Droit de douane, position NC 8703 (voitures de tourisme), import hors UE.
  customs_duty: 0.10,
  // Position NC 9705 (vehicule de collection) : droit nul, TVA reduite.
  collection_customs_duty: 0.00,
  collection_vat: 0.055,
  standard_vat: 0.20,

  // Age a partir duquel un vehicule peut pretendre au statut de collection.
  collection_age_years: 30,

  // Seuils fiscaux du vehicule "neuf" au sens de la TVA intracommunautaire.
  new_vehicle_months: 6,
  new_vehicle_km: 6000,

  // Malus a l'immatriculation. Abattement de 10 % par annee entamee depuis
  // la premiere mise en circulation (regime du malus sur vehicule d'occasion).
  malus_abattement_par_an: 0.10,
  // Bareme CO2 simplifie (WLTP, g/km -> euros). A actualiser chaque annee.
  malus_co2_bareme: [
    { max: 112, amount: 0 },
    { max: 130, amount: 500 },
    { max: 150, amount: 2000 },
    { max: 170, amount: 6000 },
    { max: 190, amount: 15000 },
    { max: 210, amount: 30000 },
    { max: Infinity, amount: 70000 },
  ],
  // Malus au poids : seuil et tarif moyen au kilo au-dela.
  malus_masse_seuil_kg: 1600,
  malus_masse_eur_par_kg: 15,

  // Carte grise : tarif du cheval fiscal. Varie par region.
  cheval_fiscal_eur: { 'PACA': 51.2, 'Ile-de-France': 54.95, 'Occitanie': 44, 'default': 48 },
  carte_grise_frais_fixes: 13.76, // taxe de gestion + redevance d'acheminement

  // Prestations. Fourchettes indicatives, a ajuster selon le dossier reel.
  transport_eur: {
    'japon': 2500, 'coree-du-sud': 2500, 'etats-unis': 2800, 'canada': 2800,
    'royaume-uni': 900, 'suisse': 700, 'ue': 800, 'default': 1800,
  },
  homologation_eur: 1200,   // COC ou attestation d'identification + passage DREAL si besoin
  controle_technique_eur: 90,
};

const HORS_UE = new Set(['japon', 'coree-du-sud', 'etats-unis', 'canada', 'royaume-uni', 'suisse', 'autre-hors-ue']);

function round(n) { return Math.round(n); }

/**
 * @param {object} p parametres normalises
 * @param {number} p.vehicle_price_eur prix d'achat du vehicule
 * @param {string} p.origin cle de pays (voir transport_eur)
 * @param {number|null} p.first_registration_year
 * @param {number|null} p.co2_g_km
 * @param {number|null} p.weight_kg
 * @param {number|null} p.mileage_km
 * @param {number|null} p.fiscal_hp puissance fiscale (CV)
 * @param {string|null} p.region
 * @param {boolean} p.claim_collection le client vise le statut de collection
 */
function computeImportCost(p) {
  const notes = [];
  const lines = [];
  const price = Math.max(0, Number(p.vehicle_price_eur) || 0);
  const origin = p.origin ? String(p.origin).toLowerCase() : null;
  const originKnown = origin != null;
  const outsideEu = originKnown && HORS_UE.has(origin);
  const year = RATES.reference_year;

  const age = p.first_registration_year ? year - Number(p.first_registration_year) : null;
  const eligibleCollection = age != null && age >= RATES.collection_age_years;
  const collection = Boolean(p.claim_collection) && eligibleCollection;

  if (p.claim_collection && !eligibleCollection) {
    notes.push({
      level: 'warning',
      fr: `Le statut de collection suppose un vehicule de plus de ${RATES.collection_age_years} ans conserve dans son etat d'origine. Ce vehicule n'y est pas eligible : le calcul applique le regime standard.`,
      en: `Collector status requires a vehicle over ${RATES.collection_age_years} years old kept in original condition. This vehicle does not qualify, so the standard regime is applied.`,
    });
  }

  lines.push({ key: 'vehicle', label_fr: "Prix d'achat du vehicule", label_en: 'Vehicle purchase price', amount: round(price) });

  // ── Transport ───────────────────────────────────────────────────────
  // Sans pays de depart, on ne chiffre ni le transport ni le regime douanier :
  // les deux en dependent entierement.
  let transport = 0;
  if (originKnown) {
    transport = RATES.transport_eur[origin] != null ? RATES.transport_eur[origin] : RATES.transport_eur.default;
    lines.push({
      key: 'transport', amount: round(transport), partial: true,
      label_fr: 'Transport et manutention (fourchette indicative, selon le port de depart)',
      label_en: 'Transport and handling (broad estimate, depends on port of departure)',
    });
  } else {
    notes.push({
      level: 'warning',
      fr: "Pays de depart non precise : le transport, les droits de douane et la TVA a l'import ne sont pas chiffres ici. Indiquez d'ou part le vehicule pour obtenir ces postes.",
      en: 'Country of departure not specified: shipping, customs duty and import VAT are not costed here. State where the vehicle ships from to get those lines.',
    });
  }

  // ── Douane et TVA ───────────────────────────────────────────────────
  let duty = 0, vat = 0;
  const customsValue = price + transport; // valeur en douane : prix + acheminement jusqu'a la frontiere UE

  if (!originKnown) {
    // rien : l'avertissement ci-dessus couvre l'absence de ces postes
  } else if (outsideEu) {
    const dutyRate = collection ? RATES.collection_customs_duty : RATES.customs_duty;
    const vatRate = collection ? RATES.collection_vat : RATES.standard_vat;
    duty = customsValue * dutyRate;
    vat = (customsValue + duty) * vatRate;
    lines.push({
      key: 'duty', amount: round(duty), rate: dutyRate,
      label_fr: `Droits de douane (${(dutyRate * 100).toFixed(1)} %)`,
      label_en: `Customs duty (${(dutyRate * 100).toFixed(1)}%)`,
    });
    lines.push({
      key: 'vat', amount: round(vat), rate: vatRate,
      label_fr: `TVA a l'import (${(vatRate * 100).toFixed(1)} %)`,
      label_en: `Import VAT (${(vatRate * 100).toFixed(1)}%)`,
    });
    if (collection) {
      notes.push({
        level: 'info',
        fr: "Regime de collection applique (position NC 9705) : droits de douane nuls et TVA reduite. Il exige une attestation — en pratique un certificat FFVE — et un vehicule dans son etat d'origine.",
        en: 'Collector regime applied (CN 9705): zero customs duty and reduced VAT. It requires an attestation — in practice an FFVE certificate — and a vehicle in original condition.',
      });
    }
  } else {
    const monthsKnown = p.first_registration_year != null;
    const looksNew =
      (p.mileage_km != null && Number(p.mileage_km) < RATES.new_vehicle_km) ||
      (monthsKnown && year - Number(p.first_registration_year) === 0);
    if (looksNew) {
      vat = price * RATES.standard_vat;
      lines.push({
        key: 'vat', amount: round(vat), rate: RATES.standard_vat,
        label_fr: `TVA francaise (${RATES.standard_vat * 100} %) — vehicule fiscalement neuf`,
        label_en: `French VAT (${RATES.standard_vat * 100}%) — fiscally new vehicle`,
      });
      notes.push({
        level: 'warning',
        fr: `Au sein de l'UE, un vehicule de moins de ${RATES.new_vehicle_months} mois ou de moins de ${RATES.new_vehicle_km} km est fiscalement neuf : la TVA est due en France, meme si elle a deja ete acquittee a l'etranger.`,
        en: `Within the EU, a vehicle under ${RATES.new_vehicle_months} months old or under ${RATES.new_vehicle_km} km counts as fiscally new: VAT is due in France even if already paid abroad.`,
      });
    } else {
      notes.push({
        level: 'info',
        fr: "Acquisition intracommunautaire d'un vehicule d'occasion : ni droits de douane ni TVA a l'import. Un quitus fiscal reste necessaire pour l'immatriculation.",
        en: 'Intra-EU acquisition of a used vehicle: no customs duty and no import VAT. A tax clearance certificate (quitus fiscal) is still required for registration.',
      });
    }
  }

  // ── Malus ───────────────────────────────────────────────────────────
  let malus = 0;
  if (collection) {
    notes.push({
      level: 'info',
      fr: "Carte grise de collection : exoneration de malus CO2 et de malus au poids.",
      en: 'Collector registration: exempt from CO2 and weight malus.',
    });
  } else if (p.co2_g_km == null && p.weight_kg == null) {
    notes.push({
      level: 'warning',
      fr: "Malus non estime : il depend du CO2 homologue et de la masse en ordre de marche, non fournis. Ces deux valeurs figurent sur le certificat de conformite.",
      en: 'Malus not estimated: it depends on the homologated CO2 figure and kerb weight, which were not provided. Both appear on the certificate of conformity.',
    });
  } else {
    let co2Malus = 0;
    if (p.co2_g_km != null) {
      const co2 = Number(p.co2_g_km);
      for (const step of RATES.malus_co2_bareme) {
        if (co2 <= step.max) { co2Malus = step.amount; break; }
      }
    }
    let massMalus = 0;
    if (p.weight_kg != null) {
      const over = Number(p.weight_kg) - RATES.malus_masse_seuil_kg;
      if (over > 0) massMalus = over * RATES.malus_masse_eur_par_kg;
    }
    malus = co2Malus + massMalus;

    if (age != null && age > 0) {
      const abattement = Math.min(1, age * RATES.malus_abattement_par_an);
      malus = malus * (1 - abattement);
      notes.push({
        level: 'info',
        fr: abattement >= 1
          ? `Malus entierement efface par l'anciennete : l'abattement de ${RATES.malus_abattement_par_an * 100} % par annee depuis la premiere immatriculation atteint 100 %.`
          : `Abattement de ${(abattement * 100).toFixed(0)} % applique au malus (${RATES.malus_abattement_par_an * 100} % par annee depuis la premiere immatriculation).`,
        en: abattement >= 1
          ? `Malus fully offset by age: the ${RATES.malus_abattement_par_an * 100}% per-year reduction since first registration reaches 100%.`
          : `${(abattement * 100).toFixed(0)}% reduction applied to the malus (${RATES.malus_abattement_par_an * 100}% per year since first registration).`,
      });
    }
    if (malus > 0) {
      lines.push({
        key: 'malus', amount: round(malus),
        label_fr: 'Malus a la premiere immatriculation (estimation)',
        label_en: 'First-registration malus (estimate)',
      });
    }
    notes.push({
      level: 'warning',
      fr: `Le bareme du malus est celui retenu pour ${year} dans ce simulateur et evolue a chaque loi de finances. A confirmer au moment de l'immatriculation.`,
      en: `The malus scale used here is the one configured for ${year} and changes with each annual finance act. To be confirmed at registration time.`,
    });
  }

  // ── Immatriculation ─────────────────────────────────────────────────
  let carteGrise = RATES.carte_grise_frais_fixes;
  let carteGriseComplete = p.fiscal_hp != null;
  if (p.fiscal_hp != null) {
    const region = p.region && RATES.cheval_fiscal_eur[p.region] != null ? p.region : 'default';
    const cv = RATES.cheval_fiscal_eur[region];
    let taxe = Number(p.fiscal_hp) * cv;
    if (collection) taxe = taxe / 2; // demi-tarif applique aux vehicules de plus de 30 ans
    carteGrise += taxe;
  } else {
    notes.push({
      level: 'info',
      fr: "Taxe regionale de carte grise non chiffree : la puissance fiscale (CV) n'a pas ete fournie.",
      en: 'Regional registration tax not costed: the fiscal horsepower (CV) was not provided.',
    });
  }
  lines.push({
    key: 'carte_grise', amount: round(carteGrise),
    label_fr: carteGriseComplete ? 'Carte grise' : 'Carte grise — frais fixes seuls (taxe regionale non chiffree)',
    label_en: carteGriseComplete ? 'Registration certificate' : 'Registration — fixed fees only (regional tax not costed)',
    partial: !carteGriseComplete,
  });

  // ── Mise en conformite ──────────────────────────────────────────────
  lines.push({
    key: 'homologation', amount: RATES.homologation_eur,
    label_fr: 'Homologation et conformite (COC, DREAL si necessaire)',
    label_en: 'Homologation and compliance (COC, DREAL if required)',
  });
  lines.push({
    key: 'ct', amount: RATES.controle_technique_eur,
    label_fr: 'Controle technique', label_en: 'Roadworthiness test',
  });

  const total = lines.reduce((s, l) => s + l.amount, 0);
  const extraOverPrice = total - round(price);

  return {
    reference_year: year,
    regime: !originKnown ? 'origine_inconnue'
      : collection ? 'collection'
      : outsideEu ? 'hors_ue_standard'
      : 'intra_ue',
    origin_known: originKnown,
    outside_eu: outsideEu,
    partial: !originKnown, // total incomplet : transport + douane + TVA manquants
    lines,
    notes,
    total_eur: total,
    extra_over_price_eur: extraOverPrice,
    extra_ratio: price > 0 ? extraOverPrice / price : null,
  };
}

module.exports = { RATES, computeImportCost, HORS_UE };
