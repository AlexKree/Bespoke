const crypto = require('crypto');
const https = require('https');
const { Pool } = require('pg');

let pool = null;

/**
 * Base privee (jamais commitee dans le repo public) servant a stocker le VIN
 * complet des vehicules. stock.json reste public : il ne contient jamais que
 * les 6 premiers caracteres du VIN.
 */
function getPool() {
  const dbUrl = process.env.DATABASE_URL || process.env.NEON_DATABASE_URL;
  if (!dbUrl) return null;
  if (!pool) {
    pool = new Pool({ connectionString: dbUrl, ssl: { rejectUnauthorized: false } });
  }
  return pool;
}

/**
 * Upsert des VIN complets fournis pour les vehicules presents dans `items`,
 * et purge des VIN de vehicules qui ne sont plus dans le stock. N'ecrit rien
 * dans stock.json : cette table est le seul endroit ou le VIN integral vit.
 */
async function saveVins(items, vins) {
  const pool = getPool();
  if (!pool) return; // DB non configuree : la sauvegarde du stock continue sans bloquer.

  const ids = Array.from(new Set((items || []).map((it) => it && it.id).filter(Boolean)));
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const id of ids) {
      const full = ((vins && vins[id]) || '').trim();
      if (!full) continue;
      await client.query(
        `INSERT INTO vehicle_vins (car_id, vin_full, updated_at) VALUES ($1, $2, now())
         ON CONFLICT (car_id) DO UPDATE SET vin_full = EXCLUDED.vin_full, updated_at = now()`,
        [id, full]
      );
    }
    await client.query('DELETE FROM vehicle_vins WHERE car_id <> ALL($1::text[])', [ids]);
    await client.query('COMMIT');
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

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

/** Slug d'URL pour une fiche vehicule : pas de troncature, accents retires. */
function vehicleSlugify(s) {
  return String(s || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

/**
 * Garantit un `slug` unique et stable sur chaque vehicule de la liste.
 * Ne touche jamais un slug deja present : une URL publiee ne doit pas bouger.
 * Mute la liste en place.
 */
function ensureSlugs(list) {
  const seen = new Set();
  for (const it of list) {
    if (it && typeof it.slug === 'string' && it.slug.trim()) seen.add(it.slug.trim());
  }
  for (const it of list) {
    if (!it || (typeof it.slug === 'string' && it.slug.trim())) continue;
    const name = (it.title && (it.title.fr || it.title.en))
      || [it.make, it.model].filter(Boolean).join(' ');
    let base = vehicleSlugify(name);
    if (it.year && !base.split('-').includes(String(it.year))) {
      base = base ? `${base}-${it.year}` : String(it.year);
    }
    base = base || vehicleSlugify(String(it.id || '')) || 'vehicule';
    let slug = base;
    let n = 2;
    while (seen.has(slug)) slug = `${base}-${n++}`;
    it.slug = slug;
    seen.add(slug);
  }
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
        const res = await githubRequest('PUT', ghPath, GITHUB_TOKEN, {
          message: `Admin: upload image ${filename}`,
          content:  file.data.toString('base64'),
        });

        if (res.status !== 200 && res.status !== 201) {
          uploadErrors.push(`${file.filename}: GitHub error (${res.status})`);
          continue;
        }
        uploadedPaths.push(`/assets/stock/images/${filename}`);
      } catch (_) {
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
  if (action === 'auth' || action === 'login') {
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

  // ── VIN complets (base privee, jamais dans stock.json) ───────────────────
  if (action === 'getVins') {
    const dbPool = getPool();
    if (!dbPool) {
      return { statusCode: 200, headers, body: JSON.stringify({ vins: {} }) };
    }
    try {
      const { rows } = await dbPool.query('SELECT car_id, vin_full FROM vehicle_vins');
      const vins = {};
      for (const row of rows) vins[row.car_id] = row.vin_full;
      return { statusCode: 200, headers, body: JSON.stringify({ vins }) };
    } catch (err) {
      return { statusCode: 502, headers, body: JSON.stringify({ error: 'DB error', detail: String(err) }) };
    }
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
    const { stock, sha, vins } = body;
    if (!stock || typeof sha !== 'string') {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing stock or sha' }) };
    }
    // Validate basic structure
    if (!Array.isArray(stock.items)) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'stock.items must be an array' }) };
    }

    // Slug stable par vehicule. L'URL publique /fr|/en/stock/<slug>.html ne doit
    // jamais changer : on genere un slug pour toute fiche qui n'en a pas (ajout
    // via l'admin, donnee historique), on le fige, et on garantit l'unicite.
    ensureSlugs(stock.items);

    // VIN complets : persistes en base privee, jamais dans stock.json (public,
    // commite dans le repo). Non bloquant : une erreur DB ne doit pas empecher
    // la publication du stock.
    if (vins && typeof vins === 'object') {
      try {
        await saveVins(stock.items, vins);
      } catch (err) {
        console.error('saveVins failed', err);
      }
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
