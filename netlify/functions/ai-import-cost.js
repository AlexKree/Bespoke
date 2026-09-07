'use strict';

/**
 * Calculateur de cout d'import.
 *
 * Repartition volontaire des roles :
 *   1. le modele extrait les parametres du texte libre (et rien d'autre) ;
 *   2. le calcul est fait en code, dans netlify/lib/import-cost.js ;
 *   3. le modele redige ensuite l'explication A PARTIR du chiffrage produit.
 * Le modele ne produit jamais un montant lui-meme.
 *
 * Deroulement en DEUX requetes pour tenir dans le budget temps des fonctions
 * synchrones Netlify (~26 s) :
 *   - step "quote"   : extraction (1 appel modele) + chiffrage en code.
 *                      Renvoie les montants tout de suite.
 *   - step "explain" : redaction de l'explication (1 appel modele) a partir
 *                      des parametres deja extraits. Le client l'appelle
 *                      juste apres et l'affiche en complement.
 * Chaque requete ne fait donc qu'un seul aller-retour modele.
 */

const { z } = require('zod');
const { zodOutputFormat } = require('@anthropic-ai/sdk/helpers/zod');
const { MODEL, getClient, json, rateLimit, parseBody, requireKey, lang, apiError } = require('../lib/ai');
const { computeImportCost, RATES } = require('../lib/import-cost');

const ORIGINS = ['japon', 'coree-du-sud', 'etats-unis', 'canada', 'royaume-uni', 'suisse', 'autre-hors-ue', 'ue'];

const Params = z.object({
  vehicle_label: z.string().describe("Le vehicule tel que le client le decrit, ex. 'Nissan Skyline GT-R R34 1999'."),
  vehicle_price_eur: z.number().nullable().describe("Prix d'achat en euros. Convertis si le client donne une autre devise, et signale-le dans assumptions."),
  origin_stated_by_client: z.boolean().describe("true UNIQUEMENT si le client indique explicitement d'ou part le vehicule (pays, ville, vendeur, port). false si tu l'as deduit de la marque, du modele ou du pays de fabrication. Le pays de construction n'est PAS le pays de depart."),
  origin: z.enum(ORIGINS).nullable().describe("Pays de depart, seulement si origin_stated_by_client est true. 'ue' pour tout Etat membre de l'Union europeenne. Sinon null."),
  first_registration_year: z.number().nullable(),
  co2_g_km: z.number().nullable().describe('CO2 homologue en g/km, seulement si le client le donne ou si le modele exact le rend certain.'),
  weight_kg: z.number().nullable().describe('Masse en ordre de marche en kg.'),
  mileage_km: z.number().nullable(),
  fiscal_hp: z.number().nullable().describe('Puissance fiscale francaise en CV.'),
  region: z.enum(['PACA', 'Ile-de-France', 'Occitanie', 'default']).describe("Region d'immatriculation, 'default' si non precisee."),
  claim_collection: z.boolean().describe("Vrai si le client vise la carte grise de collection, ou si le vehicule a plus de 30 ans et qu'aucune indication contraire n'est donnee."),
  assumptions: z.array(z.string()).describe("Toute valeur que tu as deduite plutot que lue. Une ligne par hypothese, dans la langue du client. Tableau vide si tout etait explicite."),
  missing: z.array(z.string()).describe("Informations manquantes qui changeraient sensiblement le chiffrage, formulees comme des questions au client."),
});

