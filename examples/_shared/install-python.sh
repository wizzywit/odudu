#!/usr/bin/env bash
# Installs the Python example's dependencies from this repository while the
# `odudu` package is not on PyPI yet: a virtual environment with the pinned,
# hashed requirements, and the package built into a wheel from sdks/python and
# installed beside them. The example's own files are not changed.
#
#   examples/_shared/install-python.sh <example folder>
#
# $PYTHON names the interpreter (python3 when omitted). The wheel goes to
# $SDK_TARBALLS, which is $RUNNER_TEMP/sdks on a CI runner.
set -euo pipefail

root="$(cd "$(dirname "$0")/../.." && pwd)"
wheels="${SDK_TARBALLS:-${RUNNER_TEMP:-${TMPDIR:-/tmp}}/sdks}/python"
example="${1:?usage: install-python.sh <example folder>}"

"${PYTHON:-python3}" -m venv "$example/.venv"
python="$example/.venv/bin/python"
"$python" -m pip install --require-hashes -r "$example/requirements.txt"

rm -rf "$wheels"
"$python" -m pip wheel --no-deps --wheel-dir "$wheels" "$root/sdks/python"
"$python" -m pip install --no-deps "$wheels"/odudu-*.whl
