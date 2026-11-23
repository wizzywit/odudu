#!/usr/bin/env bash
# Publishes the first version of the npm SDKs from this machine, one tarball at a
# time and in dependency order, asking before each one. It is the manual path in
# RELEASING.md for a package that has no trusted publisher yet; the sdk-release
# workflow publishes every later version.
#
#   tools/release/publish-first.sh [--dry-run] [package ...]
#
# With no package it goes through all eight. --dry-run packs and inspects but
# runs `npm publish --dry-run`, so nothing reaches the registry.
set -euo pipefail

cd "$(dirname "$0")/../.."

ORDER=(oidc node admin-client me-client bff react mcp-stdio next)
DRY=0
PACKAGES=()
for arg in "$@"; do
  case "$arg" in
    --dry-run) DRY=1 ;;
    -*) echo "unknown option: $arg" >&2; exit 2 ;;
    *) PACKAGES+=("$arg") ;;
  esac
done
if [ ${#PACKAGES[@]} -eq 0 ]; then PACKAGES=("${ORDER[@]}"); fi

for name in "${PACKAGES[@]}"; do
  case " ${ORDER[*]} " in *" $name "*) ;; *) echo "not an npm SDK: $name" >&2; exit 2 ;; esac
done

if [ "$DRY" -eq 0 ]; then
  if ! user=$(npm whoami 2>/dev/null); then
    echo "Not logged in to npm. Run 'npm login' first." >&2
    exit 1
  fi
  echo "Publishing as npm user: $user"
fi

if [ "$DRY" -eq 0 ] && [ -n "$(git status --porcelain)" ]; then
  echo "The working tree has uncommitted changes; publish from a clean checkout of main." >&2
  exit 1
fi

pnpm install --frozen-lockfile

TARBALLS="$(mktemp -d)"
trap 'rm -rf "$TARBALLS"' EXIT

# Packages are visited in dependency order, but one named on the command line
# may need a dependency that is not on npm yet.
published() { npm view "@odudu-io/$1@$2" version >/dev/null 2>&1; }

for name in "${PACKAGES[@]}"; do
  dir="sdks/$name"
  version=$(node -p "require('./$dir/package.json').version")
  echo
  echo "=== @odudu-io/$name $version"

  if published "$name" "$version"; then
    echo "already on npm, skipping"
    continue
  fi

  pnpm --filter "./$dir..." run build
  out="$TARBALLS/$name"
  mkdir -p "$out"
  (cd "$dir" && pnpm pack --pack-destination "$out" >/dev/null)
  tarball=$(ls "$out"/*.tgz)

  files=$(tar -tzf "$tarball")
  entry=dist/index.js
  [ "$name" = mcp-stdio ] && entry=dist/bin.js
  for needed in package/README.md "package/$entry"; do
    echo "$files" | grep -qx "$needed" || { echo "missing from the tarball: $needed" >&2; exit 1; }
  done
  if tar -xzOf "$tarball" package/package.json | grep -q 'workspace:'; then
    echo "the packed package.json still has a workspace: dependency" >&2
    exit 1
  fi
  echo "$files" | sed 's/^/  /'
  echo "dependencies as published:"
  tar -xzOf "$tarball" package/package.json | node -e \
    'const p=JSON.parse(require("fs").readFileSync(0,"utf8"));console.log(JSON.stringify(p.dependencies??{},null,2))'

  if [ "$DRY" -eq 1 ]; then
    npm publish "$tarball" --access public --dry-run
    continue
  fi

  read -r -p "Publish @odudu-io/$name $version to npm? A published version can never be replaced. [y/N] " answer
  case "$answer" in
    y|Y|yes) npm publish "$tarball" --access public ;;
    *) echo "stopped before @odudu-io/$name; run again to continue"; exit 0 ;;
  esac

  # npm answers with a version a moment before the registry serves it.
  for _ in 1 2 3 4 5 6; do
    published "$name" "$version" && break
    sleep 5
  done
done

echo
echo "done"
