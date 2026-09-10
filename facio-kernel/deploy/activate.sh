#!/bin/bash
set -euo pipefail
umask 077
release_sha=${1:?A verified 40-character git SHA is required}
[[ "$release_sha" =~ ^[a-f0-9]{40}$ ]] || exit 2
base=/srv/facio-kernel
exec 9>"$base/deploy.lock"
flock -n 9 || { echo 'Another deployment is active'; exit 1; }
findmnt "$base/data" >/dev/null || { echo 'Dedicated data disk is not mounted'; exit 1; }
test -s "$base/secrets/hosted.env"
test -s "$base/secrets/bootstrap.json"
public_host=$(python3 - "$base/secrets/hosted.env" <<'PYHOST'
from pathlib import Path
import sys, urllib.parse
values=dict(line.split("=",1) for line in Path(sys.argv[1]).read_text().splitlines() if "=" in line and not line.startswith("#"))
print(urllib.parse.urlparse(values["KERNEL_PUBLIC_URL"]).netloc)
PYHOST
)
set -a
source "$base/deploy/storage.env"
set +a
release="$base/releases/$release_sha"
mkdir -p "$release"
python3 "$base/deploy/blob.py" download releases "$release_sha/image.tar.gz" "$release/image.tar.gz"
python3 "$base/deploy/blob.py" download releases "$release_sha/image.sha256" "$release/image.sha256"
(cd "$release" && sha256sum --check image.sha256)
docker load --input "$release/image.tar.gz"
image="facio-kernel:$release_sha"
test "$(docker image inspect "$image" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}')" = "$release_sha"
previous=$(cat "$base/active-sha" 2>/dev/null || true)
if test -e "$base/data/kernel.sqlite" || test -e "$base/data/auth.sqlite"; then
  python3 "$base/deploy/backup.py"
fi
start_image() {
  docker run --detach --name facio-kernel --restart unless-stopped \
    --read-only --tmpfs /tmp:rw,noexec,nosuid,size=64m \
    --security-opt no-new-privileges --cap-drop ALL \
    --publish 127.0.0.1:4310:4310 \
    --env-file "$base/secrets/hosted.env" --env "KERNEL_BUILD_SHA=$1" \
    --mount "type=bind,src=$base/data,dst=/data" \
    --mount "type=bind,src=$base/secrets/bootstrap.json,dst=/run/secrets/bootstrap.json,readonly" \
    "facio-kernel:$1" >/dev/null
}
wait_ready() {
  local expected_sha=$1
  for attempt in $(seq 1 30); do
    if curl --fail --silent --connect-timeout 2 --max-time 3 --header "Host: $public_host" http://127.0.0.1:4310/health | jq -e --arg sha "$expected_sha" '.buildSha == $sha and .environment == "sandbox" and .mode == "hosted-sandbox"' >/dev/null; then
      return 0
    fi
    sleep 2
  done
  return 1
}
docker stop --time 30 facio-kernel >/dev/null 2>&1 || true
docker rm facio-kernel >/dev/null 2>&1 || true
healthy=false
if start_image "$release_sha"; then
  if wait_ready "$release_sha"; then healthy=true; fi
fi
if test "$healthy" != true; then
  docker stop --time 30 facio-kernel >/dev/null 2>&1 || true
  docker rm facio-kernel >/dev/null 2>&1 || true
  # Transactions are never rolled back by swapping a database snapshot.
  # Only schema-compatible runtime rollback is allowed; incompatibility must fail startup.
  if [[ "$previous" =~ ^[a-f0-9]{40}$ ]] && start_image "$previous" && wait_ready "$previous"; then
    echo 'Candidate failed readiness; previous exact SHA recovered, transaction data preserved'
  else
    echo 'Candidate failed readiness and previous runtime was not recovered; data preserved, operator action required'
  fi
  exit 1
fi
python3 - "$base" "$release_sha" <<'PYSTATE'
import os, pathlib, sys
base=pathlib.Path(sys.argv[1])
temporary=base/'active-sha.pending'
with temporary.open('w') as stream:
    stream.write(sys.argv[2]+'\n'); stream.flush(); os.fsync(stream.fileno())
os.replace(temporary,base/'active-sha')
directory=os.open(base,os.O_RDONLY)
try: os.fsync(directory)
finally: os.close(directory)
PYSTATE
echo "Activated sandbox build $release_sha"
