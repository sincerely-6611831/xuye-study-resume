import { useState, type FormEvent } from "react";
import { Modal } from "../components/Modal";
import { post } from "../api/client";
import type { Plugin, Task } from "../types";

export function NewTask({
  plugins,
  onClose,
  onCreated,
}: {
  plugins: Plugin[];
  onClose: () => void;
  onCreated: (t: Task) => void;
}) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    setBusy(true);
    try {
      onCreated(
        await post<Task>("/tasks", {
          title: f.get("title"),
          course: f.get("course"),
          goal: f.get("goal"),
          plugin_id: f.get("plugin"),
          steps: String(f.get("steps")).split("\n").filter(Boolean),
        }),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal title="开始一件想完成的事" onClose={onClose}>
      <form onSubmit={submit} className="stack">
        <label>
          任务名称
          <input
            name="title"
            required
            maxLength={120}
            placeholder="例如：弄懂分部积分的选择依据"
            autoFocus
          />
        </label>
        <div className="form-row">
          <label>
            课程 / 项目
            <input name="course" maxLength={100} placeholder="例如：高等数学" />
          </label>
          <label>
            领域插件
            <select name="plugin">
              {plugins.map((p) => (
                <option value={p.id} key={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label>
          想达到什么目标？
          <textarea name="goal" placeholder="完成时，我应该能够……" rows={2} />
        </label>
        <label>
          任务步骤（选填，每行一步）
          <textarea
            name="steps"
            placeholder={"阅读定义\n完成练习\n检查并总结"}
            rows={3}
          />
        </label>
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
        <footer>
          <button type="button" className="secondary" onClick={onClose}>
            取消
          </button>
          <button className="primary" disabled={busy}>
            {busy ? "创建中…" : "创建任务"}
          </button>
        </footer>
      </form>
    </Modal>
  );
}
