'use strict';

/**
 * Pre-rapport photo.
 *
 * Analyse les photos d'une annonce ou d'un vehicule et produit une liste de
 * points a verifier. Ce n'est PAS une expertise : c'est ce qu'un professionnel
 * regarderait en premier sur un jeu de photos, pour orienter la vraie
 * inspection physique (PPI). Le prompt et l'interface le disent tous les deux.
 */

const { z } = require('zod');
const { zodOutputFormat } = require('@anthropic-ai/sdk/helpers/zod');
const { MODEL, getClient, json, rateLimit, parseBody, requireKey, lang, apiError } = require('../lib/ai');

const MAX_IMAGES = 6;
const MAX_IMAGE_BYTES = 1.6 * 1024 * 1024; // apres redimensionnement cote client
const ALLOWED_MEDIA = new Set(['image/jpeg', 'image/png', 'image/webp']);

/** N'accepte qu'une URL http(s) plausible. Retourne '' si invalide. */
function normalizeListingUrl(v) {
  if (typeof v !== 'string') return '';
  const s = v.trim();
  if (!s || s.length > 2000) return '';
  try {
    const u = new URL(s);
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return '';
    return u.toString();
  } catch (_) {
    return '';
  }
}

const Report = z.object({
  identification: z.string().describe("Ce que montrent les photos : type de vehicule, epoque probable, modele si reconnaissable. Dis explicitement si tu n'es pas sur."),
  photo_quality: z.string().describe("Ce que le jeu de photos permet — et surtout ne permet pas — de juger. Angles manquants, eclairage, cadrage trop serre."),
  observations: z.array(z.object({
    zone: z.string().describe('Carrosserie, interieur, moteur, trains roulants, pneumatiques, documents...'),
    finding: z.string().describe('Ce qui est visible sur la photo. Descriptif, factuel.'),
    severity: z.enum(['info', 'attention', 'alerte']),
  })).describe('Observations tirees uniquement de ce qui est visible.'),
  checks: z.array(z.string()).describe("Points a verifier physiquement lors de l'inspection, classes du plus important au moins important."),
  questions_for_seller: z.array(z.string()).describe('Questions precises a poser au vendeur, formulees pour obtenir une reponse verifiable.'),
  documents_to_request: z.array(z.string()).describe('Documents a demander avant tout engagement.'),
  overall: z.string().describe("Synthese en 2 a 3 phrases. Prudente : les photos ne permettent pas de conclure sur l'etat mecanique."),
});

const SYSTEM = `Tu es inspecteur vehicules pour The Bespoke Car. On te soumet les photos d'un vehicule — souvent celles d'une annonce trouvee ailleurs.

Ton travail : dire ce qu'un professionnel regarderait en premier, pour orienter une inspection physique. Pas rendre un verdict.

Regles absolues :
- Tu ne decris QUE ce qui est visible sur les photos. Si une zone n'est pas photographiee, tu ne te prononces pas dessus : tu la mets dans "checks".
- Tu ne conclus jamais sur l'etat mecanique, l'historique d'entretien, un accident, un kilometrage ou l'authenticite a partir de photos. Tu peux signaler un indice visuel et dire quoi verifier.
- Tu n'estimes aucun prix et tu ne dis jamais si c'est une bonne affaire.
- Une severite "alerte" est reservee a ce qui est nettement visible et couteux (corrosion structurelle apparente, ecarts de teinte ou d'ajustement marques, trace de choc). En cas de doute, "attention".
- Tu signales franchement quand le jeu de photos est trop pauvre pour dire quoi que ce soit d'utile.
- Si les images ne montrent pas de vehicule, dis-le dans "identification" et laisse les autres tableaux vides.
- Ton sobre et professionnel. Pas de flatterie, pas d'alarmisme. Redige dans la langue demandee.`;

exports.handler = async function (event) {
  const parsed = parseBody(event, 12 * 1024 * 1024);
  if (parsed.error) return parsed.error;
  const body = parsed.body;

  const notReady = requireKey();
  if (notReady) return notReady;

  const l = lang(body);
  const images = Array.isArray(body.images) ? body.images : [];

  if (!images.length) {
    return json(400, {
      error: 'no_images',
      message_fr: 'Ajoutez au moins une photo.',
      message_en: 'Please add at least one photo.',
    });
  }
  if (images.length > MAX_IMAGES) {
    return json(400, { error: 'too_many_images', max: MAX_IMAGES });
  }

  const content = [];
  for (const img of images) {
    if (!img || typeof img.data !== 'string' || !ALLOWED_MEDIA.has(img.media_type)) {
      return json(400, { error: 'invalid_image', allowed: [...ALLOWED_MEDIA] });
    }
    // Une chaine base64 sans en-tete data: ; ~4/3 de la taille binaire.
    if (img.data.length * 0.75 > MAX_IMAGE_BYTES) {
      return json(413, { error: 'image_too_large' });
    }
    content.push({
      type: 'image',
      source: { type: 'base64', media_type: img.media_type, data: img.data },
    });
  }

  const context = typeof body.context === 'string' ? body.context.trim().slice(0, 1500) : '';
  const listingUrl = normalizeListingUrl(body.listing_url);
  content.push({
    type: 'text',
    text:
      (l === 'en' ? 'Answer in English.' : 'Reponds en francais.') +
      '\n\n' + (context
        ? "Ce que le client indique sur le vehicule (a prendre comme declaratif, non verifie) :\n" + context
        : "Le client n'a fourni aucune information : travaille uniquement sur les photos.") +
      (listingUrl
        ? "\n\nLien de l'annonce indique par le client : " + listingUrl +
          "\nTu ne peux pas ouvrir ce lien. Ne suppose rien de son contenu ; tout au plus, situe le marche d'origine d'apres le domaine si c'est utile pour les questions au vendeur ou les documents a demander."
        : ''),
  });

  // Les images sont couteuses en tokens : quota plus serre que les autres outils.
  const limited = await rateLimit(event, 'inspection', { limit: 5, windowMs: 3600000 });
  if (!limited.ok) return limited.response;

  try {
    const response = await getClient().messages.parse({
      model: MODEL,
      max_tokens: 8000,
      thinking: { type: 'adaptive' },
      output_config: { effort: 'low', format: zodOutputFormat(Report) },
      system: SYSTEM,
      messages: [{ role: 'user', content }],
    });

    if (response.stop_reason === 'refusal') return json(422, { error: 'refused' });
    const report = response.parsed_output;
    if (!report) return json(502, { error: 'unparsable_response' });

    return json(200, {
      ok: true,
      report,
      image_count: images.length,
      listing_url: listingUrl || null,
      disclaimer_fr: "Pre-rapport indicatif etabli a partir de photos uniquement. Il ne remplace en aucun cas une inspection physique (PPI) ni une expertise. Aucune conclusion sur l'etat mecanique, l'historique ou l'authenticite ne peut etre tiree de photographies.",
      disclaimer_en: 'Indicative pre-report based on photographs only. It is in no way a substitute for a physical pre-purchase inspection or a formal appraisal. No conclusion about mechanical condition, history or authenticity can be drawn from photographs.',
      usage: {
        input_tokens: response.usage.input_tokens,
        output_tokens: response.usage.output_tokens,
      },
    });
  } catch (err) {
    return apiError(err);
  }
};
