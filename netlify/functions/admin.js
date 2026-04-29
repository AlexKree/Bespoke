const crypto = require('crypto');
const https = require('https');

// ---------------------------------------------------------------------------
// Image upload constants
// ---------------------------------------------------------------------------

const ALLOWED_IMAGE_TYPES = new Set([
  'image/jpeg', 'image/jpg', 'image/png', 'image/webp',
  'image/gif', 'image/avif', 'image/heic', 'image/heif',
  'image/tiff', 'image/bmp', 'image/svg+xml',
]);

const MIME_TO_EXT = {
  'image/jpeg': 'jpg', 'image/jpg': 'jpg',
  'image/png': 'png',  'image/webp': 'webp',
  'image/gif': 'gif',  'image/avif': 'avif',
  'image/heic': 'heic','image/heif': 'heif',
  'image/tiff': 'tiff','image/bmp': 'bmp',
  'image/svg+xml': 'svg',
};

/** Maximum size per uploaded file (5 MB). */
const MAX_FILE_SIZE = 5 * 1024 * 1024;

/** Maximum number of files per upload request. */
const MAX_FILES = 20;

/** Maximum length for the car ID slug prefix in generated filenames. */
const MAX_SLUG_LENGTH = 40;

/** Number of random bytes for the unique suffix in filenames (produces 6 hex chars). */
const RANDOM_BYTES = 3;

// ---------------------------------------------------------------------------
// Upload helpers
// ---------------------------------------------------------------------------

function slugify(s) {
  return (s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, MAX_SLUG_LENGTH) || 'img';
}

function getExtFromMime(mime, filename) {
  const ext = MIME_TO_EXT[(mime || '').toLowerCase()];
  if (ext) return ext;
  const m = (filename || '').match(/\.([a-zA-Z0-9]+)$/);
  return m ? m[1].toLowerCase() : 'jpg';
}

/**
 * Minimal multipart/form-data parser — no external dependencies.
 * Returns an array of { name, filename, contentType, data (Buffer) }.
 */
