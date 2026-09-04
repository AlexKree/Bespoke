'use strict';

/**
 * Socle commun aux fonctions IA (concierge, calculateur d'import, pre-rapport photo).
 *
 * Regles :
 *  - la cle API ne quitte jamais le serveur (ANTHROPIC_API_KEY, cote Netlify) ;
 *  - toute reponse destinee au public porte une mention "indicatif, non contractuel" ;
 *  - chaque appel passe par le limiteur de debit.
 */

const Anthropic = require('@anthropic-ai/sdk');
const { Pool } = require('pg');

// Sonnet par defaut : les fonctions synchrones Netlify sont plafonnees a 26 s,
// et deux appels opus-5 avec thinking depassaient ce plafond. Surchargeable
// via ANTHROPIC_MODEL si on veut repasser sur opus pour une tache precise.
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-sonnet-5';

let client = null;
function getClient() {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  if (!client) {
    client = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
      // Sous le plafond Netlify : on prefere un echec propre et rapide au 504.
      timeout: 23000,
      maxRetries: 1,
    });
  }
  return client;
}

let pool = null;
function getPool() {
  if (!process.env.DATABASE_URL) return null;
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      ssl: { rejectUnauthorized: false },
    });
  }
  return pool;
}

function json(statusCode, body) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    body: JSON.stringify(body),
  };
}

function clientIp(event) {
  const h = event.headers || {};
  const fwd = h['x-nf-client-connection-ip'] || h['x-forwarded-for'] || '';
  return String(fwd).split(',')[0].trim() || 'unknown';
}

/* ── Limiteur de debit ────────────────────────────────────────────────
   Deux niveaux :
   1. memoire de l'instance — immediat, mais ne couvre qu'une instance ;
   2. Postgres — partage entre instances, si DATABASE_URL est defini.
   L'absence de base ne bloque jamais l'appel : on retombe sur le niveau 1. */

const memHits = new Map(); // ip -> number[] (horodatages ms)

function memoryAllows(ip, limit, windowMs) {
  const now = Date.now();
  const hits = (memHits.get(ip) || []).filter((t) => now - t < windowMs);
  if (hits.length >= limit) return false;
  hits.push(now);
  memHits.set(ip, hits);
  if (memHits.size > 5000) memHits.clear(); // garde-fou memoire
  return true;
}

async function dbAllows(ip, action, limit, windowMs) {
  const p = getPool();
  if (!p) return true;
  try {
    const { rows } = await p.query(
      `SELECT count(*)::int AS n FROM ai_usage
        WHERE ip = $1 AND action = $2 AND created_at > now() - ($3 || ' milliseconds')::interval`,
      [ip, action, String(windowMs)]
    );
    if (rows[0] && rows[0].n >= limit) return false;
    await p.query('INSERT INTO ai_usage (ip, action) VALUES ($1, $2)', [ip, action]);
    return true;
  } catch (err) {
    // Table absente ou base indisponible : on ne bloque pas l'utilisateur.
    console.warn('ai_usage indisponible, repli sur le limiteur memoire:', err.message);
    return true;
  }
}

/**
 * @returns {Promise<{ok: true} | {ok: false, response: object}>}
 */
async function rateLimit(event, action, { limit = 8, windowMs = 3600000 } = {}) {
  const ip = clientIp(event);
  const ok = memoryAllows(ip, limit, windowMs) && (await dbAllows(ip, action, limit, windowMs));
  if (ok) return { ok: true };
  return {
    ok: false,
    response: json(429, {
      error: 'rate_limited',
      message_fr: "Vous avez atteint la limite d'utilisation. Merci de reessayer dans une heure, ou de nous ecrire directement.",
      message_en: 'You have reached the usage limit. Please try again in an hour, or write to us directly.',
    }),
  };
}

/* ── Garde-fous d'entree ─────────────────────────────────────────────── */

function parseBody(event, maxBytes = 8 * 1024 * 1024) {
  if (event.httpMethod !== 'POST') {
    return { error: json(405, { error: 'method_not_allowed' }) };
  }
  const raw = event.body || '';
  const size = event.isBase64Encoded ? raw.length * 0.75 : Buffer.byteLength(raw, 'utf8');
  if (size > maxBytes) {
    return { error: json(413, { error: 'payload_too_large' }) };
  }
  try {
    const body = JSON.parse(event.isBase64Encoded ? Buffer.from(raw, 'base64').toString('utf8') : raw);
    if (body && body['bot-field']) return { error: json(400, { error: 'spam_detected' }) };
    return { body: body || {} };
  } catch (_) {
    return { error: json(400, { error: 'invalid_json' }) };
  }
}

function requireKey() {
  if (!getClient()) {
    return json(503, {
      error: 'ai_not_configured',
      message_fr: "L'assistant n'est pas encore active. Merci d'utiliser le formulaire de contact.",
      message_en: 'The assistant is not enabled yet. Please use the contact form.',
    });
  }
  return null;
}

function lang(body) {
  return body && body.lang === 'en' ? 'en' : 'fr';
}

/* ── Erreurs SDK ─────────────────────────────────────────────────────── */

function apiError(err) {
  if (err instanceof Anthropic.RateLimitError) {
    return json(429, { error: 'upstream_rate_limited' });
  }
  if (err instanceof Anthropic.AuthenticationError) {
    console.error('Cle ANTHROPIC_API_KEY invalide');
    return json(503, { error: 'ai_not_configured' });
  }
  if (err instanceof Anthropic.APIError) {
    console.error('Erreur API Claude', err.status, err.message);
    return json(502, { error: 'upstream_error' });
  }
  console.error('Erreur inattendue', err && err.message);
  return json(500, { error: 'internal_error' });
}

/* ── Catalogue ───────────────────────────────────────────────────────── */

let stockCache = null;
let stockCachedAt = 0;

/** Charge stock.json depuis le site deploye, avec un cache d'instance de 5 min. */
async function loadStock() {
  const now = Date.now();
  if (stockCache && now - stockCachedAt < 300000) return stockCache;
  const base = process.env.URL || process.env.DEPLOY_PRIME_URL || 'https://thebespokecar.com';
  const res = await fetch(base.replace(/\/$/, '') + '/assets/stock/stock.json');
  if (!res.ok) throw new Error('stock.json inaccessible (' + res.status + ')');
  const data = await res.json();
  stockCache = Array.isArray(data.items) ? data.items : [];
  stockCachedAt = now;
  return stockCache;
}

/** Reduit une fiche stock aux champs utiles au modele (schema heterogene). */
function compactVehicle(item, l) {
  const pick = (v) => (v && typeof v === 'object' ? v[l] || v.fr || v.en : v) || null;
  return {
    id: item.id,
    title: pick(item.title),
    make: pick(item.make),
    model: pick(item.model),
    year: item.year || null,
    price_eur: item.price_eur != null ? item.price_eur : (item.price || null),
    mileage_km: item.mileage_km != null ? item.mileage_km : (item.mileage || null),
    location: pick(item.location) || pick(item.country) || null,
    status: item.status,
    sale_category: item.sale_category || null,
    headline: pick(item.headline),
    description: (pick(item.description) || '').slice(0, 400),
  };
}

module.exports = {
  MODEL,
  getClient,
  getPool,
  json,
  clientIp,
  rateLimit,
  parseBody,
  requireKey,
  lang,
  apiError,
  loadStock,
  compactVehicle,
};
