#!/usr/bin/env bash
# Runs once when the codespace is created. Codespaces only reveals the
# public forwarding domain/name at runtime (it's random per codespace), so
# the OAuth redirect URI and the frontend's API base can't be baked in
# ahead of time the way local/VPS deployments do it - this generates the
# root .env docker-compose reads from those runtime values instead, then
# builds and starts everything.
set -euo pipefail
cd "$(dirname "$0")/.."

DOMAIN="${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN:-app.github.dev}"
FRONTEND_PUBLIC_URL="https://${CODESPACE_NAME}-5173.${DOMAIN}"
BACKEND_PUBLIC_URL="https://${CODESPACE_NAME}-8000.${DOMAIN}"

mkdir -p /tmp/pytrace-sessions

cat > .env <<EOF
PYTRACE_HOST_DATA_DIR=/tmp/pytrace-sessions
GEMINI_API_KEY=${GEMINI_API_KEY:-}
FRONTEND_ORIGINS=${FRONTEND_PUBLIC_URL}
GITHUB_TOKEN_KEY=${GITHUB_TOKEN_KEY:-}
GOOGLE_CLIENT_ID=${GOOGLE_CLIENT_ID:-}
GOOGLE_CLIENT_SECRET=${GOOGLE_CLIENT_SECRET:-}
GOOGLE_REDIRECT_URI=${BACKEND_PUBLIC_URL}/api/auth/google/callback
FRONTEND_URL=${FRONTEND_PUBLIC_URL}
VITE_API_HTTP_BASE=${BACKEND_PUBLIC_URL}
VITE_API_WS_BASE=wss://${CODESPACE_NAME}-8000.${DOMAIN}
EOF

echo ""
echo "================================================================"
echo " PyTrace will be public at:  ${FRONTEND_PUBLIC_URL}"
echo " Backend API at:             ${BACKEND_PUBLIC_URL}"
echo ""
echo " Add this as an Authorized redirect URI in Google Cloud Console"
echo " (APIs & Services > Credentials > your OAuth client):"
echo "   ${BACKEND_PUBLIC_URL}/api/auth/google/callback"
echo ""
if [ -z "${GOOGLE_CLIENT_ID:-}" ] || [ -z "${GOOGLE_CLIENT_SECRET:-}" ]; then
  echo " WARNING: GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET are not set."
  echo " Add them as Codespaces secrets (repo Settings > Secrets and"
  echo " variables > Codespaces) and rebuild the container, or sign-in"
  echo " will fail with 'Google OAuth is not configured'."
fi
echo "================================================================"
echo ""

docker compose up --build -d
