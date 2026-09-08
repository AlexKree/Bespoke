'use strict';

/**
 * Pre-rapport photo — etat du job (fonction SYNCHRONE, rapide).
 *
 * Le navigateur interroge cette fonction toutes les ~2,5 s apres avoir recu un
 * `job_id` de `ai-inspection`. Reponses :
 *   - { ok:true,  status:'pending'|'running' }        -> continuer a interroger
 *   - { ok:true,  status:'done',  report, ... }       -> afficher le rapport
 *   - { ok:false, status:'error', message_fr, ... }   -> afficher l'erreur
 *
 * Filet de securite : si un job est encore 'pending' plusieurs secondes apres
 * sa creation, c'est que le declenchement initial du worker s'est perdu. On le
 * relance ici (best-effort) et on repousse `updated_at` pour ne pas le relancer
 * a chaque interrogation.
 */

const { json, getPool } = require('../lib/ai');
const { workerBaseUrl, triggerWorker } = require('../lib/inspection');

const ERROR_MESSAGES = {
  timeout: {
    fr: "L’analyse a pris trop de temps. Réessayez avec moins de photos, ou utilisez le formulaire de contact.",
    en: 'The analysis took too long. Try again with fewer photos, or use the contact form.',
  },
  refused: {
    fr: "L’analyse n’a pas pu aboutir sur ces photos. Merci d’utiliser le formulaire de contact.",
    en: 'The analysis could not be completed on these photos. Please use the contact form.',
  },
  upstream_rate_limited: {
    fr: "Le service d’analyse est temporairement saturé. Merci de réessayer dans quelques minutes.",
    en: 'The analysis service is temporarily overloaded. Please try again in a few minutes.',
  },
  _default: {
    fr: "L’analyse est momentanément indisponible. Merci d’utiliser le formulaire de contact.",
    en: 'The analysis is unavailable right now. Please use the contact form.',
  },
};

function readJobId(event) {
  const q = event.queryStringParameters || {};
  if (q.job || q.jobId) return String(q.job || q.jobId);
  try {
    const raw = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString('utf8') : (event.body || '');
    const b = JSON.parse(raw || '{}');
    return String(b.job || b.jobId || '');
  } catch (_) {
    return '';
  }
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'GET' && event.httpMethod !== 'POST') {
    return json(405, { error: 'method_not_allowed' });
  }

  const jobId = readJobId(event);
  if (!jobId || jobId.length > 64) {
    return json(400, { error: 'bad_job_id' });
  }

  const pool = getPool();
  if (!pool) {
    return json(503, {
      ok: false,
      status: 'error',
      error: 'jobs_unavailable',
      message_fr: ERROR_MESSAGES._default.fr,
      message_en: ERROR_MESSAGES._default.en,
    });
  }

  let row;
  try {
    const { rows } = await pool.query(
      `SELECT status, result, error_code, error_detail, lang,
              extract(epoch from (now() - created_at)) AS age_s,
              extract(epoch from (now() - updated_at)) AS idle_s
         FROM ai_inspection_jobs
        WHERE id = $1`,
      [jobId]
    );
    row = rows[0];
  } catch (err) {
    console.error('ai-inspection-result : SELECT', jobId, err && err.message);
    return json(503, {
      ok: false,
      status: 'error',
      error: 'jobs_unavailable',
      message_fr: ERROR_MESSAGES._default.fr,
      message_en: ERROR_MESSAGES._default.en,
    });
  }

  if (!row) {
    return json(404, { ok: false, status: 'error', error: 'job_not_found' });
  }

  if (row.status === 'done' && row.result) {
    return json(200, Object.assign({ ok: true, status: 'done' }, row.result));
  }

  if (row.status === 'error') {
    const m = ERROR_MESSAGES[row.error_code] || ERROR_MESSAGES._default;
    return json(200, {
      ok: false,
      status: 'error',
      error: row.error_code || 'unknown',
      detail: row.error_detail || null,
      message_fr: m.fr,
      message_en: m.en,
    });
  }

  // pending / running : le worker n'a pas fini. Relance si le declenchement
  // initial s'est perdu (job encore 'pending', inactif depuis > 12 s).
  if (row.status === 'pending' && Number(row.idle_s) > 12) {
    try {
      await pool.query(
        "UPDATE ai_inspection_jobs SET updated_at = now() WHERE id = $1 AND status = 'pending'",
        [jobId]
      );
      await triggerWorker(workerBaseUrl(event), jobId);
      console.log('ai-inspection-result : worker relance pour', jobId, 'apres', Math.round(row.age_s), 's');
    } catch (err) {
      console.error('ai-inspection-result : relance worker', jobId, err && err.message);
    }
  }

  return json(200, {
    ok: true,
    status: row.status === 'running' ? 'running' : 'pending',
    age_s: Math.round(Number(row.age_s) || 0),
  });
};
