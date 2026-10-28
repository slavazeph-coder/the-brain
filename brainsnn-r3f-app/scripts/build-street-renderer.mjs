// The street renderer stays lazy: it never enters the homepage Vite graph.
import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
import {dirname,resolve} from 'node:path';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
await build({absWorkingDir:root,entryPoints:['src/world/street/scene-view.mjs'],outfile:'public/world/street/scene-view.mjs',bundle:true,format:'esm',target:['es2022'],minify:true,legalComments:'eof',logLevel:'warning'});
