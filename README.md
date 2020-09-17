# release-auth

[![Build Status](https://travis-ci.org/vercel/release-auth.svg?branch=master)](https://travis-ci.org/vercel/release-auth)
[![XO code style](https://img.shields.io/badge/code_style-XO-5ed9c7.svg)](https://github.com/sindresorhus/xo)

Handles the OAuth authentication with GitHub's webflow for [release](https://github.com/vercel/release).

## Contributing

1. Create a new OAuth application in [your GitHub account](https://github.com/settings/developers) (if you're working at [@vercel](https://github.com/vercel), just get the keys from [here](https://github.com/organizations/vercel/settings/applications))
2. Set the "Authorization callback URL" to `https://release-auth.vercel.sh`
3. [Fork](https://help.github.com/articles/fork-a-repo/) this repository to your own GitHub account and then [clone](https://help.github.com/articles/cloning-a-repository/) it to your local device
4. Install the dependencies: `yarn install`
5. Start the server: `CLIENT_ID="<id>" CLIENT_SECRET="<secret>" vercel dev`

As always, you can use `yarn test` to run the tests and see if your changes have broken anything.

## Author

Leo Lamprecht ([@notquiteleo](https://twitter.com/notquiteleo)) - [▲Vercel](https://vercel.com)
