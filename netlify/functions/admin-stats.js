'use strict';

const { Pool } = require('pg');
const crypto = require('crypto');

let pool = null;

function getPool() {
  if (!process.env.DATABASE_URL) return null;
  if (!pool) {
    pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
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

// ── Token helpers (same algorithm as admin.js) ────────────────────────────
const MS_PER_HOUR = 3_600_000;

function deriveSigningKey(password) {
  return crypto.scryptSync(password, 'bespoke-admin-token-salt-v1', 32);
}

function makeToken(password, hourTs) {
  return crypto.createHmac('sha256', deriveSigningKey(password)).update(String(hourTs)).digest('hex');
}

function currentHour() {
  return Math.floor(Date.now() / MS_PER_HOUR);
}

function verifyToken(token, password) {
  const h = currentHour();
  return (
    crypto.timingSafeEqual(Buffer.from(token), Buffer.from(makeToken(password, h))) ||
    crypto.timingSafeEqual(Buffer.from(token), Buffer.from(makeToken(password, h - 1)))
  );
}

exports.handler = async function (event) {
  const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  // ── Auth ─────────────────────────────────────────────────────────────────
  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
  const authHeader = (event.headers || {})['authorization'] || (event.headers || {})['Authorization'] || '';
  const sessionToken = authHeader.replace(/^Bearer\s+/i, '').trim();

  if (!sessionToken || !ADMIN_PASSWORD) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  let tokenValid = false;
  try {
    if (sessionToken.length === 64) tokenValid = verifyToken(sessionToken, ADMIN_PASSWORD);
  } catch (_) {}

  if (!tokenValid) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  // ── DB ───────────────────────────────────────────────────────────────────
  const db = getPool();
  if (!db) return { statusCode: 503, headers, body: JSON.stringify({ error: 'Database not configured' }) };

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const { action } = body;

  try {
    if (action === 'get-stats') {
      const [usersRes, verifiedRes, balanceRes, unreadRes, recentUsersRes, recentTxRes, recentMsgRes] =
        await Promise.all([
          db.query('SELECT COUNT(*) AS total FROM users'),
          db.query('SELECT COUNT(*) AS total FROM users WHERE email_verified = TRUE'),
          db.query('SELECT COALESCE(SUM(balance_cents), 0) AS total FROM users'),
          db.query(`
            SELECT COUNT(*) AS total FROM (
              SELECT thread_id FROM messages
              GROUP BY thread_id
              HAVING (
                SELECT author_role FROM messages m2
                WHERE m2.thread_id = messages.thread_id
                ORDER BY created_at DESC LIMIT 1
              ) = 'client'
            ) t
          `),
          db.query(
            `SELECT id, email, role, account_type, email_verified, created_at
             FROM users ORDER BY created_at DESC LIMIT 10`
          ),
          db.query(
            `SELECT t.id, t.type, t.amount_cents, t.label, t.created_at, u.email
             FROM transactions t JOIN users u ON u.id = t.user_id
             ORDER BY t.created_at DESC LIMIT 10`
          ),
          db.query(
            `SELECT m.id, m.thread_id, m.author_role, m.content, m.created_at, u.email
             FROM messages m JOIN users u ON u.id = m.author_id
             ORDER BY m.created_at DESC LIMIT 10`
          ),
        ]);

      return {
        statusCode: 200,
        headers,
        body: JSON.stringify({
          stats: {
            total_users: parseInt(usersRes.rows[0].total, 10),
            verified_users: parseInt(verifiedRes.rows[0].total, 10),
            total_balance_cents: parseInt(balanceRes.rows[0].total, 10),
            unread_threads: parseInt(unreadRes.rows[0].total, 10),
          },
          recent: {
            users: recentUsersRes.rows,
            transactions: recentTxRes.rows,
            messages: recentMsgRes.rows,
          },
        }),
      };
    }

    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Action inconnue' }) };
  } catch (err) {
    console.error('admin-stats error:', err);
    return { statusCode: 503, headers, body: JSON.stringify({ error: 'Service temporairement indisponible' }) };
  }
};
