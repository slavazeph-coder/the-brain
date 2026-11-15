import {build} from 'esbuild';
import {fileURLToPath} from 'node:url';
import {dirname,resolve} from 'node:path';
await build({absWorkingDir:resolve(dirname(fileURLToPath(import.meta.url)),'..'),entryPoints:['src/world/twin-renderer.js'],outfile:'public/world/twin-renderer.js',bundle:true,format:'iife',target:['es2020'],minify:true,legalComments:'eof',logLevel:'warning'});
