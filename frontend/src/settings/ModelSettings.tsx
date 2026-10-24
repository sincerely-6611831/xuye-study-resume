import { useState, type FormEvent } from "react";
import {
  Plus,
  Server,
  KeyRound,
  Pencil,
  Trash2,
  Zap,
  Check,
  CopyCheck,
  List,
} from "lucide-react";
import { api, post } from "../api/client";
import { Modal } from "../components/Modal";
import { VoiceSettings } from "./VoiceSettings";
import type { AppSettings, ModelProfile } from "./types";

// 预设只帮助填写表单；保存时仍使用原有模型配置字段。
const modelPresets = {
  custom: { label: "自定义兼容接口", url: "" },
  ollama: {
    label: "Ollama（本地服务）",
    url: "http://localhost:11434/v1/chat/completions",
  },
  lmstudio: {
    label: "LM Studio（本地服务）",
    url: "http://localhost:1234/v1/chat/completions",
  },
};
type ModelPreset = keyof typeof modelPresets;

export function ModelSettings({
  settings,
  onUpdated,
  notify,
}: {
  settings: AppSettings;
  onUpdated: (s: AppSettings) => void;
  notify: (s: string) => void;
}) {
  const androidLocal =
    (
      window as Window & { XuYeAndroid?: { isEmbedded?: () => boolean } }
    ).XuYeAndroid?.isEmbedded?.() ?? false;
  const [editing, setEditing] = useState<ModelProfile | "new" | null>(null);
  const [removing, setRemoving] = useState<ModelProfile | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [tested, setTested] = useState<Record<string, string>>({});
  const [preset, setPreset] = useState<ModelPreset>("custom");
  const [apiUrl, setApiUrl] = useState("");
  const [model, setModel] = useState("");
  const [modelChoices, setModelChoices] = useState<string[]>([]);
  const [modelListMessage, setModelListMessage] = useState("");
  const selected =
    settings.ai.default_provider === "manual_lianxiaoli"
      ? "manual"
      : settings.ai.active_profile_id || "environment";
  const existing = editing && editing !== "new" ? editing : null;
  function openEditor(profile?: ModelProfile) {
    const url = profile?.api_url || "";
    setError("");
    setApiUrl(url);
    setModel(profile?.model || "");
    setPreset(
      (Object.keys(modelPresets) as ModelPreset[]).find(
        (key) => key !== "custom" && modelPresets[key].url === url,
      ) || "custom",
    );
    setModelChoices([]);
    setModelListMessage("");
    setEditing(profile || "new");
  }
  async function fetchModels() {
    if (!existing) return;
    setBusy(true);
    setModelListMessage("");
    try {
      // 使用已保存配置的密钥访问网关，浏览器不读取或回显密钥。
      const result = await post<{ models: string[] }>("/local-models/list", {
        profile_id: existing.id,
      });
      const choices = [...new Set(result.models)];
      setModelChoices(choices);
      setModelListMessage(
        choices.length
          ? `已读取${choices.length}个模型，请选择要使用的模型。`
          : "服务未返回模型，请确认服务已启动且已有可用模型，也可手动填写模型ID。",
      );
    } catch (e) {
      setModelChoices([]);
      setModelListMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function select(value: string) {
    setBusy(true);
    try {
      onUpdated(
        await api<AppSettings>("/settings/ai", {
          method: "PUT",
          body: JSON.stringify({
            default_provider:
              value === "manual" ? "manual_lianxiaoli" : "http_provider",
            active_profile_id: ["manual", "environment"].includes(value)
              ? null
              : value,
          }),
        }),
      );
      notify("默认AI方式已更新，下一次生成将使用所选配置。");
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function save(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const f = new FormData(e.currentTarget);
    try {
      await api("/settings/models" + (existing ? "/" + existing.id : ""), {
        method: existing ? "PUT" : "POST",
        body: JSON.stringify({
          name: f.get("name"),
          api_url: f.get("api_url"),
          model: f.get("model"),
          api_key: f.get("api_key") || "",
          timeout: Number(f.get("timeout")),
          clear_api_key: f.get("clear_api_key") === "on",
        }),
      });
      onUpdated(await api<AppSettings>("/settings"));
      setEditing(null);
      notify("模型配置已保存，可在默认AI方式中选用。");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function test(p: ModelProfile) {
    setBusy(true);
    try {
      const r = await post<{ ok: boolean; elapsed_ms: number }>(
        `/settings/models/${p.id}/test`,
      );
      setTested({ ...tested, [p.id]: `连接成功 · ${r.elapsed_ms} ms` });
    } catch (e) {
      setTested({ ...tested, [p.id]: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    setBusy(true);
    try {
      onUpdated(
        await api<AppSettings>(`/settings/models/${removing!.id}`, {
          method: "DELETE",
        }),
      );
      setRemoving(null);
      notify("模型配置已移除，学习记录和历史回复保留。");
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="stack">
      <VoiceSettings
        settings={settings}
        onUpdated={onUpdated}
        notify={notify}
      />
      <section className="panel">
        <div className="section-heading">
          <div>
            <h2>默认AI方式</h2>
            <p className="muted">
              续学卡与首页 AI
              学习总结会使用这里选中的方式。首页总结需要选择已配置的模型。
            </p>
          </div>
          <span className="badge">按账号保存</span>
        </div>
        <label>
          当前选用
          <select
            aria-label="默认AI方式"
            disabled={busy}
            value={selected}
            onChange={(e) => select(e.target.value)}
          >
            <option value="manual">连小理 · 手动对话导入</option>
            {settings.ai.environment_available && (
              <option value="environment">
                服务器默认 · {settings.ai.environment_model || ".env配置"}
              </option>
            )}
            {settings.ai.profiles.map((p) => (
              <option value={p.id} key={p.id}>
                {p.name} · {p.model}
              </option>
            ))}
          </select>
        </label>
        <div className="help-note">
          <KeyRound size={15} />{" "}
          {androidLocal
            ? "配置保存在这台设备，API密钥由 Android 系统密钥库加密，保存后不回显；完整ZIP带走接口配置，不带走密钥。"
            : "配置保存在本机，API密钥由当前网关加密封装，保存后不回显；完整ZIP带走接口配置，不带走密钥。"}
        </div>
      </section>
      <section className="panel">
        <div className="section-heading">
          <h2>
            <Server size={19} />
            我的模型配置
          </h2>
          <button
            className="primary small"
            disabled={busy}
            onClick={() => openEditor()}
          >
            <Plus size={16} />
            添加模型
          </button>
        </div>
        <p className="muted">
          支持兼容Chat
          Completions消息协议的接口。请求地址需填写完整端点，模型名称以服务商控制台为准。
        </p>
        <p className="help-note">
          {androidLocal
            ? "APK 会直接连接这里填写的接口。手机上的 localhost 指手机自身；如果模型运行在电脑上，请填写电脑的局域网 IP、开放服务监听地址，并保持两台设备联网。"
            : "本地模型需要先在运行Python网关的电脑上启动Ollama或LM Studio服务，并准备好要使用的模型。localhost指这台网关电脑；手机可通过网关调用该电脑上的模型。"}
        </p>
        {!settings.ai.profiles.length && (
          <div className="empty settings-empty">
            <Server size={28} />
            <h3>添加你的第一个模型</h3>
            <p>保存地址、模型名称与密钥，之后即可在续学卡中选用。</p>
          </div>
        )}
        {settings.ai.profiles.map((p) => (
          <article className="model-profile" key={p.id}>
            <div className="section-heading">
              <div>
                <h3>
                  {p.name}
                  {selected === p.id && (
                    <span className="badge">
                      <Check size={12} />
                      当前使用
                    </span>
                  )}
                </h3>
                <p className="model-id">{p.model}</p>
              </div>
              <span className="badge">
                {p.has_api_key ? "密钥已设置" : "无密钥"}
              </span>
            </div>
            <p className="model-endpoint">{p.api_url}</p>
            <small>超时 {p.timeout} 秒</small>
            {tested[p.id] && (
              <p className="connection-result" role="status">
                <CopyCheck size={15} />
                {tested[p.id]}
              </p>
            )}
            <div className="actions">
              <button
                className="secondary small"
                disabled={busy || selected === p.id}
                onClick={() => select(p.id)}
              >
                设为当前模型
              </button>
              <button
                className="secondary small"
                disabled={busy}
                onClick={() => test(p)}
              >
                <Zap size={14} />
                测试连接
              </button>
              <button
                className="quiet"
                disabled={busy}
                onClick={() => openEditor(p)}
              >
                <Pencil size={14} />
                编辑
              </button>
              <button
                className="quiet"
                disabled={busy}
                onClick={() => setRemoving(p)}
              >
                <Trash2 size={14} />
                移除
              </button>
            </div>
          </article>
        ))}
        <small>测试连接会向该接口发送一条简短请求，可能消耗服务商额度。</small>
      </section>
      {editing && (
        <Modal
          title={existing ? "编辑模型配置" : "添加模型配置"}
          onClose={() => {
            if (!busy) setEditing(null);
          }}
        >
          <form className="stack" onSubmit={save}>
            <fieldset disabled={busy} className="settings-form-fields">
              <label>
                接口预设
                <select
                  value={preset}
                  onChange={(e) => {
                    const value = e.target.value as ModelPreset;
                    setPreset(value);
                    if (value !== "custom") setApiUrl(modelPresets[value].url);
                    setModelChoices([]);
                    setModelListMessage("");
                  }}
                >
                  {(Object.keys(modelPresets) as ModelPreset[]).map((key) => (
                    <option key={key} value={key}>
                      {modelPresets[key].label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                配置名称
                <input
                  name="name"
                  defaultValue={existing?.name || ""}
                  maxLength={80}
                  required
                  placeholder="例如：我的学习模型"
                />
              </label>
              <label>
                完整API请求地址
                <input
                  name="api_url"
                  type="url"
                  value={apiUrl}
                  onChange={(e) => {
                    setApiUrl(e.target.value);
                    setPreset("custom");
                    setModelChoices([]);
                    setModelListMessage("");
                  }}
                  maxLength={2000}
                  required
                  placeholder="https://服务商地址/v1/chat/completions"
                />
              </label>
              <label>
                模型名称
                <input
                  name="model"
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  maxLength={150}
                  required
                  placeholder="填写服务商提供的模型ID"
                />
              </label>
              <div className="model-list-picker">
                <button
                  type="button"
                  className="secondary small"
                  disabled={busy || !existing || apiUrl !== existing.api_url}
                  onClick={fetchModels}
                >
                  <List size={15} />
                  读取可用模型
                </button>
                <small>
                  {!existing || apiUrl !== existing.api_url
                    ? "先保存配置，再编辑并读取服务提供的模型列表。模型ID可先手动填写。"
                    : "读取已保存接口的模型列表，选择后保存配置；也可直接编辑模型ID。"}
                </small>
                {!!modelChoices.length && (
                  <label>
                    选择模型
                    <select
                      value={modelChoices.includes(model) ? model : ""}
                      onChange={(e) => {
                        if (e.target.value) setModel(e.target.value);
                      }}
                    >
                      <option value="">保留手动输入的模型ID</option>
                      {modelChoices.map((name) => (
                        <option key={name} value={name}>
                          {name}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
                {modelListMessage && (
                  <p className="connection-result" role="status">
                    {modelListMessage}
                  </p>
                )}
              </div>
              <label>
                API密钥
                <input
                  name="api_key"
                  type="password"
                  autoComplete="new-password"
                  maxLength={4000}
                  placeholder={
                    existing?.has_api_key
                      ? "已设置，留空保留原密钥"
                      : "可选，本地无鉴权模型可留空"
                  }
                />
              </label>
              {existing?.has_api_key && (
                <label className="inline-check">
                  <input name="clear_api_key" type="checkbox" />
                  清除已保存的密钥
                </label>
              )}
              <label>
                请求超时（秒）
                <input
                  name="timeout"
                  type="number"
                  min={5}
                  max={120}
                  defaultValue={existing?.timeout || 30}
                  required
                />
              </label>
            </fieldset>
            {error && (
              <p className="error" role="alert">
                {error}
              </p>
            )}
            <footer>
              <button
                type="button"
                className="secondary"
                disabled={busy}
                onClick={() => setEditing(null)}
              >
                取消
              </button>
              <button className="primary" disabled={busy}>
                {busy ? "保存中…" : "保存配置"}
              </button>
            </footer>
          </form>
        </Modal>
      )}
      {removing && (
        <Modal
          title="移除模型配置"
          onClose={() => {
            if (!busy) setRemoving(null);
          }}
        >
          <div className="stack">
            <p>
              移除「{removing.name}
              」的地址和密钥配置？如果它是当前模型，将切换回连小理手动对话方式。
            </p>
            <footer>
              <button
                className="secondary"
                disabled={busy}
                onClick={() => setRemoving(null)}
              >
                取消
              </button>
              <button className="primary" disabled={busy} onClick={remove}>
                确认移除
              </button>
            </footer>
          </div>
        </Modal>
      )}
    </div>
  );
}
