// GET /.netlify/functions/views?ids=id1,id2,...
// Returns view counts for the requested car IDs as { id1: 14, id2: 3, ... }.
// Missing IDs default to 0.
// Idempotent table creation — works even if sql/create_views_table.sql was never run.

const { Pool } = require('pg');

let pool;

function getPool() {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.NEON_DATABASE_URL,
      ssl: { rejectUnauthorized: false },
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
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
      body: '',
    };
  }

  if (event.httpMethod !== 'GET') {
    return cors(405, { error: 'Method not allowed' });
  }

  const idsParam = (event.queryStringParameters || {}).ids || '';
  const ids = idsParam
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

  if (!ids.length) {
    return cors(200, {});
  }

  const db = getPool();
  try {
    await db.query(INIT_SQL);

    // Build parameterised query: WHERE car_id = ANY($1)
    const result = await db.query(
      'SELECT car_id, views_total FROM car_views WHERE car_id = ANY($1)',
      [ids]
    );

    // Build response object, defaulting unseen IDs to 0
    const counts = {};
    ids.forEach((id) => { counts[id] = 0; });
    result.rows.forEach((row) => { counts[row.car_id] = row.views_total; });

    return cors(200, counts);
  } catch (err) {
    console.error('views function error:', err);
    return cors(500, { error: 'Internal server error' });
  }
};