const EXTRACT_SYSTEM = `Tu extrais les parametres d'un projet d'import automobile vers la France a partir d'une demande en langage naturel.

Regles strictes :
- Tu n'inventes aucun chiffre. Si une donnee n'est pas dans la demande, mets null et ajoute une ligne dans "missing".
- Exception unique : si le modele est identifie sans ambiguite et que sa fiche technique est un fait etabli et stable (masse, puissance fiscale, CO2 homologue), tu peux la renseigner — mais tu dois alors l'ecrire dans "assumptions".
- Ne devine jamais un prix d'achat. Sans prix, mets null.
- Le pays de FABRICATION n'est pas le pays de DEPART. Une R34 en vente au Royaume-Uni part du Royaume-Uni. Ne mets origin_stated_by_client a true que si le client dit ou se trouve la voiture ou d'ou elle expedie. Sinon : origin_stated_by_client = false, origin = null, et une question dans "missing".
- Convertis les devises en euros si necessaire et note le taux utilise dans "assumptions".
- "assumptions" et "missing" sont rediges dans la langue du client.`;

const EXPLAIN_SYSTEM = `Tu es le specialiste import de The Bespoke Car. On te fournit un chiffrage DEJA CALCULE.

Regles absolues :
- Tu ne recalcules rien et tu ne cites aucun montant qui ne figure pas dans le chiffrage fourni.
- Tu expliques la logique de chaque poste, dans l'ordre reel des operations.
- Tu listes les documents a reunir et une chronologie realiste en semaines.
- Tu signales franchement ce qui peut faire deraper le budget sur ce dossier precis.
- Tu rappelles que le chiffrage est indicatif et doit etre confirme au moment du dedouanement.
- Si un poste manque parce qu'une donnee n'a pas ete fournie (pays de depart, CV fiscaux, CO2, masse...), tu le dis clairement et tu indiques quoi fournir pour l'obtenir.
- Ton sobre et professionnel, pas de superlatifs. Redige dans la langue demandee.`;

const Explanation = z.object({
  headline: z.string().describe('Une phrase de synthese sur ce que coute reellement cet import.'),
  steps: z.array(z.object({
    title: z.string(),
    detail: z.string(),
  })).describe('Les etapes de l operation, du paiement du vehicule a l immatriculation francaise.'),
  documents: z.array(z.string()).describe('Documents a reunir, nommes precisement.'),
  timeline_weeks: z.string().describe("Fourchette de delai realiste, ex. '8 a 12 semaines'."),
  risks: z.array(z.string()).describe('Ce qui peut faire deraper le budget ou le calendrier sur ce dossier.'),
});

// Garde deterministe : on ne retient le pays de depart que si le client l'a
// explicitement donne. Le modele a tendance a deduire "R34 => Japon".
function applyOriginGuard(params) {
  if (!params.origin_stated_by_client) params.origin = null;
  return params;
}

function disclaimers() {
  return {
    rates_reference_year: RATES.reference_year,
    disclaimer_fr: `Estimation indicative calculee sur les taux parametres pour ${RATES.reference_year}. Les droits, la TVA et le malus sont confirmes au dedouanement et a l'immatriculation. Ce chiffrage s'entend sous reserve des pieces et travaux de mise aux normes que l'homologation ou le controle technique francais peuvent exiger (eclairage, depollution, freinage, compteur, securite...), variables selon le vehicule et son marche d'origine. Ne constitue ni un devis, ni un conseil fiscal.`,
    disclaimer_en: `Indicative estimate based on the rates configured for ${RATES.reference_year}. Duty, VAT and malus are confirmed at customs clearance and registration. This costing is subject to any parts and compliance work that French type-approval or the roadworthiness test may require (lighting, emissions, braking, odometer, safety...), which vary by vehicle and country of origin. This is neither a quote nor tax advice.`,
  };
}