function parseMultipartBody(bodyBuffer, boundary) {
  const parts = [];
  const firstBoundaryBuf = Buffer.from('--' + boundary);
  const sepBuf           = Buffer.from('\r\n--' + boundary);
  const CRLF2            = Buffer.from('\r\n\r\n');

  // Locate the start of the first part
  let pos = bodyBuffer.indexOf(firstBoundaryBuf);
  if (pos === -1) return parts;
  pos += firstBoundaryBuf.length;

  // Skip CRLF after the opening boundary
  if (bodyBuffer[pos] === 0x0D && bodyBuffer[pos + 1] === 0x0A) pos += 2;
  else if (bodyBuffer[pos] === 0x0A) pos += 1;

  while (pos < bodyBuffer.length) {
    const headerEnd = bodyBuffer.indexOf(CRLF2, pos);
    if (headerEnd === -1) break;

    // Use latin1 so header bytes are preserved faithfully
    const headerText = bodyBuffer.slice(pos, headerEnd).toString('latin1');
    const dataStart  = headerEnd + 4;

    // Find the next boundary separator (preceded by \r\n)
    const nextSepPos = bodyBuffer.indexOf(sepBuf, dataStart);
    const dataEnd    = nextSepPos === -1 ? bodyBuffer.length : nextSepPos;
    const data       = bodyBuffer.slice(dataStart, dataEnd);

    // Parse headers into a plain object
    const hdrs = {};
    headerText.split('\r\n').forEach(line => {
      const colon = line.indexOf(':');
      if (colon > -1) {
        hdrs[line.slice(0, colon).toLowerCase().trim()] = line.slice(colon + 1).trim();
      }
    });

    const cd             = hdrs['content-disposition'] || '';
    const nameMatch      = cd.match(/\bname="([^"]+)"/i);
    const filenameMatch  = cd.match(/\bfilename="([^"]*?)"/i);

    parts.push({
      name:        nameMatch     ? nameMatch[1]     : null,
      filename:    filenameMatch ? filenameMatch[1]  : null,
      contentType: (hdrs['content-type'] || 'application/octet-stream').split(';')[0].trim(),
      data,
    });

    if (nextSepPos === -1) break;

    pos = nextSepPos + sepBuf.length;

    // Final boundary ends with '--'
    if (bodyBuffer[pos] === 0x2D && bodyBuffer[pos + 1] === 0x2D) break;

    // Skip CRLF before next part
    if (bodyBuffer[pos] === 0x0D && bodyBuffer[pos + 1] === 0x0A) pos += 2;
    else if (bodyBuffer[pos] === 0x0A) pos += 1;
  }

  return parts;
}

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

    req.on('error', (err) => {
      console.error('GitHub API request error:', err);
      reject(err);
    });
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

  const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
  const GITHUB_TOKEN   = process.env.GITHUB_TOKEN;
  const GITHUB_OWNER   = process.env.GITHUB_OWNER;
  const GITHUB_REPO    = process.env.GITHUB_REPO;

  // ── Detect multipart (image upload) ─────────────────────────────────────
  const rawContentType = (event.headers || {})['content-type'] || (event.headers || {})['Content-Type'] || '';
  const contentTypeLower = rawContentType.toLowerCase();

  if (contentTypeLower.startsWith('multipart/form-data')) {
    // ── Auth check ──────────────────────────────────────────────────────
    const authHeader   = (event.headers || {})['authorization'] || (event.headers || {})['Authorization'] || '';
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

    if (!GITHUB_TOKEN || !GITHUB_OWNER || !GITHUB_REPO) {
      return { statusCode: 500, headers, body: JSON.stringify({ error: 'GitHub not configured' }) };
    }

    // ── Parse multipart boundary ─────────────────────────────────────────
    const boundaryMatch = rawContentType.match(/boundary=([^\s;]+)/i);
    if (!boundaryMatch) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing multipart boundary' }) };
    }
    const boundary = boundaryMatch[1].replace(/^"(.*)"$/, '$1');

    // Netlify base64-encodes binary bodies
    const bodyBuffer = event.isBase64Encoded
      ? Buffer.from(event.body || '', 'base64')
      : Buffer.from(event.body || '', 'utf8');

    const parts = parseMultipartBody(bodyBuffer, boundary);

    // ── Extract optional carId field ─────────────────────────────────────
    let carId = 'img';
    for (const part of parts) {
      if (part.name === 'carId' && !part.filename) {
        carId = slugify(part.data.toString('utf8').trim()) || 'img';
        break;
      }
    }

    // ── Validate and upload image files ──────────────────────────────────
    const imageFiles = parts.filter(p => p.name === 'images' && p.filename);

    if (!imageFiles.length) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'No image files provided' }) };
    }
    if (imageFiles.length > MAX_FILES) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: `Too many files (max ${MAX_FILES})` }) };
    }

    const uploadedPaths = [];
    const uploadErrors  = [];

    for (const file of imageFiles) {
      const mime = file.contentType.toLowerCase();

      if (!ALLOWED_IMAGE_TYPES.has(mime)) {
        uploadErrors.push(`${file.filename}: unsupported type (${mime})`);
        continue;
      }
      if (file.data.length > MAX_FILE_SIZE) {
        uploadErrors.push(`${file.filename}: file too large (max 5 MB)`);
        continue;
      }

      const ext      = getExtFromMime(mime, file.filename);
      const ts       = Date.now();
      const rnd      = crypto.randomBytes(RANDOM_BYTES).toString('hex');
      const filename = `${carId}-${ts}-${rnd}.${ext}`;
      const ghPath   = `/repos/${GITHUB_OWNER}/${GITHUB_REPO}/contents/assets/stock/images/${filename}`;

      try {
        console.log(`Uploading image ${filename} to GitHub`);
        const res = await githubRequest('PUT', ghPath, GITHUB_TOKEN, {
          message: `Admin: upload image ${filename}`,
          content:  file.data.toString('base64'),
        });

        console.log(`GitHub API response for ${filename}:`, res.status);

        if (res.status !== 200 && res.status !== 201) {
          console.error(`Upload failed for ${filename}:`, res.status, res.body);
          uploadErrors.push(`${file.filename}: GitHub error (${res.status})`);
          continue;
        }
        uploadedPaths.push(`/assets/stock/images/${filename}`);
      } catch (err) {
        console.error(`Network error uploading ${filename}:`, err);
        uploadErrors.push(`${file.filename}: network error`);
      }
    }

    if (uploadedPaths.length === 0 && uploadErrors.length > 0) {
      return {
        statusCode: 422,
        headers,
        body: JSON.stringify({ error: uploadErrors.join('; '), paths: [] }),
      };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({
        ok: true,
        paths: uploadedPaths,
        ...(uploadErrors.length ? { errors: uploadErrors } : {}),
      }),
    };
  }

  // ── JSON actions (auth / getStock / saveStock) ────────────────────────────
  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch (_) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

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
    console.log('getStock: fetching stock.json from GitHub');
    const res = await githubRequest('GET', filePath, GITHUB_TOKEN, null);
    console.log('GitHub API response status:', res.status);
    if (res.status !== 200) {
      console.error('GitHub API error:', { status: res.status, body: res.body, filePath });
      return { statusCode: 502, headers, body: JSON.stringify({ error: 'GitHub API error', status: res.status, detail: res.body }) };
    }
    let content, stock;
    try {
      content = Buffer.from(res.body.content, 'base64').toString('utf8');
      stock = JSON.parse(content);
      console.log('getStock: success, items count:', stock.items?.length || 0);
    } catch (err) {
      console.error('getStock: malformed stock.json:', err);
      return { statusCode: 502, headers, body: JSON.stringify({ error: 'Malformed stock.json' }) };
    }
    return { statusCode: 200, headers, body: JSON.stringify({ stock, sha: res.body.sha }) };
  }

  // ── Save updated stock ───────────────────────────────────────────────────
  if (action === 'saveStock') {
    const { stock, sha } = body;
    console.log('saveStock: updating stock.json with sha:', sha);
    if (!stock || typeof sha !== 'string') {
      console.error('saveStock: missing stock or sha');
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing stock or sha' }) };
    }
    // Validate basic structure
    if (!Array.isArray(stock.items)) {
      console.error('saveStock: stock.items is not an array');
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'stock.items must be an array' }) };
    }

    const content = Buffer.from(JSON.stringify(stock, null, 2) + '\n').toString('base64');
    const res = await githubRequest('PUT', filePath, GITHUB_TOKEN, {
      message: 'Admin: update stock.json',
      content,
      sha,
    });

    console.log('GitHub API response status:', res.status);

    if (res.status !== 200 && res.status !== 201) {
      console.error('GitHub API error:', { status: res.status, body: res.body, filePath, sha });
      return { statusCode: 502, headers, body: JSON.stringify({ error: 'GitHub API error', status: res.status, detail: res.body }) };
    }
    console.log('saveStock: success');
    return { statusCode: 200, headers, body: JSON.stringify({ ok: true }) };
  }

  return { statusCode: 400, headers, body: JSON.stringify({ error: 'Unknown action' }) };
};
