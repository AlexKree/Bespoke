'use strict';

/**
 * Prix marche — worker (fonction BACKGROUND, 15 min max).
 *
 * Traite la file `vehicle_market_prices` un vehicule a la fois : reclame le
 * plus ancien job 'pending' (atomique, SKIP LOCKED), lance la recherche web +
 * l'estimation, ecrit la proposition ('proposed') ou l'erreur ('error'), puis
 * passe au suivant. Proche de la limite de temps, il se relance lui-meme pour
 * la suite de la file. Sequentiel expres : une vingtaine de recherches web en
 * parallele depasserait les limites de debit de l'API.
 *
 * Appelable publiquement comme toute fonction Netlify, mais ne traite que des
 * jobs deja crees par l'admin authentifie.
 */

const Anthropic = require('@anthropic-ai/sdk');
const { getPool, classifyError } = require('../lib/ai');
const { workerBaseUrl, triggerWorker } = require('../lib/inspection');
const {
  MARKET_MODEL, WORKER_PATH, SYSTEM, ESTIMATE_SCHEMA, Estimate, userPrompt,
} = require('../lib/market-price');

// On arrete de prendre de nouveaux jobs apres 11 min : une recherche peut
// durer plusieurs minutes et la fonction est coupee a 15.
const TIME_BUDGET_MS = 11 * 60 * 1000;
// pause_turn : la recherche web s'est interrompue, on relance le meme tour.
const MAX_CONTINUATIONS = 4;

let client = null;
function getClient() {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (!client) {
    client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY, timeout: 300000, maxRetries: 1 });
  }
  return client;
}

async function claimNext(pool) {
  // Un job 'running' depuis > 10 min est considere abandonne (worker mort).
  const { rows } = await pool.query(
    `UPDATE vehicle_market_prices
        SET status = 'running', updated_at = now()
      WHERE car_id = (
        SELECT car_id FROM vehicle_market_prices
         WHERE status = 'pending'
            OR (status = 'running' AND updated_at < now() - interval '10 minutes')
         ORDER BY requested_at
         LIMIT 1
         FOR UPDATE SKIP LOCKED)
    RETURNING car_id, request`
  );
  return rows[0] || null;
}

async function finish(pool, carId, fields) {
  await pool.query(
    `UPDATE vehicle_market_prices
        SET status = $2, proposal = $3::jsonb, error_code = $4, error_detail = $5, updated_at = now()
      WHERE car_id = $1`,
    [carId, fields.status, fields.proposal ? JSON.stringify(fields.proposal) : null,
      fields.error_code || null, fields.error_detail ? String(fields.error_detail).slice(0, 500) : null]
  );
}

/** Recherche + estimation pour une fiche. Renvoie { proposal } ou { error_code, error_detail }. */
async function estimate(anthropic, request) {
  const messages = [{ role: 'user', content: userPrompt(request || {}) }];
  const tools = [
    { type: 'web_search_20260209', name: 'web_search', max_uses: 12, blocked_domains: ['thebespokecar.com'] },
    {
      name: 'submit_estimate',
      description: "Renvoie l'estimation du prix de marché et les comparables trouvés. Seul moyen de répondre.",
      input_schema: ESTIMATE_SCHEMA,
      strict: true,
    },
  ];

  let usage = { input_tokens: 0, output_tokens: 0, web_searches: 0 };
  for (let i = 0; i <= MAX_CONTINUATIONS; i++) {
    const response = await anthropic.beta.messages.create({
      model: MARKET_MODEL,
      max_tokens: 16000,
      thinking: { type: 'adaptive' },
      output_config: { effort: 'high' },
      system: SYSTEM,
      messages,
      tools,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
    });

    const u = response.usage || {};
    usage.input_tokens += u.input_tokens || 0;
    usage.output_tokens += u.output_tokens || 0;
    usage.web_searches += (u.server_tool_use && u.server_tool_use.web_search_requests) || 0;

    if (response.stop_reason === 'refusal') return { error_code: 'refused', error_detail: 'stop_reason refusal' };
    if (response.stop_reason === 'max_tokens') return { error_code: 'response_truncated', error_detail: 'max_tokens atteint' };

    const block = (response.content || []).find((c) => c.type === 'tool_use' && c.name === 'submit_estimate');
    if (block) {
      const parsed = Estimate.safeParse(block.input);
      if (!parsed.success) {
        return { error_code: 'unparsable_response', error_detail: parsed.error.message.slice(0, 300) };
      }
      return { proposal: { ...parsed.data, model: response.model, usage } };
    }

    if (response.stop_reason === 'pause_turn') {
      // Recherche web longue interrompue par le serveur : on renvoie le tour tel
      // quel pour qu'il reprenne la ou il s'est arrete.
      messages.push({ role: 'assistant', content: response.content });
      continue;
    }

    // Fin de tour sans appel a l'outil : on le redemande une fois explicitement.
    messages.push({ role: 'assistant', content: response.content });
    messages.push({ role: 'user', content: 'Appelle maintenant submit_estimate avec ton estimation.' });
  }
  return { error_code: 'no_estimate', error_detail: 'aucun appel a submit_estimate' };
}

exports.handler = async function (event) {
  const started = Date.now();
  const pool = getPool();
  if (!pool) {
    console.error('market-price-run : DATABASE_URL absent');
    return { statusCode: 200, body: 'no db' };
  }
  const anthropic = getClient();

  let done = 0;
  while (Date.now() - started < TIME_BUDGET_MS) {
    let job;
    try {
      job = await claimNext(pool);
    } catch (err) {
      console.error('market-price-run : claim', err && err.message);
      return { statusCode: 200, body: 'claim failed' };
    }
    if (!job) break;

    if (!anthropic) {
      await finish(pool, job.car_id, { status: 'error', error_code: 'ai_not_configured', error_detail: 'ANTHROPIC_API_KEY absent' });
      continue;
    }

    try {
      const res = await estimate(anthropic, job.request);
      if (res.proposal) {
        await finish(pool, job.car_id, { status: 'proposed', proposal: res.proposal });
        console.log('market-price-run :', job.car_id, 'propose', res.proposal.market_price_eur, res.proposal.usage);
      } else {
        await finish(pool, job.car_id, { status: 'error', error_code: res.error_code, error_detail: res.error_detail });
        console.error('market-price-run :', job.car_id, res.error_code, res.error_detail);
      }
    } catch (err) {
      const isTimeout = err instanceof Anthropic.APIConnectionTimeoutError;
      const code = isTimeout ? 'timeout' : classifyError(err);
      const detail = (err && err.error && err.error.error && err.error.error.message) || (err && err.message) || 'inconnu';
      console.error('market-price-run : echec', job.car_id, code, err && err.status, detail);
      try {
        await finish(pool, job.car_id, { status: 'error', error_code: code, error_detail: (err && err.status ? err.status + ' ' : '') + detail });
      } catch (err2) {
        console.error('market-price-run : impossible d’ecrire l’erreur', job.car_id, err2 && err2.message);
      }
    }
    done++;
  }

  // Temps presque ecoule avec encore des jobs en file : on passe le relais.
  if (Date.now() - started >= TIME_BUDGET_MS) {
    const relayed = await triggerWorker(workerBaseUrl(event), null, WORKER_PATH);
    console.log('market-price-run : relais', relayed ? 'ok' : 'echoue', 'apres', done, 'vehicules');
  }
  return { statusCode: 200, body: 'processed ' + done };
};
