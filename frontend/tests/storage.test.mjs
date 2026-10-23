import { test } from "node:test";
import assert from "node:assert/strict";
import "fake-indexeddb/auto";
import {
  readLocal,
  writeLocal,
  removeLocal,
  listPending,
  localKey,
} from "../src/sync/storage.mjs";

test("本机草稿经过重新读取仍完整，其他账号不能混用同一任务缓存", async () => {
  await writeLocal(localKey("alice", "draft", "task1"), {
    thought: "先换元",
    revision: 3,
  });
  assert.deepEqual(await readLocal(localKey("alice", "draft", "task1")), {
    thought: "先换元",
    revision: 3,
  });
  assert.equal(await readLocal(localKey("bob", "draft", "task1")), undefined);
});

test("重试队列同一request_id只保留一份，成功删除不影响其他账号", async () => {
  const a = localKey("alice", "pending", "r1");
  const b = localKey("bob", "pending", "r1");
  await writeLocal(a, { request_id: "r1", task_id: "task1" });
  await writeLocal(a, { request_id: "r1", task_id: "task1" });
  await writeLocal(b, { request_id: "r1", task_id: "task2" });
  assert.equal((await listPending("alice")).length, 1);
  await removeLocal(a);
  assert.equal((await listPending("alice")).length, 0);
  assert.equal((await listPending("bob")).length, 1);
});
