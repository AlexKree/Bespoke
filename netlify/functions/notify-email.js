'use strict';

const { Resend } = require('resend');
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

function escapeHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method not allowed' });
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return json(400, { error: 'Invalid JSON' });
  }

  const { to, subject, html, from = 'noreply@thebespokecar.com' } = body;

  if (!to || !subject || !html) {
    return json(400, { error: 'Missing required fields: to, subject, html' });
  }

  if (!process.env.RESEND_API_KEY_V2) {
    console.error('RESEND_API_KEY_V2 not configured');
    return json(500, { error: 'Email service not configured' });
  }

  const resend = new Resend(process.env.RESEND_API_KEY_V2);

  try {
    const result = await resend.emails.send({ from, to, subject, html });

    // Log to DB (best-effort, non-blocking)
    const db = getPool();
    if (db) {
      db.query(
        `INSERT INTO email_notifications (email_to, subject, sent_at, status)
         VALUES ($1, $2, NOW(), 'sent')`,
        [to, subject]
      ).catch(function (dbErr) {
        console.error('Failed to log email to DB:', dbErr);
      });
    }

    return json(200, { success: true, id: result.data && result.data.id });
  } catch (err) {
    console.error('Email send error:', err);
    return json(500, { error: 'Failed to send email' });
  }
};
