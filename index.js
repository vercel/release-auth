// Native
const url = require('url')

// Packages
const {send} = require('micro')
const request = require('request-promise-native')

let tokens = {}

const client_id = '08bd4d4e3725ce1c0465'
const client_secret = '98ecfe426906f3a861fe86078b73ba431d78becc'

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
  } catch (err) {
    console.error(err)
    return false
  }

  return response.access_token
}

module.exports = async function (req, res) {
  const urlParts = url.parse(req.url, true)
  const query = urlParts.query

  const keyCount = Object.keys(query).length
  console.log(query)

  if (keyCount < 1 || !query.state) {
    send(res, 502, {
      error: 'invalid_request'
    })

    return
  }

  if (query.code && query.state) {
    const token = await requestToken(query.code, query.state)
    tokens[query.state] = token

    send(res, 200, 'Done. You can close this window now!')
    return
  }

  if (query.state) {
    const ID = query.state

    if (tokens[ID]) {
      send(res, 200, {
        token: tokens[ID]
      })

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
