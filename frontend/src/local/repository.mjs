import {
  readLocal,
  writeLocal,
  updateLocal,
  listLocal,
  atomicRecords,
} from "../sync/storage.mjs";

export const newId = () =>
  globalThis.crypto?.randomUUID?.() ||
  Date.now().toString(36) + "-" + Math.random().toString(36).slice(2);
export const now = () => new Date().toISOString();
export class LocalError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
export const requireValue = (condition, message, status = 422) => {
  if (!condition) throw new LocalError(status, message);
};
export const emptySnapshot = () => ({
  current_step: "",
  next_action: "",
  thought: "",
  position: "",
  completed: "",
  attempts: "",
  blocker: "",
  notes: "",
  reason: "time_limit",
  domain_data: {},
});
export class LocalRepository {
  constructor(userId) {
    this.userId = userId;
    this.prefix = userId + ":local:task:";
  }
  async list() {
    return (await listLocal(this.prefix)).sort((a, b) =>
      b.detail.task.updated_at.localeCompare(a.detail.task.updated_at),
    );
  }
  async get(id) {
    const record = await readLocal(this.prefix + id);
    requireValue(record, "本机没有这个任务，请在数据与同步中接收。", 404);
    return record;
  }
  async effective(id) {
    return atomicRecords(
      [this.prefix + id, this.userId + ":draft:" + id],
      ([record, draft]) => {
        requireValue(record, "本机任务不存在", 404);
        if (
          draft?.dirty &&
          JSON.stringify(record.detail.task.draft) !==
            JSON.stringify(draft.payload)
        ) {
          record.detail.task.draft = structuredClone(draft.payload);
          record.dirty = true;
          record.local_version++;
          record.detail.task.updated_at = now();
        }
        return { writes: [[this.prefix + id, record]], result: record };
      },
    );
  }
  async put(record) {
    await writeLocal(this.prefix + record.detail.task.id, record);
    return record;
  }
  async mutate(id, action) {
    let value;
    await updateLocal(this.prefix + id, (record) => {
      requireValue(record, "本机任务不存在", 404);
      value = action(record);
      record.local_version = (record.local_version || 0) + 1;
      record.dirty = true;
      record.detail.task.updated_at = now();
      return record;
    });
    return value;
  }
  async create(body) {
    requireValue(
      typeof body.title === "string" &&
        body.title.trim() &&
        body.title.length <= 120,
      "请填写有效任务名称",
    );
    const id = newId();
    const task = {
      id,
      title: body.title.trim(),
      course: body.course || "",
      goal: body.goal || "",
      plugin_id: body.plugin_id || "general",
      status: "todo",
      stage: "准备开始",
      revision: 0,
      updated_at: now(),
      draft: emptySnapshot(),
      session: null,
      steps: (body.steps || []).map((title) => ({
        id: newId(),
        title,
        done: false,
      })),
    };
    const detail = {
      task,
      checkpoints: [],
      cards: [],
      jobs: [],
      resources: [],
      sessions: [],
      events: [],
    };
    await this.put({
      detail,
      files: {},
      dirty: true,
      base_revision: null,
      local_version: 1,
      receipts: {},
    });
    return task;
  }
}
