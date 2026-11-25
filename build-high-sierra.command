#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"

if [ "$(uname -s)" != "Darwin" ]; then
  echo "Build this package on an Intel Mac with Node.js 24; the target iMac only needs the resulting app."
  exit 1
fi
if ! command -v node >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
  echo "Install Node.js 24 on the build Mac first."
  exit 1
fi
node -e 'if (process.arch !== "x64" || Number(process.versions.node.split(".")[0]) !== 24) throw new Error("Use an Intel Mac running Node.js 24")'
export SHARP_IGNORE_GLOBAL_LIBVIPS=1
npm ci --include=optional
npm test
npm run dist:mac:intel
npm run verify:mac:native
npm run verify:mac:intel
npm run test:high-sierra
npm run test:packaged
hdiutil verify release/*-High-Sierra-Intel.dmg
cp docs/MAC-INTEL-TEST.md release/MAC-INTEL-TEST.md
(cd release && shasum -a 256 *-High-Sierra-Intel.dmg > SHA256SUMS.txt)
echo "Local test installer ready in release/. Nothing was published. Target iMac testing is still required."
