'use strict';

const { Pool } = require('pg');
const https = require('https');
const crypto = require('crypto');

let pool = null;

function getPool() {
  const dbUrl = process.env.DATABASE_URL || process.env.NEON_DATABASE_URL;
  if (!dbUrl) return null;
  if (!pool) {
    pool = new Pool({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  }
  return pool;
}

const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };

function json(statusCode, body) {
  return { statusCode, headers, body: JSON.stringify(body) };
}

// ── Token helpers (same as admin.js) ─────────────────────────────────────────

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
    message: 'Admin-reservations: update vehicle status',
    content,
    sha,
  });
  if (res.status !== 200 && res.status !== 201) throw new Error('GitHub write error');
  return true;
}

// ── Main handler ─────────────────────────────────────────────────────────────

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') return json(405, { error: 'Method not allowed' });

  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;

  // Auth: Bearer token from Authorization header
  const authHeader = (event.headers || {})['authorization'] || (event.headers || {})['Authorization'] || '';
  const sessionToken = authHeader.replace(/^Bearer\s+/i, '').trim();

  if (!sessionToken || !ADMIN_PASSWORD) return json(401, { error: 'Unauthorized' });

  let tokenValid = false;
  try {
    if (sessionToken.length === 64) tokenValid = verifyToken(sessionToken, ADMIN_PASSWORD);
  } catch (_) {}

  if (!tokenValid) return json(401, { error: 'Unauthorized' });

  const db = getPool();
  if (!db) return json(503, { error: 'Database not configured' });

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return json(400, { error: 'Invalid JSON' });
  }

  const { action } = body;

  try {

    // ── list-all ──────────────────────────────────────────────────────────
    if (action === 'list-all') {
      const res = await db.query(
        `SELECT r.*, u.email AS user_email
         FROM vehicle_reservations r
         JOIN users u ON u.id = r.user_id
         ORDER BY r.created_at DESC`
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

    // ── cancel-reservation ────────────────────────────────────────────────
    if (action === 'cancel-reservation') {
      const { reservation_id } = body;
      if (!reservation_id) return json(400, { error: 'reservation_id requis' });

      const resRow = await db.query(
        'SELECT * FROM vehicle_reservations WHERE id = $1',
        [reservation_id]
      );
      if (!resRow.rows.length) return json(404, { error: 'Réservation introuvable' });

      const reservation = resRow.rows[0];
      if (reservation.status === 'cancelled') {
        return json(400, { error: 'Réservation déjà annulée' });
      }

      // Get vehicle title for refund label
      let vehicleTitle = reservation.vehicle_slug;
      let stock, sha;
      try {
        ({ stock, sha } = await readStockJson());
        const v = stock.items.find(i => i.id === reservation.vehicle_slug);
        if (v) vehicleTitle = v.title ? (v.title.fr || v.title.en) : vehicleTitle;
      } catch (_) {}

      await db.query('BEGIN');
      try {
        // Cancel reservation
        await db.query(
          `UPDATE vehicle_reservations SET status = 'cancelled', updated_at = now() WHERE id = $1`,
          [reservation_id]
        );

        // Refund deposit if not paid and not already cancelled
        if (reservation.status !== 'paid' && reservation.status !== 'cancelled') {
          await db.query(
            'UPDATE users SET balance_cents = balance_cents + $1 WHERE id = $2',
            [reservation.deposit_cents, reservation.user_id]
          );
          await db.query(
            `INSERT INTO wallet_transactions (user_id, type, amount_cents, label)
             VALUES ($1, 'deposit', $2, $3)`,
            [reservation.user_id, reservation.deposit_cents, `Remboursement acompte ${vehicleTitle}`]
          );
        }

        await db.query('COMMIT');

        // Update stock.json: restore to available
        if (stock && sha) {
          const vehicleIdx = stock.items.findIndex(v => v.id === reservation.vehicle_slug);
          if (vehicleIdx !== -1) {
            const { reserved_by, reserved_at, ...vehicleWithoutReservation } = stock.items[vehicleIdx];
            stock.items[vehicleIdx] = { ...vehicleWithoutReservation, status: 'available' };
            try { await writeStockJson(stock, sha); } catch (e) { console.error('admin-reservations: GitHub write error:', e); }
          }
        }

        return json(200, { ok: true });
      } catch (err) {
        await db.query('ROLLBACK');
        throw err;
      }
    }

    // ── request-balance ───────────────────────────────────────────────────
    if (action === 'request-balance') {
      const { reservation_id } = body;
      if (!reservation_id) return json(400, { error: 'reservation_id requis' });

      const resRow = await db.query(
        'SELECT * FROM vehicle_reservations WHERE id = $1',
        [reservation_id]
      );
      if (!resRow.rows.length) return json(404, { error: 'Réservation introuvable' });

      const reservation = resRow.rows[0];
      if (reservation.status !== 'pending') {
        return json(400, { error: 'La réservation doit être en statut "pending" pour demander le solde' });
      }

      await db.query(
        `UPDATE vehicle_reservations SET status = 'balance_requested', updated_at = now() WHERE id = $1`,
        [reservation_id]
      );

      return json(200, { ok: true });
    }

    // ── mark-as-sold ──────────────────────────────────────────────────────
    if (action === 'mark-as-sold') {
      const { reservation_id } = body;
      if (!reservation_id) return json(400, { error: 'reservation_id requis' });

      const resRow = await db.query(
        'SELECT * FROM vehicle_reservations WHERE id = $1',
        [reservation_id]
      );
      if (!resRow.rows.length) return json(404, { error: 'Réservation introuvable' });

      const reservation = resRow.rows[0];
      if (reservation.status !== 'paid') {
        return json(400, { error: 'Le solde doit être payé avant de marquer comme vendu' });
      }

      // Update stock.json: mark as sold
      let stock, sha;
      try {
        ({ stock, sha } = await readStockJson());
        const vehicleIdx = stock.items.findIndex(v => v.id === reservation.vehicle_slug);
        if (vehicleIdx !== -1) {
          const { reserved_by, reserved_at, ...vehicleWithoutReservation } = stock.items[vehicleIdx];
          stock.items[vehicleIdx] = { ...vehicleWithoutReservation, status: 'sold' };
          await writeStockJson(stock, sha);
        }
      } catch (e) {
        console.error('admin-reservations mark-as-sold: GitHub error:', e);
        return json(503, { error: 'Impossible de mettre à jour le stock' });
      }

      // Archive reservation as sold
      await db.query(
        `UPDATE vehicle_reservations SET status = 'sold', updated_at = now() WHERE id = $1`,
        [reservation_id]
      );

      return json(200, { ok: true });
    }

    // ── update-vehicle-status ─────────────────────────────────────────────
    if (action === 'update-vehicle-status') {
      const { vehicle_slug, status: newStatus } = body;
      if (!vehicle_slug) return json(400, { error: 'vehicle_slug requis' });
      if (!['available', 'reserved', 'sold'].includes(newStatus)) {
        return json(400, { error: 'Statut invalide' });
      }

      let stock, sha;
      try {
        ({ stock, sha } = await readStockJson());
      } catch (e) {
        return json(503, { error: 'Impossible de charger le stock' });
      }

      const vehicleIdx = stock.items.findIndex(v => v.id === vehicle_slug);
      if (vehicleIdx === -1) return json(404, { error: 'Véhicule introuvable' });

      const oldStatus = stock.items[vehicleIdx].status;

      // If switching to available, cancel any active reservation
      if (newStatus === 'available' && oldStatus === 'reserved') {
        console.log(`Admin: Cancelling reservation for ${vehicle_slug}`);
        const db2 = getPool();
        const activeRes = await db2.query(
          `SELECT * FROM vehicle_reservations
           WHERE vehicle_slug = $1 AND status IN ('pending', 'balance_requested')
           LIMIT 1`,
          [vehicle_slug]
        );
        if (activeRes.rows.length) {
          const reservation = activeRes.rows[0];
          console.log(`Found active reservation: ${reservation.id}`);
          let vehicleTitle = vehicle_slug;
          const v = stock.items[vehicleIdx];
          if (v) vehicleTitle = v.title ? (v.title.fr || v.title.en) : vehicleTitle;

          await db2.query('BEGIN');
          try {
            await db2.query(
              `UPDATE vehicle_reservations SET status = 'cancelled', updated_at = now() WHERE id = $1`,
              [reservation.id]
            );
            console.log(`Reservation ${reservation.id} cancelled.`);
            await db2.query(
              'UPDATE users SET balance_cents = balance_cents + $1 WHERE id = $2',
              [reservation.deposit_cents, reservation.user_id]
            );
            console.log(`Refunded ${reservation.deposit_cents} cents to user ${reservation.user_id}`);
            await db2.query(
              `INSERT INTO wallet_transactions (user_id, type, amount_cents, label)
               VALUES ($1, 'deposit', $2, $3)`,
              [reservation.user_id, reservation.deposit_cents, `Remboursement acompte ${vehicleTitle}`]
            );
            console.log(`Transaction recorded.`);
            await db2.query('COMMIT');
            console.log(`Reservation cancellation committed.`);
          } catch (err) {
            await db2.query('ROLLBACK');
            console.error(`Reservation cancellation failed:`, err);
            throw err;
          }
        } else {
          console.log(`No active reservation found for ${vehicle_slug}`);
        }
      }

      // Update stock.json
      if (newStatus === 'available') {
        const { reserved_by, reserved_at, ...vehicleWithoutReservation } = stock.items[vehicleIdx];
        stock.items[vehicleIdx] = { ...vehicleWithoutReservation, status: 'available' };
      } else {
        stock.items[vehicleIdx] = { ...stock.items[vehicleIdx], status: newStatus };
      }

      try {
        await writeStockJson(stock, sha);
      } catch (e) {
        return json(503, { error: 'Impossible de sauvegarder le stock' });
      }

      return json(200, { ok: true });
    }

    return json(400, { error: 'Action inconnue' });
  } catch (err) {
    console.error('admin-reservations error:', err);
    return json(503, { error: 'Service temporairement indisponible' });
  }
};
