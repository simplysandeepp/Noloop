/** System email domain for all generated accounts. */
export const EMAIL_DOMAIN = "noloop.in";

/** "Acme Hospital" -> "acme.hospital" (words joined by dots). */
export function toDotted(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .join(".");
}

/** "Acme Hospital" -> "acmehospital" (alphanumeric only, no separators). */
export function toCompact(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, "");
}

/**
 * Build a unique email from a local-part base, appending 1, 2, 3… on collision.
 * `exists` checks whether a full email is already taken.
 */
export async function uniqueEmail(
  localBase: string,
  exists: (email: string) => Promise<boolean>,
): Promise<string> {
  let candidate = `${localBase}@${EMAIL_DOMAIN}`;
  let n = 1;
  while (await exists(candidate)) {
    candidate = `${localBase}${n}@${EMAIL_DOMAIN}`;
    n++;
  }
  return candidate;
}