/* ── Etape 1 : extraction + chiffrage, sans redaction ────────────────── */
async function handleQuote(event, body, l) {
  const query = typeof body.query === 'string' ? body.query.trim() : '';
  if (query.length < 10) {
    return json(400, {
      error: 'query_too_short',
      message_fr: 'Decrivez le vehicule, son pays de depart et son prix.',
      message_en: 'Describe the vehicle, where it comes from and its price.',
    });
  }
  if (query.length > 3000) return json(400, { error: 'query_too_long' });

  const limited = await rateLimit(event, 'import-cost', { limit: 12, windowMs: 3600000 });
  if (!limited.ok) return limited.response;

  const client = getClient();
  const langLine = l === 'en' ? 'Answer in English.' : 'Reponds en francais.';

  // Extraction des parametres — le modele ne voit aucun taux.
  const extraction = await client.messages.parse({
    model: MODEL,
    max_tokens: 4000,
    // Extraction de champs structures : aucun raisonnement necessaire, on
    // coupe le thinking pour tenir dans le budget temps de la fonction.
    thinking: { type: 'disabled' },
    output_config: { effort: 'low', format: zodOutputFormat(Params) },
    system: EXTRACT_SYSTEM,
    messages: [{ role: 'user', content: langLine + '\n\nDemande :\n' + query }],
  });

  if (extraction.stop_reason === 'refusal') return json(422, { error: 'refused' });
  const params = extraction.parsed_output;
  if (!params) return json(502, { error: 'unparsable_response' });

  applyOriginGuard(params);

  if (params.vehicle_price_eur == null) {
    return json(200, {
      ok: true,
      needs_price: true,
      params,
      message_fr: "Indiquez le prix d'achat du vehicule pour obtenir un chiffrage.",
      message_en: 'Please provide the purchase price to get a costing.',
    });
  }

  // Le chiffrage, en code. Aucun montant ne vient du modele.
  const costing = computeImportCost(params);

  return json(200, {
    ok: true,
    step: 'quote',
    needs_explain: true, // le client enchaine avec step:"explain"
    params,
    costing,
    ...disclaimers(),
  });
}

/* ── Etape 2 : redaction de l'explication a partir des parametres ────── */
async function handleExplain(event, body, l) {
  const query = typeof body.query === 'string' ? body.query.trim() : '';
  // Les parametres reviennent du client (issus de l'etape 1). On les revalide
  // et on RECALCULE le chiffrage ici : le client ne peut pas injecter de
  // montants, il ne fait que transmettre les parametres extraits.
  const check = Params.safeParse(body.params);
  if (!check.success) return json(400, { error: 'invalid_params' });
  const params = applyOriginGuard(check.data);

  if (params.vehicle_price_eur == null) return json(400, { error: 'missing_price' });

  const limited = await rateLimit(event, 'import-cost-explain', { limit: 12, windowMs: 3600000 });
  if (!limited.ok) return limited.response;

  const client = getClient();
  const langLine = l === 'en' ? 'Answer in English.' : 'Reponds en francais.';
  const costing = computeImportCost(params);

  const explanation = await client.messages.parse({
    model: MODEL,
    max_tokens: 3000,
    // Redaction a partir d'un chiffrage deja calcule : pas besoin de thinking,
    // et on reste ainsi sous le plafond temps de la fonction Netlify.
    thinking: { type: 'disabled' },
    output_config: { effort: 'low', format: zodOutputFormat(Explanation) },
    system: EXPLAIN_SYSTEM,
    messages: [{
      role: 'user',
      content:
        langLine + '\n\nDemande initiale du client :\n' + query +
        '\n\nParametres retenus (JSON) :\n' + JSON.stringify(params) +
        '\n\nCHIFFRAGE CALCULE — seule source de montants autorisee (JSON) :\n' + JSON.stringify(costing),
    }],
  });

  if (explanation.stop_reason === 'refusal') return json(422, { error: 'refused' });

  return json(200, {
    ok: true,
    step: 'explain',
    params,
    costing,
    explanation: explanation.parsed_output,
    ...disclaimers(),
  });
}

exports.handler = async function (event) {
  const parsed = parseBody(event, 256 * 1024);
  if (parsed.error) return parsed.error;
  const body = parsed.body;

  const notReady = requireKey();
  if (notReady) return notReady;

  const l = lang(body);

  try {
    return body.step === 'explain'
      ? await handleExplain(event, body, l)
      : await handleQuote(event, body, l);
  } catch (err) {
    return apiError(err);
  }
};
