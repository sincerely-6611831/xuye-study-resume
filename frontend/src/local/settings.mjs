import { readLocal, writeLocal, updateLocal } from "../sync/storage.mjs";
import { requireValue, newId } from "./repository.mjs";
const defaults = () => ({
  version: "1.3.0",
  appearance: {
    theme: "light",
    accent: "sage",
    font_size: "medium",
    density: "comfortable",
  },
  ai: {
    default_provider: "manual_lianxiaoli",
    active_profile_id: null,
    profiles: [],
    environment_available: false,
    environment_model: "",
  },
  speech: {
    enabled: false,
    api_url: "",
    model: "",
    language: "zh",
    timeout: 60,
    summary_profile_id: null,
    encrypted_key: "",
  },
});
export async function internalSettings(user) {
  return (await readLocal(user + ":local:settings")) || defaults();
}
export function publicSettings(value) {
  const s = structuredClone(value);
  s.ai.profiles = s.ai.profiles.map(({ encrypted_key, ...p }) => ({
    ...p,
    has_api_key: !!encrypted_key,
  }));
  const key = s.speech.encrypted_key;
  delete s.speech.encrypted_key;
  s.speech.has_api_key = !!key;
  const selected = s.ai.profiles.find((p) => p.id === s.ai.active_profile_id);
  s.http_ai_configured = !!selected;
  s.model = selected?.model || "";
  return s;
}
export function selectConfig(settings, id) {
  const p = settings.ai.profiles.find(
    (p) => p.id === (id || settings.ai.active_profile_id),
  );
  requireValue(p, "请在本机模型设置中添加并选用模型。");
  return {
    name: p.name,
    api_url: p.api_url,
    model: p.model,
    timeout: p.timeout,
    encrypted_key: p.encrypted_key || "",
  };
}
function validateProfile(p) {
  requireValue(
    typeof p.name === "string" && p.name.trim() && p.name.length <= 80,
    "请填写配置名称",
  );
  requireValue(
    typeof p.model === "string" && p.model.trim() && p.model.length <= 150,
    "请填写模型名称",
  );
  let url;
  try {
    url = new URL(p.api_url);
  } catch {}
  requireValue(
    url &&
      ["http:", "https:"].includes(url.protocol) &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash,
    "请输入不含密码和查询参数的完整HTTP/HTTPS地址",
  );
  requireValue(
    Number.isInteger(p.timeout) && p.timeout >= 5 && p.timeout <= 120,
    "超时应为5–120秒",
  );
}
export async function settingsRequest(user, path, method, body, remote) {
  const key = user + ":local:settings",
    s = await internalSettings(user);
  if (path === "/settings" && method === "GET") return publicSettings(s);
  if (path === "/local-models/list") {
    return remote("/local-ai/models", {
      method: "POST",
      body: JSON.stringify({ config: selectConfig(s, body.profile_id) }),
    });
  }
  if (path.endsWith("/test")) {
    const id = path.split("/")[3];
    const started = Date.now();
    await remote("/local-ai/chat", {
      method: "POST",
      body: JSON.stringify({
        config: selectConfig(s, id),
        prompt: "请回复连接成功。",
      }),
    });
    return { ok: true, elapsed_ms: Date.now() - started };
  }
  // 密钥只在用户保存新值时交给本机网关封装；浏览器持久化中不留明文。
  let sealed = "";
  if (body.api_key && !body.clear_api_key)
    sealed = (
      await remote("/local-ai/seal", {
        method: "POST",
        body: JSON.stringify({ api_key: body.api_key }),
      })
    ).encrypted_key;
  const next = await updateLocal(key, (current) => {
    const value = current || defaults();
    if (path === "/settings/appearance") value.appearance = body;
    else if (path === "/settings/ai") {
      if (body.default_provider === "http_provider")
        selectConfig(value, body.active_profile_id);
      value.ai = { ...value.ai, ...body };
    } else if (path === "/settings/voice") {
      const { api_key, clear_api_key, ...rest } = body;
      if (rest.enabled) validateProfile({ name: "语音识别", ...rest });
      if (rest.summary_profile_id) selectConfig(value, rest.summary_profile_id);
      value.speech = {
        ...value.speech,
        ...rest,
        encrypted_key: clear_api_key
          ? ""
          : sealed || value.speech.encrypted_key,
      };
    } else if (path.startsWith("/settings/models")) {
      const id = path.split("/")[3],
        old = value.ai.profiles.find((p) => p.id === id);
      if (id) requireValue(old, "模型不存在", 404);
      if (method === "DELETE") {
        value.ai.profiles = value.ai.profiles.filter((p) => p.id !== id);
        if (value.ai.active_profile_id === id) {
          value.ai.active_profile_id = null;
          value.ai.default_provider = "manual_lianxiaoli";
        }
        if (value.speech.summary_profile_id === id)
          value.speech.summary_profile_id = null;
      } else {
        validateProfile(body);
        requireValue(
          id || value.ai.profiles.length < 20,
          "本机最多20套模型配置",
        );
        const { api_key, clear_api_key, ...rest } = body;
        const profile = {
          ...rest,
          id: id || newId(),
          encrypted_key: clear_api_key
            ? ""
            : sealed || old?.encrypted_key || "",
        };
        if (old)
          value.ai.profiles = value.ai.profiles.map((p) =>
            p.id === id ? profile : p,
          );
        else value.ai.profiles.push(profile);
      }
    } else throw new Error("未知本机设置操作");
    return value;
  });
  if (path === "/settings/models" && method === "POST")
    return publicSettings(next).ai.profiles.at(-1);
  if (path.startsWith("/settings/models/") && method === "PUT")
    return publicSettings(next).ai.profiles.find(
      (p) => p.id === path.split("/")[3],
    );
  return publicSettings(next);
}
