// POST /.netlify/functions/view
// Body: { carId: string }
// Increments the view counter for the given car.
// Idempotent table creation — works even if sql/create_views_table.sql was never run.

const { Pool } = require('pg');

let pool;

function getPool() {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.NEON_DATABASE_URL,
      ssl: { rejectUnauthorized: true },
      // max:1 is intentional for serverless — each invocation has its own instance
      max: 1,
    });
  }
  return pool;
}

const INIT_SQL = `
  CREATE TABLE IF NOT EXISTS car_views (
    car_id      TEXT        PRIMARY KEY,
    views_total INTEGER     NOT NULL DEFAULT 0,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )
`;

function cors(statusCode, body) {
  return {
    statusCode,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    },
    body: JSON.stringify(body),
  };
}

exports.handler = async (event) => {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 204,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
      body: '',
    };
  }

  if (event.httpMethod !== 'POST') {
    return cors(405, { error: 'Method not allowed' });
  }

  let carId;
  try {
    const body = JSON.parse(event.body || '{}');
    carId = (body.carId || '').trim();
  } catch (_) {
    return cors(400, { error: 'Invalid JSON body' });
  }

  if (!carId) {
    return cors(400, { error: 'carId is required' });
  }

  const db = getPool();
  try {
    await db.query(INIT_SQL);
    const result = await db.query(
      `INSERT INTO car_views (car_id, views_total, updated_at)
       VALUES ($1, 1, NOW())
       ON CONFLICT (car_id) DO UPDATE
         SET views_total = car_views.views_total + 1,
             updated_at  = NOW()
       RETURNING views_total`,
      [carId]
    );
    return cors(200, { carId, views: result.rows[0].views_total });
  } catch (err) {
    console.error('view function error:', err);
    return cors(500, { error: 'Internal server error' });
  }
};
