'use strict';

const { Pool } = require('pg');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const { Resend } = require('resend');

// Module-level pool with lazy init
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

function jsonWithCookie(statusCode, body, cookie) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json', 'Set-Cookie': cookie },
    body: JSON.stringify(body),
  };
}

function parseSessionCookie(event) {
  const header = event.headers && (event.headers['cookie'] || event.headers['Cookie']);
  if (!header) return null;
  const match = header.match(/(?:^|;\s*)bespoke_session=([^;]+)/);
  return match ? match[1] : null;
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
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

async function sendVerificationEmail(email, token, baseUrl) {
  const verifyUrl = `${baseUrl}/fr/verify.html?token=${token}`;
  const apiKey = process.env.RESEND_API_KEY_V2;

  // 🔍 DEBUG: Vérifier si la clé API est chargée
  console.log('🔑 RESEND_API_KEY_V2 defined:', !!apiKey);

  if (!apiKey) {
    console.log('⚠️ RESEND_API_KEY_V2 not configured. Verification link:', verifyUrl);
    return verifyUrl;
  }

  try {
    const resend = new Resend(apiKey);
    const from = process.env.RESEND_FROM_EMAIL || 'contact@thebespokecar.com';

    console.log(`📧 Attempting to send verification email`);
    console.log(`   From: ${from}`);
    console.log(`   To: ${email}`);
    console.log(`   Resend instance created:`, !!resend);

    const result = await resend.emails.send({
      from,
      to: email,
      subject: 'Vérifiez votre adresse email — Bespoke',
      html: `
        <div style="font-family:sans-serif;max-width:480px;margin:0 auto;padding:32px 24px;background:#05101e;color:#fff;border-radius:12px">
          <h2 style="color:#c9a14a;margin-bottom:16px">Bienvenue sur Bespoke</h2>
          <p>Cliquez sur le lien ci-dessous pour activer votre compte :</p>
          <a href="${verifyUrl}" style="display:inline-block;margin:20px 0;padding:12px 28px;background:#c9a14a;color:#05101e;border-radius:8px;text-decoration:none;font-weight:600">Vérifier mon email</a>
          <p style="color:rgba(255,255,255,.58);font-size:13px">Ce lien expire dans 24 heures. Si vous n'avez pas créé de compte, ignorez cet email.</p>
          <p style="color:rgba(255,255,255,.58);font-size:12px">Ou copiez ce lien : ${verifyUrl}</p>
        </div>
      `,
    });

    // 🔍 DEBUG: Afficher la réponse complète de Resend
    console.log('✅ Resend API response:', JSON.stringify({ data: result.data, error: result.error }, null, 2));

    // Resend SDK v6 returns { data, error } — check for API-level errors
    if (result.error) {
      console.error('❌ Resend API returned an error:', JSON.stringify(result.error, null, 2));
      console.log('📋 Fallback verification link:', verifyUrl);
      return verifyUrl;
    }

    console.log('✅ Email sent successfully. Resend ID:', result.data?.id);
    return null;

  } catch (error) {
    // 🔍 DEBUG: Afficher l'erreur complète
    console.error('❌ Failed to send verification email');
    console.error('   Error name:', error.name);
    console.error('   Error message:', error.message);
    console.error('   Error stack:', error.stack);
    if (error.statusCode) {
      console.error('   HTTP status code:', error.statusCode);
    }
    if (error.response) {
      console.error('   API response:', JSON.stringify(error.response, null, 2));
    }
    console.log('📋 Fallback verification link:', verifyUrl);
    return verifyUrl;
  }
}

exports.handler = async function (event) {
  if (event.httpMethod !== 'POST') {
    return json(405, { error: 'Method not allowed' });
  }

  const db = getPool();
  if (!db) {
    return json(503, { error: 'Database not configured' });
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return json(400, { error: 'Invalid JSON' });
  }

  const { action } = body;

  try {
    // ── register ──────────────────────────────────────────────────────────
    if (action === 'register') {
      const { email, password, account_type } = body;
      if (!email || !isValidEmail(email)) return json(400, { error: 'Email invalide' });
      if (!password || password.length < 8) return json(400, { error: 'Le mot de passe doit contenir au moins 8 caractères' });
      const acctType = account_type === 'Entreprise' ? 'Entreprise' : 'Particulier';

      const existing = await db.query('SELECT id FROM users WHERE email = $1', [email.toLowerCase()]);
      if (existing.rows.length) return json(409, { error: 'Cet email est déjà utilisé' });

      const hash = await bcrypt.hash(password, 10);
      const userRes = await db.query(
        `INSERT INTO users (email, password_hash, role, account_type, email_verified)
         VALUES ($1, $2, 'client', $3, FALSE) RETURNING id`,
        [email.toLowerCase(), hash, acctType]
      );
      const userId = userRes.rows[0].id;

      const token = crypto.randomBytes(32).toString('hex');
      await db.query(
        `INSERT INTO email_tokens (user_id, token, expires_at) VALUES ($1, $2, now() + interval '24 hours')`,
        [userId, token]
      );

      const proto = event.headers['x-forwarded-proto'] || 'https';
      const host = event.headers['x-forwarded-host'] || event.headers['host'] || 'thebespokecar.com';
      const baseUrl = `${proto}://${host}`;
      const verifyUrl = await sendVerificationEmail(email.toLowerCase(), token, baseUrl);

      // 🔍 DEBUG: Indiquer si le lien a été retourné (= email non envoyé)
      if (verifyUrl) {
        console.log(`⚠️ Email could not be sent. Returning verification link in response.`);
        return json(200, {
          ok: true,
          message: 'Vérifiez votre email',
          verifyUrl,
          warning: 'Email non envoyé. Utilisez le lien ci-dessous pour vérifier votre compte.',
        });
      }

      console.log('✅ Registration complete. Email sent successfully.');
      return json(200, { ok: true, message: 'Vérifiez votre email pour activer votre compte.' });
    }

    // ── verify-email ──────────────────────────────────────────────────────
    if (action === 'verify-email') {
      const token = body.token || (event.queryStringParameters && event.queryStringParameters.token);
      if (!token) return json(400, { error: 'Token manquant' });

      const tokenRes = await db.query(
        `SELECT id, user_id, expires_at, used FROM email_tokens WHERE token = $1`,
        [token]
      );
      if (!tokenRes.rows.length) return json(400, { error: 'Token invalide' });
      const row = tokenRes.rows[0];
      if (row.used) return json(400, { error: 'Token déjà utilisé' });
      if (new Date(row.expires_at) < new Date()) return json(400, { error: 'Token expiré' });

      await db.query('UPDATE email_tokens SET used = TRUE WHERE id = $1', [row.id]);
      await db.query('UPDATE users SET email_verified = TRUE WHERE id = $1', [row.user_id]);

      return json(200, { ok: true });
    }

    // ── login ─────────────────────────────────────────────────────────────
    if (action === 'login') {
      const { email, password } = body;
      if (!email || !password) return json(400, { error: 'Email et mot de passe requis' });

      const userRes = await db.query(
        `SELECT id, email, password_hash, role, account_type, balance_cents, email_verified
         FROM users WHERE email = $1`,
        [email.toLowerCase()]
      );
      if (!userRes.rows.length) return json(401, { error: 'Identifiants incorrects' });
      const user = userRes.rows[0];

      if (!user.email_verified) return json(403, { error: 'Veuillez vérifier votre email avant de vous connecter' });

      const valid = await bcrypt.compare(password, user.password_hash);
      if (!valid) return json(401, { error: 'Identifiants incorrects' });

      const sessionId = crypto.randomBytes(32).toString('hex');
      await db.query(
        `INSERT INTO sessions (id, user_id, expires_at) VALUES ($1, $2, now() + interval '7 days')`,
        [sessionId, user.id]
      );

      const cookie = `bespoke_session=${sessionId}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=604800`;
      return jsonWithCookie(200, {
        ok: true,
        user: { id: user.id, email: user.email, role: user.role, account_type: user.account_type, balance_cents: user.balance_cents },
      }, cookie);
    }

    // ── logout ────────────────────────────────────────────────────────────
    if (action === 'logout') {
      const sessionId = parseSessionCookie(event);
      if (sessionId) {
        await db.query('DELETE FROM sessions WHERE id = $1', [sessionId]);
      }
      const cookie = 'bespoke_session=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0';
      return jsonWithCookie(200, { ok: true }, cookie);
    }

    // ── me ────────────────────────────────────────────────────────────────
    if (action === 'me') {
      const sessionId = parseSessionCookie(event);
      const user = await getSessionUser(db, sessionId);
      return json(200, { user: user || null });
    }

    // ── setup-staff ───────────────────────────────────────────────────────
    if (action === 'setup-staff') {
      const { token, password } = body;
      if (!token) return json(400, { error: 'Token manquant' });
      if (!password || password.length < 8) return json(400, { error: 'Le mot de passe doit contenir au moins 8 caractères' });

      const inviteRes = await db.query(
        `SELECT id, email, role, used, expires_at FROM staff_invites WHERE token = $1`,
        [token]
      );
      if (!inviteRes.rows.length) return json(400, { error: 'Token invalide' });
      const invite = inviteRes.rows[0];
      if (invite.used) return json(400, { error: 'Token déjà utilisé' });
      if (new Date(invite.expires_at) < new Date()) return json(400, { error: 'Token expiré' });

      const hash = await bcrypt.hash(password, 10);

      // Upsert user
      await db.query(
        `INSERT INTO users (email, password_hash, role, email_verified)
         VALUES ($1, $2, $3, TRUE)
         ON CONFLICT (email) DO UPDATE SET password_hash = $2, role = $3, email_verified = TRUE`,
        [invite.email, hash, invite.role]
      );

      await db.query('UPDATE staff_invites SET used = TRUE WHERE id = $1', [invite.id]);

      return json(200, { ok: true });
    }

    return json(400, { error: 'Action inconnue' });
  } catch (err) {
    console.error('auth error:', err);
    return json(503, { error: 'Service temporairement indisponible' });
  }
};
