import test from "node:test";
import assert from "node:assert/strict";
import "fake-indexeddb/auto";
import { createLocalHandler } from "../src/local/adapter.mjs";
import { LocalRepository } from "../src/local/repository.mjs";
import { packBundle } from "../src/local/bundles.mjs";
import { pullRecord, pushRecord } from "../src/local/sync.mjs";
import { unpackBundle } from "../src/local/bundles.mjs";
import { backupChunks } from "../src/local/backup.mjs";
const call = (h, path, body) =>
  h(path, { method: "POST", body: JSON.stringify(body) });
test("同步绑定原账号，不随网络等待期间浏览器登录账号切换而混入其他账号", async () => {
  const repo = new LocalRepository("bound-a");
  const t = await repo.create({ title: "A私有记录" });
  let expected;
  await pushRecord(repo, t.id, async (p, o) => {
    expected = o.headers?.["X-Study-User"];
    return { revision: 1 };
  });
  assert.equal(expected, "bound-a");
});
test("迟到的接收响应不能降低已经推进的同步基准", async () => {
  const repo = new LocalRepository("stale-pull");
  const t = await repo.create({ title: "较新版本" });
  const old = await packBundle(await repo.get(t.id));
  let finish;
  const pending = pullRecord(
    repo,
    t.id,
    () => new Promise((resolve) => (finish = resolve)),
  );
  const current = await repo.get(t.id);
  current.base_revision = 3;
  current.dirty = false;
  await repo.put(current);
  finish({ revision: 1, bundle: old });
  await assert.rejects(() => pending, /较旧/);
  assert.equal((await repo.get(t.id)).base_revision, 3);
});
test("容量较大的备份自动分卷；来源不合法的确认卡不能从备份导入", async () => {
  const repo = new LocalRepository("backup-check"),
    t = await repo.create({ title: "校验" });
  const bundle = await packBundle(await repo.get(t.id));
  assert.ok(
    backupChunks(
      [bundle, bundle, bundle],
      new TextEncoder().encode(JSON.stringify(bundle)).length * 2 + 1200,
    ).length >= 2,
  );
  bundle.detail.cards = [
    {
      id: "forged",
      checkpoint_id: "missing",
      status: "accepted",
      content: { source_ids: ["missing"] },
    },
  ];
  assert.throws(() => unpackBundle(bundle), /来源|引用/);
});
test("AI生成期间接收旧版本后，迟到原文仍保存为副本，旧生成状态不会永久运行", async () => {
  let answer;
  const h = createLocalHandler(
    "ai-pull",
    async (path) => {
      if (path === "/local-ai/chat")
        return new Promise((resolve) => (answer = resolve));
      throw new Error("意外网络");
    },
    { skipMigration: true },
  );
  const t = await call(h, "/tasks", { title: "并发AI" }),
    repo = new LocalRepository("ai-pull");
  let s = await call(h, `/tasks/${t.id}/start`, {
    expected_revision: 0,
    device_id: "d",
  });
  const p = await call(h, `/tasks/${t.id}/pause`, {
    expected_revision: s.revision,
    session_id: s.session.id,
    request_id: "p",
    payload: { current_step: "进度", next_action: "行动" },
  });
  await call(h, "/settings/models", {
    name: "本地",
    api_url: "http://localhost:11434/v1/chat/completions",
    model: "local",
    timeout: 30,
  });
  const config = (await h("/settings")).ai.profiles[0];
  await h("/settings/ai", {
    method: "PUT",
    body: JSON.stringify({
      default_provider: "http_provider",
      active_profile_id: config.id,
    }),
  });
  const older = await packBundle(await repo.get(t.id));
  const pending = call(h, `/checkpoints/${p.checkpoint.id}/ai-jobs`, {
    provider: "http_provider",
  });
  while (!answer) await new Promise((resolve) => setTimeout(resolve, 1));
  await pullRecord(repo, t.id, async () => ({ revision: 1, bundle: older }));
  answer({ raw: "迟到但不能丢失的模型原文" });
  await pending;
  const jobs = (await repo.list()).flatMap((r) => r.detail.jobs);
  assert.equal(
    jobs.filter((j) => j.raw_output === "迟到但不能丢失的模型原文").length,
    1,
  );
  assert.equal(jobs.filter((j) => j.status === "running").length, 0);
});
