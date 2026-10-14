/** Keep requests and downloads inside the app whatever its base path (root at www.oitato.com.br; a prefix in development). */
export const appBasePath = import.meta.env.BASE_URL.replace(/\/$/, '');
export function appUrl(path: string): string {
  return path.startsWith('/') ? `${appBasePath}${path}` : path;
}
