import {
  ArrowRight,
  BookOpen,
  CheckCircle2,
  CirclePause,
  Plus,
} from "lucide-react";
import { dateText, type Task } from "../types";
import { motion, useReducedMotion } from "motion/react";
import { OverviewAI } from "./OverviewAI";

/** 首页只读取本机任务列表；AI 总结也必须由用户主动点击。 */
export function Overview({
  userId,
  tasks,
  onOpen,
  onNew,
  onTasks,
  onSettings,
}: {
  userId: string;
  tasks: Task[];
  onOpen: (id: string) => void;
  onNew: () => void;
  onTasks: () => void;
  onSettings: () => void;
}) {
  const waiting = tasks.filter((task) =>
    ["paused", "blocked"].includes(task.status),
  );
  const active = tasks.filter((task) => task.status === "active");
  const done = tasks.filter((task) => task.status === "done");
  const next = [...waiting, ...active].sort((a, b) =>
    b.updated_at.localeCompare(a.updated_at),
  )[0];
  const finishedSteps = tasks.reduce(
    (sum, task) => sum + task.steps.filter((step) => step.done).length,
    0,
  );
  const nextStepCount = next?.steps.length || 0;
  const nextFinished = next?.steps.filter((step) => step.done).length || 0;
  const nextProgress = nextStepCount ? (nextFinished / nextStepCount) * 100 : 0;
  const reduceMotion = useReducedMotion();

  return (
    <div className="overview">
      <div className="page-heading">
        <div>
          <span className="eyebrow">YOUR LEARNING, AT A GLANCE</span>
          <h1>学习总览</h1>
          <p>今天要做什么，从这里看清楚。</p>
        </div>
        <button className="primary" onClick={onNew}>
          <Plus size={17} />
          新建任务
        </button>
      </div>

      <section className="overview-stats" aria-label="学习统计">
        {[
          { label: "等待续接", value: waiting.length, Icon: CirclePause },
          { label: "正在学习", value: active.length, Icon: BookOpen },
          { label: "已完成任务", value: done.length, Icon: CheckCircle2 },
          { label: "已完成步骤", value: finishedSteps, Icon: CheckCircle2 },
        ].map(({ label, value, Icon }, index) => (
          <motion.div
            className="overview-metric"
            key={label}
            initial={reduceMotion ? false : { opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.36, delay: index * 0.075 }}
          >
            <Icon />
            <span>{label}</span>
            <strong>{value}</strong>
          </motion.div>
        ))}
      </section>

      {/* 先呈现真实任务的下一步；AI 总结是用户主动调用的补充。 */}
      <div className="overview-columns">
        <motion.section
          className="panel overview-focus"
          initial={reduceMotion ? false : { opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.42, ease: "easeOut" }}
        >
          <motion.div
            className="overview-orbit"
            aria-hidden="true"
            animate={reduceMotion ? undefined : { rotate: 360 }}
            transition={
              reduceMotion
                ? undefined
                : { duration: 28, ease: "linear", repeat: Infinity }
            }
          />
          <span className="eyebrow">NEXT, ONE SMALL STEP</span>
          {next ? (
            <>
              <div className="overview-focus-main">
                <span className="overview-focus-label">下一件值得做的事</span>
                <h2>{next.title}</h2>
                <p>
                  {next.draft.next_action ||
                    next.goal ||
                    "打开任务，记录一个具体的下一步。"}
                </p>
              </div>
              {/* 轨迹只使用当前任务的真实步骤，不用演示用的假进度。 */}
              <div className="overview-focus-progress">
                <div className="overview-focus-progress-label">
                  <span>这项任务的学习轨迹</span>
                  <strong>
                    {nextStepCount
                      ? `${nextFinished} / ${nextStepCount} 步`
                      : "尚未拆分步骤"}
                  </strong>
                </div>
                <div
                  className="overview-focus-track"
                  role="progressbar"
                  aria-label="当前任务步骤进度"
                  aria-valuemin={0}
                  aria-valuemax={nextStepCount || 1}
                  aria-valuenow={nextFinished}
                >
                  <motion.span
                    initial={false}
                    animate={{ width: `${nextProgress}%` }}
                    transition={{
                      duration: reduceMotion ? 0 : 0.7,
                      ease: "easeOut",
                    }}
                  />
                </div>
                {nextStepCount > 0 && (
                  <small>
                    接下来：
                    {next.steps.find((step) => !step.done)?.title ||
                      "所有步骤已勾选，可检查并完成任务"}
                  </small>
                )}
              </div>
              <div className="overview-focus-footer">
                <small>
                  {next.course || "自主学习"} · 更新于{" "}
                  {dateText(next.updated_at)}
                </small>
                <button className="primary" onClick={() => onOpen(next.id)}>
                  继续这项任务 <ArrowRight size={17} />
                </button>
              </div>
            </>
          ) : (
            <>
              <div className="overview-focus-main">
                <span className="overview-focus-label">从一件小事开始</span>
                <h2>给今天，留一个起点。</h2>
                <p>写下学习目标。暂停时留住进度，下次就能从这里继续。</p>
              </div>
              <button className="primary" onClick={onNew}>
                创建任务 <ArrowRight size={17} />
              </button>
            </>
          )}
        </motion.section>
        <section className="panel overview-queue">
          <div className="section-heading">
            <div>
              <span className="eyebrow">PICK UP WHERE YOU LEFT OFF</span>
              <h2>待续接列表</h2>
            </div>
            <button className="quiet" onClick={onTasks}>
              全部任务 <ArrowRight size={15} />
            </button>
          </div>
          {waiting.length ? (
            waiting.slice(0, 5).map((task, index) => (
              <motion.button
                className="overview-row"
                key={task.id}
                initial={reduceMotion ? false : { opacity: 0, x: 12 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.3, delay: 0.1 + index * 0.065 }}
                whileHover={reduceMotion ? undefined : { x: 3 }}
                onClick={() => onOpen(task.id)}
              >
                <span className="overview-row-index">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <span className="overview-row-copy">
                  <strong>{task.title}</strong>
                  <small>{task.draft.next_action || "查看上次断点"}</small>
                </span>
                <ArrowRight size={16} />
              </motion.button>
            ))
          ) : (
            <p className="muted overview-queue-empty">
              目前没有等待续接的任务。每次停下前，都可以在工作台留个断点。
            </p>
          )}
        </section>
      </div>

      <OverviewAI
        userId={userId}
        tasks={tasks}
        onOpen={onOpen}
        onSettings={onSettings}
      />
    </div>
  );
}
