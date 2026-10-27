#!/bin/sh
set -e
cd /workspace
if curl -sf -o /dev/null --max-time 1 http://127.0.0.1:8080/; then
  exit 0
fi
npm run dev > /tmp/dev-server.log 2>&1 &
for i in $(seq 1 40); do
  curl -sf -o /dev/null --max-time 1 http://127.0.0.1:8080/ && exit 0
  sleep 0.5
done
exit 1
