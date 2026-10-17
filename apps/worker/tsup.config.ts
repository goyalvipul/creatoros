import { defineConfig } from 'tsup';

// Bundle our own workspace packages (they ship TypeScript sources); leave third-party packages as runtime dependencies.
export default defineConfig({
  entry: ['src/main.ts'],
  format: ['esm'],
  target: 'node22',
  platform: 'node',
  outDir: 'dist',
  clean: true,
  sourcemap: true,
  noExternal: [/^@creatoros\//],
  banner: {
    js: "import { createRequire as __cr } from 'node:module'; const require = __cr(import.meta.url);",
  },
});
