import { execSync } from 'node:child_process';
import { defineConfig, type Plugin } from 'vite';

/** The commit this build is made from, with a plus when the working tree has changes the commit does not, so a build can be told from another of the same version. */
function buildCommit(): string {
  const git = (args: string): string => {
    try {
      return execSync(`git ${args}`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    } catch {
      return '';
    }
  };
  const commit = git('rev-parse --short HEAD');
  return commit === '' ? 'unknown' : `${commit}${git('status --porcelain') === '' ? '' : '+'}`;
}

/**
 * Browsers refuse ES-module scripts on `file://` (opaque origin), so this build
 * emits one classic IIFE bundle and turns the module script tag into a deferred
 * classic one; `defer` keeps the module timing the app relies on.
 */
function classicScriptsForFileProtocol(): Plugin {
  return {
    name: 'classic-scripts-for-file-protocol',
    transformIndexHtml(html) {
      return html
        .replace(/<link rel="modulepreload"[^>]*>\s*/g, '')
        .replace(/<script type="module"(?: crossorigin)? src="([^"]+)"><\/script>/g, '<script src="$1" defer></script>');
    },
  };
}

export default defineConfig({
  base: './',
  define: { __BUILD_COMMIT__: JSON.stringify(buildCommit()) },
  plugins: [classicScriptsForFileProtocol()],
  build: {
    outDir: 'dist-file',
    emptyOutDir: true,
    cssCodeSplit: false,
    assetsInlineLimit: 100_000_000,
    rollupOptions: {
      input: 'index.html',
      output: {
        format: 'iife',
        name: 'Eebox',
        inlineDynamicImports: true,
        entryFileNames: 'app.js',
      },
    },
  },
});
