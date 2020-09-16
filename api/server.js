// Native
const url = require('url')

// Packages
const {send} = require('micro')
const request = require('request-promise-native')

const client_id = process.env.CLIENT_ID
const client_secret = process.env.CLIENT_SECRET

if (!client_id || !client_secret) {
  console.error('Please define the necessary env variables.')
  process.exit(1)
}

const tokens = new Map()

const requestToken = async (code, state) => {
  if (!code || !state) {
    return false
  }

  let response

  try {
    response = await request({
      uri: 'https://github.com/login/oauth/access_token',
      method: 'POST',
      body: {
        code,
        state,
        client_id,
        client_secret
      },
      json: true
    })
  } catch (error) {
    console.error(error)
    return false
  }

  return response.access_token
}

module.exports = async function (req, res) {
  const {query} = url.parse(req.url, true)
  const keyCount = Object.keys(query).length

  if (keyCount < 1 || !query.state) {
    send(res, 502, {
      error: 'invalid_request'
    })

    return
  }

  if (query.code && query.state) {
    const token = await requestToken(query.code, query.state)
    tokens.set(String(query.state), Buffer.from(token))

    send(res, 200, 'Done. You can close this window now!')
    return
  }

  if (query.state) {
    const ID = query.state

    if (tokens.has(ID)) {
      send(res, 200, {
        token: tokens.get(ID).toString()
      })

      // Securily wipe token from RAM
      tokens.get(ID).fill(0)
      tokens.delete(ID)

      return
    }

    send(res, 403, {
      error: 'state_not_defined'
    })

    return
  }

  send(res, 502, {
    error: 'invalid_request'
  })
}
