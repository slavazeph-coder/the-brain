#!/usr/bin/env node
/**
 * Private large-source transfer example. Node 22+; no provider SDK in the client.
 * Credentials come only from the environment and are never printed or persisted.
 * Upload and completion are separate, explicit commands; requests never auto-retry.
 */
import { openAsBlob } from 'node:fs';
import { open, link, unlink } from 'node:fs/promises';
import { basename, dirname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { parseArgs } from 'node:util';
import {
  createProjectsClient, createIdempotencyKey, ProjectsApiError,
} from '../brainsnn-r3f-app/public/world/projects-client.mjs';

const HELP = `Usage (Node 22+):
  node examples/world-project-large-source.mjs upload --project ID --file PATH [--media-type TYPE]
  node examples/world-project-large-source.mjs upload --project ID --file PATH --upload UPLOAD_ID
  node examples/world-project-large-source.mjs complete --project ID --upload UPLOAD_ID
  node examples/world-project-large-source.mjs download --project ID --source SOURCE_ID --output PATH

Set WORLD_PROJECT_API_URL and WORLD_PROJECT_API_KEY privately before running.
Upload transfers parts only. Complete verifies and retains one source.
For an ambiguous create/complete retry, use the printed --idempotency-key and
--expected-version with the unchanged original inputs. A known upload ID resumes
stored parts after rehashing the complete original file. No request auto-retries.
Download verifies size and SHA-256 before committing a new file; never overwrites.
`;

function input(message) {
  throw new ProjectsApiError(message, { code: 'invalid_example_arguments' });
}

function progressLogger() {
  let previous = '';
  return ({ phase, completedBytes, totalBytes }) => {
    const band = Math.floor(10 * completedBytes / totalBytes);
    const marker = `${phase}:${band}`;
    if (marker !== previous) {
      previous = marker;
      console.error(JSON.stringify({ phase, completed_bytes: completedBytes, total_bytes: totalBytes }));
    }
  };
}

async function privateFileSink(destination) {
  const target = resolve(destination);
  const temporary = join(dirname(target), `.world-source-${randomUUID()}.part`);
  let file = await open(temporary, 'wx', 0o600);
  let committed = false;
  return {
    async write(bytes) {
      // FileHandle.write can write fewer bytes than requested; retain backpressure.
      let offset = 0;
      while (offset < bytes.byteLength) {
        const { bytesWritten } = await file.write(bytes, offset, bytes.byteLength - offset);
        if (!bytesWritten) throw new Error('Destination stopped accepting bytes.');
        offset += bytesWritten;
      }
    },
    async close() {
      // The SDK calls close only after length and full-file SHA-256 verification.
      await file.sync();
      await file.close(); file = null;
      // An adjacent hard link publishes atomically and refuses an existing target.
      await link(temporary, target);
      committed = true;
      await unlink(temporary);
    },
    async abort() {
      if (file) { await file.close().catch(() => {}); file = null; }
      await unlink(temporary).catch(() => {});
      // A committed target contains verified bytes and is never removed here.
    },
    get committed() { return committed; },
  };
}

async function main() {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: Object.fromEntries([
      ...['project', 'file', 'media-type', 'upload', 'source', 'output', 'idempotency-key', 'expected-version'].map(name => [name, { type: 'string' }]),
      ['help', { type: 'boolean', short: 'h' }],
    ]),
  });
  if (values.help || positionals.length === 0) { console.log(HELP); return; }
  const command = positionals[0];
  if (positionals.length !== 1 || !['upload', 'complete', 'download'].includes(command) || !values.project) input('Choose one command and an existing --project ID. Use --help for examples.');
  if (!process.env.WORLD_PROJECT_API_KEY || !process.env.WORLD_PROJECT_API_URL) input('Set WORLD_PROJECT_API_URL and WORLD_PROJECT_API_KEY in the private environment.');
  const expectedVersion = values['expected-version'] === undefined ? undefined : Number(values['expected-version']);
  if (expectedVersion !== undefined && (!Number.isSafeInteger(expectedVersion) || expectedVersion < 1)) input('Use a positive integer --expected-version.');
  if (values['idempotency-key'] && expectedVersion === undefined && !values.upload) input('A creation retry needs the original --expected-version and unchanged file/name/media type.');
  if (values['idempotency-key'] && expectedVersion === undefined && command === 'complete') input('A completion retry needs its original --expected-version.');

  const client = createProjectsClient({ apiKey: process.env.WORLD_PROJECT_API_KEY, baseUrl: process.env.WORLD_PROJECT_API_URL });
  const controller = new AbortController();
  const cancel = () => controller.abort();
  process.once('SIGINT', cancel); process.once('SIGTERM', cancel);
  const signal = controller.signal;
  const onProgress = progressLogger();
  try {
    if (command === 'upload') {
      if (!values.file) input('Upload requires --file.');
      const mediaType = values['media-type'] || 'application/octet-stream';
      const file = await openAsBlob(resolve(values.file), { type: mediaType });
      const version = values.upload ? undefined : expectedVersion ?? (await client.getProject(values.project, { signal })).project.version;
      const key = values['idempotency-key'] || createIdempotencyKey();
      if (!values.upload) console.log(JSON.stringify({ action: 'create_source_upload', project_id: values.project, expected_version: version, idempotency_key: key, name: basename(values.file), media_type: mediaType, bytes: file.size }));
      let announced;
      const { upload } = await client.uploadSourceFile(values.project, file, {
        uploadId: values.upload, expectedVersion: version, name: basename(values.file), mediaType,
        createIdempotencyKey: key, signal, onProgress,
        onUpload: value => {
          if (announced !== value.id) {
            announced = value.id;
            console.log(JSON.stringify({ upload_id: value.id, project_id: values.project, sha256: value.sha256, expires_at: value.expires_at }));
          }
        },
      });
      console.log(JSON.stringify({ upload_id: upload.id, status: upload.status, uploaded_bytes: upload.uploaded_bytes, bytes: upload.bytes, source_id: upload.source_id, next_action: upload.status === 'retained' ? 'already_retained' : upload.status === 'verifying' ? 'inspect_after_verification' : 'explicit_complete' }));
    } else if (command === 'complete') {
      if (!values.upload) input('Completion requires --upload.');
      const version = expectedVersion ?? (await client.getProject(values.project, { signal })).project.version;
      const key = values['idempotency-key'] || createIdempotencyKey();
      console.log(JSON.stringify({ action: 'complete_source_upload', project_id: values.project, upload_id: values.upload, expected_version: version, idempotency_key: key }));
      const result = await client.completeSourceUpload(values.project, values.upload, { expected_version: version }, { idempotencyKey: key, signal });
      console.log(JSON.stringify({ project_id: result.project.id, project_version: result.project.version, applied_version: result.applied_version, source: result.resource }));
    } else {
      if (!values.source || !values.output) input('Download requires --source and a new --output path.');
      const sink = await privateFileSink(values.output);
      const result = await client.downloadSourceToSink(values.project, values.source, { sink, signal, onProgress });
      console.log(JSON.stringify({ source_id: result.source.id, bytes: result.bytes, sha256: result.sha256, verified: result.verified, output: resolve(values.output) }));
    }
  } finally {
    process.off('SIGINT', cancel); process.off('SIGTERM', cancel);
    client.clearApiKey();
  }
}

main().catch(error => {
  // Native error strings can include paths or transport details. Do not dump them.
  const known = error instanceof ProjectsApiError;
  console.error(JSON.stringify({
    error: known ? error.code : 'example_failed',
    message: known ? error.message : 'The local file or transfer could not finish. Check paths, credentials, service configuration and transfer state.',
    ...(known && error.status ? { status: error.status } : {}),
    ...(known && error.requestId ? { request_id: error.requestId } : {}),
    ...(known && error.idempotencyKey ? { idempotency_key: error.idempotencyKey } : {}),
    ...(error.uploadId ? { upload_id: error.uploadId } : {}),
  }));
  process.exitCode = 1;
});
