'use strict';

/**
 * Pre-rapport photo — reception des photos et lancement du traitement.
 *
 * Les fonctions "background" de Netlify plafonnent la requete entrante a 256 Ko :
 * impossible de leur envoyer des photos directement. Cette fonction synchrone
 * (plafond 6 Mo) recoit le lot, l'ecrit dans le magasin de jobs (Netlify Blobs),
 * puis declenche `ai-inspection-background` avec le seul identifiant du job.
 * La page interroge ensuite `ai-inspection-status` par polling.
 */

const {
  json, jobStore, rateLimit, parseBody, lang,
} = require('../lib/ai');

const MAX_IMAGES = 6;
const MAX_IMAGE_BYTES = 1.6 * 1024 * 1024; // apres redimensionnement cote client
const ALLOWED_MEDIA = new Set(['image/jpeg', 'image/png', 'image/webp']);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const UNAVAILABLE = {
  message_fr: "L’analyse est momentanement indisponible. Merci d’utiliser le formulaire de contact.",
  message_en: 'The analysis is unavailable right now. Please use the contact form.',
};

/** URL absolue de ce deploiement, pour rappeler une autre fonction du meme site. */
function siteBase(event) {
  const h = event.headers || {};
  const host = h['x-forwarded-host'] || h.host;
  const proto = h['x-forwarded-proto'] || 'https';
  if (host) return proto + '://' + host;
  return (process.env.DEPLOY_PRIME_URL || process.env.URL || '').replace(/\/$/, '');
}

exports.handler = async function (event) {
  const parsed = parseBody(event, 8 * 1024 * 1024);
  if (parsed.error) return parsed.error;
  const body = parsed.body;

  const jobId = typeof body.job_id === 'string' && UUID_RE.test(body.job_id) ? body.job_id : null;
  if (!jobId) return json(400, { error: 'bad_id', ...UNAVAILABLE });

  const images = Array.isArray(body.images) ? body.images : [];
  if (!images.length || images.length > MAX_IMAGES) {
    return json(400, { error: 'invalid_request', ...UNAVAILABLE });
  }
  for (const img of images) {
    if (!img || typeof img.data !== 'string' || !ALLOWED_MEDIA.has(img.media_type)) {
      return json(400, { error: 'invalid_request', ...UNAVAILABLE });
    }
    if (img.data.length * 0.75 > MAX_IMAGE_BYTES) {
      return json(413, { error: 'payload_too_large', ...UNAVAILABLE });
    }
  }

  const store = jobStore(event);
  if (!store) return json(503, { error: 'ai_not_configured', ...UNAVAILABLE });

  // Les images sont couteuses en tokens : quota plus serre que les autres outils.
  const limited = await rateLimit(event, 'inspection', { limit: 5, windowMs: 3600000 });
  if (!limited.ok) return limited.response;

  try {
    await store.setJSON(jobId + '/input', {
      lang: lang(body),
      context: typeof body.context === 'string' ? body.context : '',
      listing_url: typeof body.listing_url === 'string' ? body.listing_url : '',
      images,
    });
    await store.setJSON(jobId, { status: 'pending', updated_at: Date.now() });
  } catch (err) {
    console.error('ai-inspection-start : ecriture Blobs', err && err.message);
    return json(503, { error: 'ai_not_configured', ...UNAVAILABLE });
  }

  // Declenche la fonction background. Elle repond 202 sans attendre la fin ;
  // si l'appel echoue, on marque le job en erreur pour que le polling s'arrete.
  try {
    const res = await fetch(siteBase(event) + '/.netlify/functions/ai-inspection-background', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ job_id: jobId }),
    });
    if (res.status !== 202 && !res.ok) {
      throw new Error('kickoff HTTP ' + res.status);
    }
  } catch (err) {
    console.error('ai-inspection-start : lancement background', err && err.message);
    try {
      await store.setJSON(jobId, {
        status: 'error', error_code: 'kickoff_failed',
        detail: String(err && err.message).slice(0, 300),
        ...UNAVAILABLE, updated_at: Date.now(),
      });
    } catch (_) { /* rien de plus a faire */ }
    return json(502, { error: 'kickoff_failed', ...UNAVAILABLE });
  }

  return json(200, { ok: true });
};
