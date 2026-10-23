import test from "node:test";
import assert from "node:assert/strict";
import "fake-indexeddb/auto";
import { LocalRepository } from "../src/local/repository.mjs";
import { createLocalHandler } from "../src/local/adapter.mjs";
import { packBundle, unpackBundle, forkRecord } from "../src/local/bundles.mjs";
import { pushRecord, pullRecord } from "../src/local/sync.mjs";

const noNetwork = async () => {
  throw new Error("测试禁止网络");
};
const setup = (id) =>
  createLocalHandler(id, noNetwork, { skipMigration: true });
const call = (handler, path, body, method = "POST") =>
  handler(path, { method, body: JSON.stringify(body) });
test("断网也可新建任务、开始、存草稿、暂停；暂停幂等且账号隔离", async () => {
  const h = setup("local-a"),
    other = setup("local-b");
  const t = await call(h, "/tasks", {
    title: "本机数学",
    plugin_id: "math",
    steps: ["计算"],
  });
  const started = await call(h, `/tasks/${t.id}/start`, {
    expected_revision: 0,
    device_id: "device",
  });
  const body = {
    expected_revision: started.revision,
    session_id: started.session.id,
    request_id: "p1",
    payload: {
      current_step: "第三题",
      next_action: "比较方法",
      reason: "time_limit",
      domain_data: { conditions: "x>0" },
    },
  };
  const paused = await call(h, `/tasks/${t.id}/pause`, body);
  assert.equal(paused.task.status, "paused");
  assert.equal(
    (await call(h, `/tasks/${t.id}/pause`, body)).checkpoint.id,
    paused.checkpoint.id,
  );
  assert.equal((await h(`/tasks/${t.id}`)).checkpoints.length, 1);
  assert.equal((await other("/tasks")).length, 0);
  await assert.rejects(
    () =>
      call(
        h,
        `/tasks/${t.id}`,
        { expected_revision: 0, stage: "旧写入" },
        "PATCH",
      ),
    /版本/,
  );
});
test("本机附件Blob、手动AI原文和确认卡可离线保存，备份往返保留内容", async () => {
  const h = setup("local-files");
  let t = await call(h, "/tasks", { title: "附件任务" });
  t = await call(h, `/tasks/${t.id}/start`, {
    expected_revision: 0,
    device_id: "d",
  });
  const upload = new FormData();
  upload.set("file", new File(["本机附件"], "note.txt"));
  await h(`/tasks/${t.id}/resources`, { method: "POST", body: upload });
  const p = await call(h, `/tasks/${t.id}/pause`, {
    expected_revision: t.revision,
    session_id: t.session.id,
    request_id: "p",
    payload: { current_step: "看到第三页", next_action: "读第四页" },
  });
  const j = await call(h, `/checkpoints/${p.checkpoint.id}/ai-jobs`, {
    provider: "manual_lianxiaoli",
  });
  const imported = await call(h, `/ai-jobs/${j.id}/import`, {
    raw_text: "真实手动文本",
  });
  await call(h, `/cards/${imported.card.id}/accept`, {
    content: {
      summary: "人工确认摘要",
      next_action: "下一步",
      blocker: "",
      warmup: "",
    },
  });
  const repo = new LocalRepository("local-files"),
    rec = await repo.get(t.id);
  const unpacked = unpackBundle(await packBundle(rec));
  assert.equal(await Object.values(unpacked.files)[0].text(), "本机附件");
  assert.equal(unpacked.detail.jobs[0].raw_output, "真实手动文本");
  assert.equal(unpacked.detail.cards[0].status, "accepted");
  rec.detail.task.draft.notes = p.checkpoint.id;
  const fork = forkRecord(rec);
  assert.equal(fork.detail.task.draft.notes, p.checkpoint.id);
  assert.notEqual(fork.detail.task.id, t.id);
  assert.notEqual(fork.detail.checkpoints[0].id, p.checkpoint.id);
  assert.equal(
    fork.detail.cards[0].checkpoint_id,
    fork.detail.checkpoints[0].id,
  );
});
test("同步只在手动调用时发送；迟到上传不能清除较新编辑；接收先保留脏副本", async () => {
  const h = setup("local-sync");
  const t = await call(h, "/tasks", { title: "同步任务" });
  const repo = new LocalRepository("local-sync");
  let resolveUpload;
  const pending = pushRecord(
    repo,
    t.id,
    () =>
      new Promise((resolve) => {
        resolveUpload = resolve;
      }),
  );
  while (!resolveUpload) await new Promise((resolve) => setTimeout(resolve, 1));
  await call(
    h,
    `/tasks/${t.id}`,
    { expected_revision: 0, stage: "上传期间的新编辑" },
    "PATCH",
  );
  resolveUpload({ revision: 1 });
  await pending;
  assert.equal((await repo.get(t.id)).dirty, true);
  assert.equal((await repo.get(t.id)).base_revision, 1);
  const remote = await packBundle(await repo.get(t.id));
  remote.detail.task.title = "另一设备";
  const result = await pullRecord(repo, t.id, async () => ({
    revision: 2,
    bundle: remote,
  }));
  assert.equal(result.keptCopy, true);
  assert.equal((await repo.list()).length, 2);
  assert.equal((await repo.get(t.id)).detail.task.title, "另一设备");
});
