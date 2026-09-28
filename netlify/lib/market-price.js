'use strict';

/**
 * Prix marche des vehicules du stock, partage entre :
 *  - `admin.js`                      : met les vehicules en file (status 'pending') ;
 *  - `market-price-run-background`   : recherche web + estimation par Claude.
 *
 * Le resultat n'est qu'une PROPOSITION stockee en base privee : il n'atteint
 * la fiche publique qu'une fois valide par l'admin (ecrit alors dans
 * stock.json). Un « Bonne affaire » affiche doit pouvoir etre justifie : on
 * exige donc des comparables sources (URL, date) plutot qu'un chiffre seul.
 */

const { z } = require('zod');

// Recherche de prix = raisonnement + web : modele de qualite, le worker tourne
// en background (15 min). Surchargeable par var d'env.
const MARKET_MODEL = process.env.ANTHROPIC_MODEL_MARKET || 'claude-opus-5';
const WORKER_PATH = '/.netlify/functions/market-price-run-background';

const SYSTEM = `Tu es l'expert cotation d'un négociant européen en véhicules de collection et de prestige.
On te donne la fiche d'un véhicule en stock. Estime son prix de marché actuel en euros, en Europe.

Méthode :
- Cherche sur le web des véhicules COMPARABLES : même modèle et même génération, année proche, kilométrage et état comparables, même type de boîte si cela influe sur la cote.
- Sources utiles : annonces (AutoScout24, mobile.de, La Centrale, Leboncoin, Classic Driver, Car & Classic, Elferspot…), résultats d'enchères (Bring a Trailer, Collecting Cars, Catawiki, RM Sotheby's, Bonhams, Artcurial, Osenat…), cotes publiées (Hagerty, La Vie de l'Auto…).
- Privilégie les données de moins de 18 mois. Convertis en euros les prix en devises étrangères et indique-le.
- Une annonce est un prix DEMANDÉ, généralement au-dessus du prix de transaction ; un résultat d'enchère est un prix RÉALISÉ. Tiens-en compte dans ton estimation.
- N'invente jamais un comparable ni une URL : ne cite que ce que tu as réellement trouvé.
- S'il y a trop peu de données fiables, renvoie market_price_eur = null et explique pourquoi.

Réponds uniquement en appelant l'outil submit_estimate, en français.`;

const ESTIMATE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['market_price_eur', 'low_eur', 'high_eur', 'confidence', 'comparables', 'rationale'],
  properties: {
    market_price_eur: { type: ['integer', 'null'], description: 'Prix de marché central estimé en euros, ou null si données insuffisantes.' },
    low_eur: { type: ['integer', 'null'], description: 'Bas de la fourchette de marché en euros.' },
    high_eur: { type: ['integer', 'null'], description: 'Haut de la fourchette de marché en euros.' },
    confidence: { type: 'string', enum: ['low', 'medium', 'high'], description: 'Confiance dans l’estimation, selon le nombre et la proximité des comparables.' },
    comparables: {
      type: 'array',
      description: 'Véhicules comparables réellement trouvés (8 maximum), du plus proche au moins proche.',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['title', 'price_eur', 'kind', 'source', 'url', 'date', 'note'],
        properties: {
          title: { type: 'string', description: 'Véhicule : modèle, année, kilométrage si connu.' },
          price_eur: { type: 'integer', description: 'Prix en euros (converti si besoin).' },
          kind: { type: 'string', enum: ['listing', 'auction_result', 'price_guide'] },
          source: { type: 'string', description: 'Nom du site ou de la maison de ventes.' },
          url: { type: 'string' },
          date: { type: 'string', description: 'Date de l’annonce ou de la vente (AAAA-MM ou AAAA-MM-JJ), vide si inconnue.' },
          note: { type: 'string', description: 'Écart notable avec notre véhicule (km, état, options, devise d’origine…), vide sinon.' },
        },
      },
    },
    rationale: { type: 'string', description: 'Justification courte (5 lignes max) : comment les comparables mènent au prix retenu.' },
  },
};

const Estimate = z.object({
  market_price_eur: z.number().int().positive().nullable(),
  low_eur: z.number().int().positive().nullable(),
  high_eur: z.number().int().positive().nullable(),
  confidence: z.enum(['low', 'medium', 'high']),
  comparables: z.array(z.object({
    title: z.string(),
    price_eur: z.number().int(),
    kind: z.enum(['listing', 'auction_result', 'price_guide']),
    source: z.string(),
    url: z.string(),
    date: z.string(),
    note: z.string(),
  })).max(12),
  rationale: z.string(),
});

const str = (v) => (v == null ? '' : String(v).trim());

/**
 * Fiche envoyee au modele. Volontairement SANS notre prix de vente : il ne
 * doit pas ancrer l'estimation du marche.
 */
function buildRequest(car) {
  const c = car || {};
  const desc = str(c.description && (c.description.fr || c.description.en)).slice(0, 1500);
  return {
    title: str(c.title && (c.title.fr || c.title.en)) || str(c.model),
    make: str(c.make),
    model: str(c.model),
    year: c.year || null,
    vehicle_type: c.vehicle_type === 'motorcycle' ? 'moto' : 'voiture',
    mileage: str(c.mileage) || (c.mileage_km ? c.mileage_km + ' km' : ''),
    transmission: str(c.transmission),
    fuel_type: str(c.fuel_type),
    body_type: str(c.body_type),
    power_hp: c.power_hp || null,
    exterior_color: str(c.exterior_color),
    interior_color: str(c.interior_color),
    country_of_origin: str(c.country),
    description: desc,
  };
}

function userPrompt(request) {
  const lines = Object.entries(request)
    .filter(([, v]) => v != null && v !== '')
    .map(([k, v]) => `${k}: ${v}`);
  return `Véhicule à coter :\n${lines.join('\n')}\n\nDate du jour : ${new Date().toISOString().slice(0, 10)}.`;
}

module.exports = {
  MARKET_MODEL,
  WORKER_PATH,
  SYSTEM,
  ESTIMATE_SCHEMA,
  Estimate,
  buildRequest,
  userPrompt,
};
