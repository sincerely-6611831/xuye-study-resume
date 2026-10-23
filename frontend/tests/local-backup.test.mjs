import test from "node:test";
import assert from "node:assert/strict";
import "fake-indexeddb/auto";
import { zipSync, strToU8 } from "fflate";
import { LocalRepository } from "../src/local/repository.mjs";
import { restoreBackup } from "../src/local/backup.mjs";
import { hashBytes } from "../src/local/bundles.mjs";
const store = new Map([
  ["study-last-user", JSON.stringify({ id: "restore-user" })],
]);
globalThis.localStorage = { getItem: (key) => store.get(key) || null };
test("旧版ZIP也必须验证附件校验和，失败时不恢复部分任务", async () => {
  const repo = new LocalRepository("old-zip-source");
  const task = await repo.create({ title: "旧版任务" });
  const record = await repo.get(task.id);
  record.detail.resources = [
    {
      id: "file-1",
      filename: "note.txt",
      size: 2,
      sha256: hashBytes(strToU8("ok")),
    },
  ];
  const bytes = zipSync({
    "backup.json": strToU8(
      JSON.stringify({ schema_version: 1, tasks: [record.detail] }),
    ),
    "resources/file-1": strToU8("xx"),
  });
  await assert.rejects(
    () => restoreBackup(new File([bytes], "old.zip")),
    /校验/,
  );
  assert.equal((await new LocalRepository("restore-user").list()).length, 0);
});
test("当前ZIP恢复保留文件、追加副本且不会带入配置和密钥", async () => {
  const repo = new LocalRepository("zip-source"),
    task = await repo.create({ title: "备份往返" }),
    record = await repo.get(task.id);
  const bundle = { detail: record.detail, files: [] };
  const bytes = zipSync({
    "local-backup.json": strToU8(
      JSON.stringify({ schema_version: 2, bundles: [bundle] }),
    ),
  });
  const result = await restoreBackup(new File([bytes], "local.zip"));
  assert.equal(result.imported, 1);
  const restored = (await new LocalRepository("restore-user").list())[0];
  assert.notEqual(restored.detail.task.id, task.id);
  assert.equal(restored.detail.task.title, "备份往返（恢复副本）");
  assert.equal(restored.encrypted_key, undefined);
});
