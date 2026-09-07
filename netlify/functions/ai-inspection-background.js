'use strict';

/**
 * Pre-rapport photo — traitement en tache de fond.
 *
 * L'analyse de plusieurs photos par un modele vision depasse le budget temps
 * d'une fonction Netlify synchrone. Cette fonction "background" (suffixe
 * `-background`, plafond 15 min) fait le travail sans contrainte de temps et
 * ecrit son resultat dans le magasin de jobs (Netlify Blobs). La page appelle
 * ensuite `ai-inspection-status` toutes les 2-3 s jusqu'a ce qu'il soit pret.
 *
 * Ce n'est PAS une expertise : c'est ce qu'un professionnel regarderait en
 * premier sur un jeu de photos, pour orienter la vraie inspection physique (PPI).
 * Le prompt et l'interface le disent tous les deux.
 */

const { z } = require('zod');
const { zodOutputFormat } = require('@anthropic-ai/sdk/helpers/zod');
const {
  getBackgroundClient, jobStore, rateLimit, parseBody, lang, classifyError,
} = require('../lib/ai');

// Fonction background : on peut viser la qualite sans surveiller le chrono.
// opus-5 + effort "medium" tient generalement en 1 a 2 min sur 6 photos.
const MODEL = process.env.ANTHROPIC_MODEL_INSPECTION || 'claude-opus-5';
const EFFORT = process.env.ANTHROPIC_EFFORT_INSPECTION || 'medium';

const MAX_IMAGES = 6;
const MAX_IMAGE_BYTES = 1.6 * 1024 * 1024; // apres redimensionnement cote client
const ALLOWED_MEDIA = new Set(['image/jpeg', 'image/png', 'image/webp']);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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
    zone: z.string().describe('Carrosserie, capote/toit, vitrage, interieur, moteur, trains roulants, pneumatiques, documents...'),
    finding: z.string().describe("Ce qui est visible sur la photo, factuel et precis. Nomme explicitement tout defaut net : scotch ou reparation de fortune, dechirure, rouille, cloquage, impact, ecart de teinte, piece rapportee."),
    severity: z.enum(['info', 'attention', 'alerte']),
  })).describe("Observations tirees uniquement de ce qui est visible. Tout defaut nettement visible DOIT y figurer."),
  checks: z.array(z.string()).describe("Points a verifier physiquement lors de l'inspection, classes du plus important au moins important. Chaque entree est une phrase complete et specifique a ce vehicule. Tableau vide si rien de pertinent — jamais d'entree vide."),
  questions_for_seller: z.array(z.string()).describe("Questions precises a poser au vendeur, formulees pour obtenir une reponse verifiable. Chaque entree est une phrase complete. Tableau vide si rien de pertinent — jamais d'entree vide ni de texte passe-partout."),
  documents_to_request: z.array(z.string()).describe("Documents a demander avant tout engagement. Chaque entree nomme un document precis. Tableau vide si rien de pertinent — jamais d'entree vide."),
  overall: z.string().describe("Synthese en 2 a 3 phrases completes, specifiques a ce vehicule. Prudente : les photos ne permettent pas de conclure sur l'etat mecanique. Jamais vide, jamais un texte passe-partout."),
});

const SYSTEM = `Tu es inspecteur vehicules pour The Bespoke Car. On te soumet les photos d'un vehicule — souvent celles d'une annonce trouvee ailleurs.

Ton travail : dire ce qu'un professionnel regarderait en premier, pour orienter une inspection physique. Pas rendre un verdict.

Methode — pour chaque photo, examine activement :
- Carrosserie : ecarts et alignement des ouvrants, difference de teinte ou de grain de peinture, cloquage, rouille, mastic, traces de choc ou de reparation.
- Capote ou toit ouvrant : dechirures, scotch ou reparation de fortune, coutures qui laachent, pieces rapportees, toile detendue ou lustree, lunette arriere jaunie, rayee ou decollee, mauvais ajustement.
- Vitrage : impacts, fissures, rayures d'essuie-glace, joints.
- Interieur : usure et dechirures de sellerie, craquelures du cuir, etat de la planche de bord, tapis, signes d'infiltration d'eau.
- Moteur si visible : fuites, corrosion, montages recents ou non conformes.
- Trains roulants et pneumatiques : usure, craquelures, date des pneus si lisible, disques, corrosion.
Ce qui est nettement visible et anormal DOIT apparaitre dans "observations". Ne minimise jamais un defaut evident — un scotch sur une capote, une dechirure, une trace de rouille — sous pretexte que les photos ne permettent pas de tout juger : decris ce que tu vois, puis renvoie la verification fine dans "checks".

Regles absolues :
- Tu ne decris QUE ce qui est visible sur les photos. Si une zone n'est pas photographiee, tu ne te prononces pas dessus : tu la mets dans "checks".
- Tu ne conclus jamais sur l'etat mecanique, l'historique d'entretien, un accident, un kilometrage ou l'authenticite a partir de photos. Tu peux signaler un indice visuel et dire quoi verifier.
- Tu n'estimes aucun prix et tu ne dis jamais si c'est une bonne affaire.
- Severite : "alerte" pour un defaut nettement visible et couteux (corrosion structurelle, ecarts de teinte ou d'ajustement marques, choc, capote hors d'usage) ; "attention" pour un defaut visible a confirmer ; "info" pour un simple point de vigilance.
- Tu signales franchement quand le jeu de photos est trop pauvre pour dire quoi que ce soit d'utile.
- Si les images ne montrent pas de vehicule, dis-le dans "identification" et laisse les autres tableaux vides.

Remplissage interdit : n'ecris jamais de phrase de remplissage ni de texte generique. Chaque entree de "checks", "questions_for_seller" et "documents_to_request" est une phrase complete et specifique. Si une de ces listes n'a rien de pertinent, renvoie un tableau vide plutot qu'une entree vide. "overall" est toujours une vraie synthese, jamais un espace ni un texte passe-partout.

Ton sobre et professionnel. Pas de flatterie, pas d'alarmisme. Redige dans la langue demandee.`;

