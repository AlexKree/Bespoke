const crypto = require('crypto');
const https = require('https');

// ---------------------------------------------------------------------------
// Token helpers — stateless HMAC-based session (~1-2 h validity)
// ---------------------------------------------------------------------------

const MS_PER_HOUR = 3_600_000;

/**
 * Derive a 32-byte signing key from the admin password using scrypt, a
 * memory-hard KDF designed for password-based key derivation.  This ensures
 * the raw password is never used directly as a cryptographic key.
 */
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
  // Accept current hour and previous hour to handle the boundary gracefully
  return (
    crypto.timingSafeEqual(Buffer.from(token), Buffer.from(makeToken(password, h))) ||
    crypto.timingSafeEqual(Buffer.from(token), Buffer.from(makeToken(password, h - 1)))
  );
}

/**
 * Constant-time string equality — prevents timing attacks on password comparison.
 * Pads shorter buffers so length differences don't shortcut the comparison.
 */
function timingSafeStringEqual(a, b) {
  const bufA = Buffer.from(String(a));
  const bufB = Buffer.from(String(b));
  // Pad to the same length; result is still false when lengths differ
  const maxLen = Math.max(bufA.length, bufB.length);
  const paddedA = Buffer.concat([bufA, Buffer.alloc(maxLen - bufA.length)]);
  const paddedB = Buffer.concat([bufB, Buffer.alloc(maxLen - bufB.length)]);
  const equal = crypto.timingSafeEqual(paddedA, paddedB);
  // Explicitly reject if lengths differ (padding means equal is meaningless)
  return equal && bufA.length === bufB.length;
}

// ---------------------------------------------------------------------------
// GitHub API helper
// ---------------------------------------------------------------------------

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
    if (payload) {
      options.headers['Content-Length'] = Buffer.byteLength(payload);
    }

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(data) });
        } catch (_) {
          resolve({ status: res.statusCode, body: data });
        }
      });
    });

    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Main handler
// ---------------------------------------------------------------------------

exports.handler = async function (event) {
  const headers = {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    Vary: 'Origin',
  };

  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 204, headers, body: '' };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (_) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
  const GITHUB_TOKEN   = process.env.GITHUB_TOKEN;
  const GITHUB_OWNER   = process.env.GITHUB_OWNER;
  const GITHUB_REPO    = process.env.GITHUB_REPO;

  const { action } = body;

  // ── Authentication ──────────────────────────────────────────────────────
  if (action === 'auth') {
    if (!ADMIN_PASSWORD) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'Admin not configured' }) };
    }
    const { password } = body;
    if (!password || !timingSafeStringEqual(password, ADMIN_PASSWORD)) {
      return { statusCode: 401, headers, body: JSON.stringify({ error: 'Invalid password' }) };
    }
    const sessionToken = makeToken(ADMIN_PASSWORD, currentHour());
    return { statusCode: 200, headers, body: JSON.stringify({ token: sessionToken }) };
  }

  // ── All other actions require a valid session token ──────────────────────
  const authHeader = (event.headers || {})['authorization'] || (event.headers || {})['Authorization'] || '';
  const sessionToken = authHeader.replace(/^Bearer\s+/i, '').trim();

  if (!sessionToken || !ADMIN_PASSWORD) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  let tokenValid = false;
  try {
    // timingSafeEqual requires same-length buffers; makeToken always returns 64-char hex
    if (sessionToken.length === 64) {
      tokenValid = verifyToken(sessionToken, ADMIN_PASSWORD);
    }
  } catch (_) {
    tokenValid = false;
  }

  if (!tokenValid) {
    return { statusCode: 401, headers, body: JSON.stringify({ error: 'Unauthorized' }) };
  }

  if (!GITHUB_TOKEN || !GITHUB_OWNER || !GITHUB_REPO) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'GitHub not configured' }) };
  }

  // GITHUB_TOKEN must be a Personal Access Token (classic) with `repo` scope,
  // or a fine-grained token with Contents: Read & Write on this repository.
  const filePath = `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/assets/stock/stock.json`;

  // ── Get current stock ────────────────────────────────────────────────────
  if (action === 'getStock') {
    const res = await githubRequest('GET', filePath, GITHUB_TOKEN, null);
    if (res.status !== 200) {
      return { statusCode: 502, headers, body: JSON.stringify({ error: 'GitHub API error', detail: res.body }) };
    }
    let content, stock;
    try {
      content = Buffer.from(res.body.content, 'base64').toString('utf8');
      stock = JSON.parse(content);
    } catch (_) {
      return { statusCode: 502, headers, body: JSON.stringify({ error: 'Malformed stock.json' }) };
    }
    return { statusCode: 200, headers, body: JSON.stringify({ stock, sha: res.body.sha }) };
  }

  // ── Save updated stock ───────────────────────────────────────────────────
  if (action === 'saveStock') {
    const { stock, sha } = body;
    if (!stock || typeof sha !== 'string') {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing stock or sha' }) };
    }
    // Validate basic structure
    if (!Array.isArray(stock.items)) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'stock.items must be an array' }) };
    }

    const content = Buffer.from(JSON.stringify(stock, null, 2) + '\n').toString('base64');
    const res = await githubRequest('PUT', filePath, GITHUB_TOKEN, {
      message: 'Admin: update stock.json',
      content,
      sha,
    });

    if (res.status !== 200 && res.status !== 201) {
      return { statusCode: 502, headers, body: JSON.stringify({ error: 'GitHub API error', detail: res.body }) };
    }
    return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
  }

  return { statusCode: 400, headers, body: JSON.stringify({ error: 'Unknown action' }) };
};
