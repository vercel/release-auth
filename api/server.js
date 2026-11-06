const { isIP } = require('node:net');

const client_id = process.env.CLIENT_ID;
const client_secret = process.env.CLIENT_SECRET;

if (!client_id || !client_secret) {
  console.error('Please define the necessary env variables.');
  process.exit(1);
}

/** @type {Map<string, { ip: string, expiresAt: number, token?: Buffer }>} */
const tokens = new Map();
/** @type {Map<string, { count: number, expiresAt: number }>} */
const pollers = new Map();
const tokenLifetime = 5 * 60 * 1000; // 5 minutes, in milliseconds.
const pollWindow = 60 * 1000; // 1 minute, in milliseconds.
const maxPolls = 60; // 60 requests per IP per polling window.
const maxEntries = 1000; // 1,000 entries per map per function instance.

module.exports = async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'; base-uri 'none'");

  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'method_not_allowed' });
  }

  const now = Date.now();
  for (const [state, entry] of tokens) {
    if (entry.expiresAt <= now) {
      entry.token?.fill(0);
      tokens.delete(state);
    }
  }
  for (const [ip, poller] of pollers) {
    if (poller.expiresAt <= now) {
      pollers.delete(ip);
    }
  }

  const { code, state, error } = req.query;
  if (
    typeof state !== 'string' || !state ||
    (code !== undefined && (typeof code !== 'string' || !code))
  ) {
    return res.status(400).json({ error: 'invalid_request' });
  }

  const ip = getClientIP(req);
  if (!ip) {
    return res.status(403).json({ error: 'invalid_client_ip' });
  }

  if (error !== undefined) {
    return res.status(400).json({ error: 'authorization_failed' });
  }

  if (code) {
    if (tokens.has(state)) {
      return res.status(409).json({ error: 'state_already_defined' });
    }
    if (tokens.size >= maxEntries) {
      res.setHeader('Retry-After', String(tokenLifetime / 1000));
      return res.status(503).json({ error: 'too_many_tokens' });
    }

    // Reserve the state before exchanging so concurrent callbacks cannot overwrite it.
    const entry = { ip, expiresAt: now + tokenLifetime };
    tokens.set(state, entry);
    const token = await requestToken(code);
    if (!token || tokens.get(state) !== entry || entry.expiresAt <= Date.now()) {
      if (tokens.get(state) === entry) {
        tokens.delete(state);
      }
      return res.status(502).json({ error: 'token_exchange_failed' });
    }

    entry.token = Buffer.from(token);
    entry.expiresAt = Date.now() + tokenLifetime;
    return res.status(200).end('Done. You can close this window now!');
  }

  let poller = pollers.get(ip);
  if ((!poller && pollers.size >= maxEntries) || (poller && poller.count >= maxPolls)) {
    const retryAfter = Math.ceil(((poller?.expiresAt || now + pollWindow) - now) / 1000);
    res.setHeader('Retry-After', String(retryAfter));
    return res.status(429).json({ error: 'rate_limited' });
  }
  if (!poller) {
    poller = { count: 0, expiresAt: now + pollWindow };
    pollers.set(ip, poller);
  }
  poller.count++;

  const entry = tokens.get(state);
  if (!entry?.token || entry.ip !== ip) {
    return res.status(403).json({ error: 'state_not_defined' });
  }

  tokens.delete(state);
  try {
    return res.status(200).json({ token: entry.token.toString() });
  } finally {
    entry.token.fill(0);
  }
};

const getClientIP = req => {
  const ip =
    process.env.VERCEL === '1'
      ? req.headers['x-real-ip']
      : req.socket?.remoteAddress;
  return typeof ip === 'string' && isIP(ip) && !ip.includes('%')
    ? ip
    : undefined;
};

const requestToken = async code => {
  try {
    const response = await fetch(
      'https://github.com/login/oauth/access_token',
      {
        method: 'POST',
        body: JSON.stringify({
          code,
          client_id,
          client_secret,
        }),
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
        },
        signal: AbortSignal.timeout(10_000),
      }
    );

    if (!response.ok) {
      return false;
    }

    const data = await response.json();
    return !data.error && typeof data.access_token === 'string' && data.access_token
      ? data.access_token
      : false;
  } catch (error) {
    console.error('GitHub token exchange failed', {
      name: error?.name,
      code: error?.cause?.code ?? error?.code,
    });
    return false;
  }
};
