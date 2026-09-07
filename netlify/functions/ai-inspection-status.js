'use strict';

/**
 * Statut d'un pre-rapport photo lance en tache de fond (ai-inspection-background).
 * La page appelle cet endpoint toutes les 2-3 s avec l'identifiant du job jusqu'a
 * ce que le statut passe a "done" ou "error".
 *
 * Reponses (toujours 200, le polling ne doit pas traiter un code d'erreur comme
 * un echec definitif) :
 *   { status: 'pending' }
 *   { status: 'done', ok: true, report, image_count, listing_url, disclaimer_fr, disclaimer_en, usage }
 *   { status: 'error', message_fr, message_en }
 */

const { json, jobStore } = require('../lib/ai');

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const UNAVAILABLE = {
  message_fr: "L’analyse est momentanement indisponible. Merci d’utiliser le formulaire de contact.",
  message_en: 'The analysis is unavailable right now. Please use the contact form.',
};

exports.handler = async function (event) {
  if (event.httpMethod !== 'GET') return json(405, { error: 'method_not_allowed' });

  const id = (event.queryStringParameters || {}).id || '';
  if (!UUID_RE.test(id)) return json(400, { error: 'bad_id' });

  const store = jobStore(event);
  if (!store) return json(200, { status: 'error', ...UNAVAILABLE });

  let job;
  try {
    job = await store.get(id, { type: 'json', consistency: 'strong' });
  } catch (err) {
    // Panne transitoire du magasin : on laisse la page reessayer.
    console.error('ai-inspection-status', err && err.message);
    return json(200, { status: 'pending' });
  }

  // Pas encore ecrit : la fonction background demarre peut-etre tout juste.
  if (!job) return json(200, { status: 'pending' });

  if (job.status === 'done') {
    return json(200, { status: 'done', ok: true, ...(job.result || {}) });
  }
  if (job.status === 'error') {
    return json(200, {
      status: 'error',
      error_code: job.error_code || null,
      detail: job.detail || null,
      message_fr: job.message_fr || UNAVAILABLE.message_fr,
      message_en: job.message_en || UNAVAILABLE.message_en,
    });
  }
  return json(200, { status: 'pending' });
};
