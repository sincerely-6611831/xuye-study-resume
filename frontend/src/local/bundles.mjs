import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { newId, now, requireValue } from "./repository.mjs";
import { validateDetail } from "./validate.mjs";
export const hashBytes = (bytes) => bytesToHex(sha256(bytes));
function encode(bytes) {
  let text = "";
  for (let i = 0; i < bytes.length; i += 8192)
    text += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(text);
}
function decode(text) {
  return Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
}
export async function packBundle(record) {
  const files = [];
  for (const r of record.detail.resources) {
    const blob = record.files[r.id];
    requireValue(blob, "材料未完整保存在本机，请先从旧版服务导入完整记录。");
    files.push({
      id: r.id,
      data: encode(new Uint8Array(await blob.arrayBuffer())),
    });
  }
  return { detail: structuredClone(record.detail), files };
}
export function unpackBundle(bundle) {
  requireValue(
    bundle && bundle.detail?.task?.id && Array.isArray(bundle.files),
    "无效任务数据包",
  );
  const detail = structuredClone(bundle.detail),
    files = {};
  validateDetail(detail);
  let total = 0;
  requireValue(
    !bundle.settings && !bundle.api_key,
    "学习数据包不能包含模型密钥",
  );
  for (const r of detail.resources) {
    const item = bundle.files.find((f) => f.id === r.id);
    requireValue(item && typeof item.data === "string", "材料不完整");
    const bytes = decode(item.data);
    total += bytes.length;
    requireValue(
      bytes.length <= 10 * 1024 * 1024 &&
        total <= 100 * 1024 * 1024 &&
        bytes.length === r.size &&
        hashBytes(bytes) === r.sha256,
      "材料大小或校验和无效",
    );
    files[r.id] = new Blob([bytes]);
  }
  requireValue(
    Object.keys(files).length === bundle.files.length,
    "材料列表不一致",
  );
  return {
    detail,
    files,
    dirty: false,
    base_revision: null,
    local_version: 1,
    receipts: {},
  };
}
/** 冲突或恢复时复制整套ID，AI提示词保留原文，来源映射保留旧快照ID。 */
export function forkRecord(record, suffix = "（本机保留副本）") {
  const copy = structuredClone(record),
    map = new Map();
  for (const entity of [
    copy.detail.task,
    ...copy.detail.task.steps,
    ...[
      "checkpoints",
      "cards",
      "jobs",
      "resources",
      "sessions",
      "events",
    ].flatMap((k) => copy.detail[k]),
  ])
    if (entity.id) map.set(entity.id, newId());
  const idFields = new Set([
    "id",
    "task_id",
    "checkpoint_id",
    "job_id",
    "session_id",
    "source_checkpoint_id",
    "resource_ids",
    "source_ids",
  ]);
  const rewrite = (value, field = "") => {
    if (Array.isArray(value)) return value.map((item) => rewrite(item, field));
    if (value && typeof value === "object")
      return Object.fromEntries(
        Object.entries(value).map(([key, v]) => [key, rewrite(v, key)]),
      );
    return idFields.has(field) && typeof value === "string" && map.has(value)
      ? map.get(value)
      : value;
  };
  copy.detail = rewrite(copy.detail);
  copy.detail.jobs.forEach((job) => {
    if (job.status === "running") {
      job.status = "interrupted";
      job.error = "生成期间保留了任务副本，迟到结果将另存为结果副本。";
    }
  });
  copy.files = Object.fromEntries(
    Object.entries(record.files).map(([id, blob]) => [map.get(id) || id, blob]),
  );
  copy.detail.checkpoints.forEach((cp, index) => {
    cp.payload.origin_checkpoint_ids = [
      record.detail.checkpoints[index].id,
      ...(record.detail.checkpoints[index].payload.origin_checkpoint_ids || []),
    ];
  });
  copy.detail.task.title = copy.detail.task.title.slice(0, 100) + suffix;
  copy.detail.task.session = null;
  copy.detail.sessions.forEach((s) => {
    s.ended_at ||= now();
  });
  if (copy.detail.task.status === "active")
    copy.detail.task.status = copy.detail.checkpoints.length
      ? "paused"
      : "todo";
  copy.detail.task.revision = 0;
  copy.detail.task.updated_at = now();
  copy.base_revision = null;
  copy.local_version = 1;
  copy.dirty = true;
  copy.receipts = {};
  return copy;
}
