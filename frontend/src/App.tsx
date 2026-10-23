import { useEffect, useState, useCallback } from "react";
import {
  Bookmark,
  LayoutDashboard,
  History,
  UserRound,
  Plus,
  RefreshCw,
  WifiOff,
  X,
  ArrowRight,
  CloudUpload,
} from "lucide-react";
import { api, ApiError, post } from "./api/client";
import { Login } from "./auth/Login";
import { TaskBoard } from "./tasks/TaskBoard";
import { NewTask } from "./tasks/NewTask";
import { Workspace } from "./workspace/Workspace";
import { Personal } from "./personal/Personal";
import { Overview } from "./home/Overview";
import { Onboarding } from "./home/Onboarding";
import { useAppearance } from "./settings/useAppearance";
import { Modal } from "./components/Modal";
import {
  readLocal,
  writeLocal,
  removeLocal,
  localKey,
  listPending,
} from "./sync/storage.mjs";
import type { User, Task, Plugin } from "./types";

interface Pending {
  key: string;
  task_id: string;
  body: { request_id: string };
  error?: string;
}

export default function App() {
  // App负责登录、导航和全局缓存。任务内部的编辑状态交给Workspace，避免全局刷新覆盖输入。
  const [user, setUser] = useState<User | null>(null);
  const { appearance, changeAppearance } = useAppearance(user?.id);
  const [loading, setLoading] = useState(true);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [plugins, setPlugins] = useState<Plugin[]>([]);
  const [view, setView] = useState("home");
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [personalSection, setPersonalSection] = useState("account");
  const [selected, setSelected] = useState<string | null>(null);
  const [newTask, setNewTask] = useState(false);
  const [toast, setToast] = useState("");
  const [offline, setOffline] = useState(!navigator.onLine);
  const [pending, setPending] = useState<Pending[]>([]);
  const [showPending, setShowPending] = useState(false);
  const [syncBusy, setSyncBusy] = useState(false);
  const [fatal, setFatal] = useState("");
  const notify = useCallback((s: string) => setToast(s), []);
  useEffect(() => {
    const switched = (event: StorageEvent) => {
      if (event.key === "study-last-user" && user?.id) {
        const next = event.newValue ? JSON.parse(event.newValue) : null;
        if (next?.id !== user.id) {
          setUser(null);
          setSelected(null);
          setTasks([]);
          setPlugins([]);
        }
      }
    };
    window.addEventListener("storage", switched);
    return () => window.removeEventListener("storage", switched);
  }, [user?.id]);

  useEffect(() => {
    api<User>("/auth/me")
      .then(setUser)
      .catch((e) => {
        if (e instanceof ApiError && e.status === 0) {
          const cached = localStorage.getItem("study-last-user");
          if (cached) {
            setUser(JSON.parse(cached));
            setOffline(true);
          }
        }
      })
      .finally(() => setLoading(false));
  }, []);
  async function refresh() {
    // 服务端是正式记录来源；仅在网络不可达时读取当前账号自己的本机缓存。
    if (!user) return;
    try {
      const [t, p] = await Promise.all([
        api<Task[]>("/tasks"),
        api<Plugin[]>("/plugins"),
      ]);
      setTasks(t);
      // Android 外壳只接收标题与计数，不接收笔记、密钥或附件。
      const bridge = (window as Window & { XuYeAndroid?: { updateOverview: (summary: string) => void } }).XuYeAndroid;
      bridge?.updateOverview(JSON.stringify({ waiting: t.filter((item) => ["paused", "blocked"].includes(item.status)).length, title: t.find((item) => ["paused", "blocked"].includes(item.status))?.title || "暂无待续接任务" }));
      setPlugins(p);
      setOffline(false);
      setFatal("");
      await writeLocal(localKey(user.id, "cache", "tasks"), t);
      await writeLocal(localKey(user.id, "cache", "plugins"), p);
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        setUser(null);
        localStorage.removeItem("study-last-user");
        return;
      }
      if (e instanceof ApiError && e.status === 0) {
        setOffline(true);
        setTasks(
          ((await readLocal(localKey(user.id, "cache", "tasks"))) as Task[]) ||
            [],
        );
        setPlugins(
          ((await readLocal(
            localKey(user.id, "cache", "plugins"),
          )) as Plugin[]) || [],
        );
      } else notify((e as Error).message);
    }
    setPending((await listPending(user.id)) as Pending[]);
  }
  useEffect(() => {
    if (!user) return;
    localStorage.setItem("study-last-user", JSON.stringify(user));
    setShowOnboarding(localStorage.getItem(`study-onboarded:${user.id}`) !== "1");
    refresh().catch((e) => setFatal("本机缓存不可用：" + e.message));
  }, [user?.id]);
  useEffect(() => {
    const online = () => {
      setOffline(false);
      refresh().catch((e) => notify(e.message));
    };
    const offlineHandler = () => setOffline(true);
    const focus = () => {
      if (document.visibilityState === "visible") refresh().catch(() => {});
    };
    window.addEventListener("online", online);
    window.addEventListener("offline", offlineHandler);
    document.addEventListener("visibilitychange", focus);
    return () => {
      window.removeEventListener("online", online);
      window.removeEventListener("offline", offlineHandler);
      document.removeEventListener("visibilitychange", focus);
    };
  }, [user?.id]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 7000);
    return () => clearTimeout(t);
  }, [toast]);

  async function retryPending() {
    // 队列保存的是原请求和request_id。相同操作可以安全重试，但不能跳过服务端版本检查。
    if (!user) return;
    setSyncBusy(true);
    const remaining: Pending[] = [];
    for (const item of (await listPending(user.id)) as Pending[]) {
      try {
        await post(`/tasks/${item.task_id}/pause`, item.body);
        await removeLocal(item.key);
        // 只有与本次提交相同的本机内容才清除，后续新编辑不能被重试队列删掉。
        const key = localKey(user.id, "draft", item.task_id);
        const local = (await readLocal(key)) as
          | { payload?: unknown }
          | undefined;
        if (
          JSON.stringify(local?.payload) ===
          JSON.stringify((item.body as unknown as { payload: unknown }).payload)
        )
          await removeLocal(key);
      } catch (e) {
        remaining.push({ ...item, error: (e as Error).message });
      }
    }
    await refresh();
    setPending(remaining);
    setSyncBusy(false);
    notify(
      remaining.length
        ? "部分记录需要处理冲突，本机草稿仍然保留。"
        : "待提交记录已同步，请打开任务刷新查看。",
    );
  }
  async function logout() {
    if ((window as Window & { XuYeAndroid?: { isEmbedded?: () => boolean } }).XuYeAndroid?.isEmbedded?.()) {
      notify("当前是 Android 本机空间，无需退出登录。");
      return;
    }
    try {
      await post("/auth/logout");
      localStorage.removeItem("study-last-user");
      setUser(null);
      setSelected(null);
      setTasks([]);
      setPlugins([]);
      setView("home");
      setPersonalSection("account");
      (window as Window & { XuYeAndroid?: { updateOverview: (summary: string) => void } }).XuYeAndroid?.updateOverview(JSON.stringify({ waiting: 0, title: "请登录查看任务" }));
    } catch (e) {
      notify((e as Error).message);
    }
  }
  if (loading) return <div className="loading">正在打开学习空间…</div>;
  if (!user) return <Login onLogin={setUser} />;
  const navigate = (v: string) => {
    setView(v);
    setSelected(null);
  };
  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="wordmark">
          <span className="brand-icon">
            <Bookmark size={24} />
          </span>
          <b>续页</b>
          <span>RESUME</span>
        </div>
        <div className="space-label">
          我的学习空间 <span>V1.4</span>
        </div>
        <nav aria-label="主导航">
          {[
            ["home", "总览", LayoutDashboard],
            ["tasks", "学习任务", LayoutDashboard],
            ["history", "已完成与归档", History],
            ["personal", "个人", UserRound],
          ].map(([key, label, Icon]) => {
            const I = Icon as typeof Bookmark;
            return (
              <button
                key={String(key)}
                className={view === key ? "selected" : ""}
                onClick={() => navigate(String(key))}
              >
                <I size={18} />
                {String(label)}
                {key === "tasks" && (
                  <span>
                    {tasks.filter((t) => t.status !== "archived").length}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
        <button className="sidebar-new" onClick={() => setNewTask(true)}>
          <Plus size={18} />
          新建学习任务
        </button>
        <div className="sidebar-tip">
          <Bookmark size={22} />
          <p>
            停下来没关系。
            <br />
            给思路留个书签。
          </p>
          <span>PAUSE. SAVE. RESUME.</span>
        </div>
        <div className="personal-sidebar-note">账号与偏好，尽在“个人”</div>
      </aside>
      <div className="main-shell">
        <header className="topbar">
          <div className="breadcrumb">
            我的空间 <span>/</span>{" "}
            {selected
              ? "学习工作台"
              : view === "personal"
                ? personalSection === "settings"
                  ? "个人 / 设置"
                  : "个人"
                : view === "history"
                  ? "学习归档"
                  : view === "home" ? "总览" : "学习任务"}
          </div>
          <div className="topbar-actions">
            {pending.length > 0 && (
              <button
                className="pending-badge"
                onClick={() => setShowPending(true)}
              >
                <CloudUpload size={15} />
                {pending.length}条待提交
              </button>
            )}
            <span className="connection">
              <i className={"dot " + (offline ? "amber" : "green")} />
              {offline ? "离线本机保存" : "本机保存 · 手动同步"}
            </span>
            <button
              aria-label="刷新任务列表"
              className="icon-button"
              onClick={() => refresh().catch((e) => notify(e.message))}
            >
              <RefreshCw size={17} />
            </button>
          </div>
        </header>
        {offline && (
          <div className="offline-banner">
            <WifiOff size={16} />
            当前使用本机记录，可创建任务、编辑和暂停。联网后可在设置中选择同步，AI需要连接模型网关。
          </div>
        )}
        {fatal && <div className="offline-banner error">{fatal}</div>}
        <main className="page">
          {selected ? (
            <Workspace
              key={selected}
              taskId={selected}
              user={user}
              plugins={plugins}
              onBack={() => {
                setSelected(null);
                refresh().catch(() => {});
              }}
              notify={notify}
              changed={() => refresh().catch(() => {})}
            />
          ) : view === "home" ? (
            <Overview tasks={tasks} onOpen={setSelected} onNew={() => setNewTask(true)} onTasks={() => navigate("tasks")} />
          ) : view === "personal" ? (
            <Personal
              user={user}
              tasks={tasks}
              section={personalSection}
              onSectionChange={setPersonalSection}
              onLogout={logout}
              onShowGuide={() => setShowOnboarding(true)}
              plugins={plugins}
              notify={notify}
              changed={() => refresh().catch(() => {})}
              appearance={appearance}
              onAppearanceChange={changeAppearance}
            />
          ) : (
            <TaskBoard
              tasks={tasks}
              plugins={plugins}
              onOpen={setSelected}
              onNew={() => setNewTask(true)}
              view={view}
            />
          )}
        </main>
        <footer className="page-footer">
          <span>续页 · 学习断片续接器</span>
          <span>让每一次重新开始，都有迹可循。</span>
        </footer>
      </div>
      {newTask && (
        <NewTask
          plugins={plugins}
          onClose={() => setNewTask(false)}
          onCreated={(t) => {
            setNewTask(false);
            setSelected(t.id);
            setView("tasks");
            refresh().catch(() => {});
          }}
        />
      )}
      <nav className="mobile-nav">
        {[
          ["home", "总览", LayoutDashboard],
          ["tasks", "任务", LayoutDashboard],
          ["history", "归档", History],
          ["personal", "个人", UserRound],
        ].map(([k, text, Icon]) => {
          const I = Icon as typeof Bookmark;
          return (
            <button
              className={view === k ? "selected" : ""}
              key={String(k)}
              onClick={() => navigate(String(k))}
            >
              <I size={20} />
              {String(text)}
            </button>
          );
        })}
        <button onClick={() => setNewTask(true)}>
          <Plus size={20} />
          新建
        </button>
      </nav>
      {toast && (
        <div className="toast" role="status">
          <span>{toast}</span>
          <button
            className="icon-button"
            aria-label="关闭提示"
            onClick={() => setToast("")}
          >
            <X size={16} />
          </button>
        </div>
      )}
      {showOnboarding && <Onboarding onClose={() => {
        localStorage.setItem(`study-onboarded:${user.id}`, "1");
        setShowOnboarding(false);
      }} />}
      {showPending && (
        <Modal title="本机待提交记录" onClose={() => setShowPending(false)}>
          <div className="stack">
            <p className="muted">
              联网后可重试。发生版本冲突时先打开任务对照，再决定采用哪个版本。
            </p>
            <button
              className="primary"
              disabled={syncBusy}
              onClick={retryPending}
            >
              {syncBusy ? "正在同步…" : "重试提交全部记录"}
            </button>
            {pending.map((item) => (
              <div className="panel" key={item.key}>
                <strong>
                  {tasks.find((t) => t.id === item.task_id)?.title ||
                    "学习任务"}
                </strong>
                {item.error && <p className="error">{item.error}</p>}
                <div className="actions">
                  <button
                    className="secondary"
                    onClick={() => {
                      setShowPending(false);
                      setSelected(item.task_id);
                    }}
                  >
                    打开任务对照
                    <ArrowRight size={15} />
                  </button>
                  <button
                    className="quiet"
                    onClick={async () => {
                      await removeLocal(item.key);
                      setPending((await listPending(user.id)) as Pending[]);
                      notify("已移除这次待提交操作，本机草稿保留。");
                    }}
                  >
                    移除待提交操作
                  </button>
                </div>
              </div>
            ))}
            {!pending.length && <p>没有待提交的记录。</p>}
          </div>
        </Modal>
      )}
    </div>
  );
}
