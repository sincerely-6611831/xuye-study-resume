import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { parseGuide } from "../src/settings/guide-markdown.mjs";

test("Markdown手册覆盖所有主要操作，目录和正文直接从文件生成", async () => {
  const markdown = await readFile(
    new URL("../src/settings/guide.md", import.meta.url),
    "utf8",
  );
  const chapters = parseGuide(markdown);
  assert.ok(chapters.length >= 17);
  assert.equal(chapters[0].title, "续页 · 完整使用手册");
  for (const phrase of [
    "总览",
    "学习分析",
    "中断",
    "语音",
    "续学卡",
    "模型",
    "插件",
    "自建服务器",
    "ZIP",
    "外观",
    "字体",
    "账号",
    "Windows",
    "Android",
    "手表",
  ])
    assert.ok(markdown.includes(phrase), `缺少${phrase}`);
  assert.ok(chapters.every((chapter) => chapter.blocks.length > 0));
});

test("跨设备迁移只展示自建服务器和完整 ZIP 两条路径", async () => {
  const { syncMethods } = await import("../src/settings/guide.mjs");
  assert.deepEqual(
    syncMethods.map((method) => method.id),
    ["server", "zip"],
  );
  assert.ok(syncMethods.every((method) => method.title && method.summary));
});

test("连接自建服务器只接受完整的 HTTP(S) 根地址", async () => {
  const { normalizeServerUrl } = await import("../src/settings/guide.mjs");
  assert.equal(
    normalizeServerUrl("https://study.example.com/"),
    "https://study.example.com/",
  );
  assert.equal(
    normalizeServerUrl("http://192.168.1.10:18461"),
    "http://192.168.1.10:18461/",
  );
  for (const value of [
    "file:///tmp/x",
    "https://user:pass@host/",
    "https://host/path",
    "https://host/?token=x",
    "not-a-url",
  ])
    assert.throws(() => normalizeServerUrl(value));
});
