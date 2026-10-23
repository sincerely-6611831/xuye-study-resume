import { ArrowRight, BookOpen, CheckCircle2, CirclePause, Plus } from "lucide-react";
import { dateText, type Task } from "../types";

/** 首页只读取本机任务列表，不会因为打开页面而触发同步。 */
export function Overview({ tasks, onOpen, onNew, onTasks }: {
  tasks: Task[]; onOpen: (id: string) => void; onNew: () => void; onTasks: () => void;
}) {
  const waiting = tasks.filter((task) => ["paused", "blocked"].includes(task.status));
  const active = tasks.filter((task) => task.status === "active");
  const done = tasks.filter((task) => task.status === "done");
  const next = [...waiting, ...active].sort((a, b) => b.updated_at.localeCompare(a.updated_at))[0];
  const finishedSteps = tasks.reduce((sum, task) => sum + task.steps.filter((step) => step.done).length, 0);
  return <div className="overview">
    <div className="page-heading"><div><span className="eyebrow">TODAY AT A GLANCE</span><h1>学习总览</h1><p>先看下一步，再回到正在推进的任务。</p></div><button className="primary" onClick={onNew}><Plus size={17}/>新建任务</button></div>
    <div className="overview-stats" aria-label="学习统计">
      <div className="panel"><CirclePause/><span>等待续接</span><strong>{waiting.length}</strong></div>
      <div className="panel"><BookOpen/><span>正在学习</span><strong>{active.length}</strong></div>
      <div className="panel"><CheckCircle2/><span>已完成任务</span><strong>{done.length}</strong></div>
      <div className="panel"><CheckCircle2/><span>已完成步骤</span><strong>{finishedSteps}</strong></div>
    </div>
    <div className="overview-columns">
      <section className="panel overview-focus"><span className="eyebrow">下一件值得做的事</span>{next ? <><h2>{next.title}</h2><p>{next.draft.next_action || next.goal || "打开任务，记录一个具体的下一步。"}</p><small>{next.course || "自主学习"} · 更新于 {dateText(next.updated_at)}</small><button className="primary" onClick={() => onOpen(next.id)}>继续这项任务 <ArrowRight size={17}/></button></> : <><h2>从第一个任务开始</h2><p>写下目标，学习中断时留下进度与下一步。</p><button className="primary" onClick={onNew}>创建任务 <ArrowRight size={17}/></button></>}</section>
      <section className="panel overview-queue"><div className="section-heading"><h2>待续接列表</h2><button className="quiet" onClick={onTasks}>全部任务 <ArrowRight size={15}/></button></div>{waiting.length ? waiting.slice(0, 5).map((task) => <button className="overview-row" key={task.id} onClick={() => onOpen(task.id)}><span><strong>{task.title}</strong><small>{task.draft.next_action || "查看上次断点"}</small></span><ArrowRight size={16}/></button>) : <p className="muted">目前没有等待续接的任务。</p>}</section>
    </div>
  </div>;
}
