#!/usr/bin/env bash
# Smoke test of the app image, called by the shared CI (twostone/hassio-workflows app-ci.yml).
# Usage: scripts/smoke.sh <image>
set -euo pipefail
IMAGE="${1:?usage: $0 <image>}"

dump() { echo "--- container log ($1)"; docker logs "$1" || true; }
wait_for() { # $1 url
  for _ in $(seq 1 30); do
    curl -s -o /dev/null "$1" && return 0
    sleep 1
  done
  return 1
}

# 1) Both listeners with the Ingress guard off and the external listener enabled.
docker run -d --name smoke -p 8099:8099 -p 8100:8100 \
  -e INGRESS_ONLY_IP= -e HA_EXTERNAL_URL=https://ha.example.test -e APP_EXTERNAL_URL=https://garmin.example.test \
  "$IMAGE"
wait_for http://localhost:8099/api/context || { dump smoke; exit 1; }
wait_for http://localhost:8100/ || { dump smoke; exit 1; }
curl -fsS http://localhost:8099/ | grep -q '"mode":"ingress"' || { dump smoke; exit 1; }
curl -fsS http://localhost:8100/ | grep -q '"mode":"external"' || { dump smoke; exit 1; }
# /mcp without a token: 401 with a pointer to the protected-resource metadata.
code=$(curl -s -o /dev/null -D /tmp/mcp.headers -w '%{http_code}' -X POST http://localhost:8100/mcp)
[ "$code" = "401" ] || { echo "expected 401 from /mcp, got $code"; dump smoke; exit 1; }
grep -i '^www-authenticate:.*resource_metadata=' /tmp/mcp.headers || { dump smoke; exit 1; }
curl -fsS http://localhost:8100/.well-known/oauth-protected-resource/mcp | grep -q '"authorization_servers"' || { dump smoke; exit 1; }
# /mcp does not exist on the Ingress listener.
[ "$(curl -s -o /dev/null -w '%{http_code}' -X POST http://localhost:8099/mcp)" = "404" ] || { dump smoke; exit 1; }
docker rm -f smoke

# 2) Default configuration: only Supervisor's ingress address may connect, everyone else gets 403.
docker run -d --name guarded -p 8099:8099 "$IMAGE"
code=000
for _ in $(seq 1 30); do
  code=$(curl -s -o /dev/null -w '%{http_code}' http://localhost:8099/api/context || true)
  [ "$code" != "000" ] && break
  sleep 1
done
[ "$code" = "403" ] || { echo "expected 403 from the ingress guard, got $code"; dump guarded; exit 1; }
docker rm -f guarded
