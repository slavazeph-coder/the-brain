#!/usr/bin/env node
/**
 * Node 22.6+ quickstart. Creates a clearly labelled authored example project.
 * It does not upload a real capture, execute a simulator, or run a physical robot.
 * Run from the repository root with WORLD_PROJECT_API_KEY and
 * WORLD_PROJECT_API_URL (for example http://127.0.0.1:3000/api/world/v1).
 */
import { createHash } from 'node:crypto';
import { createProjectsClient, ProjectsApiError } from '../brainsnn-r3f-app/public/world/projects-client.mjs';

const apiKey = process.env.WORLD_PROJECT_API_KEY;
const baseUrl = process.env.WORLD_PROJECT_API_URL;
if (!apiKey || !baseUrl) {
  console.error('Set WORLD_PROJECT_API_URL and WORLD_PROJECT_API_KEY. Never put the key in a URL.');
  process.exitCode = 1;
} else {
  const client = createProjectsClient({ apiKey, baseUrl });
  try {
    const status = await client.status();
    if (!status.available) throw new Error('Durable project storage is unavailable. Configure PostgreSQL before running this example.');
    const me = await client.me();
    console.log(`Connected to ${me.tenant.name} as ${me.actor.name} (${me.actor.role}).`);

    // prepareMutation snapshots body/key for an explicit retry of THIS operation.
    // This program never automatically retries or silently creates another site.
    const create = client.prepareMutation('createProject', [{
      title: 'SDK example — authored fixture',
      description: 'API workflow demonstration only. No physical capture, measurement, simulation, or robot trial was performed.',
    }]);
    let { project } = await create.run();
    console.log(`Created example project ${project.id}.`);

    const content = 'AUTHORED SDK FIXTURE\nNo real site was captured. No independent dimensions were measured. No simulator or physical robot was executed.\n';
    const sha256 = createHash('sha256').update(content, 'utf8').digest('hex');
    const sourceResult = await client.prepareMutation('addSource', [project.id, {
      expected_version: project.version,
      name: 'authored-fixture.txt', media_type: 'text/plain', content_text: content, sha256,
    }]).run();
    project = sourceResult.project;
    const source = sourceResult.resource;

    const retained = await client.getSource(project.id, source.id);
    const retainedBytes = Buffer.from(retained.data_base64, 'base64');
    if (createHash('sha256').update(retainedBytes).digest('hex') !== sha256 || !retainedBytes.equals(Buffer.from(content, 'utf8'))) {
      throw new Error('The retained source did not match the submitted bytes.');
    }

    const revisionResult = await client.prepareMutation('createRevision', [project.id, {
      expected_version: project.version, label: 'Authored example baseline', kind: 'as_is',
      source_ids: [source.id],
      robot: { model: 'Example cleaner — unqualified profile' },
      task: { kind: 'cleaning-assessment', goal: 'Demonstrate record linkage; do not infer deployment suitability.' },
    }]).run();
    project = revisionResult.project;
    const revision = revisionResult.resource;

    const evidenceResult = await client.prepareMutation('addEvidence', [project.id, {
      expected_version: project.version, revision_id: revision.id, source_id: source.id,
      kind: 'observed', claim: 'The retained fixture explicitly says no real measurement or robot trial took place.',
      locator: { note: 'Second line of authored-fixture.txt.' },
      uncertainty: 'This is a software example, not physical evidence.',
    }]).run();
    project = evidenceResult.project;

    const trialResult = await client.prepareMutation('createTrial', [project.id, {
      expected_version: project.version, revision_id: revision.id,
      robot_model: revision.robot.model, task: revision.task.goal,
      kind: 'simulation', outcome: 'inconclusive', prediction: 'unknown',
      source_ids: [source.id], measurement_evidence_ids: [],
      notes: 'Authored test record only. No simulator was executed; this intentionally cannot support physical verification.',
      occurred_at: new Date().toISOString(),
    }]).run();
    project = trialResult.project;

    const exported = await client.exportProject(project.id);
    console.log(JSON.stringify({
      project_id: project.id, version: project.version,
      source_sha256: source.sha256, retained_source_bytes: retainedBytes.byteLength,
      readiness: project.readiness, export_schema: exported.schema,
      physical_validated: exported.physical_validated,
    }, null, 2));
    console.log('Example complete. The records remain in this workspace as an explicitly labelled software fixture.');
  } catch (error) {
    if (error instanceof ProjectsApiError) {
      // A key is never included. The request ID is safe for operator diagnostics.
      console.error(JSON.stringify({ error: error.code, message: error.message, status: error.status, request_id: error.requestId }));
      if (error.idempotencyKey) console.error('The request may need an explicit retry with its original body and Idempotency-Key; this example does not retry automatically.');
    } else console.error(error.message);
    process.exitCode = 1;
  } finally {
    client.clearApiKey();
  }
}
