import { useState } from "react";
import {
  ArrowRight,
  Download,
  Upload,
  Puzzle,
  ShieldCheck,
  Server,
  FileArchive,
} from "lucide-react";
import { downloadBackup, restoreBackup } from "../local/backup.mjs";
import { SyncSettings } from "./SyncSettings";
import { normalizeServerUrl, syncMethods } from "./guide.mjs";
import type { Plugin } from "../types";

type SyncMode = "server" | "zip";
type AndroidDataBridge = {
  isEmbedded?: () => boolean;
  openServerSetup?: () => void;
};

export function DataSettings({
  plugins,
  notify,
  changed,
}: {
  plugins: Plugin[];
  notify: (s: string) => void;
  changed: () => void;
}) {
  const android = (window as Window & { XuYeAndroid?: AndroidDataBridge })
    .XuYeAndroid;
  const androidLocal = android?.isEmbedded?.() ?? false;
  const [mode, setMode] = useState<SyncMode>(androidLocal ? "zip" : "server");
  const [busy, setBusy] = useState(false);
  const [restoreVersion, setRestoreVersion] = useState(0);
  const [serverUrl, setServerUrl] = useState(
    () => localStorage.getItem("study-self-host-url") || "",
  );
  const [serverError, setServerError] = useState("");

  function openServer() {
    try {
      const address = normalizeServerUrl(serverUrl);
      localStorage.setItem("study-self-host-url", address);
      // 浏览器和 Windows 内嵌窗口都可切换来源；不同来源的本机任务不会混在一起。
      window.location.assign(address);
    } catch (e) {
      setServerError((e as Error).message);
    }
  }

  async function restore(file: File) {
    setBusy(true);
    try {
      const result = await restoreBackup(file);
      notify(
        `已导入 ${result.imported} 个任务副本${result.personalization ? "和个性化设置" : ""}；原有任务保留。模型密钥需在目标设备重新填写。`,
      );
      setRestoreVersion((value) => value + 1);
      changed();
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function downloadZip() {
    setBusy(true);
    try {
      await downloadBackup("zip");
      notify("完整 ZIP 已开始导出。任务较多时，请保存全部分卷。");
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="stack data-method-page">
      <section className="panel data-method-intro">
        <span className="eyebrow">YOUR DATA, YOUR ROUTE</span>
        <h2>数据在你的设备上，迁移由你决定。</h2>
        <p>
          跨设备只有两种方式。先选一种，再按下方步骤操作；打开本页不会自动上传任务。
        </p>
        <div
          className="data-method-picker"
          role="group"
          aria-label="跨设备数据方式"
        >
          {syncMethods.map((method, index) => {
            const Icon = method.id === "server" ? Server : FileArchive;
            return (
              <button
                type="button"
                key={method.id}
                disabled={busy}
                className={mode === method.id ? "selected" : ""}
                aria-pressed={mode === method.id}
                onClick={() => setMode(method.id as SyncMode)}
              >
                <span className="method-number">0{index + 1}</span>
                <Icon size={24} />
                <strong>{method.title}</strong>
                <small>{method.summary}</small>
                <ArrowRight size={17} className="method-arrow" />
              </button>
            );
          })}
        </div>
      </section>

      {mode === "server" &&
        (androidLocal ? (
          <section className="panel data-method-detail">
            <span className="eyebrow">METHOD 01 · SELF HOSTED</span>
            <h2>
              <Server size={21} /> 连接你自己的服务器
            </h2>
            <p>
              Android
              内置本机空间可离线使用。连接服务器后会进入服务器账号空间；两个空间的数据独立，连接动作不会自动搬走任务。
            </p>
            <ol className="data-method-steps">
              <li>先在自己的服务器部署续页服务，跨公网使用时配置 HTTPS。</li>
              <li>点击下方按钮输入服务器地址，再登录服务器上的账号。</li>
              <li>
                要搬迁当前本机任务，先切到“完整 ZIP”导出；进入服务器空间后再导入
                ZIP。
              </li>
            </ol>
            <button
              className="primary"
              onClick={() => {
                if (android?.openServerSetup) android.openServerSetup();
                else notify("请使用应用顶部的“连接服务器”入口。");
              }}
            >
              连接自建服务器 <ArrowRight size={16} />
            </button>
          </section>
        ) : (
          <div className="stack">
            <section className="panel data-method-detail">
              <span className="eyebrow">METHOD 01 · SELF HOSTED</span>
              <h2>
                <Server size={21} /> 自建服务器手动同步
              </h2>
              <p>
                当前打开的续页服务就是这台设备使用的同步服务器。其他设备打开同一服务器地址、登录同一账号后，可以主动发送和接收任务。
              </p>
              {!android ? (
                <div className="server-address-box">
                  <strong>当前服务地址：{window.location.origin}</strong>
                  <p className="muted">
                    需要使用另一台自建服务器？在此输入它的根地址，当前窗口会打开该服务器。原空间的本机任务仍保留在原地址；Windows
                    版关闭并重新打开后回到本机空间。
                  </p>
                  <div className="server-address-actions">
                    <input
                      aria-label="自建服务器地址"
                      type="url"
                      value={serverUrl}
                      placeholder="https://你的续页服务器地址"
                      onChange={(event) => {
                        setServerUrl(event.target.value);
                        setServerError("");
                      }}
                    />
                    <button
                      className="secondary"
                      type="button"
                      onClick={openServer}
                    >
                      打开服务器 <ArrowRight size={16} />
                    </button>
                  </div>
                  {serverError && (
                    <p className="error" role="alert">
                      {serverError}
                    </p>
                  )}
                </div>
              ) : (
                <p className="muted">
                  当前服务地址：{window.location.origin}。如需更换服务器，请使用
                  Android 顶部的“连接服务器”入口。
                </p>
              )}
              <ol className="data-method-steps">
                <li>
                  自行部署续页服务；跨公网请使用
                  HTTPS，保存好服务器数据库和密钥文件。
                </li>
                <li>在原设备勾选任务，点击“发送所选”。</li>
                <li>
                  在目标设备登录同一账号，点击“获取服务器任务”后选择“接收所选”。
                </li>
              </ol>
              <p className="muted">
                服务器部署步骤见项目文档
                docs/self-host-server.md。任务仍先保存在每台设备，发送/接收不会自动进行。
              </p>
            </section>
            <SyncSettings
              key={restoreVersion}
              notify={notify}
              changed={changed}
              busy={busy}
              setBusy={setBusy}
            />
          </div>
        ))}

      {mode === "zip" && (
        <section className="panel data-method-detail zip-method">
          <span className="eyebrow">METHOD 02 · OFFLINE TRANSFER</span>
          <h2>
            <FileArchive size={22} /> 完整 ZIP 导出与导入
          </h2>
          <p>
            适合没有服务器、离线换设备，或从 Android 本机空间迁入服务器空间。ZIP
            包含任务、断点、附件、AI交互、自定义插件、外观、字体文件、模型接口和语音配置；密钥需要在目标设备重新填写。
          </p>
          <ol className="data-method-steps">
            <li>在原设备点击“导出完整 ZIP”；如果下载了多个分卷，全部保留。</li>
            <li>
              把 ZIP 文件复制到目标设备，若有分卷，请从 part-1 开始逐个导入。
            </li>
            <li>
              导入会生成任务副本，不覆盖已有内容；完成后打开任务检查材料和断点。
            </li>
          </ol>
          <div className="zip-actions">
            <button className="primary" disabled={busy} onClick={downloadZip}>
              <Download size={17} /> 导出完整 ZIP
            </button>
            <label
              className={`secondary file-button${busy ? " sync-disabled" : ""}`}
            >
              <Upload size={17} /> {busy ? "正在处理…" : "从 ZIP 导入"}
              <input
                type="file"
                accept=".zip"
                disabled={busy}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void restore(file);
                  event.target.value = "";
                }}
              />
            </label>
          </div>
          <p className="muted">
            ZIP
            是完整学习记录备份。请妥善保管文件；清除浏览器或应用数据之前，先在别处保存一份。
          </p>
        </section>
      )}

      <div className="settings-grid">
        <section className="panel">
          <div className="section-heading">
            <h2>
              <Puzzle size={20} /> 领域插件
            </h2>
            <span className="badge">{plugins.length} 个可选模块</span>
          </div>
          <p className="muted">
            插件决定任务的专门记录字段和续接提示。请到“领域插件”页自由添加自己的方案。
          </p>
          {plugins.map((plugin) => (
            <div className="plugin-row" key={plugin.id}>
              <div>
                <strong>{plugin.name}</strong>
                <p>{plugin.description}</p>
                <small>
                  专门字段：
                  {plugin.fields.map((field) => field.label).join("、")}
                </small>
              </div>
              <span className="badge">v{plugin.version}</span>
            </div>
          ))}
        </section>
        <section className="panel">
          <h2>
            <ShieldCheck size={20} /> 数据保留原则
          </h2>
          <p className="muted">
            任务首先保存在当前设备。服务器同步必须由你选中任务并点击发送或接收；ZIP
            导入始终创建新副本。
          </p>
          <p className="muted">
            同步遇到版本冲突会阻止覆盖；接收前如有本机修改，会保留完整副本。ZIP保存模型配置但不保存密钥，手动服务器同步只发送所选任务及其插件定义。
          </p>
        </section>
      </div>
    </div>
  );
}
