#!/bin/sh
# Keep the service startCommand stable; release checks belong to this reviewed file.
set -eu
cd /app
/opt/worker/bin/python -B - <<'PY'
import hashlib,json,os,pathlib
from robotics.g1_trial.runtime import preflight
root=pathlib.Path('robotics/g1_trial')
print('G1_DEPLOYMENT_CHECK '+json.dumps({'schema':'brainsnn.g1-deployment.v1',
    'commit_sha':os.environ.get('RAILWAY_GIT_COMMIT_SHA'),
    'modules':{p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(root.glob('*.py'))},
    'runtime':preflight(),'simulation_started':False},sort_keys=True),flush=True)
PY
(
  printf '%s\n' 'ASBUILT_HOSTED_ACCEPTANCE_STARTING'
  if ! /opt/worker/bin/python /app/robotics/world_worker/deploy/railway/asbuilt_acceptance.py --confirm-synthetic-deployment-test; then
    printf '%s\n' 'ASBUILT_HOSTED_ACCEPTANCE_PROCESS_FAILED'
  fi
  # The IFC check is not held behind a legacy render/asset check. Both stay serial.
  if [ "${WORLD_DEPLOY_SMOKE:-0}" = "1" ]; then
    /opt/worker/bin/python /app/robotics/world_worker/deploy/railway/acceptance.py --confirm-synthetic-deployment-test
  fi
) &
exec /app/robotics/world_worker/deploy/railway/start.sh
