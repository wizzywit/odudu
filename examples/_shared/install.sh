#!/usr/bin/env bash
# Installs an example's dependencies from this repository while the SDKs are not
# on npm yet: builds and packs each SDK named, then installs the tarballs beside
# the example's other dependencies. The example's package.json and lockfile are
# not changed, so they stay as a reader who copies the folder gets them.
#
#   examples/_shared/install.sh <example folder> [<sdk>...]
#
# An SDK is named without its scope (`oidc`, `bff`, `node`, `next`), and every
# SDK another one depends on is named too. Tarballs go to $SDK_TARBALLS, which is
# $RUNNER_TEMP/sdks on a CI runner. With no SDK it is a plain `npm ci`.
set -euo pipefail

root="$(cd "$(dirname "$0")/../.." && pwd)"
tarballs="${SDK_TARBALLS:-${RUNNER_TEMP:-${TMPDIR:-/tmp}}/sdks}"
example="${1:?usage: install.sh <example folder> [<sdk>...]}"
shift

if [ "$#" -eq 0 ]; then
  cd "$example" && exec npm ci --ignore-scripts
fi

mkdir -p "$tarballs"
files=()
for sdk in "$@"; do
  rm -f "$tarballs/odudu-io-$sdk-"*.tgz
  pnpm --dir "$root" --filter "@odudu-io/$sdk..." run build
  pnpm --dir "$root" --filter "@odudu-io/$sdk" pack --pack-destination "$tarballs"
  files+=("$tarballs/odudu-io-$sdk-"*.tgz)
done

cd "$example"
npm install --no-save --ignore-scripts "${files[@]}"
