function normalizeModifierName(modifier: string): string {
  return modifier === "ctrl"
    ? "control"
    : modifier === "cmd"
      ? "command"
      : modifier === "option"
        ? "alt"
        : modifier;
}

export function isLeftRightMix(parts: string[]): boolean {
  const sidesByModifier = new Map<string, Set<string>>();

  const patterns = [
    /^(left|right)[-_ ]?(ctrl|control|alt|option|shift|command|cmd|super|meta)$/i,
    /^(ctrl|control|alt|option|shift|command|cmd|super|meta)[-_ ]?(left|right)$/i,
  ];

  for (const rawPart of parts) {
    const part = rawPart.replace(/\s+/g, "");
    for (const pattern of patterns) {
      const match = part.match(pattern);
      if (!match) {
        continue;
      }
      const side = match[1].toLowerCase().includes("left") ? "left" : "right";
      const modifier = match[2]?.toLowerCase() || match[1]?.toLowerCase();
      if (!modifier) {
        continue;
      }
      const normalizedModifier = normalizeModifierName(modifier);
      const set = sidesByModifier.get(normalizedModifier) ?? new Set<string>();
      set.add(side);
      sidesByModifier.set(normalizedModifier, set);
    }
  }

  for (const set of sidesByModifier.values()) {
    if (set.size > 1) {
      return true;
    }
  }

  return false;
}

