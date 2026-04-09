'use strict';

const { Pool } = require('pg');

let pool = null;

function getPool() {
  if (!process.env.NEON_DATABASE_URL) return null;
  if (!pool) {
    pool = new Pool({ connectionString: process.env.NEON_DATABASE_URL, ssl: { rejectUnauthorized: true }, max: 1 });
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
    console.error('messages session error:', err);
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
  const isStaff = user.role === 'staff' || user.role === 'admin';

  try {
    // ── list ──────────────────────────────────────────────────────────────
    if (action === 'list') {
      if (!isStaff) {
        // Client: return their own thread
        const res = await db.query(
          `SELECT id, thread_id, author_id, author_role, content, created_at
           FROM messages WHERE thread_id = $1
           ORDER BY created_at ASC`,
          [user.id]
        );
        return json(200, { messages: res.rows });
      }

      // Staff: if thread_id provided return that thread
      const threadId = body.thread_id || (event.queryStringParameters && event.queryStringParameters.thread_id);
      if (threadId) {
        const res = await db.query(
          `SELECT id, thread_id, author_id, author_role, content, created_at
           FROM messages WHERE thread_id = $1
           ORDER BY created_at ASC`,
          [threadId]
        );
        return json(200, { messages: res.rows });
      }

      // Staff: list all threads with latest message + count
      const res = await db.query(
        `SELECT
           thread_id,
           COUNT(*) AS message_count,
           MAX(created_at) AS last_at,
           (SELECT content FROM messages m2 WHERE m2.thread_id = m.thread_id ORDER BY created_at DESC LIMIT 1) AS last_content,
           (SELECT u.email FROM messages m2 JOIN users u ON u.id = m2.author_id WHERE m2.thread_id = m.thread_id AND m2.author_role = 'client' LIMIT 1) AS client_email
         FROM messages m
         GROUP BY thread_id
         ORDER BY last_at DESC`
      );
      return json(200, { threads: res.rows });
    }

    // ── send ──────────────────────────────────────────────────────────────
    if (action === 'send') {
      const content = (body.content || '').trim();
      if (!content) return json(400, { error: 'Contenu vide' });
      if (content.length > 5000) return json(400, { error: 'Message trop long (max 5000 caractères)' });

      let threadId;
      if (!isStaff) {
        threadId = user.id;
      } else {
        threadId = body.thread_id;
        if (!threadId) return json(400, { error: 'thread_id requis pour le staff' });
      }

      const res = await db.query(
        `INSERT INTO messages (thread_id, author_id, author_role, content)
         VALUES ($1, $2, $3, $4)
         RETURNING id, thread_id, author_id, author_role, content, created_at`,
        [threadId, user.id, user.role, content]
      );
      return json(200, { ok: true, message: res.rows[0] });
    }

    return json(400, { error: 'Action inconnue' });
  } catch (err) {
    console.error('messages error:', err);
    return json(503, { error: 'Service temporairement indisponible' });
  }
};
