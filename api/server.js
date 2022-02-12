const client_id = process.env.CLIENT_ID;
const client_secret = process.env.CLIENT_SECRET;

if (!client_id || !client_secret) {
  console.error('Please define the necessary env variables.');
  process.exit(1);
}

const tokens = new Map();

export default function handler(req, res) {
  console.log({ client_id, client_secret });

  const keyCount = Object.keys(req.query).length;
  if (keyCount < 1 || !req.query.state) {
    return res.status(502).json({
      error: 'invalid_request',
    });
  }

  if (req.query.code && req.query.state) {
    const token = await requestToken(req.query.code, req.query.state);
    tokens.set(String(req.query.state), Buffer.from(token));

    return res.status(200).end('Done. You can close this window now!');
  }

  if (req.query.state) {
    const ID = req.query.state;

    if (tokens.has(ID)) {
      res.status(200).json({
        token: tokens.get(ID).toString(),
      });

      // Securily wipe token from RAM
      tokens.get(ID).fill(0);
      tokens.delete(ID);

      return;
    }

    return res.status(403).json({
      error: 'state_not_defined',
    });
  }

  return res.status(502).json({
    error: 'invalid_request',
  });
}

const requestToken = async (code, state) => {
  if (!code || !state) {
    return false;
  }

  try {
    const response = await fetch(
      'https://github.com/login/oauth/access_token',
      {
        method: 'POST',
        body: JSON.stringify({
          code,
          state,
          client_id,
          client_secret,
        }),
        headers: { 'Content-Type': 'application/json' },
      }
    );

    const data = await response.json();
    return data.access_token;
  } catch (error) {
    console.error(error);
    return false;
  }
};
