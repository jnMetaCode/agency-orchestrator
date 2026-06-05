// Deterministic character avatars for roles, via DiceBear (no key, seeded by id).
// Same seed → same face every time, so each role has a stable "person".
const STYLE = "avataaars";

export function avatarUrl(seed: string): string {
  const s = encodeURIComponent(seed || "ao");
  return `https://api.dicebear.com/9.x/${STYLE}/svg?seed=${s}&radius=50&backgroundColor=transparent`;
}

/** Soft tint + solid border derived from a role color (hex or named). */
export function avatarTint(color?: string): { background: string; borderColor: string } {
  if (color && /^#([0-9a-f]{6}|[0-9a-f]{3})$/i.test(color)) {
    return { background: `${color}1f`, borderColor: `${color}55` };
  }
  return { background: "hsl(var(--primary) / 0.12)", borderColor: "hsl(var(--primary) / 0.35)" };
}
