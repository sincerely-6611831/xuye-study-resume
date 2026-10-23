import { useState } from "react";
import {
  Download,
  Upload,
  Puzzle,
  ShieldCheck,
  Smartphone,
} from "lucide-react";
import { downloadBackup, restoreBackup } from "../local/backup.mjs";
import { SyncSettings } from "./SyncSettings";
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
  const androidLocal = (
    window as Window & { XuYeAndroid?: { isEmbedded?: () => boolean } }
  ).XuYeAndroid?.isEmbedded?.() ?? false;
  const [busy, setBusy] = useState(false);
  const [restoreVersion, setRestoreVersion] = useState(0);
  async function restore(file: File) {
    setBusy(true);
    try {
      const r = await restoreBackup(file);
      notify(`已恢复${r.imported}个任务副本，原有记录保留。`);
      setRestoreVersion((value) => value + 1);
      changed();
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function download(format: "zip" | "json" | "markdown") {
    setBusy(true);
    try {
      await downloadBackup(format);
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="stack">
      {/* 共用忙碌状态，恢复备份期间禁止同时接收或发送任务。 */}
      {!androidLocal && <SyncSettings
        key={restoreVersion}
        notify={notify}
        changed={changed}
        busy={busy}
        setBusy={setBusy}
      />}
      {androidLocal && (
        <section className="panel">
          <h2><Smartphone size={20} /> 这台设备的本机空间</h2>
          <p className="muted">
            任务、附件和中断记录只存放在这台 Android 设备。跨设备转移时请在下方导出完整 ZIP，
            再到另一设备导入。顶部“连接电脑”可进入共享账号空间，两个空间的数据互相独立。
          </p>
        </section>
      )}
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
                <button
                  key={type}
                  className="secondary full"
                  disabled={busy}
                  onClick={() => download(type as "zip" | "json" | "markdown")}
                >
                  <Download size={16} />
                  {name}
                </button>
              ))}
              <label className="secondary full file-button">
                <Upload size={16} />
                {busy ? "正在处理…" : "从完整ZIP恢复副本"}
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
              {androidLocal
                ? "先导出 ZIP，再在另一设备导入，原任务和副本会分别保留。"
                : "同一网络中，用其他设备打开这台电脑的局域网地址并登录同一账号。在原设备发送所选任务，再在新设备获取远端任务并接收。"}
            </p>
            <small>
              {androidLocal
                ? "本机模型与语音接口可直接连接你配置的服务；APK 不包含模型权重。"
                : "每台设备保存自己的记录，离线也可编辑。同步和AI计算需要连接运行网关的电脑，跨网络使用需要部署统一HTTPS服务。"}
            </small>
          </section>
          <section className="panel">
            <h3>
              <ShieldCheck size={18} />
              记录保留原则
            </h3>
            <p className="muted">
              AI建议经过人工确认；快照和原始回复保存在本机。同步冲突会提示保留副本；备份包含学习记录和附件，不包含模型配置与密钥。
            </p>
          </section>
        </div>
      </div>
    </div>
  );
}
