/** @typedef {{ id: string, task_id: string, title: string, time: string, kind: string, note: string }} ActivityItem */

const dayKey = (value) => {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
};

/** 图表完全从保存的断点和会话生成；未记录的数据不会估算成学习时长。 */
export function buildAnalytics(tasks, details, days = 14, today = new Date()) {
  const safeDays = days === 30 ? 30 : 14;
  const timeline = Array.from({ length: safeDays }, (_, index) => {
    const date = new Date(
      today.getFullYear(),
      today.getMonth(),
      today.getDate() - safeDays + index + 1,
    );
    const day = dayKey(date);
    // 时间轴日期由有效的本地日期构造；无效输入应立即报错而不是流入点击状态。
    if (day === null) throw new Error("无法生成学习分析日期");
    return {
      day,
      label: `${date.getMonth() + 1}/${date.getDate()}`,
      checkpoints: 0,
      sessions: 0,
      items: /** @type {ActivityItem[]} */ ([]),
    };
  });
  const byDay = new Map(timeline.map((row) => [row.day, row]));
  for (const detail of details) {
    const title = detail.task.title;
    for (const cp of detail.checkpoints || []) {
      const row = byDay.get(dayKey(cp.created_at));
      if (row) {
        row.checkpoints++;
        row.items.push({
          id: cp.id,
          task_id: detail.task.id,
          title,
          time: cp.created_at,
          kind: "中断记录",
          note: cp.payload?.current_step || "",
        });
      }
    }
    for (const session of detail.sessions || []) {
      const row = byDay.get(dayKey(session.started_at));
      if (row) {
        row.sessions++;
        row.items.push({
          id: session.id,
          task_id: detail.task.id,
          title,
          time: session.started_at,
          kind: "开始学习",
          note: "",
        });
      }
    }
  }
  const statuses = [
    "todo",
    "active",
    "paused",
    "blocked",
    "done",
    "archived",
  ].map((status) => ({
    status,
    count: tasks.filter((task) => task.status === status).length,
  }));
  const pluginCounts = new Map();
  for (const task of tasks)
    pluginCounts.set(
      task.plugin_id,
      (pluginCounts.get(task.plugin_id) || 0) + 1,
    );
  const plugins = [...pluginCounts]
    .map(([id, count]) => ({ id, count }))
    .sort((a, b) => b.count - a.count);
  const totalSteps = tasks.reduce(
    (sum, task) => sum + (task.steps?.length || 0),
    0,
  );
  const doneSteps = tasks.reduce(
    (sum, task) => sum + (task.steps?.filter((step) => step.done).length || 0),
    0,
  );
  return {
    timeline,
    statuses,
    plugins,
    totalTasks: tasks.length,
    totalSteps,
    doneSteps,
    totalCheckpoints: details.reduce(
      (sum, detail) => sum + (detail.checkpoints?.length || 0),
      0,
    ),
  };
}
