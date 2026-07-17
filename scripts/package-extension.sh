#!/usr/bin/env bash
set -euo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
OUTPUT_PATH="${1:-$PROJECT_ROOT/dist/ux-viewport.zip}"

if [[ "$OUTPUT_PATH" != /* ]]; then
  OUTPUT_PATH="$PROJECT_ROOT/$OUTPUT_PATH"
fi

OUTPUT_DIR="$(dirname "$OUTPUT_PATH")"
mkdir -p "$OUTPUT_DIR"

BUILD_DIR="$(mktemp -d "${TMPDIR:-/tmp}/ux-viewport-package.XXXXXX")"
trap 'rm -rf "$BUILD_DIR"' EXIT

mkdir -p "$BUILD_DIR/package"
cp "$PROJECT_ROOT/manifest.json" \
  "$PROJECT_ROOT/background.js" \
  "$PROJECT_ROOT/core.js" \
  "$PROJECT_ROOT/widget.js" \
  "$BUILD_DIR/package/"
cp -R "$PROJECT_ROOT/icons" "$BUILD_DIR/package/icons"

(
  cd "$BUILD_DIR/package"
  zip -qr "$BUILD_DIR/ux-viewport.zip" .
)

unzip -tq "$BUILD_DIR/ux-viewport.zip"
mv "$BUILD_DIR/ux-viewport.zip" "$OUTPUT_PATH"
echo "Built $OUTPUT_PATH"
