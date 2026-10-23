import { useState, type FormEvent } from "react";
import { Mic, ChevronDown, Save } from "lucide-react";
import { api } from "../api/client";
import type { AppSettings } from "./types";

/** 识别模型接收音频；整理模型复用已有文本API配置，二者可以来自不同服务商。 */
export function VoiceSettings({
  settings,
  onUpdated,
  notify,
}: {
  settings: AppSettings;
  onUpdated: (value: AppSettings) => void;
  notify: (text: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const config = settings.speech;
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const data = new FormData(e.currentTarget);
    try {
      const result = await api<AppSettings>("/settings/voice", {
        method: "PUT",
        body: JSON.stringify({
          enabled: data.get("enabled") === "on",
          api_url: data.get("api_url") || "",
          model: data.get("model") || "",
          api_key: data.get("api_key") || "",
          clear_api_key: data.get("clear_api_key") === "on",
          language: data.get("language") || "",
          timeout: Number(data.get("timeout")),
          summary_profile_id: data.get("summary_profile_id") || null,
        }),
      });
      onUpdated(result);
      setRevision((n) => n + 1);
      notify("语音识别与整理设置已保存。");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="panel voice-settings">
      <div className="section-heading">
        <div>
          <h2>
            <Mic size={19} />
            语音中断记录
          </h2>
          <p className="muted">把口述整理成进度、思路、卡点与下一步。</p>
        </div>
        <span className="badge">
          {config.enabled ? "转写已启用" : "可用文本整理"}
        </span>
      </div>
      <button
        className="secondary"
        aria-expanded={open}
        disabled={busy}
        onClick={() => setOpen(!open)}
      >
        语音记录配置
        <ChevronDown size={16} />
      </button>
      {open && (
        <form onSubmit={save} className="stack" key={revision}>
          <fieldset className="settings-form-fields" disabled={busy}>
            <h3>1 · 语音识别</h3>
            <p className="muted">
              支持multipart音频转写协议，发送file、model、language，读取JSON中的text。音频格式需同时被服务商支持。
            </p>
            <label className="inline-check">
              <input
                type="checkbox"
                name="enabled"
                defaultChecked={config.enabled}
              />
              启用音频转写API
            </label>
            <label>
              语音识别完整API地址
              <input
                type="url"
                name="api_url"
                maxLength={2000}
                defaultValue={config.api_url}
                placeholder="https://服务商地址/v1/audio/transcriptions"
              />
            </label>
            <label>
              语音识别模型名称
              <input
                name="model"
                maxLength={150}
                defaultValue={config.model}
                placeholder="填写支持语音转写的模型ID"
              />
            </label>
            <label>
              语音识别API密钥
              <input
                name="api_key"
                type="password"
                autoComplete="new-password"
                maxLength={4000}
                placeholder={
                  config.has_api_key
                    ? "已设置，留空保留原密钥"
                    : "可选，本地无鉴权服务可留空"
                }
              />
            </label>
            {config.has_api_key && (
              <label className="inline-check">
                <input type="checkbox" name="clear_api_key" />
                清除语音识别密钥
              </label>
            )}
            <div className="voice-settings-row">
              <label>
                识别语言
                <input
                  name="language"
                  maxLength={20}
                  pattern="[a-zA-Z-]*"
                  defaultValue={config.language}
                  placeholder="zh，留空自动识别"
                />
              </label>
              <label>
                语音超时（秒）
                <input
                  type="number"
                  name="timeout"
                  min={5}
                  max={120}
                  required
                  defaultValue={config.timeout}
                />
              </label>
            </div>
            <h3>2 · 文本整理</h3>
            <label>
              语音整理模型
              <select
                name="summary_profile_id"
                defaultValue={config.summary_profile_id || ""}
              >
                <option value="">跟随当前默认AI模型</option>
                {settings.ai.profiles.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name} · {p.model}
                  </option>
                ))}
              </select>
            </label>
            <small>
              可使用上方添加的任一文本模型。默认若是连小理手动模式，请单独选择一个整理模型。未配置识别API时，仍可粘贴输入法转写文本后整理。
            </small>
          </fieldset>
          {error && (
            <p role="alert" className="error">
              {error}
            </p>
          )}
          <button className="primary" disabled={busy}>
            <Save size={16} />
            {busy ? "保存中…" : "保存语音设置"}
          </button>
        </form>
      )}
    </section>
  );
}
