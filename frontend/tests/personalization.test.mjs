import test from "node:test";
import assert from "node:assert/strict";
import "fake-indexeddb/auto";
import { zipSync, unzipSync, strToU8, strFromU8 } from "fflate";
import { createLocalHandler } from "../src/local/adapter.mjs";
import { LocalRepository } from "../src/local/repository.mjs";
import { packBundle, unpackBundle } from "../src/local/bundles.mjs";
import { customPlugins } from "../src/local/custom-plugins.mjs";
import { downloadBackup, restoreBackup } from "../src/local/backup.mjs";
import {
  exportPersonalization,
  validatePersonalization,
} from "../src/local/personalization.mjs";
import { addFont, listFonts } from "../src/local/fonts.mjs";
import { writeLocal, readLocal } from "../src/sync/storage.mjs";
import { buildAnalytics } from "../src/analytics/metrics.mjs";

const noNetwork = async () => {
  throw new Error("测试禁止网络");
};
const call = (handle, path, body, method = "POST") =>
  handle(path, { method, body: JSON.stringify(body) });

test("自定义插件可创建并用于任务和中断，任务数据包带定义；使用中的插件不能删除", async () => {
  const user = "custom-test";
  const handle = createLocalHandler(user, noNetwork, { skipMigration: true });
  const plugin = await call(handle, "/plugins", {
    name: "听力",
    description: "记录听力疑问",
    warmup: "上次没听懂哪句？",
    fields: [{ key: "sentence", label: "关键句", hint: "写下原句" }],
  });
  const task = await call(handle, "/tasks", {
    title: "英语听力",
    plugin_id: plugin.id,
  });
  const started = await call(handle, `/tasks/${task.id}/start`, {
    expected_revision: 0,
    device_id: "test",
  });
  const paused = await call(handle, `/tasks/${task.id}/pause`, {
    expected_revision: started.revision,
    session_id: started.session.id,
    request_id: "one",
    payload: {
      current_step: "听到第二段",
      next_action: "重听",
      domain_data: { sentence: "hello" },
    },
  });
  assert.equal(paused.checkpoint.payload.domain_data.sentence, "hello");
  await assert.rejects(
    () => call(handle, `/plugins/${plugin.id}`, {}, "DELETE"),
    /不能删除/,
  );
  const bundle = await packBundle(
    await new LocalRepository(user).get(task.id),
    plugin,
  );
  assert.equal(unpackBundle(bundle).plugin.name, "听力");
  assert.equal((await customPlugins(user)).length, 1);
});

test("个性化ZIP恢复主题、模型配置、插件和字体，但不恢复密钥", async () => {
  const source = "personal-source",
    target = "personal-target";
  const fontBytes = new Uint8Array([119, 79, 70, 50, 1, 2, 3, 4]);
  const font = await addFont(source, new File([fontBytes], "mine.woff2"));
  await writeLocal(`${source}:local:settings`, {
    version: "1.4.0",
    appearance: {
      theme: "paper",
      accent: "rose",
      font_size: "medium",
      font_scale: 1.08,
      font_family: "custom",
      font_id: font.id,
      density: "compact",
    },
    ai: {
      default_provider: "http_provider",
      active_profile_id: "model-1",
      profiles: [
        {
          id: "model-1",
          name: "本机模型",
          api_url: "http://localhost:11434/v1/chat/completions",
          model: "local",
          timeout: 30,
          encrypted_key: "secret-cipher",
        },
      ],
    },
    speech: {
      enabled: false,
      api_url: "",
      model: "",
      language: "zh",
      timeout: 60,
      summary_profile_id: null,
      encrypted_key: "voice-cipher",
    },
  });
  const handle = createLocalHandler(source, noNetwork, { skipMigration: true });
  const plugin = await call(handle, "/plugins", {
    name: "实验",
    description: "记录实验进度",
    warmup: "上次做了什么？",
    fields: [{ key: "result", label: "结果", hint: "" }],
  });
  const task = await call(handle, "/tasks", {
    title: "实验",
    plugin_id: plugin.id,
  });
  const personalization = await exportPersonalization(source);
  const archive = JSON.stringify({
    schema_version: 3,
    personalization,
    bundles: [
      await packBundle(await new LocalRepository(source).get(task.id), plugin),
    ],
  });
  assert.ok(
    !archive.includes("secret-cipher") && !archive.includes("voice-cipher"),
  );
  const oldLocalStorage = globalThis.localStorage;
  globalThis.localStorage = { getItem: () => JSON.stringify({ id: target }) };
  try {
    const result = await restoreBackup(
      new File(
        [zipSync({ "local-backup.json": strToU8(archive) })],
        "backup.zip",
      ),
    );
    assert.equal(result.imported, 1);
    assert.equal(result.personalization, true);
    assert.equal(
      (await readLocal(`${target}:local:settings`)).appearance.theme,
      "paper",
    );
    assert.equal(
      (await readLocal(`${target}:local:settings`)).ai.profiles[0]
        .encrypted_key,
      "",
    );
    assert.equal((await listFonts(target))[0].sha256, font.sha256);
    assert.equal((await customPlugins(target))[0].id, plugin.id);
    assert.equal((await new LocalRepository(target).list()).length, 1);
  } finally {
    globalThis.localStorage = oldLocalStorage;
  }
});

