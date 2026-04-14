'use strict';

const { Pool } = require('pg');
const https = require('https');
const crypto = require('crypto');

let pool = null;

function getPool() {
  if (!process.env.DATABASE_URL) return null;
  if (!pool) {
    pool = new Pool({ connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } });
  }
  return pool;
}

const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

function json(statusCode, body) {
  return { statusCode, headers, body: JSON.stringify(body) };
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

// ── GitHub helpers ───────────────────────────────────────────────────────────

function githubRequest(method, path, token, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const options = {
      hostname: 'api.github.com',
      path,
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'Bespoke-Admin/1.0',
        'Content-Type': 'application/json',
      },
    };
    if (payload) options.headers['Content-Length'] = Buffer.byteLength(payload);
    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(data) }); }
        catch (_) { resolve({ status: res.statusCode, body: data }); }
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function readStockJson() {
  const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
  const GITHUB_OWNER = process.env.GITHUB_OWNER;
  const GITHUB_REPO  = process.env.GITHUB_REPO;
  if (!GITHUB_TOKEN || !GITHUB_OWNER || !GITHUB_REPO) throw new Error('GitHub not configured');
  const filePath = `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/assets/stock/stock.json`;
  const res = await githubRequest('GET', filePath, GITHUB_TOKEN, null);
  if (res.status !== 200) throw new Error('GitHub API error');
  const content = Buffer.from(res.body.content, 'base64').toString('utf8');
  return { stock: JSON.parse(content), sha: res.body.sha };
}

async function writeStockJson(stock, sha) {
  const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
  const GITHUB_OWNER = process.env.GITHUB_OWNER;
  const GITHUB_REPO  = process.env.GITHUB_REPO;
  if (!GITHUB_TOKEN || !GITHUB_OWNER || !GITHUB_REPO) throw new Error('GitHub not configured');
  const filePath = `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/assets/stock/stock.json`;
  const content = Buffer.from(JSON.stringify(stock, null, 2) + '\n').toString('base64');
  const res = await githubRequest('PUT', filePath, GITHUB_TOKEN, {
    message: 'Reservation: update vehicle status',
    content,
    sha,
  });
  if (res.status !== 200 && res.status !== 201) throw new Error('GitHub write error');
  return true;
}

