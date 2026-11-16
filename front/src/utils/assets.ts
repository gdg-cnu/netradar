/** Resolve public assets for both root and subdirectory deployments. */
export function assetUrl(filename: string): string {
  return `${import.meta.env.BASE_URL}assets/${filename}`
}