const DISCLAIMER_FR = "Pre-rapport indicatif etabli a partir de photos uniquement. Il ne remplace en aucun cas une inspection physique (PPI) ni une expertise. Aucune conclusion sur l'etat mecanique, l'historique ou l'authenticite ne peut etre tiree de photographies.";
const DISCLAIMER_EN = 'Indicative pre-report based on photographs only. It is in no way a substitute for a physical pre-purchase inspection or a formal appraisal. No conclusion about mechanical condition, history or authenticity can be drawn from photographs.';

function message(code) {
  if (code === 'rate_limited') {
    return {
      message_fr: "Vous avez atteint la limite d'utilisation. Merci de reessayer dans une heure, ou de nous ecrire directement.",
      message_en: 'You have reached the usage limit. Please try again in an hour, or write to us directly.',
    };
  }
  return {
    message_fr: "L’analyse est momentanement indisponible. Merci d’utiliser le formulaire de contact.",
    message_en: 'The analysis is unavailable right now. Please use the contact form.',
  };
}

exports.handler = async function (event) {
  const parsed = parseBody(event, 12 * 1024 * 1024);
  if (parsed.error) return { statusCode: 202 };
  const body = parsed.body;

  const jobId = typeof body.job_id === 'string' && UUID_RE.test(body.job_id) ? body.job_id : null;
  if (!jobId) {
    console.error('ai-inspection-background : job_id absent ou invalide');
    return { statusCode: 202 };
  }

  const store = jobStore(event);
  if (!store) {
    console.error('ai-inspection-background : magasin de jobs indisponible');
    return { statusCode: 202 };
  }

  const l = lang(body);
  const finish = (fields) => store.setJSON(jobId, { ...fields, updated_at: Date.now() });
  const fail = (code) => finish({ status: 'error', error_code: code, ...message(code) });

  try {
    await finish({ status: 'pending' });

    const client = getBackgroundClient();
    if (!client) return void await fail('ai_not_configured');

    const images = Array.isArray(body.images) ? body.images : [];
    if (!images.length || images.length > MAX_IMAGES) return void await fail('invalid_request');

    const content = [];
    for (const img of images) {
      if (!img || typeof img.data !== 'string' || !ALLOWED_MEDIA.has(img.media_type)) {
        return void await fail('invalid_request');
      }
      // Une chaine base64 sans en-tete data: ; ~4/3 de la taille binaire.
      if (img.data.length * 0.75 > MAX_IMAGE_BYTES) return void await fail('invalid_request');
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
    if (!limited.ok) return void await fail('rate_limited');

    const response = await client.messages.parse({
      model: MODEL,
      max_tokens: 8000,
      thinking: { type: 'adaptive' },
      output_config: { effort: EFFORT, format: zodOutputFormat(Report) },
      system: SYSTEM,
      messages: [{ role: 'user', content }],
    });

    if (response.stop_reason === 'refusal') return void await fail('refused');
    const report = response.parsed_output;
    if (!report) return void await fail('unparsable_response');

    await finish({
      status: 'done',
      result: {
        report,
        image_count: images.length,
        listing_url: listingUrl || null,
        disclaimer_fr: DISCLAIMER_FR,
        disclaimer_en: DISCLAIMER_EN,
        usage: {
          input_tokens: response.usage.input_tokens,
          output_tokens: response.usage.output_tokens,
        },
      },
    });
  } catch (err) {
    console.error('ai-inspection-background', err && err.message);
    try { await fail(classifyError(err)); } catch (_) { /* rien de plus a faire */ }
  }

  return { statusCode: 202 };
};
