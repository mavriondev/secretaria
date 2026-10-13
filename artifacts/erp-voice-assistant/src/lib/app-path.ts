/** Keep requests and downloads inside the app when hosted under /tato/. */
export const appBasePath = import.meta.env.BASE_URL.replace(/\/$/, '');
export function appUrl(path: string): string {
  return path.startsWith('/') ? `${appBasePath}${path}` : path;
}
