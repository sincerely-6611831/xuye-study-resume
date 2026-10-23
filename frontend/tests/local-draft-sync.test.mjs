import test from "node:test";
import assert from "node:assert/strict";
import "fake-indexeddb/auto";
import { LocalRepository } from "../src/local/repository.mjs";
import { writeLocal, readLocal } from "../src/sync/storage.mjs";
import { packBundle } from "../src/local/bundles.mjs";
import { pushRecord, pullRecord } from "../src/local/sync.mjs";
test("未按保存按钮的本机自动草稿也必须包含在上传中", async () => {
  const repo = new LocalRepository("draft-sync");
  const t = await repo.create({ title: "未同步输入" });
  await writeLocal("draft-sync:draft:" + t.id, {
    dirty: true,
    revision: 0,
    payload: { current_step: "刚输入", next_action: "继续", domain_data: {} },
  });
  let sent;
  await pushRecord(repo, t.id, async (path, options) => {
    sent = JSON.parse(options.body);
    return { revision: 1 };
  });
  assert.equal(sent.bundle.detail.task.draft.current_step, "刚输入");
});
test("接收期间新增的本机编辑和自动草稿都进入保留副本，而非被覆盖", async () => {
  const repo = new LocalRepository("pull-race");
  const t = await repo.create({ title: "原任务" });
  const bundle = await packBundle(await repo.get(t.id));
  let finish;
  const pending = pullRecord(
    repo,
    t.id,
    () => new Promise((resolve) => (finish = resolve)),
  );
  await writeLocal("pull-race:draft:" + t.id, {
    dirty: true,
    revision: 0,
    payload: { thought: "接收期间新输入", domain_data: {} },
  });
  finish({ revision: 2, bundle });
  await pending;
  const copy = (await repo.list()).find((r) => r.detail.task.id !== t.id);
  assert.equal(copy.detail.task.draft.thought, "接收期间新输入");
  assert.equal(await readLocal("pull-race:draft:" + t.id), undefined);
  assert.ok((await repo.get(t.id)).detail.task.revision > 0);
});
