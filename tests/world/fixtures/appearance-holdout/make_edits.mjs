// Produce the actual three workshop downloads, including an authored move and a copy.
import { readFile, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { parseVisualAsset, STRIDE } from '../../../../brainsnn-r3f-app/public/world/visual-geometry.mjs';
import {
  addObject, createObjectDocument, createObjectifyContext, duplicateObject, exportObjectVariant,
  objectifySha256, updateObject,
} from '../../../../brainsnn-r3f-app/public/world/objectify-core.mjs';

const [sourcePath, directory, selection, orientation, fixtureCase] = process.argv.slice(2);
const bytes = new Uint8Array(await readFile(sourcePath));
const parsed = parseVisualAsset(bytes.buffer, sourcePath);
if (orientation === 'flip-y-z') {
  // Independently authored fixture uses identity quaternions; compose qx(180) * q.
  for (let i = 0; i < parsed.points.length; i += STRIDE) {
    parsed.points[i + 1] = -parsed.points[i + 1];
    parsed.points[i + 2] = -parsed.points[i + 2];
    const [x, y, z, w] = parsed.points.slice(i + 10, i + 14);
    parsed.points.set([w, -z, y, -x], i + 10);
  }
}
const ctx = await createObjectifyContext({
  ...parsed, displayTransform: orientation,
  source: { name: basename(sourcePath), bytes: bytes.length, sha256: await objectifySha256(bytes) },
});
const indices = JSON.parse(selection);
const group = addObject(ctx, createObjectDocument(ctx), { name: 'Fixture chair', reviewed: true, indices });
let doc = group.document;
if (fixtureCase !== 'original') {
  doc = updateObject(ctx, doc, group.id, { translation: [9, 0, 0], yawDegrees: 90 });
  doc = duplicateObject(ctx, doc, group.id, { translation: [-9, 1, 0] }).document;
  doc = updateObject(ctx, doc, group.id, { hidden: true });
}
const out = await exportObjectVariant(ctx, doc);
await writeFile(join(directory, 'appearance-object-edits.json'), out.manifestText);
await writeFile(join(directory, out.name), new Uint8Array(out.buffer));
await writeFile(join(directory, 'appearance-object-variant-receipt.json'), JSON.stringify(out.receipt, null, 2) + '\n');
