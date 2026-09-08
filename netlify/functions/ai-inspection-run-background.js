'use strict';

/**
 * Pre-rapport photo — worker (fonction BACKGROUND, suffixe `-background`).
 *
 * Netlify autorise 15 min a une fonction background : on y fait tourner
 * l'analyse vision qui ne tenait pas dans les 10 s de la fonction synchrone.
 * Le worker :
 *   1. reclame le job (`ai_inspection_jobs`, status 'pending' -> 'running') de
 *      facon atomique — une double invocation ne relance donc pas l'analyse ;
 *   2. appelle Claude (outil force, modele de qualite, timeout large) ;
 *   3. ecrit le rapport (status 'done') ou l'erreur (status 'error'), et purge
 *      les images du job une fois l'analyse finie.
 *
 * Ce fichier ne renvoie rien d'utile au client : Netlify repond 202 des la
 * reception et ignore le corps. Le navigateur lit le resultat via
 * `ai-inspection-result`.
 */

const Anthropic = require('@anthropic-ai/sdk');
const { getPool, classifyError } = require('../lib/ai');
const {
  INSPECTION_MODEL, Report, REPORT_SCHEMA, SYSTEM,
  DISCLAIMER_FR, DISCLAIMER_EN, buildUserContent,
} = require('../lib/inspection');

// Client dedie : le worker a du temps (background = 15 min). On laisse une marge
// large et un seul retry ; l'echec est ecrit proprement en base.
let visionClient = null;
function getVisionClient() {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (!visionClient) {
    visionClient = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 180000, maxRetries: 1 });
  }
  return visionClient;
}

function readJobId(event) {
  const q = (event.queryStringParameters && (event.queryStringParameters.job || event.queryStringParameters.jobId)) || '';
  if (q) return String(q);
  try {
    const raw = event.isBase64Encoded ? Buffer.from(event.body || '', 'base64').toString('utf8') : (event.body || '');
    const b = JSON.parse(raw || '{}');
    return String(b.jobId || b.job || '');
  } catch (_) {
    return '';
  }
}

async function finish(pool, jobId, fields) {
  const sets = ["status = $2", "updated_at = now()"];
  const vals = [jobId, fields.status];
  let i = 3;
  if ('result' in fields) { sets.push('result = $' + i + '::jsonb'); vals.push(JSON.stringify(fields.result)); i++; }
  if ('error_code' in fields) { sets.push('error_code = $' + i); vals.push(fields.error_code); i++; }
  if ('error_detail' in fields) { sets.push('error_detail = $' + i); vals.push(String(fields.error_detail || '').slice(0, 500)); i++; }
  // Les images ne servent plus une fois l'analyse finie : on les retire du job.
  sets.push("request = request - 'images'");
  await pool.query('UPDATE ai_inspection_jobs SET ' + sets.join(', ') + ' WHERE id = $1', vals);
}

