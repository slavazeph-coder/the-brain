// Internal bridge from the browser's exact edit/export implementation to the offline camera scorer.
import { readFile, stat } from 'node:fs/promises';
import { basename } from 'node:path';
import { isDeepStrictEqual } from 'node:util';
import { MAX_FILE_BYTES, STRIDE, parseVisualAsset } from '../../brainsnn-r3f-app/public/world/visual-geometry.mjs';
import {
  OBJECTIFY_LIMITS, createObjectifyContext, exportObjectVariant, objectifySha256, parseObjectDocument,
} from '../../brainsnn-r3f-app/public/world/objectify-core.mjs';

async function readBounded(path, maximum) {
  const info = await stat(path);
  if (!info.isFile() || info.size < 1 || info.size > maximum) throw Error('Input exceeds its file budget.');
  const bytes = await readFile(path);
  if (bytes.length !== info.size) throw Error('Input changed during evaluation.');
  return bytes;
}

async function parseSource(path, bytes) {
  const name = basename(path);
  const parsed = parseVisualAsset(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.length), name);
  return { ...parsed, source: { name, bytes: bytes.length, sha256: await objectifySha256(bytes) } };
}

function originalCentres(parsed) {
  return Array.from(parsed.sourceIndices, (_, i) => Array.from(parsed.points.subarray(i * STRIDE, i * STRIDE + 3)));
}

async function emitLedgerCentres(path, expectedSha) {
  const parsed = await parseSource(path, await readBounded(path, MAX_FILE_BYTES));
  if (parsed.source.sha256 !== expectedSha) throw Error('Cloud bytes differ from the frozen ledger.');
  process.stdout.write(JSON.stringify(originalCentres(parsed)));
}

function inDisplayFrame(parsed, orientation) {
  if (orientation === 'identity') return parsed.points;
  if (orientation !== 'flip-y-z') throw Error('Unknown display orientation.');
  // Same 180-degree X rotation (including Gaussian axes) as splat.mjs displayedPoints.
  const points = parsed.points.slice();
  for (let i = 0; i < points.length; i += STRIDE) {
    points[i + 1] *= -1;
    points[i + 2] *= -1;
    const [x, y, z, w] = points.subarray(i + 10, i + 14);
    points.set([w, -z, y, -x], i + 10);
  }
  return points;
}

async function main([sourcePath, editsPath, variantPath, receiptPath, objectId, cloudPath, cloudSha]) {
  const bytes = await readBounded(sourcePath, MAX_FILE_BYTES);
  const parsed = await parseSource(sourcePath, bytes);
  const edits = await readBounded(editsPath, OBJECTIFY_LIMITS.jsonBytes);
  const orientation = JSON.parse(edits).source?.displayTransform;
  const ctx = await createObjectifyContext({
    ...parsed, points: inDisplayFrame(parsed, orientation), displayTransform: orientation,
    parserVersion: parsed.parserMetadata.version,
  });
  const doc = parseObjectDocument(ctx, edits.toString('utf8'));
  const group = doc.objects.find(object => object.id === objectId);
  if (!group?.reviewed) throw Error('Specify a reviewed base object ID from the edit document.');
  const replay = await exportObjectVariant(ctx, doc);
  const receiptBytes = await readBounded(receiptPath, OBJECTIFY_LIMITS.jsonBytes);
  // The browser serializes receipt numbers to JSON (including -0 as 0).
  const expectedReceipt = JSON.parse(JSON.stringify(replay.receipt));
  if (await objectifySha256(edits) !== replay.receipt.editManifestSha256 ||
      !isDeepStrictEqual(JSON.parse(receiptBytes), expectedReceipt)) {
    throw Error('Edit bytes or variant receipt disagree with the workshop replay.');
  }
  const variant = await readBounded(variantPath, MAX_FILE_BYTES);
  if (!variant.equals(Buffer.from(replay.buffer))) throw Error('Derived PLY differs from the replayed export.');

  let registration = 'exact-ledger-ply';
  if (sourcePath.toLowerCase().endsWith('.splat')) {
    // A native ledger binds PLY. Admit a SPLAT only when every retained centre has
    // an identical, ordered source vertex in that PLY. Never guess a registration.
    const cloud = await parseSource(cloudPath, await readBounded(cloudPath, MAX_FILE_BYTES));
    if (cloud.source.sha256 !== cloudSha || parsed.total !== cloud.total ||
        !isDeepStrictEqual(parsed.sourceIndices, cloud.sourceIndices)) throw Error('SPLAT camera registration mismatch.');
    for (let i = 0; i < parsed.points.length; i += STRIDE) {
      for (let axis = 0; axis < 3; axis++) {
        if (parsed.points[i + axis] !== cloud.points[i + axis]) throw Error('SPLAT centres differ from the camera cloud.');
      }
    }
    registration = 'identical-retained-source-ids-and-xyz';
  } else if (parsed.source.sha256 !== cloudSha) {
    throw Error('Source PLY is not the bound camera cloud.');
  }

  const ids = Buffer.alloc(group.indices.length * 4);
  group.indices.forEach((index, i) => ids.writeUInt32LE(parsed.sourceIndices[index], i * 4));
  const xyz = originalCentres(parsed);
  // xyz is in original source order and coordinates. Translated/hidden/copied instances
  // were verified above but are never rasterized against the original photographs.
  process.stdout.write(JSON.stringify({
    xyz, indices: group.indices,
    evidence: {
      objectId, name: group.name, retained: ctx.pointCount, selected: group.indices.length,
      source: ctx.source, selectedSourceIdsSha256: await objectifySha256(ids), cameraRegistration: registration,
      editsSha256: replay.receipt.editManifestSha256, variantSha256: replay.receipt.variantArtifact.sha256,
      receiptSha256: await objectifySha256(receiptBytes), exportReplayMatched: true,
    },
  }));
}

const args = process.argv.slice(2);
const task = args[0] === '--ledger-centres' ? emitLedgerCentres(args[1], args[2]) : main(args);
task.catch(error => { console.error(error.message); process.exitCode = 2; });
