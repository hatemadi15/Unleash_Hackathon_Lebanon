const { randomUUID, createHmac, pbkdf2Sync } = require('crypto');

function nowISO() {
  return new Date().toISOString();
}

function sendJSON(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
  });
  res.end(JSON.stringify(data));
}

function sendText(res, statusCode, text, headers = {}) {
  res.writeHead(statusCode, Object.assign({
    'Content-Type': 'text/plain',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS'
  }, headers));
  res.end(text);
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', chunk => {
      data += chunk;
      if (data.length > 1e6) {
        req.connection.destroy();
        reject(new Error('Payload too large'));
      }
    });
    req.on('end', () => {
      if (!data) {
        resolve({});
        return;
      }
      try {
        const parsed = JSON.parse(data);
        resolve(parsed);
      } catch (err) {
        reject(err);
      }
    });
  });
}

function hashPassword(password, salt = randomUUID()) {
  const hash = pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, stored) {
  const [salt, hash] = stored.split(':');
  const computed = pbkdf2Sync(password, salt, 10000, 64, 'sha512').toString('hex');
  return hash === computed;
}

const JWT_SECRET = process.env.JWT_SECRET || 'recup-dev-secret';

function base64url(input) {
  return Buffer.from(JSON.stringify(input))
    .toString('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
}

function createToken(payload) {
  const header = { alg: 'HS256', typ: 'JWT' };
  const headerEncoded = base64url(header);
  const payloadEncoded = base64url(payload);
  const data = `${headerEncoded}.${payloadEncoded}`;
  const signature = createHmac('sha256', JWT_SECRET)
    .update(data)
    .digest('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
  return `${data}.${signature}`;
}

function verifyToken(token) {
  if (!token) return null;
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [header, payload, signature] = parts;
  const data = `${header}.${payload}`;
  const expected = createHmac('sha256', JWT_SECRET)
    .update(data)
    .digest('base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');
  if (expected !== signature) return null;
  try {
    const decoded = JSON.parse(Buffer.from(payload, 'base64').toString('utf-8'));
    return decoded;
  } catch (err) {
    return null;
  }
}

function parseCupIdFromQr(text) {
  if (!text) return null;
  try {
    const url = new URL(text);
    const segments = url.pathname.split('/').filter(Boolean);
    return segments[segments.length - 1];
  } catch (err) {
    return text.trim();
  }
}

module.exports = {
  nowISO,
  sendJSON,
  sendText,
  parseBody,
  hashPassword,
  verifyPassword,
  createToken,
  verifyToken,
  parseCupIdFromQr
};
