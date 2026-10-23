import plugins from "./plugins.mjs";
import { requireValue } from "./repository.mjs";
/** 备份同网络输入一样不可信；先验证所有引用，再允许成为本机正式记录。 */
export function validateDetail(d) {
  const fail = (message) =>
    requireValue(false, message || "任务字段或来源引用无效");
  const text = (v, max = 20000) => typeof v === "string" && v.length <= max;
  const id = (v) => text(v, 100) && v.length > 0;
  if (
    !d ||
    !d.task ||
    !id(d.task.id) ||
    !text(d.task.title, 120) ||
    !d.task.title.trim()
  )
    fail();
  const limits = {
    checkpoints: 2000,
    cards: 5000,
    jobs: 5000,
    resources: 100,
    sessions: 5000,
    events: 10000,
  };
  const maps = {};
  for (const [key, max] of Object.entries(limits)) {
    if (!Array.isArray(d[key]) || d[key].length > max) fail();
    maps[key] = new Map(d[key].map((item) => [item.id, item]));
    if (maps[key].size !== d[key].length || d[key].some((item) => !id(item.id)))
      fail("记录存在重复或无效编号");
  }
  const t = d.task,
    plugin = plugins.find((p) => p.id === t.plugin_id);
  if (!plugin) fail("未知插件");
  function snapshot(p) {
    if (!p || typeof p !== "object") fail();
    const lengths = {
      current_step: 10000,
      next_action: 10000,
      position: 2000,
      completed: 20000,
      thought: 20000,
      attempts: 20000,
      blocker: 10000,
      notes: 30000,
    };
    for (const [key, max] of Object.entries(lengths))
      if (!text(p[key] || "", max)) fail("记录长度或格式无效");
    if (
      !p.domain_data ||
      Object.entries(p.domain_data).some(
        ([key, value]) =>
          !plugin.fields.some((f) => f.key === key) || !text(value, 30000),
      )
    )
      fail("插件记录无效");
    if (p.resource_ids?.some((r) => !maps.resources.has(r)))
      fail("材料来源引用无效");
  }
  snapshot(t.draft);
  if (
    !Array.isArray(t.steps) ||
    t.steps.length > 50 ||
    t.steps.some(
      (s) => !id(s.id) || !text(s.title, 300) || typeof s.done !== "boolean",
    )
  )
    fail("任务步骤无效");
  if (
    !["todo", "active", "paused", "blocked", "done", "archived"].includes(
      t.status,
    ) ||
    !Number.isInteger(t.revision) ||
    t.revision < 0
  )
    fail();
  for (const cp of d.checkpoints) {
    if (
      cp.task_id !== t.id ||
      cp.plugin_id !== t.plugin_id ||
      (cp.session_id && !maps.sessions.has(cp.session_id))
    )
      fail("中断来源引用无效");
    snapshot(cp.payload);
  }
  for (const s of d.sessions)
    if (
      s.task_id !== t.id ||
      (s.source_checkpoint_id && !maps.checkpoints.has(s.source_checkpoint_id))
    )
      fail("会话来源引用无效");
  for (const j of d.jobs)
    if (
      !maps.checkpoints.has(j.checkpoint_id) ||
      !text(j.prompt, 2000000) ||
      (j.raw_output != null && !text(j.raw_output, 60000))
    )
      fail("AI来源引用无效");
  for (const c of d.cards) {
    if (
      !maps.checkpoints.has(c.checkpoint_id) ||
      (c.job_id && maps.jobs.get(c.job_id)?.checkpoint_id !== c.checkpoint_id)
    )
      fail("续学卡来源引用无效");
    if (
      !Array.isArray(c.content?.source_ids) ||
      !c.content.source_ids.length ||
      c.content.source_ids.some((source) => source !== c.checkpoint_id)
    )
      fail("确认卡来源引用无效");
    for (const key of ["summary", "blocker", "next_action", "warmup"])
      if (!text(c.content[key] || "", key === "summary" ? 60000 : 20000))
        fail("续学卡格式无效");
  }
  for (const e of d.events)
    if (!maps.sessions.has(e.session_id) || e.task_id !== t.id)
      fail("事件引用无效");
  for (const r of d.resources)
    if (
      !text(r.filename, 200) ||
      !Number.isInteger(r.size) ||
      r.size < 0 ||
      !/^[a-f0-9]{64}$/.test(r.sha256)
    )
      fail("材料元数据无效");
  if (t.session && !maps.sessions.has(t.session.id)) fail("活动会话引用无效");
  return d;
}
