'use strict';

/**
 * Concierge de sourcing.
 * Transforme une demande en langage naturel en brief structure, puis confronte
 * ce brief au stock disponible. Le classement et le commentaire viennent du
 * modele ; la decision d'achat reste humaine.
 */

const { z } = require('zod');
const { zodOutputFormat } = require('@anthropic-ai/sdk/helpers/zod');
const {
  MODEL, getClient, json, rateLimit, parseBody, requireKey, lang, apiError,
  loadStock, compactVehicle,
} = require('../lib/ai');

const Brief = z.object({
  summary: z.string().describe('Reformulation du besoin en une phrase, dans la langue du client.'),
  makes: z.array(z.string()).describe('Marques ou familles de marques visees. Vide si non exprime.'),
  body_styles: z.array(z.string()).describe('Carrosseries visees (coupe, cabriolet, berline...). Vide si non exprime.'),
  year_min: z.number().nullable(),
  year_max: z.number().nullable(),
  budget_eur_max: z.number().nullable(),
  transmission: z.enum(['manuelle', 'automatique', 'indifferent']),
  usage: z.string().describe("Usage vise : collection, plaisir, route, piste, investissement, inconnu."),
  must_have: z.array(z.string()).describe('Criteres non negociables deduits de la demande.'),
  nice_to_have: z.array(z.string()),
  open_questions: z.array(z.string()).describe('2 a 4 questions de cadrage a poser au client pour affiner la recherche.'),
  matches: z.array(z.object({
    id: z.string().describe('id exact d un vehicule du catalogue fourni.'),
    score: z.number().describe('Pertinence de 0 a 100.'),
    why: z.string().describe('Pourquoi ce vehicule correspond, ou sur quel point il devie du brief.'),
  })).describe('Vehicules du catalogue classes par pertinence. Tableau vide si rien ne correspond serieusement.'),
  no_match_advice: z.string().describe("Si aucun vehicule ne correspond, ce que Bespoke peut chercher pour le client. Chaine vide sinon."),
});

const SYSTEM = `Tu es le concierge de sourcing de The Bespoke Car, maison de sourcing et d'import de voitures de collection et de prestige (Sophia-Antipolis, France).

Ton role : transformer la demande libre d'un client en brief d'acquisition structure, puis le confronter au catalogue fourni.

Regles :
- Ne recommande QUE des vehicules presents dans le catalogue fourni, en reprenant leur "id" a l'identique. N'invente jamais un vehicule, un prix ou une annee.
- Un vehicule dont le statut est "sold" ne doit jamais apparaitre dans matches.
- Sois honnete sur les ecarts : si le seul vehicule proche depasse le budget ou n'a pas la bonne boite, dis-le dans "why" plutot que de le survendre.
- Si rien ne correspond serieusement, renvoie matches vide et explique dans no_match_advice ce que Bespoke peut aller chercher (marches, delais realistes).
- Les questions de cadrage doivent etre celles d'un professionnel : usage reel, tolerance au kilometrage, exigences de matching numbers, historique documente, pays de livraison, delai.
- Tu ne donnes aucun conseil financier ni aucune promesse de valorisation future.
- Redige dans la langue demandee, sur un ton sobre et professionnel. Pas de superlatifs commerciaux.`;

exports.handler = async function (event) {
  const parsed = parseBody(event, 256 * 1024);
  if (parsed.error) return parsed.error;
  const body = parsed.body;

  const notReady = requireKey();
  if (notReady) return notReady;

  const l = lang(body);
  const query = typeof body.query === 'string' ? body.query.trim() : '';
  if (query.length < 10) {
    return json(400, {
      error: 'query_too_short',
      message_fr: 'Merci de decrire votre recherche en quelques mots de plus.',
      message_en: 'Please describe what you are looking for in a little more detail.',
    });
  }
  if (query.length > 4000) {
    return json(400, { error: 'query_too_long' });
  }

  const limited = await rateLimit(event, 'concierge', { limit: 12, windowMs: 3600000 });
  if (!limited.ok) return limited.response;

  let catalogue;
  try {
    const items = await loadStock();
    catalogue = items.filter((i) => i.status !== 'sold').map((i) => compactVehicle(i, l));
  } catch (err) {
    console.error('Chargement du stock impossible:', err.message);
    return json(503, { error: 'catalogue_unavailable' });
  }

  try {
    const response = await getClient().messages.parse({
      model: MODEL,
      max_tokens: 8000,
      thinking: { type: 'adaptive' },
      output_config: { effort: 'low', format: zodOutputFormat(Brief) },
      // Prefixe stable en premier : le catalogue est mis en cache entre les appels.
      system: [
        { type: 'text', text: SYSTEM },
        {
          type: 'text',
          text: 'CATALOGUE DISPONIBLE (JSON) :\n' + JSON.stringify(catalogue),
          cache_control: { type: 'ephemeral' },
        },
      ],
      messages: [
        {
          role: 'user',
          content:
            (l === 'en' ? 'Answer in English.\n\n' : 'Reponds en francais.\n\n') +
            'Demande du client :\n' + query,
        },
      ],
    });

    if (response.stop_reason === 'refusal') {
      return json(422, { error: 'refused' });
    }
    const brief = response.parsed_output;
    if (!brief) return json(502, { error: 'unparsable_response' });

    // Le modele ne renvoie que des identifiants : on rattache les fiches
    // cote serveur pour que le front n'affiche que des donnees du catalogue.
    const byId = new Map(catalogue.map((v) => [v.id, v]));
    const matches = (brief.matches || [])
      .filter((m) => byId.has(m.id))
      .slice(0, 6)
      .map((m) => ({ ...m, vehicle: byId.get(m.id) }));

    return json(200, {
      ok: true,
      brief: { ...brief, matches },
      disclaimer_fr: "Analyse indicative generee automatiquement, revue par notre equipe avant toute suite. Ne constitue ni un conseil financier ni un engagement contractuel.",
      disclaimer_en: 'Indicative, automatically generated analysis, reviewed by our team before any next step. Not financial advice and not a contractual commitment.',
      usage: {
        input_tokens: response.usage.input_tokens,
        output_tokens: response.usage.output_tokens,
        cache_read_input_tokens: response.usage.cache_read_input_tokens,
      },
    });
  } catch (err) {
    return apiError(err);
  }
};
