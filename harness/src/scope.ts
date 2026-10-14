/** Static prefix of a glob: everything before the first wildcard character. */
const prefix = (g: string) => g.replace(/^\.\//, "").split(/[*?[{]/)[0]!;

/** Conservative overlap test: two write globs may touch the same file if one static prefix contains the other. */
export function globsMayOverlap(a: string, b: string): boolean {
  const pa = prefix(a), pb = prefix(b);
  return pa.startsWith(pb) || pb.startsWith(pa);
}

export function scopesConflict(a: string[], b: string[]): boolean {
  return a.some((x) => b.some((y) => globsMayOverlap(x, y)));
}
