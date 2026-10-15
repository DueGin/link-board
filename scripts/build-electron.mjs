import { build } from 'esbuild';
import 'electron';

await build({
  entryPoints: { main: 'electron/main.ts', preload: 'electron/preload.ts' },
  outdir: 'dist-electron',
  outExtension: { '.js': '.cjs' },
  bundle: true,
  minify: true,
  sourcemap: false,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  external: ['electron'],
  logLevel: 'info',
});
