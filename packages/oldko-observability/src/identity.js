import { readFile } from 'node:fs/promises';

function exactSha(value) {
  return typeof value === 'string' && /^[0-9a-f]{40}$/i.test(value) ? value : undefined;
}

export function releaseIdentityFromHandoff(handoff = {}) {
  const inputPins = handoff.input_pins ?? {};
  const providerSet = handoff.provider_set ?? handoff.providerSet ?? inputPins.provider_set ?? inputPins.parent_provider_set;
  const sourceCommit = exactSha(handoff.source_commit);
  return {
    release_id: handoff.release_id ?? 'unknown-release',
    ...(providerSet ? { provider_set: providerSet } : {}),
    ...(sourceCommit ? { coordinator_source_commit: sourceCommit } : {}),
    ...(inputPins.client_artifact ? { client_artifact: String(inputPins.client_artifact) } : {}),
    ...(inputPins.client_digest ? { client_digest: inputPins.client_digest } : {}),
    ...(handoff.client_build ? { client_build: handoff.client_build } : {}),
    ...(handoff.service_version ? { service_version: handoff.service_version } : {}),
    ...(handoff.service_versions ? { service_versions: handoff.service_versions } : {}),
    ...(handoff.migration_head ? { migration_head: handoff.migration_head } : {})
  };
}

export async function loadReleaseIdentity(input = {}) {
  let handoff = input.handoff;
  if (!handoff && input.handoff_file) {
    handoff = JSON.parse(await readFile(input.handoff_file, 'utf8'));
  }
  const identity = releaseIdentityFromHandoff(handoff ?? input);
  return {
    ...identity,
    ...(input.provider_set ? { provider_set: input.provider_set } : {}),
    ...(input.client_artifact ? { client_artifact: String(input.client_artifact) } : {}),
    ...(input.client_digest ? { client_digest: input.client_digest } : {}),
    ...(input.client_build ? { client_build: input.client_build } : {}),
    ...(input.service_version ? { service_version: input.service_version } : {}),
    ...(input.service_versions ? { service_versions: input.service_versions } : {}),
    ...(input.migration_head ? { migration_head: input.migration_head } : {})
  };
}
