#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if [[ "${SITES_ENV_READY:-}" != "1" ]]; then
  exec "${script_dir}/sites-env.sh" -- "$0" "$@"
fi

worker="${SITES_PROJECT_ROOT}/dist/server/index.js"
hosting="${SITES_PROJECT_ROOT}/dist/.openai/hosting.json"
worker_config="${SITES_PROJECT_ROOT}/dist/server/wrangler.json"
wrangler="${SITES_PROJECT_ROOT}/node_modules/.bin/wrangler"
dry_run_dir="${TMPDIR:-/tmp}/blocktrade-sites-validation-$$"

[[ -f "${worker}" ]] || {
  echo "Missing Sites Worker entry: dist/server/index.js" >&2
  exit 66
}
[[ -f "${hosting}" ]] || {
  echo "Missing packaged Sites manifest: dist/.openai/hosting.json" >&2
  exit 66
}
[[ -f "${worker_config}" ]] || {
  echo "Missing packaged Worker config: dist/server/wrangler.json" >&2
  exit 66
}
[[ -x "${wrangler}" ]] || {
  echo "Wrangler is unavailable. Run npm run install:ci first." >&2
  exit 69
}

node --input-type=module - "${hosting}" <<'NODE'
import { readFile } from "node:fs/promises";

const [hostingPath] = process.argv.slice(2);
JSON.parse(await readFile(hostingPath, "utf8"));
NODE

mkdir -p "${dry_run_dir}"
WRANGLER_LOG_PATH="${SITES_PROJECT_ROOT}/.wrangler/wrangler.log" \
  "${wrangler}" deploy \
  --dry-run \
  --config "${worker_config}" \
  --outdir "${dry_run_dir}"

echo "Validated Sites artifact: Worker dry-run bundle and hosting manifest are valid."
