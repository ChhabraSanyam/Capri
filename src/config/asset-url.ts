/**
 * The single place that turns a `public/` path into a URL.
 *
 * The app is served from the root of the custom subdomain, so `import.meta.env.BASE_URL` is `/`.
 * Going through `BASE_URL` keeps every asset URL base-relative and keeps any origin out of the code
 * (Requirement 30.8). Pass a path relative to `public/`, for example `assetUrl('models/capri.vrm')`.
 */

/** `base` must end with a slash, which Vite guarantees for `import.meta.env.BASE_URL`. */
export function joinBase(base: string, path: string): string {
  return `${base}${path.replace(/^\/+/u, '')}`;
}

export function assetUrl(path: string): string {
  return joinBase(import.meta.env.BASE_URL, path);
}
