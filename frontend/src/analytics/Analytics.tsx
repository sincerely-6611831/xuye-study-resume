import { useEffect, useMemo, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import {
  Activity,
  ChartNoAxesCombined,
  CircleCheck,
  Bookmark,
  ArrowRight,
} from "lucide-react";
import { api } from "../api/client";
import { buildAnalytics } from "./metrics.mjs";
import type { Detail, Plugin, Task } from "../types";
import { statusNames } from "../types";
import "./analytics.css";

type Metrics = ReturnType<typeof buildAnalytics>;

/** 手机上也可能有很多任务；并发读取限制为8个，避免一次打开太多IndexedDB事务。 */
async function readDetails(tasks: Task[]) {
  const result = new Array<Detail>(tasks.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(8, tasks.length) }, async () => {
      while (next < tasks.length) {
        const index = next++;
        result[index] = await api<Detail>(`/tasks/${tasks[index].id}`);
      }
    }),
  );
  return result;
}

export function Analytics({
  tasks,
  plugins,
  onOpen,
}: {
  tasks: Task[];
  plugins: Plugin[];
  onOpen: (id: string) => void;
}) {
  const [details, setDetails] = useState<Detail[]>([]);
  const [days, setDays] = useState<14 | 30>(14);
  const [selected, setSelected] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const reduceMotion = useReducedMotion();
  const taskSignature = tasks
    .map((task) => `${task.id}:${task.revision}:${task.updated_at}`)
    .join("|");
  useEffect(() => {
    let active = true;
    setLoading(true);
    readDetails(tasks)
      .then((result) => {
        if (active) {
          setDetails(result);
          setError("");
        }
      })
      .catch((reason: Error) => {
        if (active) setError(reason.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [taskSignature]);
  const metrics: Metrics = useMemo(
    () => buildAnalytics(tasks, details, days),
    [tasks, details, days],
  );
  const selectedRow =
    metrics.timeline.find((row) => row.day === selected) ||
    metrics.timeline.at(-1);
  const max = Math.max(
    1,
    ...metrics.timeline.map((row) => Math.max(row.checkpoints, row.sessions)),
  );
  const statusColors: Record<string, string> = {
    todo: "#a8b5aa",
    active: "#399d87",
    paused: "#e5a650",
    blocked: "#ce6679",
    done: "#6082b8",
    archived: "#818594",
  };
  const stops = metrics.statuses.reduce<{ parts: string[]; cursor: number }>(
    (state, row) => {
      const next =
        state.cursor + (row.count / Math.max(metrics.totalTasks, 1)) * 100;
      state.parts.push(`${statusColors[row.status]} ${state.cursor}% ${next}%`);
      state.cursor = next;
      return state;
    },
    { parts: [], cursor: 0 },
  ).parts;
  return (
    <div className="analytics-page stack">
      <div className="page-heading">
        <div>
          <span className="eyebrow">YOUR LEARNING IN VIEW</span>
          <h1>学习分析</h1>
          <p>
            从真实任务、学习会话和中断记录中看见自己的节奏。点击图表查看当天明细。
          </p>
        </div>
        <ChartNoAxesCombined size={34} />
      </div>
      <div className="analytics-stats">
        {[
          { label: "任务总数", value: metrics.totalTasks, Icon: Bookmark },
          {
            label: "中断记录",
            value: metrics.totalCheckpoints,
            Icon: Activity,
          },
          {
            label: "已完成步骤",
            value: `${metrics.doneSteps}/${metrics.totalSteps}`,
            Icon: CircleCheck,
          },
        ].map(({ label, value, Icon }) => (
          <div className="panel" key={label}>
            <Icon size={22} />
            <strong>{value}</strong>
            <span>{label}</span>
          </div>
        ))}
      </div>
      <section className="panel analytics-chart">
        <div className="section-heading">
          <div>
            <h2>学习活动</h2>
            <p className="muted">每天开始学习和记录中断的次数</p>
          </div>
          <div className="segmented" role="group" aria-label="图表时间范围">
            <button
              className={days === 14 ? "selected" : ""}
              onClick={() => setDays(14)}
            >
              近14天
            </button>
            <button
              className={days === 30 ? "selected" : ""}
              onClick={() => setDays(30)}
            >
              近30天
            </button>
          </div>
        </div>
        {loading ? (
          <p className="muted">正在整理本机记录…</p>
        ) : error ? (
          <p className="error" role="alert">
            {error}
          </p>
        ) : (
          <>
            <div
              className="analytics-bars"
              role="group"
              aria-label="每日学习活动图表"
            >
              {metrics.timeline.map((row) => (
                <button
                  type="button"
                  key={row.day}
                  className={selectedRow?.day === row.day ? "selected" : ""}
                  aria-label={`${row.day}：开始学习${row.sessions}次，中断记录${row.checkpoints}次`}
                  aria-pressed={selectedRow?.day === row.day}
                  onClick={() => setSelected(row.day)}
                >
                  <span className="bar-pair">
                    <motion.i
                      className="sessions"
                      initial={false}
                      animate={{
                        height: `${Math.max(2, (row.sessions / max) * 100)}%`,
                      }}
                      transition={{ duration: reduceMotion ? 0 : 0.4 }}
                    />
                    <motion.i
                      className="checkpoints"
                      initial={false}
                      animate={{
                        height: `${Math.max(2, (row.checkpoints / max) * 100)}%`,
                      }}
                      transition={{ duration: reduceMotion ? 0 : 0.4 }}
                    />
                  </span>
                  <small>{row.label}</small>
                </button>
              ))}
            </div>
            <div className="chart-legend">
              <span>
                <i className="sessions" />
                开始学习
              </span>
              <span>
                <i className="checkpoints" />
                中断记录
              </span>
            </div>
          </>
        )}
      </section>
      <div className="analytics-columns">
        <section className="panel">
          <h2>任务状态</h2>
          <div className="status-visual">
            <div
              className="status-ring"
              style={{
                background: metrics.totalTasks
                  ? `conic-gradient(${stops.join(",")})`
                  : "var(--soft)",
              }}
            >
              <strong>{metrics.totalTasks}</strong>
              <small>个任务</small>
            </div>
            <ul>
              {metrics.statuses.map((row) => (
                <li key={row.status}>
                  <i style={{ background: statusColors[row.status] }} />
                  {statusNames[row.status]}
                  <strong>{row.count}</strong>
                </li>
              ))}
            </ul>
          </div>
        </section>
        <section className="panel">
          <h2>领域分布</h2>
          {metrics.plugins.length ? (
            metrics.plugins.map((row) => (
              <div className="plugin-meter" key={row.id}>
                <div>
                  <span>
                    {plugins.find((plugin) => plugin.id === row.id)?.name ||
                      "已移除的插件"}
                  </span>
                  <strong>{row.count}</strong>
                </div>
                <i>
                  <b
                    style={{
                      width: `${(row.count / Math.max(1, metrics.totalTasks)) * 100}%`,
                    }}
                  />
                </i>
              </div>
            ))
          ) : (
            <p className="muted">创建任务后，这里会显示所用插件的分布。</p>
          )}
        </section>
      </div>
      <section className="panel analytics-detail">
        <div className="section-heading">
          <h2>{selectedRow?.day || "今天"} · 活动明细</h2>
          <span className="badge">{selectedRow?.items.length || 0} 条</span>
        </div>
        {selectedRow?.items.length ? (
          [...selectedRow.items]
            .sort((a, b) => b.time.localeCompare(a.time))
            .map((item) => (
              <button
                key={`${item.kind}:${item.id}`}
                onClick={() => onOpen(item.task_id)}
              >
                <span>
                  <strong>{item.title}</strong>
                  <small>
                    {item.kind} ·{" "}
                    {new Date(item.time).toLocaleTimeString("zh-CN", {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </small>
                  {item.note && <small>{item.note.slice(0, 110)}</small>}
                </span>
                <ArrowRight size={17} />
              </button>
            ))
        ) : (
          <p className="muted">这一天没有本机保存的活动记录。</p>
        )}
      </section>
      <p className="muted analytics-note">
        图表统计已保存的会话和断点，不根据页面停留时间推算学习时长。任务状态与步骤为当前值。
      </p>
    </div>
  );
}
