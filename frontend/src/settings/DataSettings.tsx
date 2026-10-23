import { useState } from "react";
import {
  Download,
  Upload,
  Puzzle,
  ShieldCheck,
  Smartphone,
} from "lucide-react";
import { api } from "../api/client";
import type { Plugin } from "../types";

export function DataSettings({
  plugins,
  notify,
  changed,
}: {
  plugins: Plugin[];
  notify: (s: string) => void;
  changed: () => void;
}) {
  const [busy, setBusy] = useState(false);
  async function restore(file: File) {
    setBusy(true);
    try {
      const body = new FormData();
      body.append("file", file);
      const r = await api<{ imported: number }>("/backup/import", {
        method: "POST",
        body,
      });
      notify(`已恢复${r.imported}个任务副本，原有记录保留。`);
      changed();
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <div className="settings-grid">
        <section className="panel">
          <div className="section-heading">
            <h2>
              <Puzzle size={20} />
              领域插件
            </h2>
            <span className="badge">{plugins.length}个内置模块</span>
          </div>
          <p className="muted">
            插件决定记录哪些领域信息，以及恢复时优先思考什么。每个任务创建时选择自己的插件。
          </p>
          {plugins.map((p) => (
            <div className="plugin-row" key={p.id}>
              <div>
                <strong>{p.name}</strong>
                <p>{p.description}</p>
                <small>
                  专门字段：{p.fields.map((f) => f.label).join("、")}
                </small>
              </div>
              <span className="badge">v{p.version}</span>
            </div>
          ))}
        </section>
        <div className="stack">
          <section className="panel">
            <h2>
              <Download size={20} />
              导出与备份
            </h2>
            <p className="muted">
              Markdown便于展示，JSON便于分析，完整ZIP包含材料及AI交互记录，可用于恢复副本。
            </p>
            <div className="stack">
              {[
                ["markdown", "导出可阅读记录（Markdown）"],
                ["json", "导出结构化数据（JSON）"],
                ["zip", "下载完整备份（ZIP）"],
              ].map(([type, name]) => (
                <a
                  key={type}
                  href={"/api/export?format=" + type}
                  className="secondary full"
                  download
                >
                  <Download size={16} />
                  {name}
                </a>
              ))}
              <label className="secondary full file-button">
                <Upload size={16} />
                {busy ? "正在恢复…" : "从完整ZIP恢复副本"}
                <input
                  type="file"
                  accept=".zip"
                  disabled={busy}
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) restore(f);
                    e.target.value = "";
                  }}
                />
              </label>
            </div>
          </section>
          <section className="panel">
            <h3>
              <Smartphone size={18} />
              在其他设备继续
            </h3>
            <p className="muted">
              同一网络中，用其他设备打开这台电脑的局域网地址并登录同一账号。更换设备前先同步或暂停；接续后可明确接管当前会话。
            </p>
            <small>
              跨网络使用需要部署统一HTTPS服务。本机断网草稿只有同步后才会出现在其他设备。
            </small>
          </section>
          <section className="panel">
            <h3>
              <ShieldCheck size={18} />
              记录保留原则
            </h3>
            <p className="muted">
              AI建议经过人工确认；快照和原始回复追加保存。离线记录、服务端记录和冲突会显示不同状态。
            </p>
          </section>
        </div>
      </div>
    </>
  );
}
