# release-auth

Handles the OAuth authentication with GitHub's webflow for [release](https://github.com/vercel/release).

## Contributing

1. Create a new OAuth application in [your GitHub account](https://github.com/settings/developers)
1. Set the "Authorization callback URL" to `https://release-auth.vercel.sh`
1. [Fork](https://help.github.com/articles/fork-a-repo/) this repository to your own GitHub account and then [clone](https://help.github.com/articles/cloning-a-repository/) it to your local device
1. Install the dependencies: `yarn install`
1. Download environment variables: `vc env pull`
1. Start the server: `vercel dev`
