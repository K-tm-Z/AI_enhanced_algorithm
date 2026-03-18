/** Normalize stored path to a URL the dev proxy / production can serve. */
export function toStorageUrl(p: string | undefined | null): string {
  if (!p) return "";
  const normalized = String(p).replaceAll("\\", "/");
  if (normalized.startsWith("storage/")) return `/${normalized}`;
  if (normalized.startsWith("/storage/")) return normalized;
  return `/storage/${normalized.replace(/^\/+/, "")}`;
}
