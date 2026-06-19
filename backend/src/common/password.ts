/** Generate a readable temporary password, e.g. "Noloop-7F3K9Q".
 *  Returned in plain text ONCE to the admin who created/reset the account. */
export function genPassword(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no ambiguous chars
  let s = "";
  for (let i = 0; i < 6; i++)
    s += chars[Math.floor(Math.random() * chars.length)];
  return `Noloop-${s}`;
}
