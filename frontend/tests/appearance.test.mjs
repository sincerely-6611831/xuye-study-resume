import { test } from "node:test";
import assert from "node:assert/strict";
import {
  normalizeAppearance,
  resolveTheme,
  appearanceAttributes,
  createAppearanceCoordinator,
} from "../src/settings/appearance.mjs";

test("跟随系统在深色系统下使用深色，显式浅色不受系统影响", () => {
  assert.equal(resolveTheme("system", true), "dark");
  assert.equal(resolveTheme("light", true), "light");
  assert.equal(resolveTheme("system", false), "light");
});
test("损坏或旧缓存回到有效默认值，完整配置产生全局外观参数", () => {
  assert.deepEqual(
    normalizeAppearance({ theme: "bad", accent: "blue", font_size: 999 }),
    {
      theme: "light",
      accent: "blue",
      font_size: "medium",
      density: "comfortable",
      font_scale: 1,
      font_family: "system",
      font_id: "",
    },
  );
  const attrs = appearanceAttributes(
    { theme: "dark", accent: "violet", font_size: "large", density: "compact" },
    false,
  );
  assert.equal(attrs.theme, "dark");
  assert.equal(attrs.fontScale, "1.13");
  assert.equal(attrs.density, "compact");
});

test("较晚返回的登录设置不能覆盖用户刚修改的外观，旧账号加载也可失效", async () => {
  let visible;
  const coordinator = createAppearanceCoordinator((value) => {
    visible = value;
  });
  let finish;
  const pending = coordinator.load(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  coordinator.change({ theme: "dark", accent: "blue" });
  finish({ theme: "light" });
  assert.equal(await pending, false);
  assert.equal(visible.theme, "dark");
  const stale = coordinator.load(() => Promise.resolve({ theme: "light" }));
  coordinator.invalidate();
  assert.equal(await stale, false);
  assert.equal(visible.accent, "blue");
});
