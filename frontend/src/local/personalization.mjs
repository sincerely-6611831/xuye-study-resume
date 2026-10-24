import { requireValue } from "./repository.mjs";
import { validatePlugin } from "./custom-plugins.mjs";
import { exportFonts, validateFontArchive } from "./fonts.mjs";
import { internalSettings } from "./settings.mjs";
import { customPlugins } from "./custom-plugins.mjs";
import { normalizeAppearance } from "../settings/appearance.mjs";

const validText = (value, max) =>
  typeof value === "string" && value.length <= max;
function validUrl(value) {
  try {
    const url = new URL(value);
    return (
      ["http:", "https:"].includes(url.protocol) &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash
    );
  } catch {
    return false;
  }
}

/** 只取可迁移配置；本机网关加密的密钥在另一设备也无法解开。 */
export async function exportPersonalization(user) {
  const settings = await internalSettings(user);
  return {
    appearance: normalizeAppearance(settings.appearance),
    ai: {
      default_provider: settings.ai.default_provider,
      active_profile_id: settings.ai.active_profile_id,
      profiles: settings.ai.profiles.map(
        ({ id, name, api_url, model, timeout }) => ({
          id,
          name,
          api_url,
          model,
          timeout,
        }),
      ),
    },
    speech: {
      enabled: !!settings.speech.enabled,
      api_url: settings.speech.api_url || "",
      model: settings.speech.model || "",
      language: settings.speech.language || "zh",
      timeout: settings.speech.timeout || 60,
      summary_profile_id: settings.speech.summary_profile_id || null,
    },
    plugins: await customPlugins(user),
    fonts: await exportFonts(user),
  };
}

/** ZIP完全不可信，先验证并丢弃多余字段，再交给一次原子写入。 */
export function validatePersonalization(input) {
  requireValue(input && typeof input === "object", "个性化设置无效");
  requireValue(
    Array.isArray(input.plugins) && input.plugins.length <= 100,
    "自定义插件列表无效",
  );
  const plugins = input.plugins.map(validatePlugin);
  requireValue(
    new Set(plugins.map((p) => p.id)).size === plugins.length,
    "自定义插件编号重复",
  );
  const fonts = validateFontArchive(input.fonts || []);
  const ai = input.ai;
  requireValue(
    ai && Array.isArray(ai.profiles) && ai.profiles.length <= 20,
    "模型配置列表无效",
  );
  const profiles = ai.profiles.map((profile) => {
    requireValue(
      validText(profile.id, 100) &&
        profile.id.length > 0 &&
        validText(profile.name, 80) &&
        !!profile.name.trim() &&
        validText(profile.model, 150) &&
        !!profile.model.trim() &&
        validUrl(profile.api_url) &&
        Number.isInteger(profile.timeout) &&
        profile.timeout >= 5 &&
        profile.timeout <= 120,
      "模型配置内容无效",
    );
    requireValue(
      !profile.api_key && !profile.encrypted_key,
      "备份不应包含模型密钥",
    );
    return {
      id: profile.id,
      name: profile.name,
      api_url: profile.api_url,
      model: profile.model,
      timeout: profile.timeout,
      encrypted_key: "",
    };
  });
  requireValue(
    new Set(profiles.map((p) => p.id)).size === profiles.length,
    "模型配置编号重复",
  );
  requireValue(
    ["manual_lianxiaoli", "http_provider"].includes(ai.default_provider) &&
      (ai.active_profile_id === null ||
        profiles.some((p) => p.id === ai.active_profile_id)),
    "默认模型选择无效",
  );
  const speech = input.speech;
  requireValue(
    speech &&
      typeof speech.enabled === "boolean" &&
      validText(speech.api_url, 2000) &&
      validText(speech.model, 150) &&
      validText(speech.language, 40) &&
      Number.isInteger(speech.timeout) &&
      speech.timeout >= 5 &&
      speech.timeout <= 120,
    "语音配置无效",
  );
  requireValue(
    !speech.api_key && !speech.encrypted_key,
    "备份不应包含语音密钥",
  );
  requireValue(!speech.api_url || validUrl(speech.api_url), "语音接口地址无效");
  requireValue(
    speech.summary_profile_id === null ||
      profiles.some((p) => p.id === speech.summary_profile_id),
    "语音总结模型选择无效",
  );
  const appearance = normalizeAppearance(input.appearance);
  requireValue(
    appearance.font_family !== "custom" ||
      fonts.some((font) => font.id === appearance.font_id),
    "所选自定义字体没有包含在备份中",
  );
  return {
    appearance,
    ai: {
      default_provider: ai.default_provider,
      active_profile_id: ai.active_profile_id,
      profiles,
    },
    speech: {
      enabled: speech.enabled,
      api_url: speech.api_url,
      model: speech.model,
      language: speech.language,
      timeout: speech.timeout,
      summary_profile_id: speech.summary_profile_id,
      encrypted_key: "",
    },
    plugins,
    fonts,
  };
}