exports.handler = async function (event) {
  const jobId = readJobId(event);
  if (!jobId) {
    console.error('ai-inspection-run : jobId manquant');
    return { statusCode: 200, body: 'no job id' };
  }

  const pool = getPool();
  if (!pool) {
    console.error('ai-inspection-run : DATABASE_URL absent, impossible de traiter', jobId);
    return { statusCode: 200, body: 'no db' };
  }

  // Reclamation atomique. Un job encore 'running' depuis > 2 min est considere
  // comme abandonne (worker precedent mort) et peut etre repris.
  let claimed;
  try {
    const { rows } = await pool.query(
      `UPDATE ai_inspection_jobs
          SET status = 'running', updated_at = now()
        WHERE id = $1
          AND (status = 'pending'
               OR (status = 'running' AND updated_at < now() - interval '120 seconds'))
      RETURNING request, lang`,
      [jobId]
    );
    claimed = rows[0];
  } catch (err) {
    console.error('ai-inspection-run : claim', jobId, err && err.message);
    return { statusCode: 200, body: 'claim failed' };
  }

  if (!claimed) {
    console.log('ai-inspection-run : job', jobId, 'deja pris, termine ou introuvable');
    return { statusCode: 200, body: 'already handled' };
  }

  const req = claimed.request || {};
  const images = Array.isArray(req.images) ? req.images : [];
  const l = claimed.lang === 'en' ? 'en' : 'fr';

  if (!images.length) {
    await finish(pool, jobId, { status: 'error', error_code: 'no_images', error_detail: 'images absentes du job' });
    return { statusCode: 200, body: 'no images' };
  }

  const client = getVisionClient();
  if (!client) {
    await finish(pool, jobId, { status: 'error', error_code: 'ai_not_configured', error_detail: 'ANTHROPIC_API_KEY absent' });
    return { statusCode: 200, body: 'no key' };
  }

  try {
    const content = buildUserContent({
      images,
      context: req.context || '',
      listingUrl: req.listing_url || '',
      l,
    });

    const response = await client.messages.create({
      model: INSPECTION_MODEL,
      // Le worker a 15 min : large marge pour un rapport complet sur 6 photos.
      // A 2500, le JSON de l'outil etait tronque (tous les champs undefined).
      max_tokens: 6000,
      system: SYSTEM,
      messages: [{ role: 'user', content }],
      tools: [{
        name: 'submit_report',
        description: "Renvoie le pre-rapport photo structure. Seul moyen de repondre.",
        input_schema: REPORT_SCHEMA,
      }],
      tool_choice: { type: 'tool', name: 'submit_report' },
    });

    if (response.stop_reason === 'refusal') {
      await finish(pool, jobId, { status: 'error', error_code: 'refused', error_detail: 'stop_reason refusal' });
      return { statusCode: 200, body: 'refused' };
    }

    const block = (response.content || []).find((c) => c.type === 'tool_use');
    console.log('ai-inspection-run : reponse', jobId,
      'stop=' + response.stop_reason,
      'out_tokens=' + (response.usage && response.usage.output_tokens),
      'tool_keys=' + JSON.stringify(block ? Object.keys(block.input || {}) : null));

    if (response.stop_reason === 'max_tokens') {
      // JSON de l'outil coupe en cours : inutile d'essayer de le valider.
      console.error('ai-inspection-run : reponse tronquee (max_tokens)', jobId);
      await finish(pool, jobId, {
        status: 'error',
        error_code: 'response_truncated',
        error_detail: 'max_tokens atteint, out_tokens=' + (response.usage && response.usage.output_tokens),
      });
      return { statusCode: 200, body: 'truncated' };
    }

    const parsedReport = block ? Report.safeParse(block.input) : null;
    if (!parsedReport || !parsedReport.success) {
      const zodMsg = (parsedReport && parsedReport.error && parsedReport.error.message) || 'pas de tool_use';
      const preview = block ? JSON.stringify(block.input || {}).slice(0, 300) : '(aucun bloc tool_use)';
      console.error('ai-inspection-run : sortie outil invalide', jobId, zodMsg, '| recu:', preview);
      await finish(pool, jobId, {
        status: 'error',
        error_code: 'unparsable_response',
        error_detail: 'stop=' + response.stop_reason + ' | ' + zodMsg.slice(0, 200) + ' | recu: ' + preview,
      });
      return { statusCode: 200, body: 'unparsable' };
    }

    const result = {
      report: parsedReport.data,
      image_count: images.length,
      listing_url: req.listing_url || null,
      disclaimer_fr: DISCLAIMER_FR,
      disclaimer_en: DISCLAIMER_EN,
      usage: {
        input_tokens: response.usage.input_tokens,
        output_tokens: response.usage.output_tokens,
      },
    };
    await finish(pool, jobId, { status: 'done', result });
    console.log('ai-inspection-run : job', jobId, 'termine', result.usage);
    return { statusCode: 200, body: 'done' };
  } catch (err) {
    const isTimeout = err instanceof Anthropic.APIConnectionTimeoutError;
    const code = isTimeout ? 'timeout' : classifyError(err);
    const detail = isTimeout
      ? 'timeout appel Claude'
      : (err && err.error && err.error.error && err.error.error.message) || (err && err.message) || 'inconnu';
    console.error('ai-inspection-run : echec', jobId, code, err && err.status, detail);
    try {
      await finish(pool, jobId, { status: 'error', error_code: code, error_detail: (err && err.status ? err.status + ' ' : '') + detail });
    } catch (err2) {
      console.error('ai-inspection-run : impossible d’ecrire l’erreur', jobId, err2 && err2.message);
    }
    return { statusCode: 200, body: 'error' };
  }
};
