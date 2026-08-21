#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
VENDOR_DIR="${SKILL_DIR}/vendor"

mkdir -p "${VENDOR_DIR}"

if [ ! -f "${VENDOR_DIR}/package.json" ]; then
  cat > "${VENDOR_DIR}/package.json" <<'JSON'
{
  "name": "merry-slide-vendor",
  "private": true,
  "type": "module",
  "dependencies": {
    "pptxgenjs": "^4.0.1"
  }
}
JSON
fi

cd "${VENDOR_DIR}"
npm install --omit=dev

echo "Merry-slide dependencies installed: ${VENDOR_DIR}"
