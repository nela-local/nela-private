#!/usr/bin/env bash
# Bootstrap a local venv for NELA Excel openpyxl sandbox (desktop).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
VENV="${ROOT}/.venv-xlsx"
PYTHON="${PYTHON:-python3}"

if [[ ! -x "${VENV}/bin/python" && ! -x "${VENV}/Scripts/python.exe" ]]; then
  echo "Creating ${VENV}…"
  "${PYTHON}" -m venv "${VENV}"
fi

if [[ -x "${VENV}/bin/pip" ]]; then
  PIP="${VENV}/bin/pip"
elif [[ -x "${VENV}/Scripts/pip.exe" ]]; then
  PIP="${VENV}/Scripts/pip.exe"
else
  echo "pip not found in ${VENV}" >&2
  exit 1
fi

"${PIP}" install --upgrade pip
"${PIP}" install -r "${ROOT}/scripts/xlsx-requirements.txt"
echo "OK: xlsx venv ready at ${VENV}"
