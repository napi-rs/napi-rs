#!/usr/bin/env bash
# Asserts that #[napi(extends)] is a compile error without napi8 on native
# targets (with the message naming the feature), and compiles with it.
set -euo pipefail
cd "$(dirname "$0")"
log="$(mktemp)"
trap 'rm -f "$log"' EXIT

if cargo check --quiet 2>"$log"; then
  echo "error: #[napi(extends)] compiled without the napi8 feature" >&2
  exit 1
fi
if ! grep -q 'requires the `napi8` feature of `napi` on native targets' "$log"; then
  echo "error: unexpected compile failure without napi8:" >&2
  cat "$log" >&2
  exit 1
fi
cargo check --quiet --features napi8
echo "ok: #[napi(extends)] requires napi8"
