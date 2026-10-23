import { useState, useEffect, useRef } from "react";
import {
  ArrowLeft,
  Play,
  Pause,
  Check,
  Save,
  Upload,
  FileText,
  History,
  Sparkles,
  PenLine,
  RefreshCw,
  ArrowUpRight,
} from "lucide-react";
import { api, ApiError, post } from "../api/client";
import {
  readLocal,
  writeLocal,
  removeLocal,
  localKey,
} from "../sync/storage.mjs";
import { AIPanel } from "../resume/AIPanel";
import { DraftGuard } from "../sync/draft-state.mjs";
import {
  emptySnapshot,
  newId,
  deviceId,
  dateText,
  statusNames,
  reasons,
  type User,
  type Task,
  type Detail,
  type Snapshot,
  type Plugin,
} from "../types";

type LocalDraft = {
  payload: Snapshot;
  revision: number;
  session_id: string | null;
  dirty: boolean;
  saved_at: string;
};

export function Workspace({
  taskId,
  user,
  plugins,
  onBack,
  notify,
  changed,
}: {
  taskId: string;
  user: User;
  plugins: Plugin[];
  onBack: () => void;
  notify: (s: string) => void;
  changed: () => void;
}) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [form, setForm] = useState<Snapshot>(emptySnapshot());
  const [tab, setTab] = useState("work");
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [syncText, setSyncText] = useState("正在读取");
  const [conflict, setConflict] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const taskRef = useRef<Task | null>(null);
  const guard = useRef<DraftGuard | null>(null);
  const formRef = useRef<Snapshot>(emptySnapshot());
  const busyRef = useRef(false);
  const localTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const draftKey = localKey(user.id, "draft", taskId);
  const cacheKey = localKey(user.id, "detail", taskId);

  function install(d: Detail) {
    taskRef.current = d.task;
    setDetail(d);
  }
  async function reload() {
    const d = await api<Detail>(`/tasks/${taskId}`);
    // 无论从附件、AI还是刷新按钮进入，都走同一版本检查，避免绕过脏草稿的基准。
    guard.current ??= new DraftGuard(d.task);
    guard.current.observe(d.task);
    setConflict(guard.current.conflict);
    if (!guard.current.dirty) {
      const value = { ...emptySnapshot(), ...d.task.draft };
      formRef.current = value;
      setForm(value);
    }
    install(d);
    await writeLocal(cacheKey, d);
    changed();
  }
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        let d: Detail;
        try {
          d = await api<Detail>(`/tasks/${taskId}`);
          await writeLocal(cacheKey, d);
        } catch (e) {
          if (!(e instanceof ApiError) || e.status !== 0) throw e;
          d = (await readLocal(cacheKey)) as Detail;
          if (!d) throw e;
        }
        const local = (await readLocal(draftKey)) as LocalDraft | undefined;
        if (cancelled) return;
        install(d);
        guard.current = new DraftGuard(d.task);
        const fromServer = { ...emptySnapshot(), ...d.task.draft };
        if (local?.dirty) {
          guard.current.restore(local);
          guard.current.observe(d.task);
          formRef.current = local.payload;
          setForm(local.payload);
          setConflict(guard.current.conflict);
          setSyncText("已恢复本机草稿，尚未同步");
        } else {
          formRef.current = fromServer;
          setForm(fromServer);
          setSyncText("已读取同步记录");
        }
        setLoaded(true);
      } catch (e) {
        notify((e as Error).message);
        onBack();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [taskId]);

  // 输入先保存本机。明确点击“同步草稿”或“暂停”才写服务器，避免频繁请求与编辑竞争。
  // 每次onChange立即安排写入；切换页面时也使用当前捕获的值完成这次保存。
  function edit(next: Snapshot) {
    if (busyRef.current) return;
    formRef.current = next;
    setForm(next);
    guard.current!.edit();
    setSyncText("正在保存本机…");
    clearTimeout(localTimer.current);
    const revision = guard.current!.revision,
      sessionId = guard.current!.sessionId;
    localTimer.current = setTimeout(() => {
      writeLocal(draftKey, {
        payload: next,
        revision,
        session_id: sessionId,
        dirty: true,
        saved_at: new Date().toISOString(),
      })
        .then(() => setSyncText("已保存本机 · 待同步"))
        .catch(() => {
          setSyncText("本机存储失败，请立即同步");
          notify("浏览器未能保存本机草稿，请保持页面打开并同步。");
        });
    }, 350);
  }
  async function persistLocal() {
    clearTimeout(localTimer.current);
    await writeLocal(draftKey, {
      payload: formRef.current,
      revision: guard.current!.revision,
      session_id: guard.current!.sessionId,
      dirty: true,
      saved_at: new Date().toISOString(),
    });
  }
  async function run(action: () => Promise<void>) {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    try {
      await action();
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        setConflict(true);
        if (guard.current) guard.current.conflict = true;
        // 冲突面板必须展示真正的新版本，不能让用户误把旧详情当成最新服务端内容。
        try {
          await reload();
        } catch {
          /* 断网时保留当前草稿，等用户再次刷新。 */
        }
      }
      notify((e as Error).message);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  }
  async function begin(takeover = false) {
    await run(async () => {
      const version = guard.current!.beginWrite();
      const updated = await post<Task>(`/tasks/${taskId}/start`, {
        expected_revision: version.revision,
        device_id: deviceId(),
        takeover,
      });
      taskRef.current = updated;
      guard.current!.observe(updated, true);
      if (guard.current!.dirty) await persistLocal();
      await post(`/tasks/${taskId}/events`, {
        session_id: updated.session!.id,
        event_type: "opened",
      });
      setConflict(false);
      await reload();
      setTab("work");
      notify(
        takeover ? "已接管到本机，原记录仍保留。" : "开始学习，从一小步继续。",
      );
    });
  }
  async function sync() {
    if (conflict) {
      notify("请先在冲突提示中核对并选择版本。");
      return;
    }
    await run(async () => {
      await persistLocal();
      const t = taskRef.current!;
      if (!t.session) throw new Error("请先开始学习，再同步草稿。");
      const submission = guard.current!.beginWrite();
      const updated = await api<Task>(`/tasks/${taskId}/draft`, {
        method: "PUT",
        body: JSON.stringify({
          expected_revision: submission.revision,
          session_id: submission.sessionId,
          payload: formRef.current,
        }),
      });
      if (guard.current!.finishWrite(updated, submission))
        await removeLocal(draftKey);
      else await persistLocal();
      taskRef.current = updated;
      await reload();
      setSyncText(
        guard.current!.dirty
          ? "较早输入已同步 · 新编辑保留在本机"
          : "已同步 · 其他设备可读取",
      );
    });
  }
  async function pause() {
    if (!form.current_step.trim() || !form.next_action.trim()) {
      notify("暂停前，请填写“当前做到哪里”和“下一步最小行动”。");
      return;
    }
    if (conflict) {
      notify("请先解决版本冲突。");
      return;
    }
    await run(async () => {
      await persistLocal();
      const t = taskRef.current!;
      if (!t.session) throw new Error("请先开始学习。");
      const submission = guard.current!.beginWrite();
      const requestId = newId();
      const body = {
        expected_revision: submission.revision,
        session_id: submission.sessionId,
        request_id: requestId,
        payload: formRef.current,
      };
      const key = localKey(user.id, "pending", requestId);
      // 在发送请求前写重试队列，响应丢失时仍能用相同request_id安全重发。
      await writeLocal(key, { task_id: taskId, body });
      try {
        const result = await post<{ task: Task }>(
          `/tasks/${taskId}/pause`,
          body,
        );
        await removeLocal(key);
        if (guard.current!.finishWrite(result.task, submission))
          await removeLocal(draftKey);
        else await persistLocal();
        await reload();
        setSyncText("中断快照已同步");
        setTab("resume");
        notify("已留下中断快照，下次可以从这里继续。");
      } catch (e) {
        if (e instanceof ApiError && e.status !== 0 && e.status !== 409)
          await removeLocal(key);
        setSyncText("暂停记录保存在本机 · 等待提交");
        changed();
        throw e;
      }
    });
  }
  async function refresh() {
    await run(async () => {
      await reload();
      if (guard.current!.conflict)
        notify("服务端有新版本。本机草稿已保留，请对照后选择。");
    });
  }
  async function patch(values: object) {
    await run(async () => {
      const version = guard.current!.beginWrite();
      const updated = await api<Task>(`/tasks/${taskId}`, {
        method: "PATCH",
        body: JSON.stringify({
          expected_revision: version.revision,
          ...values,
        }),
      });
      guard.current!.observe(updated, true);
      await reload();
      if (guard.current!.dirty) await persistLocal();
    });
  }
  async function upload(file: File) {
    await run(async () => {
      const body = new FormData();
      body.append("file", file);
      await api(`/tasks/${taskId}/resources`, { method: "POST", body });
      await reload();
      notify("材料已上传，其他设备可以下载。");
    });
  }
  async function markProgress() {
    await run(async () => {
      await post(`/tasks/${taskId}/events`, {
        session_id: taskRef.current!.session!.id,
        event_type: "first_progress",
      });
      await reload();
      notify("已记录首个有效进展。");
    });
  }
  async function chooseServerVersion() {
    clearTimeout(localTimer.current);
    guard.current!.chooseServer(taskRef.current!);
    const value = { ...emptySnapshot(), ...taskRef.current!.draft };
    formRef.current = value;
    setForm(value);
    setConflict(false);
    await removeLocal(draftKey);
    setSyncText("已选择服务端版本");
  }
  if (!detail || !loaded)
    return <div className="loading">正在找回你的学习记录…</div>;
  const t = detail.task;
  const plugin = plugins.find((p) => p.id === t.plugin_id);
  const active = t.session?.device_id === deviceId();
  const other = !!t.session && !active;
  const latest = detail.checkpoints[0];
  const fields: [keyof Snapshot, string, string][] = [
    ["current_step", "当前做到哪里", "例如：第3题，正在选择u和dv"],
    ["next_action", "下一步最小行动", "例如：把两种分配后的积分分别写出来"],
    ["thought", "我当时在想什么", "记录思路、猜测或尚未验证的判断"],
  ];
  const more: [keyof Snapshot, string, string][] = [
    ["position", "材料位置", "页码、题号、章节、代码文件与行号"],
    ["completed", "已经完成的内容", "哪些步骤已经做完并检查过？"],
    ["attempts", "已经尝试的方法及结果", "试过什么，为什么暂时没有采用？"],
    ["blocker", "卡住的问题", "还缺少什么知识、材料或判断？"],
    ["notes", "原始笔记", "保留更多上下文，下次可以直接回看"],
  ];
  return (
    <>
      <button className="back-button" onClick={onBack}>
        <ArrowLeft size={16} />
        返回任务
      </button>
      <div className="page-heading workspace-heading">
        <div>
          <div className="task-meta">
            {t.course || "自主学习"} / {plugin?.name}
          </div>
          <h1>{t.title}</h1>
          <p>{t.goal || "每次暂停，留下一个可以继续的起点。"}</p>
        </div>
        <span className={"badge " + t.status}>{statusNames[t.status]}</span>
      </div>
      <div className="workspace-toolbar">
        <span className="sync-indicator">
          <i className={"dot " + (conflict ? "amber" : "green")} />
          {syncText}
        </span>
        <div className="actions">
          <button className="secondary small" onClick={refresh} disabled={busy}>
            <RefreshCw size={15} />
            刷新状态
          </button>
          {!active && (
            <button
              className="primary small"
              onClick={() => begin(other)}
              disabled={busy}
            >
              <Play size={15} />
              {other
                ? "接管到本机"
                : t.status === "todo"
                  ? "开始学习"
                  : "继续学习"}
            </button>
          )}
          {active && (
            <>
              <button
                className="secondary small"
                onClick={sync}
                disabled={busy}
              >
                <Save size={15} />
                同步草稿
              </button>
              <button className="primary small" onClick={pause} disabled={busy}>
                <Pause size={15} />
                保存并暂停
              </button>
            </>
          )}
        </div>
      </div>
      {conflict && (
        <section className="conflict">
          <strong>发现不同版本，本机草稿已保留</strong>
          <p>
            先点击“刷新状态”取得服务端最新记录，再比较内容。只有明确选择保留本机草稿后，才会使用最新版本号提交。
          </p>
          <details>
            <summary>查看服务端内容</summary>
            <pre>{JSON.stringify(t.draft, null, 2)}</pre>
          </details>
          <div className="actions">
            <button
              className="secondary"
              onClick={() => {
                chooseServerVersion().catch((e) => notify(e.message));
              }}
            >
              采用服务端版本
            </button>
            <button
              className="secondary"
              onClick={() => {
                guard.current!.chooseLocal(taskRef.current!);
                setConflict(false);
                edit(formRef.current);
                notify("本机内容已保留，提交前仍会检查服务端版本。");
              }}
            >
              保留本机草稿，再提交
            </button>
          </div>
        </section>
      )}
      <nav className="tabs" aria-label="任务页面">
        <button
          className={tab === "work" ? "selected" : ""}
          onClick={() => setTab("work")}
        >
          <PenLine size={16} />
          学习工作台
        </button>
        <button
          className={tab === "resume" ? "selected" : ""}
          onClick={() => setTab("resume")}
        >
          <Sparkles size={16} />
          续学卡与AI
        </button>
        <button
          className={tab === "history" ? "selected" : ""}
          onClick={() => setTab("history")}
        >
          <History size={16} />
          中断历史 <span>{detail.checkpoints.length}</span>
        </button>
      </nav>
      {tab === "work" && (
        <fieldset className="workspace-fieldset" disabled={busy}>
          <div className="workspace-grid">
            <section className="panel">
              <div className="section-heading">
                <h2>给下一次学习，留点线索</h2>
                <span className="badge">
                  {active ? "正在记录" : "可查看与整理"}
                </span>
              </div>
              <p className="muted">
                只填前两项，也能保存一次完整的暂停。更多细节可以慢慢补充。
              </p>
              <div className="stack">
                {fields.map(([key, label, placeholder]) => (
                  <label key={key}>
                    {label}
                    {key !== "thought" && <em> 必填</em>}
                    <textarea
                      rows={key === "thought" ? 3 : 2}
                      value={String(form[key])}
                      onChange={(e) => edit({ ...form, [key]: e.target.value })}
                      placeholder={placeholder}
                      disabled={busy}
                    />
                  </label>
                ))}
                <label>
                  这次为什么暂停？
                  <select
                    value={form.reason}
                    onChange={(e) => edit({ ...form, reason: e.target.value })}
                  >
                    {Object.entries(reasons).map(([key, label]) => (
                      <option key={key} value={key}>
                        {label}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  className="expand-button"
                  onClick={() => setExpanded(!expanded)}
                >
                  {expanded
                    ? "收起补充记录 −"
                    : "补充材料位置、尝试过程和原始笔记 ＋"}
                </button>
                {expanded &&
                  more.map(([key, label, placeholder]) => (
                    <label key={key}>
                      {label}
                      <textarea
                        rows={3}
                        value={String(form[key])}
                        onChange={(e) =>
                          edit({ ...form, [key]: e.target.value })
                        }
                        placeholder={placeholder}
                      />
                    </label>
                  ))}
              </div>
              <div className="plugin-fields">
                <div className="section-heading">
                  <h3>{plugin?.name} · 专门记录</h3>
                  <span className="badge">v{plugin?.version}</span>
                </div>
                <p className="muted">{plugin?.description}</p>
                <div className="stack">
                  {plugin?.fields.map((f) => (
                    <label key={f.key}>
                      {f.label}
                      <textarea
                        rows={3}
                        value={form.domain_data[f.key] || ""}
                        onChange={(e) =>
                          edit({
                            ...form,
                            domain_data: {
                              ...form.domain_data,
                              [f.key]: e.target.value,
                            },
                          })
                        }
                        placeholder={f.hint}
                      />
                    </label>
                  ))}
                </div>
              </div>
            </section>
            <aside className="stack">
              <section className="panel">
                <h3>这次学习的步骤</h3>
                {t.steps.length ? (
                  t.steps.map((s) => (
                    <label className="step" key={s.id}>
                      <input
                        type="checkbox"
                        checked={s.done}
                        disabled={busy}
                        onChange={() =>
                          patch({
                            steps: t.steps.map((x) =>
                              x.id === s.id ? { ...x, done: !x.done } : x,
                            ),
                          })
                        }
                      />
                      <span>{s.title}</span>
                    </label>
                  ))
                ) : (
                  <p className="muted">这是一个探索型任务，用阶段记录进展。</p>
                )}
                <label>
                  当前阶段
                  <input
                    value={t.stage}
                    maxLength={100}
                    onChange={(e) => {
                      const value = e.target.value;
                      setDetail({ ...detail, task: { ...t, stage: value } });
                    }}
                    onBlur={(e) => {
                      if (e.target.value !== taskRef.current?.stage)
                        patch({ stage: e.target.value });
                    }}
                  />
                </label>
              </section>
              <section className="panel">
                <div className="section-heading">
                  <h3>学习材料</h3>
                  <label className="upload-button" aria-label="上传材料">
                    <Upload size={17} />
                    <input
                      type="file"
                      disabled={busy}
                      onChange={(e) => {
                        const file = e.target.files?.[0];
                        if (file) upload(file);
                        e.target.value = "";
                      }}
                    />
                  </label>
                </div>
                <p className="muted">
                  上传原始材料，换设备也能找到。单个文件最多10MB。
                </p>
                {detail.resources.map((r) => (
                  <a
                    className="resource"
                    key={r.id}
                    href={"/api/resources/" + r.id}
                    download
                  >
                    <FileText size={17} />
                    <span>
                      {r.filename}
                      <small>{(r.size / 1024).toFixed(1)} KB</small>
                    </span>
                    <ArrowUpRight size={15} />
                  </a>
                ))}
              </section>
              {active && (
                <section className="panel">
                  <h3>已经重新进入状态？</h3>
                  <p className="muted">
                    完成第一步后，记录这次实际发生的进展。
                  </p>
                  <button
                    className="secondary full"
                    onClick={markProgress}
                    disabled={
                      busy ||
                      detail.events.some(
                        (e) =>
                          e.session_id === t.session?.id &&
                          e.event_type === "first_progress",
                      )
                    }
                  >
                    <Check size={16} />
                    {detail.events.some(
                      (e) =>
                        e.session_id === t.session?.id &&
                        e.event_type === "first_progress",
                    )
                      ? "首个进展已记录"
                      : "记录首个有效进展"}
                  </button>
                </section>
              )}
              <section className="panel">
                <h3>任务状态</h3>
                <p className="muted">
                  确认完成或归档前，先保存需要保留的思路。
                </p>
                <div className="stack">
                  <button
                    className="secondary full"
                    disabled={busy || t.status === "done"}
                    onClick={async () => {
                      if (guard.current!.dirty) {
                        notify("请先同步草稿或保存并暂停，再完成任务。");
                        return;
                      }
                      await patch({ status: "done" });
                    }}
                  >
                    <Check size={16} />
                    标记任务完成
                  </button>
                  <button
                    className="quiet"
                    disabled={busy || t.status === "archived"}
                    onClick={() => {
                      if (guard.current!.dirty)
                        return notify("请先保存草稿，再归档。");
                      patch({ status: "archived" });
                    }}
                  >
                    归档这个任务
                  </button>
                </div>
              </section>
            </aside>
          </div>
        </fieldset>
      )}
      {tab === "resume" && (
        <AIPanel detail={detail} notify={notify} reload={reload} />
      )}
      {tab === "history" && (
        <section className="panel">
          <h2>每一个停下的地方</h2>
          <p className="muted">快照只追加、不覆盖，保留每次真实的思路。</p>
          {!latest && (
            <div className="empty">
              <History size={28} />
              <p>还没有中断快照。</p>
            </div>
          )}
          {detail.checkpoints.map((cp, index) => (
            <details className="history-item" key={cp.id} open={index === 0}>
              <summary>
                <span>
                  {dateText(cp.created_at)} · {reasons[cp.payload.reason]}
                </span>
                <span>{cp.payload.current_step}</span>
              </summary>
              <div className="snapshot-grid">
                {[
                  ["current_step", "做到哪里"],
                  ["next_action", "下一步"],
                  ["thought", "当时的思路"],
                  ["attempts", "尝试与结果"],
                  ["completed", "已完成"],
                  ["blocker", "障碍"],
                  ["position", "材料位置"],
                  ["notes", "原始笔记"],
                ].map(
                  ([key, label]) =>
                    cp.payload[key as keyof Snapshot] && (
                      <div key={key}>
                        <small>{label}</small>
                        <p className="prewrap">
                          {String(cp.payload[key as keyof Snapshot])}
                        </p>
                      </div>
                    ),
                )}
                {Object.entries(cp.payload.domain_data).map(([key, value]) => (
                  <div key={key}>
                    <small>
                      {plugin?.fields.find((f) => f.key === key)?.label || key}
                    </small>
                    <p className="prewrap">{value}</p>
                  </div>
                ))}
              </div>
              <small>
                插件：{cp.plugin_id} v{cp.plugin_version} · 快照{" "}
                {cp.id.slice(0, 8)}
              </small>
            </details>
          ))}
          <h3>学习会话</h3>
          {detail.sessions.map((s) => {
            const progress = detail.events.find(
              (e) => e.session_id === s.id && e.event_type === "first_progress",
            );
            return (
              <div className="session-row" key={s.id}>
                <span>
                  {dateText(s.started_at)} →{" "}
                  {s.ended_at ? dateText(s.ended_at) : "进行中"}
                </span>
                <small>
                  {progress
                    ? `首次进展：约${Math.max(0, Math.round((+new Date(progress.created_at) - +new Date(s.started_at)) / 1000))}秒（用户确认）`
                    : "未记录首个进展"}
                </small>
              </div>
            );
          })}
        </section>
      )}
    </>
  );
}
