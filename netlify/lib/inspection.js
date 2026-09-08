'use strict';

/**
 * Socle commun au pre-rapport photo, partage entre :
 *  - `ai-inspection.js`            : cree le job (synchrone, rapide) ;
 *  - `ai-inspection-run-background`: appelle Claude (background, 15 min) ;
 *  - `ai-inspection-result.js`     : renvoie l'etat du job au navigateur.
 *
 * Historique : la version synchrone directe ne tenait pas dans les 10 s d'une
 * fonction Netlify (analyse vision + schema structure = 9-15 s selon la charge
 * API). Une quinzaine d'essais a coups de "moins de photos / moins de
 * resolution / Haiku au lieu de Sonnet" a degrade le rapport sans supprimer les
 * timeouts. On sort donc l'analyse du cycle requete/reponse : file d'attente en
 * base, worker en fonction background, navigateur qui interroge l'etat. Le
 * temps n'etant plus contraint, on repasse sur un modele de qualite et un jeu
 * de photos complet.
 */

const { z } = require('zod');

// Le temps n'est plus la contrainte : 6 photos, pleine definition raisonnable.
const MAX_IMAGES = 6;
const MAX_IMAGE_BYTES = 2.2 * 1024 * 1024; // apres redimensionnement cote client
const ALLOWED_MEDIA = new Set(['image/jpeg', 'image/png', 'image/webp']);

// Sonnet-5 : meilleure detection fine (scotch peu contraste sur une capote
// sombre, ecarts de teinte, micro-corrosion). On peut se le permettre puisque
// le worker tourne en background. Surchargeable par var d'env.
const INSPECTION_MODEL = process.env.ANTHROPIC_MODEL_INSPECTION || 'claude-sonnet-5';

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

Methode — pour chaque photo, examine activement, en zoomant mentalement sur chaque zone :
- Carrosserie : ecarts et alignement des ouvrants, difference de teinte ou de grain de peinture, cloquage, rouille, mastic, traces de choc ou de reparation.
- Capote ou toit ouvrant : regarde la toile de pres. Toute bande de ruban adhesif ou de scotch (souvent NOIR sur une capote sombre, donc peu contraste — cherche-le), toute zone recollee, rapiecee, d'une matiere ou d'une brillance differente du reste : c'est une capote DECHIREE ou PERCEE, reparee a la va-vite. C'est une "alerte", decrite mot pour mot ("bande de scotch noir sur le pan gauche de la capote", pas "toit d'aspect correct"). Aussi : coutures qui laachent, toile detendue ou lustree, lunette arriere jaunie, rayee, plissee ou decollee, mauvais ajustement.
- Vitrage : impacts, fissures, rayures d'essuie-glace, joints.
- Interieur : usure et dechirures de sellerie, craquelures du cuir, etat de la planche de bord, tapis, signes d'infiltration d'eau.
- Moteur si visible : fuites, corrosion, montages recents ou non conformes.
- Trains roulants et pneumatiques : usure, craquelures, date des pneus si lisible, disques, corrosion.
Ce qui est nettement visible et anormal DOIT apparaitre dans "observations". Ne minimise jamais un defaut evident — un scotch sur une capote, une dechirure, une trace de rouille — sous pretexte que les photos ne permettent pas de tout juger : decris ce que tu vois, puis renvoie la verification fine dans "checks".

Interdit : les formules qui noient un defaut visible ("a distance", "sans trace evidente", "etat de fermeture regulier", "rien d'anormal apparent") alors qu'un element franchement anormal est dans le cadre. Si tu vois du scotch, un adhesif, une piece maintenue par du ruban, une bache ou un patch de fortune, une dechirure, une couture ouverte : c'est une observation "alerte", nommee explicitement, meme si le reste de la photo est net. Une capote de cabriolet reparee au scotch n'est jamais une "note".

Regles absolues :
- Tu ne decris QUE ce qui est visible sur les photos. Si une zone n'est pas photographiee, tu ne te prononces pas dessus : tu la mets dans "checks".
- Tu ne conclus jamais sur l'etat mecanique, l'historique d'entretien, un accident, un kilometrage ou l'authenticite a partir de photos. Tu peux signaler un indice visuel et dire quoi verifier.
- Tu n'estimes aucun prix et tu ne dis jamais si c'est une bonne affaire.
- Severite : "alerte" pour un defaut nettement visible et couteux (corrosion structurelle, ecarts de teinte ou d'ajustement marques, choc, capote hors d'usage) ; "attention" pour un defaut visible a confirmer ; "info" pour un simple point de vigilance.
- Tu signales franchement quand le jeu de photos est trop pauvre pour dire quoi que ce soit d'utile.
- Si les images ne montrent pas de vehicule, dis-le dans "identification" et laisse les autres tableaux vides.

Remplissage interdit : n'ecris jamais de phrase de remplissage ni de texte generique. Chaque entree de "checks", "questions_for_seller" et "documents_to_request" est une phrase complete et specifique. Si une de ces listes n'a rien de pertinent, renvoie un tableau vide plutot qu'une entree vide. "overall" est toujours une vraie synthese, jamais un espace ni un texte passe-partout.

Ton sobre et professionnel. Pas de flatterie, pas d'alarmisme. Redige dans la langue demandee.`;

