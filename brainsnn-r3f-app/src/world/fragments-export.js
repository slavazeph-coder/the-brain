// IFC to That Open Fragments, on the person's own device. Bundled by scripts/build-fragments-export.mjs and requested
// only when someone asks for the Fragments file, so it never enters the World Builder shell.
import {IfcImporter, SingleThreadedFragmentsModel} from '@thatopen/fragments';

const value = v => v && typeof v === 'object' && 'value' in v ? v.value : v;

/** What a Fragments file holds, read back with the library's own reader: every element that has geometry, by IFC class,
 *  the volumes that mark unseen space, and how many elements still carry BrainSNN's provenance property set. */
export async function describeFragments(bytes) {
  const model = new SingleThreadedFragmentsModel('scene', bytes);
  try {
    await model.ready;
    const ids = model.getItemsWithGeometry();
    const items = model.getItemsData(ids, {attributesDefault: true, relations: {IsDefinedBy: {attributes: true, relations: true}}});
    const byClass = {}, provenance = {};
    let withProvenance = 0, unknownVolumes = 0;
    for (const item of items) {
      const set = (item.IsDefinedBy || []).find(p => value(p.Name) === 'Pset_BrainSNN');
      const said = set && (set.HasProperties || []).find(p => value(p.Name) === 'Provenance');
      const source = said && typeof value(said.NominalValue) === 'string' ? value(said.NominalValue) : null;
      if (source) {
        withProvenance++;
        provenance[source] = (provenance[source] || 0) + 1;
      }
      // Space the scan never saw is exported as a tagged volume; it is counted apart so it never reads as an object.
      if (source === 'unknown') { unknownVolumes++; continue; }
      const kind = String(value(item._category) || 'UNKNOWN');
      byClass[kind] = (byClass[kind] || 0) + 1;
    }
    return {elements: ids.length, byClass, unknownVolumes, withProvenance, provenance};
  } finally {
    model.dispose();
  }
}

/** Converts IFC bytes to a Fragments file and reads it back. `wasmPath` is the absolute URL (a directory path in Node)
 *  that holds web-ifc's .wasm, ending in '/'. Nothing is uploaded: the conversion runs where this is called. */
export async function ifcToFragments(ifcBytes, wasmPath) {
  if (!(ifcBytes instanceof Uint8Array) || !ifcBytes.length) throw new Error('No IFC file to convert.');
  const importer = new IfcImporter();
  importer.wasm = {absolute: true, path: wasmPath};
  const bytes = await importer.process({bytes: ifcBytes});
  if (!(bytes instanceof Uint8Array) || !bytes.length) throw new Error('The converter returned an empty file.');
  return {bytes, summary: await describeFragments(bytes)};
}
