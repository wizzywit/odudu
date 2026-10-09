#!/usr/bin/env bash
# Prints a new key for ODUDU_CONSOLE_CLIENT_KEY: an ES256 private JWK,
# base64-encoded, the form `odudu console keygen` prints. For a stack that
# has no image to run it in yet; a key for a stack that keeps its database
# belongs in that stack's .env (ensure-console-key.sh), never in git.
set -euo pipefail

node -e "
const { generateKeyPairSync } = require('node:crypto');
const jwk = generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({ format: 'jwk' });
process.stdout.write(Buffer.from(JSON.stringify(jwk)).toString('base64') + '\n');
"
