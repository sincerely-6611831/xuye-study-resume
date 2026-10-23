import {
  ArrowUpRight,
  BookOpen,
  Code2,
  Feather,
  Sigma,
  Layers,
  Search,
  Plus,
  Bookmark,
  Clock3,
} from "lucide-react";
import { useState } from "react";
import { dateText, statusNames, type Plugin, type Task } from "../types";
export const pluginIcons = {
  general: Layers,
  math: Sigma,
  coding: Code2,
  reading: BookOpen,
  writing: Feather,
};

export function TaskBoard({
  tasks,
  plugins,
  onOpen,
  onNew,
  view,
}: {
  tasks: Task[];
  plugins: Plugin[];
  onOpen: (id: string) => void;
  onNew: () => void;
  view: string;
}) {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const active = tasks.filter((t) => !["done", "archived"].includes(t.status));
  const shown = tasks
    .filter((t) =>
      view === "history"
        ? ["done", "archived"].includes(t.status)
        : t.status !== "archived",
    )
    .filter((t) => filter === "all" || t.plugin_id === filter)
    .filter((t) =>
      [t.title, t.course, t.goal]
        .join(" ")
        .toLowerCase()
        .includes(query.toLowerCase()),
    );
  const recent = active.find((t) => t.draft.next_action);
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">YOUR LEARNING SPACE</span>
          <h1>
            {view === "history"
              ? "走过的每一步，都算数。"
              : "从停下的地方，继续。"}
          </h1>
          <p>
            {view === "history"
              ? "查看已经完成和归档的学习任务。"
              : "把思路留给下次的自己，让每一次重新开始都轻一点。"}
          </p>
        </div>
        <button className="primary" onClick={onNew}>
          <Plus size={18} />
          新建任务
        </button>
      </div>
      <div className="stats">
        <div>
          <span>正在学习</span>
          <b>
            {tasks
              .filter((t) => t.status === "active")
              .length.toString()
              .padStart(2, "0")}
          </b>
          <i className="dot green" />
        </div>
        <div>
          <span>等待续接</span>
          <b>
            {tasks
              .filter((t) => ["paused", "blocked"].includes(t.status))
              .length.toString()
              .padStart(2, "0")}
          </b>
          <i className="dot amber" />
        </div>
        <div>
          <span>已经完成</span>
          <b>
            {tasks
              .filter((t) => t.status === "done")
              .length.toString()
              .padStart(2, "0")}
          </b>
          <i className="dot gray" />
        </div>
      </div>
      <div className="board-grid">
        <section>
          <div className="section-heading">
            <h2>
              {view === "history" ? "学习归档" : "我的任务"}{" "}
              <span className="count">{shown.length}</span>
            </h2>
            <div className="search">
              <Search size={17} />
              <input
                aria-label="搜索任务"
                placeholder="搜索任务或课程"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
          </div>
          <div className="filters">
            <button
              className={filter === "all" ? "selected" : ""}
              onClick={() => setFilter("all")}
            >
              全部
            </button>
            {plugins.map((p) => (
              <button
                key={p.id}
                className={filter === p.id ? "selected" : ""}
                onClick={() => setFilter(p.id)}
              >
                {p.name}
              </button>
            ))}
          </div>
          <div className="task-list">
            {shown.map((t) => {
              const Icon =
                pluginIcons[t.plugin_id as keyof typeof pluginIcons] || Layers;
              const done = t.steps.filter((s) => s.done).length;
              return (
                <button
                  className="task-card"
                  key={t.id}
                  onClick={() => onOpen(t.id)}
                >
                  <div className={"task-symbol " + t.plugin_id}>
                    <Icon size={23} />
                  </div>
                  <div className="task-info">
                    <div className="task-meta">
                      {t.course || "自主学习"}
                      <span>·</span>
                      {plugins.find((p) => p.id === t.plugin_id)?.name}
                    </div>
                    <h3>{t.title}</h3>
                    <p>
                      {t.draft.next_action
                        ? "下一步：" + t.draft.next_action
                        : t.goal || "为这件事留下一段清楚的思路。"}
                    </p>
                    <div className="task-bottom">
                      <span className={"badge " + t.status}>
                        {statusNames[t.status]}
                      </span>
                      <span>
                        <Clock3 size={12} />
                        {dateText(t.updated_at)}
                      </span>
                      {t.steps.length > 0 && (
                        <span>
                          {done}/{t.steps.length} 步
                        </span>
                      )}
                    </div>
                    {t.steps.length > 0 && (
                      <div className="progress">
                        <i
                          style={{ width: `${(done / t.steps.length) * 100}%` }}
                        />
                      </div>
                    )}
                  </div>
                  <ArrowUpRight size={19} className="task-arrow" />
                </button>
              );
            })}
            {!shown.length && (
              <div className="empty">
                <Bookmark size={32} />
                <h3>
                  {query ? "暂时没有匹配的任务" : "给下一次学习，留一个入口"}
                </h3>
                <p>
                  {query
                    ? "换一个关键词，或查看其他领域。"
                    : "新建一个小任务，记录第一次学习，再试着暂停和续接。"}
                </p>
                {!query && (
                  <button className="secondary" onClick={onNew}>
                    创建第一个任务
                  </button>
                )}
              </div>
            )}
          </div>
        </section>
        <aside className="board-aside">
          <div className="next-card">
            <span className="eyebrow">ONE SMALL NEXT STEP</span>
            <Bookmark size={27} />
            <h2>
              不用从头，
              <br />
              只要往前一步。
            </h2>
            <p>
              {recent
                ? recent.draft.next_action
                : "暂停前留下一个足够小、足够具体的动作。下次的你会感谢现在的自己。"}
            </p>
            {recent && (
              <button onClick={() => onOpen(recent.id)}>
                回到「{recent.title}」<ArrowUpRight size={17} />
              </button>
            )}
          </div>
          <div className="how-card">
            <h3>一次轻松的续接</h3>
            {[
              ["01", "留下断点", "记住进度、思路和下一步"],
              ["02", "找回上下文", "回看续学卡，必要时请AI帮忙"],
              ["03", "继续往前", "从一个最小行动重新开始"],
            ].map(([n, title, desc]) => (
              <div key={n}>
                <b>{n}</b>
                <span>
                  <strong>{title}</strong>
                  <small>{desc}</small>
                </span>
              </div>
            ))}
          </div>
          <div className="aside-foot">小小的进展，也值得被记住。</div>
        </aside>
      </div>
    </>
  );
}
