'use strict';

const { Pool } = require('pg');

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
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

function parseSessionCookie(event) {
  const header = event.headers && (event.headers['cookie'] || event.headers['Cookie']);
  if (!header) return null;
  const match = header.match(/(?:^|;\s*)bespoke_session=([^;]+)/);
  return match ? match[1] : null;
}

async function getSessionUser(db, sessionId) {
  if (!sessionId) return null;
  const res = await db.query(
    `SELECT u.id, u.email, u.role, u.account_type, u.balance_cents
     FROM sessions s
     JOIN users u ON u.id = s.user_id
     WHERE s.id = $1 AND s.expires_at > now()`,
    [sessionId]
  );
  return res.rows[0] || null;
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method not allowed' });
  }

  const db = getPool();
  if (!db) return json(503, { error: 'Database not configured' });

  const sessionId = parseSessionCookie(event);
  let user;
  try {
    user = await getSessionUser(db, sessionId);
  } catch (err) {
    console.error('wallet session error:', err);
    return json(503, { error: 'Service temporairement indisponible' });
  }
  if (!user) return json(401, { error: 'Non authentifié' });

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return json(400, { error: 'Invalid JSON' });
  }

  const { action } = body;

  try {
    // ── get-balance ───────────────────────────────────────────────────────
    if (action === 'get-balance') {
      const txRes = await db.query(
        `SELECT id, type, amount_cents, label, created_at
         FROM transactions WHERE user_id = $1
         ORDER BY created_at DESC LIMIT 20`,
        [user.id]
      );
      return json(200, { balance_cents: user.balance_cents, transactions: txRes.rows });
    }

    // ── add-funds ─────────────────────────────────────────────────────────
    if (action === 'add-funds') {
      const amount = parseInt(body.amount_cents, 10);
      if (!amount || amount <= 0) return json(400, { error: 'Montant invalide' });
      if (amount > 10000000) return json(400, { error: 'Montant maximum dépassé (100 000 €)' });

      await db.query('BEGIN');
      try {
        await db.query(
          `INSERT INTO transactions (user_id, type, amount_cents, label) VALUES ($1, 'deposit', $2, 'Dépôt de fonds')`,
          [user.id, amount]
        );
        const updated = await db.query(
          `UPDATE users SET balance_cents = balance_cents + $1 WHERE id = $2 RETURNING balance_cents`,
          [amount, user.id]
        );
        await db.query('COMMIT');
        return json(200, { ok: true, balance_cents: updated.rows[0].balance_cents });
      } catch (err) {
        await db.query('ROLLBACK');
        throw err;
      }
    }

    // ── allocate ──────────────────────────────────────────────────────────
    if (action === 'allocate') {
      const amount = parseInt(body.amount_cents, 10);
      const label = (body.label || 'Allocation').substring(0, 255);
      if (!amount || amount <= 0) return json(400, { error: 'Montant invalide' });
      if (amount > user.balance_cents) return json(400, { error: 'Solde insuffisant' });

      await db.query('BEGIN');
      try {
        await db.query(
          `INSERT INTO transactions (user_id, type, amount_cents, label) VALUES ($1, 'allocation', $2, $3)`,
          [user.id, amount, label]
        );
        const updated = await db.query(
          `UPDATE users SET balance_cents = balance_cents - $1 WHERE id = $2 RETURNING balance_cents`,
          [amount, user.id]
        );
        await db.query('COMMIT');
        return json(200, { ok: true, balance_cents: updated.rows[0].balance_cents });
      } catch (err) {
        await db.query('ROLLBACK');
        throw err;
      }
    }

    return json(400, { error: 'Action inconnue' });
  } catch (err) {
    console.error('wallet error:', err);
    return json(503, { error: 'Service temporairement indisponible' });
  }
};
