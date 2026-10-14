import path from 'path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig, type Plugin } from 'vite';
import { readFileSync } from 'fs';

import runtimeErrorOverlay from '@replit/vite-plugin-runtime-error-modal';

const rawPort = process.env.PORT;

if (!rawPort) {
  throw new Error(
    'PORT environment variable is required but was not provided.',
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const basePath = process.env.BASE_PATH;

if (!basePath) {
  throw new Error(
    'BASE_PATH environment variable is required but was not provided.',
  );
}

/** PWA files that depend on the base path: the manifest (start_url/scope) and the service worker (version and base). Production build only. */
function pwaFiles(base: string): Plugin {
  // Release builds carry .runtime-version.json at the repository root (written by the VPS routine); its revision names the worker version.
  const version = (() => {
    try { const v = JSON.parse(readFileSync(path.resolve(import.meta.dirname, '../../.runtime-version.json'), 'utf8')) as { revision?: string; buildId?: string }; return (v.revision ?? v.buildId ?? '').slice(0, 12) || null; } catch { return null; }
  })() ?? new Date().toISOString().replace(/\D/g, '').slice(0, 14);
  const manifest = {
    name: 'Tato', short_name: 'Tato', description: 'A secretária de voz que consulta os dados da sua empresa e responde na hora.',
    id: base, start_url: base, scope: base, display: 'standalone', orientation: 'portrait', lang: 'pt-BR', dir: 'ltr',
    background_color: '#0e1217', theme_color: '#0e1217',
    icons: [
      { src: `${base}icons/icon-192.png`, sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: `${base}icons/icon-512.png`, sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: `${base}icons/icon-maskable-192.png`, sizes: '192x192', type: 'image/png', purpose: 'maskable' },
      { src: `${base}icons/icon-maskable-512.png`, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
  const sw = () => readFileSync(path.resolve(import.meta.dirname, 'sw.template.js'), 'utf8').replace('__VERSION__', version).replace('__BASE__', base);
  return {
    name: 'tato-pwa-files',
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'manifest.webmanifest', source: JSON.stringify(manifest, null, 2) });
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: sw() });
    },
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        if (req.url?.split('?')[0] === `${base}manifest.webmanifest`) { res.setHeader('Content-Type', 'application/manifest+json'); res.end(JSON.stringify(manifest)); return; }
        next();
      });
    },
  };
}

export default defineConfig({
  base: basePath,
  plugins: [
    pwaFiles(basePath.endsWith('/') ? basePath : `${basePath}/`),
    react(),
    tailwindcss(),
    runtimeErrorOverlay(),
    ...(process.env.NODE_ENV !== 'production' &&
    process.env.REPL_ID !== undefined
      ? [
          await import('@replit/vite-plugin-cartographer').then((m) =>
            m.cartographer({
              root: path.resolve(import.meta.dirname, '..'),
            }),
          ),
          await import('@replit/vite-plugin-dev-banner').then((m) =>
            m.devBanner(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, 'src'),
      '@assets': path.resolve(
        import.meta.dirname,
        '..',
        '..',
        'attached_assets',
      ),
    },
    dedupe: ['react', 'react-dom'],
  },
  root: path.resolve(import.meta.dirname),
  build: {
    outDir: path.resolve(import.meta.dirname, 'dist/public'),
    emptyOutDir: true,
  },
  server: {
    port,
    strictPort: true,
    host: '0.0.0.0',
    allowedHosts: true,
    fs: {
      strict: true,
    },
  },
  preview: {
    port,
    host: '0.0.0.0',
    allowedHosts: true,
  },
});
