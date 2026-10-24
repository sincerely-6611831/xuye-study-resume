import { useEffect, useState } from "react";
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  Database,
  RefreshCw,
} from "lucide-react";
import {
  listLocalTasks,
  listRemoteTasks,
  pullTask,
  pushTask,
} from "../local/sync.mjs";

type LocalTask = {
  task_id: string;
  title: string;
  dirty: boolean;
  base_revision: number | null;
  updated_at: string;
};
type RemoteTask = {
  task_id: string;
  title: string;
  revision: number;
  updated_at: string;
  device_name?: string;
};

function storageSize(bytes: number) {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** 同步必须由按钮触发；打开设置只读取本机，不会自动上传或下载任务。 */
export function SyncSettings({
  notify,
  changed,
  busy,
  setBusy,
}: {
  notify: (s: string) => void;
  changed: () => void;
  busy: boolean;
  setBusy: (value: boolean) => void;
}) {
  const [localTasks, setLocalTasks] = useState<LocalTask[]>([]);
  const [remoteTasks, setRemoteTasks] = useState<RemoteTask[]>([]);
  const [localSelected, setLocalSelected] = useState<string[]>([]);
  const [remoteSelected, setRemoteSelected] = useState<string[]>([]);
  const [remoteLoaded, setRemoteLoaded] = useState(false);
  const [message, setMessage] = useState("");
  const [conflicts, setConflicts] = useState<Record<string, string>>({});
  const [persistent, setPersistent] = useState<boolean | null>(null);
  const [quota, setQuota] = useState<StorageEstimate | null>(null);

  async function readStorage() {
    if (navigator.storage?.estimate)
      setQuota(await navigator.storage.estimate());
    if (navigator.storage?.persisted)
      setPersistent(await navigator.storage.persisted());
  }
  async function refreshLocal() {
    const tasks: LocalTask[] = await listLocalTasks();
    setLocalTasks(tasks);
    setLocalSelected((ids) =>
      ids.filter((id) => tasks.some((t) => t.task_id === id)),
    );
  }
  useEffect(() => {
    void refreshLocal().catch((e: Error) => setMessage(e.message));
    void readStorage().catch(() => {
      /* 不支持存储统计时，任务功能仍可使用。 */
    });
  }, []);

  async function fetchRemote() {
    setBusy(true);
    setMessage("");
    try {
      const tasks: RemoteTask[] = await listRemoteTasks();
      setRemoteTasks(tasks);
      setRemoteLoaded(true);
      setRemoteSelected((ids) =>
        ids.filter((id) => tasks.some((t) => t.task_id === id)),
      );
      await refreshLocal();
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  function toggle(
    id: string,
    selected: string[],
    update: (ids: string[]) => void,
  ) {
    update(
      selected.includes(id)
        ? selected.filter((value) => value !== id)
        : [...selected, id],
    );
  }
  async function sync(direction: "push" | "pull") {
    const ids = direction === "push" ? localSelected : remoteSelected;
    setBusy(true);
    setMessage("");
    let succeeded = 0;
    let kept = 0;
    const errors: string[] = [];
    // 逐项同步：一个任务冲突时，仍处理其他已选任务，并保留每项错误。
    for (const id of ids) {
      try {
        if (direction === "push") await pushTask(id);
        else if ((await pullTask(id)).keptCopy) kept += 1;
        succeeded += 1;
        setConflicts((previous) => {
          const next = { ...previous };
          delete next[id];
          return next;
        });
      } catch (e) {
        const error = e as Error & { status?: number };
        const title =
          [...localTasks, ...remoteTasks].find((task) => task.task_id === id)
            ?.title || id;
        errors.push(`${title}：${error.message}`);
        if (error.status === 409) {
          setConflicts((previous) => ({
            ...previous,
            [id]: "远端已有新版本，发送未覆盖远端。可接收远端，本机未同步内容将保留为副本。",
          }));
        }
      }
    }
    try {
      await refreshLocal();
      if (succeeded) changed();
      await readStorage().catch(() => {});
    } catch (e) {
      errors.push((e as Error).message);
    } finally {
      const result = `已${direction === "push" ? "发送" : "接收"}${succeeded}个任务。${kept ? `已保留${kept}个本机副本。` : ""}${errors.length ? ` ${errors.join("；")}` : ""}`;
      setMessage(result);
      notify(result);
      setBusy(false);
    }
  }
  async function persist() {
    setBusy(true);
    try {
      if (!navigator.storage?.persist) {
        setMessage("当前浏览器不支持申请持久存储，请定期下载ZIP备份。");
        return;
      }
      const granted = await navigator.storage.persist();
      setPersistent(granted);
      setMessage(
        granted
          ? "已获得持久存储许可。清除浏览器数据仍会删除本机记录，请保留备份。"
          : "浏览器暂未授予持久存储，请定期下载ZIP备份。",
      );
      await readStorage();
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel sync-settings">
      <div className="section-heading">
        <div>
          <h2>
            <Database size={20} />
            自建服务器 · 手动发送与接收
          </h2>
          <p className="muted">
            任务先保存在当前设备。选择任务发送到你部署的服务器后，其他设备才能接收；附件与学习记录一同传递。
          </p>
        </div>
        <button
          className="secondary small"
          disabled={busy}
          onClick={fetchRemote}
        >
          <RefreshCw size={15} />
          获取服务器任务
        </button>
      </div>
      <div className="sync-task-columns">
        <fieldset className="sync-task-list" disabled={busy}>
          <legend>本机任务 · {localTasks.length}</legend>
          {!localTasks.length && <p className="muted">当前设备还没有任务。</p>}
          {localTasks.map((task) => (
            <label className="sync-task-row" key={task.task_id}>
              <input
                type="checkbox"
                checked={localSelected.includes(task.task_id)}
                onChange={() =>
                  toggle(task.task_id, localSelected, setLocalSelected)
                }
              />
              <span>
                <strong>{task.title}</strong>
                <small>
                  {task.dirty
                    ? "有本机修改，待发送"
                    : task.base_revision === null
                      ? "仅保存在本机"
                      : "与上次同步版本一致"}{" "}
                  ·{" "}
                  {task.base_revision === null
                    ? "尚未同步"
                    : `基于远端版本 ${task.base_revision}`}
                </small>
                {conflicts[task.task_id] && (
                  <small className="sync-conflict">
                    {conflicts[task.task_id]}
                  </small>
                )}
              </span>
            </label>
          ))}
          <button
            className="primary small"
            disabled={busy || !localSelected.length}
            onClick={() => sync("push")}
          >
            <ArrowUpFromLine size={15} />
            发送所选（{localSelected.length}）
          </button>
        </fieldset>
        <fieldset className="sync-task-list" disabled={busy}>
          <legend>
            服务器任务 · {remoteLoaded ? remoteTasks.length : "尚未获取"}
          </legend>
          {!remoteLoaded && (
            <p className="muted">
              点击“获取服务器任务”读取当前自建服务器。打开此页不会自动连接。
            </p>
          )}
          {remoteLoaded && !remoteTasks.length && (
            <p className="muted">当前账号的服务器中还没有同步任务。</p>
          )}
          {remoteTasks.map((task) => {
            const local = localTasks.find(
              (item) => item.task_id === task.task_id,
            );
            return (
              <label className="sync-task-row" key={task.task_id}>
                <input
                  type="checkbox"
                  checked={remoteSelected.includes(task.task_id)}
                  onChange={() =>
                    toggle(task.task_id, remoteSelected, setRemoteSelected)
                  }
                />
                <span>
                  <strong>{task.title}</strong>
                  <small>
                    版本 {task.revision}
                    {task.device_name ? ` · ${task.device_name}` : ""}
                    {local?.dirty ? " · 接收前保留本机副本" : ""}
                  </small>
                  {local?.dirty && local.base_revision !== task.revision && (
                    <small className="sync-conflict">
                      本机修改与远端版本不同，接收时会保留两个版本。
                    </small>
                  )}
                </span>
              </label>
            );
          })}
          <button
            className="secondary small"
            disabled={busy || !remoteSelected.length}
            onClick={() => sync("pull")}
          >
            <ArrowDownToLine size={15} />
            接收所选（{remoteSelected.length}）
          </button>
        </fieldset>
      </div>
      <p className="muted">
        接收服务器任务时，如果本机任务有未发送修改，会先保存完整副本。发送遇到版本冲突会停止覆盖该任务，请获取服务器版本后接收并比较副本。
      </p>
      <div className="sync-storage">
        <p>
          <strong>浏览器存储</strong> ·{" "}
          {persistent === true
            ? "已获得持久存储许可"
            : persistent === false
              ? "尚未获得持久存储许可"
              : "许可状态不可用"}
          <small>
            {quota?.usage != null
              ? `已用 ${storageSize(quota.usage)}`
              : "用量不可用"}
            {quota?.quota != null
              ? ` / 预计可用总额 ${storageSize(quota.quota)}`
              : ""}
            （当前站点）
          </small>
        </p>
        <div className="actions">
          <button
            className="secondary small"
            disabled={busy || persistent === true}
            onClick={persist}
          >
            申请持久存储
          </button>
        </div>
      </div>
      {message && (
        <p className="connection-result sync-result" role="status">
          {message}
        </p>
      )}
    </section>
  );
}