// Schema JSON de l'outil force, ecrit a la main.
// NE PAS deriver de Zod via `zodOutputFormat` : ce helper vise la fonctionnalite
// "structured outputs", pas un `input_schema` d'outil. Il rendait l'enum de
// `severity` en simple texte et truffait le schema de $ref/$defs auto-nommes —
// resultat, Sonnet emboitait tout le rapport sous une cle parasite. Un schema
// plat et explicite reste la reference ; `Report` (Zod) ne sert plus qu'a
// valider la reponse.
const REPORT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'identification', 'photo_quality', 'observations',
    'checks', 'questions_for_seller', 'documents_to_request', 'overall',
  ],
  properties: {
    identification: {
      type: 'string',
      description: "Ce que montrent les photos : type de vehicule, epoque probable, modele si reconnaissable. Dis explicitement si tu n'es pas sur.",
    },
    photo_quality: {
      type: 'string',
      description: "Ce que le jeu de photos permet — et surtout ne permet pas — de juger. Angles manquants, eclairage, cadrage trop serre.",
    },
    observations: {
      type: 'array',
      description: "Observations tirees uniquement de ce qui est visible. Tout defaut nettement visible DOIT y figurer.",
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['zone', 'finding', 'severity'],
        properties: {
          zone: {
            type: 'string',
            description: 'Carrosserie, capote/toit, vitrage, interieur, moteur, trains roulants, pneumatiques, documents...',
          },
          finding: {
            type: 'string',
            description: "Ce qui est visible sur la photo, factuel et precis. Nomme explicitement tout defaut net : scotch ou reparation de fortune, dechirure, rouille, cloquage, impact, ecart de teinte, piece rapportee.",
          },
          severity: {
            type: 'string',
            enum: ['info', 'attention', 'alerte'],
            description: "'alerte' = defaut net et couteux ; 'attention' = defaut visible a confirmer ; 'info' = simple point de vigilance.",
          },
        },
      },
    },
    checks: {
      type: 'array',
      description: "Points a verifier physiquement lors de l'inspection, classes du plus important au moins important. Chaque entree est une phrase complete et specifique a ce vehicule. Tableau vide si rien de pertinent — jamais d'entree vide.",
      items: { type: 'string' },
    },
    questions_for_seller: {
      type: 'array',
      description: "Questions precises a poser au vendeur, formulees pour obtenir une reponse verifiable. Chaque entree est une phrase complete. Tableau vide si rien de pertinent — jamais d'entree vide ni de texte passe-partout.",
      items: { type: 'string' },
    },
    documents_to_request: {
      type: 'array',
      description: "Documents a demander avant tout engagement. Chaque entree nomme un document precis. Tableau vide si rien de pertinent — jamais d'entree vide.",
      items: { type: 'string' },
    },
    overall: {
      type: 'string',
      description: "Synthese en 2 a 3 phrases completes, specifiques a ce vehicule. Prudente : les photos ne permettent pas de conclure sur l'etat mecanique. Jamais vide, jamais un texte passe-partout.",
    },
  },
};

const DISCLAIMER_FR = "Pre-rapport indicatif etabli a partir de photos uniquement. Il ne remplace en aucun cas une inspection physique (PPI) ni une expertise. Aucune conclusion sur l'etat mecanique, l'historique ou l'authenticite ne peut etre tiree de photographies.";
const DISCLAIMER_EN = 'Indicative pre-report based on photographs only. It is in no way a substitute for a physical pre-purchase inspection or a formal appraisal. No conclusion about mechanical condition, history or authenticity can be drawn from photographs.';

const WORKER_PATH = '/.netlify/functions/ai-inspection-run-background';

/** URL de base du deploiement courant, pour appeler le worker sur le MEME deploy
 *  (indispensable sur les deploy previews : `<id>--site.netlify.app`). */
function workerBaseUrl(event) {
  const h = (event && event.headers) || {};
  const host = h['x-forwarded-host'] || h.host;
  if (host) {
    const proto = String(h['x-forwarded-proto'] || 'https').split(',')[0].trim();
    return proto + '://' + host;
  }
  return process.env.DEPLOY_URL || process.env.DEPLOY_PRIME_URL || process.env.URL || '';
}

/** Declenche (ou relance) le worker background pour un job. Best-effort :
 *  abandonne au bout de 5 s sans faire echouer l'appelant. */
async function triggerWorker(base, jobId) {
  if (!base) return false;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 5000);
  try {
    await fetch(base + WORKER_PATH, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobId }),
      signal: ctrl.signal,
    });
    return true;
  } catch (_) {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/** Construit le bloc `content` du message utilisateur (images + consigne). */
function buildUserContent({ images, context, listingUrl, l }) {
  const content = images.map((img) => ({
    type: 'image',
    source: { type: 'base64', media_type: img.media_type, data: img.data },
  }));
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
  return content;
}

module.exports = {
  MAX_IMAGES,
  MAX_IMAGE_BYTES,
  ALLOWED_MEDIA,
  INSPECTION_MODEL,
  normalizeListingUrl,
  WORKER_PATH,
  workerBaseUrl,
  triggerWorker,
  Report,
  REPORT_SCHEMA,
  SYSTEM,
  DISCLAIMER_FR,
  DISCLAIMER_EN,
  buildUserContent,
};
