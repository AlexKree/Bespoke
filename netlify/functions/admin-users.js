'use strict';

const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
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

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
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
    // ── list ─────────────────────────────────────────────────────────────
    if (action === 'list') {
      const res = await db.query(
        `SELECT id, email, role, account_type, balance_cents, email_verified, created_at
         FROM users ORDER BY created_at DESC`
      );
      return { statusCode: 200, headers, body: JSON.stringify({ users: res.rows }) };
    }

    // ── create ───────────────────────────────────────────────────────────
    if (action === 'create') {
      const { email, password, role = 'client', account_type = 'Particulier', verified = false } = body;
      if (!email || !isValidEmail(email)) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Email invalide' }) };
      }
      if (!password || password.length < 8) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Le mot de passe doit contenir au moins 8 caractères' }) };
      }
      const validRoles = ['client', 'staff', 'admin'];
      if (!validRoles.includes(role)) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Rôle invalide' }) };
      }
      const validTypes = ['Particulier', 'Entreprise'];
      if (!validTypes.includes(account_type)) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Type de compte invalide' }) };
      }

      const existing = await db.query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
      if (existing.rows.length) {
        return { statusCode: 409, headers, body: JSON.stringify({ error: 'Cet email est déjà utilisé' }) };
      }

      const hash = await bcrypt.hash(password, 10);
      const res = await db.query(
        `INSERT INTO users (email, password_hash, role, account_type, email_verified)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id, email, role, account_type, balance_cents, email_verified, created_at`,
        [email.toLowerCase(), hash, role, account_type, Boolean(verified)]
      );
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, user: res.rows[0] }) };
    }

    // ── update ───────────────────────────────────────────────────────────
    if (action === 'update') {
      const { user_id, email, role, account_type, verified, balance_cents } = body;
      if (!user_id) return { statusCode: 400, headers, body: JSON.stringify({ error: 'user_id requis' }) };

      const setClauses = [];
      const params = [];
      let idx = 1;

      if (email !== undefined) {
        if (!isValidEmail(email)) {
          return { statusCode: 400, headers, body: JSON.stringify({ error: 'Email invalide' }) };
        }
        setClauses.push(`email = $${idx++}`);
        params.push(email.toLowerCase());
      }
      if (role !== undefined) {
        const validRoles = ['client', 'staff', 'admin'];
        if (!validRoles.includes(role)) {
          return { statusCode: 400, headers, body: JSON.stringify({ error: 'Rôle invalide' }) };
        }
        setClauses.push(`role = $${idx++}`);
        params.push(role);
      }
      if (account_type !== undefined) {
        const validTypes = ['Particulier', 'Entreprise'];
        if (!validTypes.includes(account_type)) {
          return { statusCode: 400, headers, body: JSON.stringify({ error: 'Type de compte invalide' }) };
        }
        setClauses.push(`account_type = $${idx++}`);
        params.push(account_type);
      }
      if (verified !== undefined) {
        setClauses.push(`email_verified = $${idx++}`);
        params.push(Boolean(verified));
      }
      if (balance_cents !== undefined) {
        const bal = Number(balance_cents);
        if (!Number.isInteger(bal) || bal < 0) {
          return { statusCode: 400, headers, body: JSON.stringify({ error: 'Balance invalide (entier positif en centimes requis)' }) };
        }
        setClauses.push(`balance_cents = $${idx++}`);
        params.push(bal);
      }

      if (!setClauses.length) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Aucun champ à mettre à jour' }) };
      }

      params.push(user_id);
      const res = await db.query(
        `UPDATE users SET ${setClauses.join(', ')} WHERE id = $${idx}
         RETURNING id, email, role, account_type, balance_cents, email_verified, created_at`,
        params
      );
      if (!res.rows.length) {
        return { statusCode: 404, headers, body: JSON.stringify({ error: 'Utilisateur introuvable' }) };
      }
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, user: res.rows[0] }) };
    }

    // ── reset-password ───────────────────────────────────────────────────
    if (action === 'reset-password') {
      const { user_id, new_password } = body;
      if (!user_id) return { statusCode: 400, headers, body: JSON.stringify({ error: 'user_id requis' }) };
      if (!new_password || new_password.length < 8) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Le mot de passe doit contenir au moins 8 caractères' }) };
      }

      const hash = await bcrypt.hash(new_password, 10);
      const res = await db.query(
        `UPDATE users SET password_hash = $1 WHERE id = $2 RETURNING id`,
        [hash, user_id]
      );
      if (!res.rows.length) {
        return { statusCode: 404, headers, body: JSON.stringify({ error: 'Utilisateur introuvable' }) };
      }
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
    }

    // ── delete ───────────────────────────────────────────────────────────
    if (action === 'delete') {
      const { user_id } = body;
      if (!user_id) return { statusCode: 400, headers, body: JSON.stringify({ error: 'user_id requis' }) };

      // All related records cascade-delete via ON DELETE CASCADE in schema
      const res = await db.query('DELETE FROM users WHERE id = $1 RETURNING id', [user_id]);
      if (!res.rows.length) {
        return { statusCode: 404, headers, body: JSON.stringify({ error: 'Utilisateur introuvable' }) };
      }
      return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
    }

    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Action inconnue' }) };
  } catch (err) {
    console.error('admin-users error:', err);
    return { statusCode: 503, headers, body: JSON.stringify({ error: 'Service temporairement indisponible' }) };
  }
};
