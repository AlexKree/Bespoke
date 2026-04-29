'use strict';

const { Pool } = require('pg');
const crypto = require('crypto');
const { Resend } = require('resend');

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
const MAX_MESSAGE_LENGTH = 5000;

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
        `SELECT
           thread_id,
           COUNT(*) AS message_count,
           MAX(created_at) AS last_at,
           (SELECT content FROM messages m2 WHERE m2.thread_id = m.thread_id ORDER BY created_at DESC LIMIT 1) AS last_content,
           (SELECT u.email FROM messages m2 JOIN users u ON u.id = m2.author_id WHERE m2.thread_id = m.thread_id AND m2.author_role = 'client' LIMIT 1) AS client_email,
           (SELECT m2.author_role FROM messages m2 WHERE m2.thread_id = m.thread_id ORDER BY created_at DESC LIMIT 1) AS last_author_role
         FROM messages m
         GROUP BY thread_id
         ORDER BY last_at DESC`
      );
      return { statusCode: 200, headers, body: JSON.stringify({ threads: res.rows }) };
    }

    // ── get-thread ───────────────────────────────────────────────────────
    if (action === 'get-thread') {
      const { thread_id } = body;
      if (!thread_id) return { statusCode: 400, headers, body: JSON.stringify({ error: 'thread_id requis' }) };
      const res = await db.query(
        `SELECT id, thread_id, author_id, author_role, content, created_at
         FROM messages WHERE thread_id = $1
         ORDER BY created_at ASC`,
        [thread_id]
      );
      return { statusCode: 200, headers, body: JSON.stringify({ messages: res.rows }) };
    }

    // ── send ─────────────────────────────────────────────────────────────
    if (action === 'send') {
      const { thread_id, content } = body;
      if (!thread_id) return { statusCode: 400, headers, body: JSON.stringify({ error: 'thread_id requis' }) };
      const trimmed = (content || '').trim();
      if (!trimmed) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Contenu vide' }) };
      if (trimmed.length > MAX_MESSAGE_LENGTH) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: `Message trop long (max ${MAX_MESSAGE_LENGTH} caractères)` }) };
      }

      // Find a staff/admin user to use as author
      const userRes = await db.query(
        `SELECT id FROM users WHERE role IN ('admin', 'staff') ORDER BY created_at ASC LIMIT 1`
      );
      if (!userRes.rows.length) {
        return { statusCode: 400, headers, body: JSON.stringify({ error: 'Aucun compte staff dans la base de données' }) };
      }
      const authorId = userRes.rows[0].id;

      const res = await db.query(
        `INSERT INTO messages (thread_id, author_id, author_role, content)
         VALUES ($1, $2, 'admin', $3)
         RETURNING id, thread_id, author_id, author_role, content, created_at`,
        [thread_id, authorId, trimmed]
      );

      // Send email notification to the client (non-blocking)
      if (process.env.RESEND_API_KEY_V2) {
        db.query(
          `SELECT email FROM users WHERE id = $1`,
          [thread_id]
        ).then(function (recipientResult) {
          if (!recipientResult.rows.length) return;
          const recipientEmail = recipientResult.rows[0].email;
          const resend = new Resend(process.env.RESEND_API_KEY_V2);
          const emailHtml = `<!DOCTYPE html>
<html>
<head>
<style>
body{font-family:Arial,sans-serif;color:#333;margin:0;padding:0}
.container{max-width:600px;margin:0 auto}
.header{background:linear-gradient(135deg,#071526,#0a1f38);color:white;padding:30px;text-align:center}
.content{background:#f9f9f9;padding:30px}
.message-box{background:white;padding:20px;border-left:4px solid #c6b07a;margin:20px 0}
.button{display:inline-block;background:#c6b07a;color:white;padding:12px 24px;text-decoration:none;border-radius:6px;margin-top:20px}
.footer{text-align:center;margin-top:30px;font-size:12px;color:#999}
</style>
</head>
<body>
<div class="container">
<div class="header"><h1>BESPOKE</h1><p>Collection &amp; Prestige</p></div>
<div class="content">
<h2>&#x1F4EC; Nouveau message de l'équipe Bespoke</h2>
<p>Bonjour,</p>
<p>Vous avez reçu une réponse de notre équipe concernant votre demande.</p>
<div class="message-box"><p><strong>Message :</strong></p><p>${trimmed.replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/\n/g,'<br>')}</p></div>
<a href="https://www.thebespokecar.com/fr/stock.html" class="button">Voir mes messages</a>
<div class="footer">
<p>Cet email a été envoyé automatiquement. Merci de ne pas y répondre directement.</p>
<p>&copy; ${new Date().getFullYear()} Bespoke — Collection &amp; Prestige</p>
</div>
</div>
</div>
</body>
</html>`;
          return resend.emails.send({
            from: 'noreply@thebespokecar.com',
            to: recipientEmail,
            subject: '📬 Nouveau message de Bespoke',
            html: emailHtml,
          });
        }).catch(function (emailErr) {
          console.error('Email notification failed:', emailErr);
        });
      }

      return { statusCode: 200, headers, body: JSON.stringify({ ok: true, message: res.rows[0] }) };
    }

    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Action inconnue' }) };
  } catch (err) {
    console.error('admin-messages error:', err);
    return { statusCode: 503, headers, body: JSON.stringify({ error: 'Service temporairement indisponible' }) };
  }
};
