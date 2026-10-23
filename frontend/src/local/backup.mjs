import { zipSync, unzipSync, strToU8, strFromU8 } from "fflate";
import { LocalRepository, requireValue } from "./repository.mjs";
import { forkRecord, packBundle, unpackBundle } from "./bundles.mjs";
import { currentUserId } from "./sync.mjs";
import { atomicRecords } from "../sync/storage.mjs";

/** 大备份按任务分卷，每卷均满足导入的50MB/解压100MB限制。 */
export function backupChunks(bundles, limit = 48 * 1024 * 1024) {
  const chunks = [];
  let group = [],
    size = 0;
  for (const bundle of bundles) {
    const bytes = strToU8(JSON.stringify(bundle)).length;
    requireValue(
      bytes + 1024 < limit,
      "单个任务超过备份容量，请先精简该任务的附件或历史记录。",
    );
    if (group.length && size + bytes + 1024 > limit) {
      chunks.push(group);
      group = [];
      size = 0;
    }
    group.push(bundle);
    size += bytes;
  }
  if (group.length || !chunks.length) chunks.push(group);
  return chunks;
}

export function downloadBlob(blob, name) {
  const url = URL.createObjectURL(blob),
    link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
export async function downloadResource(id) {
  const records = await new LocalRepository(currentUserId()).list();
  const record = records.find((r) => r.files[id]);
  requireValue(record, "本机没有这份材料");
  const meta = record.detail.resources.find((r) => r.id === id);
  downloadBlob(record.files[id], meta.filename);
}
export async function downloadBackup(format) {
  const repo = new LocalRepository(currentUserId());
  const records = await Promise.all(
    (await repo.list()).map((r) => repo.effective(r.detail.task.id)),
  );
  const bundles = await Promise.all(records.map(packBundle));
  if (format === "markdown") {
    const text = records
      .map(
        (r) =>
          "# " +
          r.detail.task.title +
          "\n\n" +
          r.detail.checkpoints
            .map(
              (cp) =>
                "## " +
                cp.created_at +
                "\n" +
                Object.entries(cp.payload)
                  .map(([k, v]) => k + ": " + JSON.stringify(v))
                  .join("\n"),
            )
            .join("\n\n") +
          "\n\n" +
          r.detail.jobs
            .map((j) => "### AI原文\n" + (j.raw_output || ""))
            .join("\n"),
      )
      .join("\n\n");
    downloadBlob(new Blob([text], { type: "text/markdown" }), "study-local.md");
    return;
  }
  const chunks = backupChunks(bundles);
  for (let i = 0; i < chunks.length; i++) {
    const text = JSON.stringify({
      schema_version: 2,
      exported_at: new Date().toISOString(),
      bundles: chunks[i],
    });
    const name = "study-local" + (chunks.length > 1 ? "-part-" + (i + 1) : "");
    if (format === "zip") {
      const zip = zipSync({ "local-backup.json": strToU8(text) }, { level: 3 });
      downloadBlob(new Blob([zip]), name + ".zip");
    } else
      downloadBlob(
        new Blob([text], { type: "application/json" }),
        name + ".json",
      );
  }
}
export async function restoreBackup(file) {
  const restoringUser = currentUserId();
  requireValue(file.size <= 50 * 1024 * 1024, "备份最多50MB");
  let data, legacyFiles;
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (file.name.toLowerCase().endsWith(".zip")) {
      let size = 0;
      legacyFiles = unzipSync(bytes, {
        filter: (entry) => {
          size += entry.originalSize;
          requireValue(size <= 100 * 1024 * 1024, "备份解压后过大");
          return true;
        },
      });
      data = JSON.parse(
        strFromU8(
          legacyFiles["local-backup.json"] || legacyFiles["backup.json"],
        ),
      );
    } else data = JSON.parse(strFromU8(bytes));
  } catch {
    throw new Error("备份格式无效或解压后超过100MB，请选择本应用导出的备份。");
  }
  let records;
  if (data.schema_version === 2) {
    requireValue(
      Array.isArray(data.bundles) && data.bundles.length <= 500,
      "备份任务数量无效",
    );
    records = data.bundles.map(unpackBundle);
  } else if (data.schema_version === 1) {
    requireValue(
      Array.isArray(data.tasks) && data.tasks.length <= 500,
      "旧版备份无效",
    );
    records = data.tasks.map((detail) => {
      const files = {};
      for (const r of detail.resources) {
        const bytes = legacyFiles?.["resources/" + r.id];
        requireValue(bytes, "旧版JSON没有附件，请选择完整ZIP");
        files[r.id] = new Blob([bytes]);
      }
      return {
        detail,
        files,
        dirty: true,
        base_revision: null,
        local_version: 1,
        receipts: {},
      };
    });
  } else throw new Error("不支持此备份版本");
  const repo = new LocalRepository(restoringUser);
  // 旧ZIP也经过同一校验；所有任务验证完才进入一笔原子写入。
  const verified = await Promise.all(
    records.map(async (record) => unpackBundle(await packBundle(record))),
  );
  const copies = verified.map((record) => forkRecord(record, "（恢复副本）"));
  requireValue(
    currentUserId() === restoringUser,
    "恢复期间账号已切换，请重新选择备份。",
    409,
  );
  if (copies.length)
    await atomicRecords([repo.prefix + copies[0].detail.task.id], () => ({
      writes: copies.map((record) => [
        repo.prefix + record.detail.task.id,
        record,
      ]),
    }));
  return { imported: records.length };
}
