/** 把本机旧缓存或意外字段归一化，再交给页面；主题计算可独立测试。 */
export function normalizeAppearance(value = {}) {
  value = value && typeof value === "object" ? value : {};
  return {
    theme: ["light", "dark", "system", "paper", "midnight"].includes(
      value.theme,
    )
      ? value.theme
      : "light",
    accent: ["sage", "blue", "violet", "amber", "rose", "teal"].includes(
      value.accent,
    )
      ? value.accent
      : "sage",
    font_size: ["small", "medium", "large"].includes(value.font_size)
      ? value.font_size
      : "medium",
    density: ["comfortable", "compact"].includes(value.density)
      ? value.density
      : "comfortable",
    font_scale:
      typeof value.font_scale === "number" && Number.isFinite(value.font_scale)
        ? Math.max(1, Math.min(1.3, Math.round(value.font_scale * 100) / 100))
        : { small: 1, medium: 1, large: 1.13 }[value.font_size] || 1,
    font_family: ["system", "song", "kai", "hei", "custom"].includes(
      value.font_family,
    )
      ? value.font_family
      : "system",
    font_id:
      typeof value.font_id === "string" &&
      /^font-[a-zA-Z0-9-]{8,80}$/.test(value.font_id)
        ? value.font_id
        : "",
  };
}
export const resolveTheme = (theme, systemDark) =>
  theme === "system"
    ? systemDark
      ? "dark"
      : "light"
    : theme === "midnight"
      ? "dark"
      : theme === "paper"
        ? "light"
        : theme;
export function appearanceAttributes(value, systemDark) {
  const prefs = normalizeAppearance(value);
  return {
    theme: resolveTheme(prefs.theme, systemDark),
    palette: prefs.theme,
    accent: prefs.accent,
    density: prefs.density,
    fontScale: String(prefs.font_scale),
  };
}

/** 用户修改使旧读取失效，避免慢网络响应把新主题和本机缓存改回旧值。 */
export function createAppearanceCoordinator(apply) {
  let generation = 0;
  return {
    change(value) {
      generation += 1;
      apply(normalizeAppearance(value));
    },
    invalidate() {
      generation += 1;
    },
    async load(read) {
      const started = generation;
      const value = await read();
      if (started !== generation) return false;
      apply(normalizeAppearance(value));
      return true;
    },
  };
}
