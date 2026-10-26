import { defineConfig, type Plugin } from 'vite';

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
