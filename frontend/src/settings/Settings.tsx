import { useEffect, useState } from "react";
import {
  Server,
  Palette,
  Database,
  HeartHandshake,
  RefreshCw,
} from "lucide-react";
import { api } from "../api/client";
import { ModelSettings } from "./ModelSettings";
import { AppearanceSettings } from "./AppearanceSettings";
import { AboutSettings } from "./AboutSettings";
import { DataSettings } from "./DataSettings";
import type { Plugin } from "../types";
import type { Appearance, AppSettings } from "./types";

/** 设置中心只管理导航与服务端配置，具体功能拆在四个独立页面中。 */
export function Settings({
  plugins,
  notify,
  changed,
  appearance,
  onAppearanceChange,
}: {
  plugins: Plugin[];
  notify: (s: string) => void;
  changed: () => void;
  appearance: Appearance;
  onAppearanceChange: (a: Appearance) => void;
}) {
  const [tab, setTab] = useState("models");
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  async function load() {
    try {
      setSettings(await api<AppSettings>("/settings"));
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
  }
  useEffect(() => {
    load();
  }, []);
  async function saveAppearance(next: Appearance) {
    const old = appearance;
    onAppearanceChange(next);
    setSaving(true);
    try {
      const s = await api<AppSettings>("/settings/appearance", {
        method: "PUT",
        body: JSON.stringify(next),
      });
      setSettings(s);
      notify("外观设置已保存。");
    } catch (e) {
      onAppearanceChange(old);
      notify((e as Error).message);
    } finally {
      setSaving(false);
    }
  }
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">MAKE IT YOURS</span>
          <h1>设置中心</h1>
          <p>选用合适的模型，调整舒适的界面，按自己的节奏继续学习。</p>
        </div>
        <span className="badge">V1.3</span>
      </div>
      <nav className="tabs settings-tabs" aria-label="设置分类">
        {[
          { id: "models", title: "模型与API", Icon: Server },
          { id: "appearance", title: "外观设置", Icon: Palette },
          { id: "data", title: "数据与同步", Icon: Database },
          { id: "about", title: "关于我们", Icon: HeartHandshake },
        ].map(({ id, title, Icon }) => (
          <button
            key={id}
            className={tab === id ? "selected" : ""}
            disabled={saving}
            onClick={() => setTab(id)}
          >
            <Icon size={16} />
            {title}
          </button>
        ))}
      </nav>
      {error && tab !== "about" && (
        <div className="settings-load-error">
          <p className="error" role="alert">
            {error}
          </p>
          <button className="secondary small" onClick={load}>
            <RefreshCw size={14} />
            重新加载设置
          </button>
        </div>
      )}
      {tab === "models" &&
        (settings ? (
          <ModelSettings
            settings={settings}
            onUpdated={setSettings}
            notify={notify}
          />
        ) : (
          !error && <div className="loading">正在读取模型设置…</div>
        ))}
      {tab === "appearance" && (
        <AppearanceSettings
          value={appearance}
          busy={saving}
          onChange={saveAppearance}
        />
      )}
      {tab === "data" && (
        <DataSettings plugins={plugins} notify={notify} changed={changed} />
      )}
      {tab === "about" && <AboutSettings />}
    </>
  );
}
