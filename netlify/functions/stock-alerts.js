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
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
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
    `SELECT u.id, u.email, u.role
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
    console.error('stock-alerts session error:', err);
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
    if (action === 'getAlerts') {
      const result = await db.query(
        `SELECT user_id, enabled, brands, max_price, min_year, updated_at
         FROM stock_alerts WHERE user_id = $1`,
        [user.id]
      );
      const alert = result.rows[0] || null;
      return json(200, { alert });
    }

    if (action === 'saveAlerts') {
      const { enabled, brands, max_price, min_year } = body;

      await db.query(
        `INSERT INTO stock_alerts (user_id, enabled, brands, max_price, min_year, updated_at)
         VALUES ($1, $2, $3, $4, $5, NOW())
         ON CONFLICT (user_id)
         DO UPDATE SET
           enabled = EXCLUDED.enabled,
           brands = EXCLUDED.brands,
           max_price = EXCLUDED.max_price,
           min_year = EXCLUDED.min_year,
           updated_at = NOW()`,
        [user.id, enabled === true, brands && brands.length ? brands : null, max_price ? parseInt(max_price, 10) : null, min_year ? parseInt(min_year, 10) : null]
      );

      return json(200, { success: true });
    }

    return json(400, { error: 'Action inconnue' });
  } catch (err) {
    console.error('stock-alerts error:', err);
    return json(503, { error: 'Service temporairement indisponible' });
  }
};
