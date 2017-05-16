# release-auth

[![Build Status](https://travis-ci.org/zeit/release-auth.svg?branch=master)](https://travis-ci.org/zeit/release-auth)
[![XO code style](https://img.shields.io/badge/code_style-XO-5ed9c7.svg)](https://github.com/sindresorhus/xo)
[![Slack Channel](http://zeit-slackin.now.sh/badge.svg)](https://zeit.chat)

Handles the OAuth authentication with GitHub's webflow for [release](https://github.com/zeit/release).

## Contributing

1. Create a new OAuth application in [your GitHub account](https://github.com/settings/developers) (if you're working at [@zeit](https://github.com/zeit), just get the keys from [here](https://github.com/organizations/zeit/settings/applications))
2. Set the "Authorization callback URL" to `https://release-auth.zeit.sh`
3. [Fork](https://help.github.com/articles/fork-a-repo/) this repository to your own GitHub account and then [clone](https://help.github.com/articles/cloning-a-repository/) it to your local device
4. Install the dependencies: `npm install`
5. Start the server: `CLIENT_ID="<id>" CLIENT_SECRET="<secret>" npm start`

As always, you can use `npm test` to run the tests and see if your changes have broken anything.

## Author

Leo Lamprecht ([@notquiteleo](https://twitter.com/notquiteleo)) - [▲ZEIT](https://zeit.co)