// ── Main handler ─────────────────────────────────────────────────────────────

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

  const db = getPool();
  if (!db) return json(503, { error: 'Database not configured' });

  const sessionId = parseSessionCookie(event);
  let user;
  try {
    user = await getSessionUser(db, sessionId);
  } catch (err) {
    console.error('reservations session error:', err);
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

    // ── reserve-vehicle ───────────────────────────────────────────────────
    if (action === 'reserve-vehicle') {
      const { vehicle_slug } = body;
      if (!vehicle_slug) return json(400, { error: 'vehicle_slug requis' });

      // Load stock from GitHub
      let stock, sha;
      try {
        ({ stock, sha } = await readStockJson());
      } catch (e) {
        return json(503, { error: 'Impossible de charger le stock' });
      }

      const vehicleIdx = stock.items.findIndex(v => v.id === vehicle_slug);
      if (vehicleIdx === -1) return json(404, { error: 'Véhicule introuvable' });

      const vehicle = stock.items[vehicleIdx];
      if (vehicle.status !== 'available') {
        return json(400, { error: 'Ce véhicule n\'est pas disponible à la réservation' });
      }
      if (!vehicle.price_eur) {
        return json(400, { error: 'Ce véhicule n\'a pas de prix défini' });
      }

      const deposit_cents = Math.round(vehicle.price_eur * 100 * 0.10);
      const remaining_cents = vehicle.price_eur * 100 - deposit_cents;

      // Re-read user balance fresh
      const userRes = await db.query('SELECT balance_cents FROM users WHERE id = $1', [user.id]);
      const freshBalance = userRes.rows[0] ? userRes.rows[0].balance_cents : 0;

      if (freshBalance < deposit_cents) {
        return json(400, {
          error: 'insufficient_balance',
          required: deposit_cents,
          current: freshBalance,
        });
      }

      // Transaction: debit balance + create reservation
      await db.query('BEGIN');
      try {
        const title = vehicle.title
          ? (vehicle.title.fr || vehicle.title.en)
          : [vehicle.make && (vehicle.make.fr || vehicle.make.en), vehicle.model && (vehicle.model.fr || vehicle.model.en)].filter(Boolean).join(' ');

        // Debit balance
        await db.query(
          'UPDATE users SET balance_cents = balance_cents - $1 WHERE id = $2',
          [deposit_cents, user.id]
        );
        // Record transaction
        await db.query(
          `INSERT INTO transactions (user_id, type, amount_cents, label)
           VALUES ($1, 'allocation', $2, $3)`,
          [user.id, deposit_cents, `Acompte véhicule ${title}`]
        );
        // Create reservation
        const resRow = await db.query(
          `INSERT INTO vehicle_reservations (vehicle_slug, user_id, deposit_cents, remaining_cents, status)
           VALUES ($1, $2, $3, $4, 'pending')
           RETURNING *`,
          [vehicle_slug, user.id, deposit_cents, remaining_cents]
        );
        await db.query('COMMIT');

        // Update stock.json via GitHub
        stock.items[vehicleIdx] = {
          ...vehicle,
          status: 'reserved',
          reserved_by: user.id,
          reserved_at: new Date().toISOString(),
        };
        try {
          await writeStockJson(stock, sha);
        } catch (ghErr) {
          console.error('reservations: GitHub write error (non-fatal):', ghErr);
        }

        return json(200, { ok: true, reservation: resRow.rows[0] });
      } catch (err) {
        await db.query('ROLLBACK');
        throw err;
      }
    }

    // ── get-my-reservations ───────────────────────────────────────────────
    if (action === 'get-my-reservations') {
      const res = await db.query(
        `SELECT * FROM vehicle_reservations WHERE user_id = $1 ORDER BY created_at DESC`,
        [user.id]
      );

      let vehicleData = {};
      try {
        const { stock } = await readStockJson();
        stock.items.forEach(v => { vehicleData[v.id] = v; });
      } catch (_) {}

      const reservations = res.rows.map(r => ({
        ...r,
        vehicle: vehicleData[r.vehicle_slug] || null,
      }));

      return json(200, { reservations });
    }

    // ── request-cancellation ──────────────────────────────────────────────
    if (action === 'request-cancellation') {
      const { reservation_id, message } = body;
      if (!reservation_id) return json(400, { error: 'reservation_id requis' });

      const resRow = await db.query(
        'SELECT * FROM vehicle_reservations WHERE id = $1 AND user_id = $2',
        [reservation_id, user.id]
      );
      if (!resRow.rows.length) return json(404, { error: 'Réservation introuvable' });

      const reservation = resRow.rows[0];
      if (reservation.status !== 'pending' && reservation.status !== 'balance_requested') {
        return json(400, { error: 'Cette réservation ne peut pas être annulée' });
      }
      if (reservation.cancellation_requested) {
        return json(400, { error: 'Une demande d\'annulation est déjà en cours' });
      }

      await db.query(
        `UPDATE vehicle_reservations
         SET cancellation_requested = TRUE, cancellation_message = $1, updated_at = now()
         WHERE id = $2`,
        [message || '', reservation_id]
      );

      return json(200, { ok: true });
    }

    // ── pay-balance ───────────────────────────────────────────────────────
    if (action === 'pay-balance') {
      const { reservation_id } = body;
      if (!reservation_id) return json(400, { error: 'reservation_id requis' });

      const resRow = await db.query(
        'SELECT * FROM vehicle_reservations WHERE id = $1 AND user_id = $2',
        [reservation_id, user.id]
      );
      if (!resRow.rows.length) return json(404, { error: 'Réservation introuvable' });

      const reservation = resRow.rows[0];
      if (reservation.status !== 'balance_requested') {
        return json(400, { error: 'Le solde n\'a pas encore été demandé par l\'admin' });
      }

      // Re-read user balance fresh
      const userRes = await db.query('SELECT balance_cents FROM users WHERE id = $1', [user.id]);
      const freshBalance = userRes.rows[0] ? userRes.rows[0].balance_cents : 0;

      if (freshBalance < reservation.remaining_cents) {
        return json(400, {
          error: 'insufficient_balance',
          required: reservation.remaining_cents,
          current: freshBalance,
        });
      }

      // Get vehicle title for label
      let vehicleTitle = reservation.vehicle_slug;
      try {
        const { stock } = await readStockJson();
        const v = stock.items.find(i => i.id === reservation.vehicle_slug);
        if (v) vehicleTitle = v.title ? (v.title.fr || v.title.en) : vehicleTitle;
      } catch (_) {}

      await db.query('BEGIN');
      try {
        await db.query(
          'UPDATE users SET balance_cents = balance_cents - $1 WHERE id = $2',
          [reservation.remaining_cents, user.id]
        );
        await db.query(
          `INSERT INTO transactions (user_id, type, amount_cents, label)
           VALUES ($1, 'allocation', $2, $3)`,
          [user.id, reservation.remaining_cents, `Solde véhicule ${vehicleTitle}`]
        );
        await db.query(
          `UPDATE vehicle_reservations SET status = 'paid', updated_at = now() WHERE id = $1`,
          [reservation_id]
        );
        await db.query('COMMIT');
        return json(200, { ok: true });
      } catch (err) {
        await db.query('ROLLBACK');
        throw err;
      }
    }

    return json(400, { error: 'Action inconnue' });
  } catch (err) {
    console.error('reservations error:', err);
    return json(503, { error: 'Service temporairement indisponible' });
  }
};