test("个性化校验拒绝密钥和损坏字体，不产生部分恢复", async () => {
  const source = "bad-personal",
    target = "bad-target";
  const prefs = await exportPersonalization(source);
  prefs.ai.profiles = [
    {
      id: "x",
      name: "x",
      api_url: "https://example.com/v1",
      model: "x",
      timeout: 30,
      api_key: "bad",
    },
  ];
  prefs.ai.active_profile_id = "x";
  assert.throws(() => validatePersonalization(prefs), /密钥/);
  const oldLocalStorage = globalThis.localStorage;
  globalThis.localStorage = { getItem: () => JSON.stringify({ id: target }) };
  try {
    const archive = JSON.stringify({
      schema_version: 3,
      personalization: prefs,
      bundles: [],
    });
    await assert.rejects(
      () =>
        restoreBackup(
          new File(
            [zipSync({ "local-backup.json": strToU8(archive) })],
            "bad.zip",
          ),
        ),
      /密钥/,
    );
    assert.equal(await readLocal(`${target}:local:settings`), undefined);
  } finally {
    globalThis.localStorage = oldLocalStorage;
  }
});

test("实际导出的ZIP为第三版并带个性化内容", async () => {
  const user = "zip-export-test";
  await new LocalRepository(user).create({ title: "导出任务" });
  const original = {
    localStorage: globalThis.localStorage,
    window: globalThis.window,
    document: globalThis.document,
    createObjectURL: URL.createObjectURL,
    revokeObjectURL: URL.revokeObjectURL,
    setTimeout: globalThis.setTimeout,
  };
  const blobs = [];
  globalThis.localStorage = { getItem: () => JSON.stringify({ id: user }) };
  globalThis.window = {};
  globalThis.document = { createElement: () => ({ click() {} }) };
  URL.createObjectURL = (blob) => {
    blobs.push(blob);
    return "blob:test";
  };
  URL.revokeObjectURL = () => {};
  globalThis.setTimeout = (callback) => {
    callback();
    return 0;
  };
  try {
    await downloadBackup("zip");
    assert.equal(blobs.length, 1);
    const zip = unzipSync(new Uint8Array(await blobs[0].arrayBuffer()));
    const archive = JSON.parse(strFromU8(zip["local-backup.json"]));
    assert.equal(archive.schema_version, 3);
    assert.equal(archive.bundles.length, 1);
    assert.ok(archive.personalization.appearance);
    assert.ok(Array.isArray(archive.personalization.plugins));
  } finally {
    globalThis.localStorage = original.localStorage;
    globalThis.window = original.window;
    globalThis.document = original.document;
    URL.createObjectURL = original.createObjectURL;
    URL.revokeObjectURL = original.revokeObjectURL;
    globalThis.setTimeout = original.setTimeout;
  }
});

test("导出期间切换账号不会把前一个账号的数据交给新账号下载", async () => {
  const old = globalThis.localStorage;
  let calls = 0;
  globalThis.localStorage = {
    getItem: () =>
      JSON.stringify({ id: ++calls === 1 ? "export-a" : "export-b" }),
  };
  try {
    await assert.rejects(() => downloadBackup("zip"), /账号已切换/);
  } finally {
    globalThis.localStorage = old;
  }
});

test("学习图表按本地日期计数且空数据不估算时长", () => {
  const task = {
    id: "t",
    title: "数学",
    plugin_id: "math",
    status: "paused",
    steps: [{ done: true }, { done: false }],
  };
  const details = [
    {
      task,
      checkpoints: [
        {
          id: "cp",
          created_at: "2026-10-24T09:00:00+08:00",
          payload: { current_step: "第二题" },
        },
      ],
      sessions: [{ id: "s", started_at: "2026-10-24T08:00:00+08:00" }],
    },
  ];
  const metrics = buildAnalytics(
    [task],
    details,
    14,
    new Date("2026-10-24T12:00:00+08:00"),
  );
  assert.equal(typeof metrics.timeline.at(-1).day, "string");
  assert.equal(metrics.timeline.at(-1).checkpoints, 1);
  assert.equal(metrics.timeline.at(-1).sessions, 1);
  assert.equal(metrics.timeline.at(-1).items[0].note, "第二题");
  assert.equal(metrics.doneSteps, 1);
  assert.equal(buildAnalytics([], [], 14).totalCheckpoints, 0);
  assert.throws(
    () => buildAnalytics([], [], 14, new Date("invalid")),
    /分析日期/,
  );
});
