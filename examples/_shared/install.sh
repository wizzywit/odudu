#!/usr/bin/env bash
# Installs an example's dependencies from this repository, for a change that is
# not released yet, in place of npm: builds and packs each SDK named, then installs the tarballs beside
# the example's other dependencies. The example's package.json and lockfile are
# not changed, so they stay as a reader who copies the folder gets them.
#
#   examples/_shared/install.sh <example folder> <sdk>...
#
# An SDK is named without its scope (`oidc`, `bff`, `node`, `next`), and every
# SDK another one depends on is named too. Tarballs go to $SDK_TARBALLS, which is
# $RUNNER_TEMP/sdks on a CI runner.
set -euo pipefail

root="$(cd "$(dirname "$0")/../.." && pwd)"
tarballs="${SDK_TARBALLS:-${RUNNER_TEMP:-${TMPDIR:-/tmp}}/sdks}"
example="${1:?usage: install.sh <example folder> <sdk>...}"
shift
[ "$#" -gt 0 ] || { echo "usage: install.sh <example folder> <sdk>..." >&2; exit 2; }

filters=()
for sdk in "$@"; do filters+=(--filter "@odudu-io/$sdk..."); done
pnpm --dir "$root" "${filters[@]}" run build

mkdir -p "$tarballs"
files=()
for sdk in "$@"; do
  rm -f "$tarballs/odudu-io-$sdk-"*.tgz
  pnpm --dir "$root" --filter "@odudu-io/$sdk" pack --pack-destination "$tarballs"
  files+=("$tarballs/odudu-io-$sdk-"*.tgz)
done

cd "$example"
npm install --no-save --ignore-scripts "${files[@]}"
