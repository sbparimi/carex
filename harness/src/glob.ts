/** Minimal glob: `**` any depth, `*` within a segment, `?` one char. A trailing `/` means "everything under". */
export function globToRegExp(glob: string): RegExp {
  let g = glob.replace(/^\.\//, "");
  if (g.endsWith("/")) g += "**";
  let re = "";
  for (let i = 0; i < g.length; i++) {
    const c = g[i]!;
    if (c === "*" && g[i + 1] === "*") {
      i++;
      if (g[i + 1] === "/") { i++; re += "(?:.*/)?"; } else re += ".*";
    } else if (c === "*") re += "[^/]*";
    else if (c === "?") re += "[^/]";
    else re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`);
}

export const matchesAny = (path: string, globs: string[]) => globs.some((g) => globToRegExp(g).test(path));
