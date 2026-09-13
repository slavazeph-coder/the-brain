# Recover the Vast host before deploying BrainSNN

Status checked September 9, 2026. These are operator instructions, not a record of a completed host repair. Run host commands from Simon's Linux host console, outside the GPU container. The application's root account inside a container is not host access.

## Evidence and boundaries

- The emailed SSH endpoint, `142.179.227.252:40008`, still times out before authentication. No remote command has executed.
- The supplied photos identify Vast machine `15904`, `king-Legion-T7-34IRZ8`, with an RTX 4090. They show a different public address, `50.99.12.201`. A single TCP-only probe of that address at the previously supplied port also timed out. **That port is not confirmed for this address.** Do not replace the saved SSH command until the complete current endpoint is verified.
- Photo 2 shows `failed to inject CDI devices: unresolvable CDI devices`, but omits the requested device name and underlying error. GPU injection is failing at container startup. If this is the container that serves SSH, the failure could keep SSH offline; it does not establish the cause of the network timeout.
- Photo 1 reports zero running rentals and one stored rental. Those counters do not identify the custom background container. Its September 11 end/expiration dates also need clarification before assuming continuing availability.
- `Max CUDA: 12.2` is a compatibility checkpoint for model/runtime selection, not a diagnosis of the CDI error.

Fresh local validation at implementation commit `9702bde`: 904 application tests, 11 runtime tests and seven queue tests passed; TypeScript lint, production build, deterministic API smoke and five HTTP mock-GPU checks passed. No adapter defect was found. The app does not configure host GPU injection, Docker startup or SSH port forwarding. Editing it cannot repair these failures.

## 1. Capture the host fault

Run the following read-only checks. Missing commands or units are diagnostic information; do not start installing/replacing the host stack automatically.

```sh
nvidia-smi
nvidia-ctk --version
nvidia-container-runtime --version
sudo nvidia-ctk --debug cdi list
sudo docker version
sudo docker ps -a --format '{{.ID}}\t{{.Names}}\t{{.Status}}\t{{.Ports}}'
```

Identify Slava's actual container from the existing Vast configuration. Replace `CONTAINER_ID` below with that ID, not the machine number `15904`:

```sh
sudo docker inspect --format '{{.State.Status}} | {{.State.Error}}' CONTAINER_ID
sudo docker inspect --format '{{.HostConfig.Runtime}}' CONTAINER_ID
sudo docker port CONTAINER_ID 22/tcp
```

Keep the complete error, especially the unresolved device name. Do not dump the whole container inspection or environment; those can contain credentials. If host `nvidia-smi` fails, resolve that driver/device failure before proceeding to a GPU container.

## 2. Repair the diagnosed CDI problem

For Toolkit 1.18+ with the packaged refresh units, inspect then regenerate the persistent specification:

```sh
sudo systemctl status nvidia-cdi-refresh.path nvidia-cdi-refresh.service --no-pager
sudo journalctl -u nvidia-cdi-refresh.service -n 80 --no-pager
sudo systemctl restart nvidia-cdi-refresh.service
sudo nvidia-ctk --debug cdi list
```

The refresh service is a oneshot; successful completion followed by `inactive` is normal. If it fails, inspect that error instead of repeatedly restarting. Confirm the requested device resolves. NVIDIA documents the refresh mechanism and its search locations in the [current CDI guide](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/cdi-support.html).

Older toolkits may require manual generation. First identify the runtime's CDI search location and back up the existing specification outside that search directory. For an installation using `/etc/cdi/nvidia.yaml`:

```sh
sudo nvidia-ctk cdi generate --output=/etc/cdi/nvidia.yaml
sudo nvidia-ctk --debug cdi list
```

This command is conditional, not an additional step for every host. See NVIDIA's [1.17.8 CDI instructions](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/1.17.8/cdi-support.html). Do not create duplicate definitions in multiple search directories or remove unrelated specifications/hooks.

The cropped error is not enough to choose this repair conclusively. NVIDIA 1.18.2 improved misleading unresolved-device reporting for just-in-time CDI generation failures; later releases also document schema compatibility limits. Capture the toolkit/library and container-engine versions before a targeted compatible update. A missing persistent YAML file is only one possibility. See [NVIDIA release notes](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/latest/release-notes.html). Do not force a different runtime mode, reinstall Docker, reboot the host or interrupt other containers as a first attempt.

## 3. Restore the container and confirm the exact SSH route

After correcting the host fault, start only the affected container through its established Vast/background-container management path. Do not recreate it or replace its entrypoint without first preserving persistent data and existing SSH/startup configuration.

Once it is running, check from the host:

```sh
sudo docker exec CONTAINER_ID nvidia-smi
sudo docker exec CONTAINER_ID sh -c 'ss -lntp'
sudo docker port CONTAINER_ID 22/tcp
```

Confirm SSH listens inside the container and determine the actual current external IP and port. If `ss` is absent, use the existing equivalent listener diagnostic. Docker's mapping alone does not verify router forwarding, firewall access or external reachability.

For a normal Vast instance, copy the complete current direct/proxy SSH commands from its connection panel. External ports are assigned per instance; the machine card does not supply the SSH mapping. If this custom background container has no Vast connection panel, Simon must confirm its mapping and network route directly. Sources: [Vast networking](https://docs.vast.ai/guides/instances/docker-environment), [Vast SSH](https://docs.vast.ai/guides/instances/connect/ssh).

Return to Slava: the complete current SSH command, full CDI/startup error if unresolved, and the host checks above. Never send a private SSH key. No new email is authorized by this runbook.

## 4. Resume the prepared deployment

After SSH works, use [README.md](README.md) to inspect persistence and actual driver/CUDA compatibility, install an isolated pinned model/runtime, establish authenticated HTTPS, validate local fallback and configure independent backups plus supported container restart. Preserve the existing Railway app and unrelated staged changes. The initial finite evaluation queue cannot supply 99% useful utilization; ongoing workloads and measured uptime/utilization remain required.

Codex's readiness watcher is active. Coordinate ownership before Hermes or another agent installs/deploys concurrently. Host repair and production activation are still pending.
