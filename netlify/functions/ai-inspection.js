'use strict';

/**
 * Pre-rapport photo — creation du job (fonction SYNCHRONE, doit rester < 1 s).
 *
 * Analyse les photos d'une annonce et produit une liste de points a verifier.
 * Ce n'est PAS une expertise : c'est ce qu'un professionnel regarderait en
 * premier sur un jeu de photos, pour orienter la vraie inspection physique.
 *
 * L'analyse elle-meme (9-15 s) ne tient pas dans les 10 s d'une fonction
 * Netlify. Cette fonction ne fait donc que :
 *   1. valider le payload et le quota ;
 *   2. ecrire un job en base (table `ai_inspection_jobs`, status 'pending') ;
 *   3. declencher le worker `ai-inspection-run-background` (fonction background,
 *      plafond 15 min) ;
 *   4. renvoyer un `job_id` que le navigateur interroge ensuite via
 *      `ai-inspection-result`.
 * Le detail des modeles / prompts / schema vit dans `../lib/inspection`.
 */

const crypto = require('crypto');
const { json, rateLimit, parseBody, requireKey, lang, clientIp, getPool } = require('../lib/ai');
const {
  MAX_IMAGES, MAX_IMAGE_BYTES, ALLOWED_MEDIA, normalizeListingUrl,
  workerBaseUrl, triggerWorker,
} = require('../lib/inspection');

exports.handler = async function (event) {
  // 6 photos redimensionnees ~= 2 Mo de JSON ; 10 Mo laisse de la marge tout en
  // echouant proprement bien avant la limite plateforme Netlify (~6 Mo utiles).
  const parsed = parseBody(event, 10 * 1024 * 1024);
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
  for (const img of images) {
    if (!img || typeof img.data !== 'string' || !ALLOWED_MEDIA.has(img.media_type)) {
      return json(400, { error: 'invalid_image', allowed: [...ALLOWED_MEDIA] });
    }
    // Chaine base64 sans en-tete data: ; ~4/3 de la taille binaire.
    if (img.data.length * 0.75 > MAX_IMAGE_BYTES) {
      return json(413, { error: 'image_too_large' });
    }
  }

  const context = typeof body.context === 'string' ? body.context.trim().slice(0, 1500) : '';
  const listingUrl = normalizeListingUrl(body.listing_url);

  // Les images sont couteuses : quota plus serre que les autres outils.
  const limited = await rateLimit(event, 'inspection', { limit: 5, windowMs: 3600000 });
  if (!limited.ok) return limited.response;

  const pool = getPool();
  if (!pool) {
    return json(503, {
      error: 'jobs_unavailable',
      message_fr: "L’analyse est momentanément indisponible. Merci d’utiliser le formulaire de contact.",
      message_en: 'The analysis is unavailable right now. Please use the contact form.',
    });
  }

  const jobId = crypto.randomUUID();
  const request = {
    images: images.map((img) => ({ media_type: img.media_type, data: img.data })),
    context,
    listing_url: listingUrl || null,
  };

  try {
    await pool.query(
      `INSERT INTO ai_inspection_jobs (id, status, lang, request, image_count, listing_url, ip)
       VALUES ($1, 'pending', $2, $3::jsonb, $4, $5, $6)`,
      [jobId, l, JSON.stringify(request), images.length, listingUrl || null, clientIp(event)]
    );
  } catch (err) {
    console.error('ai-inspection : INSERT job', err && err.message);
    return json(503, {
      error: 'jobs_unavailable',
      detail: 'db ' + ((err && err.message) || 'inconnu').slice(0, 160),
      message_fr: "L’analyse est momentanément indisponible. Merci d’utiliser le formulaire de contact.",
      message_en: 'The analysis is unavailable right now. Please use the contact form.',
    });
  }

  const triggered = await triggerWorker(workerBaseUrl(event), jobId);
  console.log('ai-inspection : job', jobId, 'cree', images.length, 'photos, worker', triggered ? 'ok' : 'a relancer');

  return json(202, {
    ok: true,
    job_id: jobId,
    status: 'pending',
    poll_url: '/.netlify/functions/ai-inspection-result?job=' + jobId,
  });
};
