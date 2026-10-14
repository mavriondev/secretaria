/** Resolve shareable links without changing where authenticated API requests go. */
export function resolvePublicUrl(path: string, configured: string | undefined, base: string, origin: string): string {
  const address = configured?.trim();
  if (address) {
    const url = new URL(address);
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
      throw new Error('VITE_PUBLIC_APP_URL deve ser um endereço HTTPS público sem credenciais.');
    }
    return new URL(path.replace(/^\//, ''), `${url.toString().replace(/\/$/, '')}/`).toString();
  }
  return new URL(`${base}${path.startsWith('/') ? path : `/${path}`}`, origin).toString();
}
