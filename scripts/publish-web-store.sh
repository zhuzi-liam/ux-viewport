#!/usr/bin/env bash
set -euo pipefail

: "${CWS_ACCESS_TOKEN:?CWS_ACCESS_TOKEN is required}"
: "${CWS_PUBLISHER_ID:?CWS_PUBLISHER_ID is required}"
: "${CWS_EXTENSION_ID:?CWS_EXTENSION_ID is required}"
: "${CWS_ZIP_PATH:?CWS_ZIP_PATH is required}"

if [[ ! -f "$CWS_ZIP_PATH" ]]; then
  echo "Package not found: $CWS_ZIP_PATH" >&2
  exit 1
fi

UPLOAD_URL="https://chromewebstore.googleapis.com/upload/v2/publishers/${CWS_PUBLISHER_ID}/items/${CWS_EXTENSION_ID}:upload"
STATUS_URL="https://chromewebstore.googleapis.com/v2/publishers/${CWS_PUBLISHER_ID}/items/${CWS_EXTENSION_ID}:fetchStatus"
PUBLISH_URL="https://chromewebstore.googleapis.com/v2/publishers/${CWS_PUBLISHER_ID}/items/${CWS_EXTENSION_ID}:publish"

UPLOAD_RESPONSE="$(mktemp)"
STATUS_RESPONSE="$(mktemp)"
PUBLISH_RESPONSE="$(mktemp)"
trap 'rm -f "$UPLOAD_RESPONSE" "$STATUS_RESPONSE" "$PUBLISH_RESPONSE"' EXIT

UPLOAD_HTTP_STATUS="$(curl --silent --show-error --max-time 120 \
  --output "$UPLOAD_RESPONSE" \
  --write-out '%{http_code}' \
  --request POST \
  --header "Authorization: Bearer $CWS_ACCESS_TOKEN" \
  --header "Content-Type: application/zip" \
  --upload-file "$CWS_ZIP_PATH" \
  "$UPLOAD_URL")"
cat "$UPLOAD_RESPONSE"

if [[ ! "$UPLOAD_HTTP_STATUS" =~ ^2 ]]; then
  echo "Chrome Web Store upload failed with HTTP $UPLOAD_HTTP_STATUS" >&2
  exit 1
fi

UPLOAD_STATE="$(jq -r '.uploadState // empty' "$UPLOAD_RESPONSE")"

if [[ "$UPLOAD_STATE" == "IN_PROGRESS" || "$UPLOAD_STATE" == "UPLOAD_IN_PROGRESS" ]]; then
  for ATTEMPT in {1..18}; do
    sleep 10
    STATUS_HTTP_STATUS="$(curl --silent --show-error --max-time 60 \
      --output "$STATUS_RESPONSE" \
      --write-out '%{http_code}' \
      --request GET \
      --header "Authorization: Bearer $CWS_ACCESS_TOKEN" \
      "$STATUS_URL")"
    cat "$STATUS_RESPONSE"

    if [[ ! "$STATUS_HTTP_STATUS" =~ ^2 ]]; then
      echo "Chrome Web Store status check failed with HTTP $STATUS_HTTP_STATUS" >&2
      exit 1
    fi

    UPLOAD_STATE="$(jq -r '.lastAsyncUploadState // empty' "$STATUS_RESPONSE")"
    if [[ "$UPLOAD_STATE" == "SUCCEEDED" ]]; then
      break
    fi
    if [[ "$UPLOAD_STATE" == "FAILED" || "$UPLOAD_STATE" == "NOT_FOUND" ]]; then
      echo "Chrome Web Store upload ended with state: $UPLOAD_STATE" >&2
      exit 1
    fi
    if [[ "$ATTEMPT" == "18" ]]; then
      echo "Chrome Web Store upload did not finish within 3 minutes" >&2
      exit 1
    fi
  done
fi

if [[ "$UPLOAD_STATE" != "SUCCEEDED" ]]; then
  echo "Unexpected Chrome Web Store upload state: ${UPLOAD_STATE:-empty}" >&2
  exit 1
fi

PUBLISH_HTTP_STATUS="$(curl --silent --show-error --max-time 120 \
  --output "$PUBLISH_RESPONSE" \
  --write-out '%{http_code}' \
  --request POST \
  --header "Authorization: Bearer $CWS_ACCESS_TOKEN" \
  --header "Content-Type: application/json" \
  --data '{"publishType":"DEFAULT_PUBLISH","blockOnWarnings":false}' \
  "$PUBLISH_URL")"
cat "$PUBLISH_RESPONSE"

if [[ ! "$PUBLISH_HTTP_STATUS" =~ ^2 ]]; then
  echo "Chrome Web Store publish submission failed with HTTP $PUBLISH_HTTP_STATUS" >&2
  exit 1
fi

echo "Chrome Web Store update submitted for review."
