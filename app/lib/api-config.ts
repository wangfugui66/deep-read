/**
 * Global API configuration center.
 *
 * Single source of truth for backend URL resolution.
 * All plugin/feature modules reference this instead of hardcoding URLs.
 */

export const API_BASE_URL =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

/**
 * Backend static asset origin — bypasses NEXT_PUBLIC_API_URL because
 * TeachAny HTML is a raw static file, not a proxied API route.
 *
 * Must point directly to the FastAPI server (default: http://localhost:8000).
 */
export const BACKEND_STATIC_URL =
  process.env.NEXT_PUBLIC_API_URL || "http://localhost:8000";

/**
 * Resolve a TeachAny view URL to the backend static origin.
 *
 * Example: "/api/plugins/teachany/view/foo/bar.html"
 *       → "http://localhost:8000/api/plugins/teachany/view/foo/bar.html"
 */
export function resolveTeachAnyUrl(relativeUrl: string): string {
  const safePath = relativeUrl.startsWith("/") ? relativeUrl : `/${relativeUrl}`;
  return `${BACKEND_STATIC_URL}${safePath}`;
}
