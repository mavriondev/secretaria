import { resolvePublicUrl } from './public-url';

/** Keep requests and downloads inside the app whatever its base path (root at www.oitato.com.br; a prefix in development). */
export const appBasePath = import.meta.env.BASE_URL.replace(/\/$/, '');
export function appUrl(path: string): string {
  return path.startsWith('/') ? `${appBasePath}${path}` : path;
}

/** Shared links use the configured public origin; API requests remain same-origin. */
export function publicAppUrl(path: string): string {
  return resolvePublicUrl(path, import.meta.env.VITE_PUBLIC_APP_URL, appBasePath, window.location.origin);
}
