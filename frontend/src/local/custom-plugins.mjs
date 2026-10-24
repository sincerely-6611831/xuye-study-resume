import presets from "./plugins.mjs";
import { newId, requireValue } from "./repository.mjs";
import { readLocal, updateLocal } from "../sync/storage.mjs";

const keyFor = (user) => `${user}:local:custom-plugins`;
const readable = (value, max) =>
  typeof value === "string" && !!value.trim() && value.length <= max;

/** 插件是数据结构，不是可执行代码；所有入口（编辑、ZIP、同步）共用此校验。 */
export function validatePlugin(input) {
  requireValue(input && typeof input === "object", "插件内容无效");
  requireValue(
    /^custom-[a-zA-Z0-9-]{8,80}$/.test(input.id),
    "自定义插件编号无效",
  );
  requireValue(readable(input.name, 60), "插件名称应为1–60字");
  requireValue(readable(input.description, 300), "请填写插件用途，最多300字");
  requireValue(readable(input.warmup, 300), "请填写续学热身问题，最多300字");
  requireValue(
    Array.isArray(input.fields) && input.fields.length <= 12,
    "插件最多12个专门字段",
  );
  const keys = new Set();
  const fields = input.fields.map((field) => {
    requireValue(
      /^[a-z][a-z0-9_]{0,39}$/.test(field?.key),
      "字段标识只能使用小写英文、数字和下划线",
    );
    requireValue(!keys.has(field.key), "插件字段标识不能重复");
    keys.add(field.key);
    requireValue(readable(field.label, 60), "请填写字段名称，最多60字");
    requireValue(
      typeof field.hint === "string" && field.hint.length <= 200,
      "字段提示最多200字",
    );
    return {
      key: field.key,
      label: field.label.trim(),
      hint: field.hint.trim(),
      type: "textarea",
    };
  });
  return {
    id: input.id,
    version: "1.0.0",
    name: input.name.trim(),
    description: input.description.trim(),
    warmup: input.warmup.trim(),
    fields,
  };
}

export function newPlugin(input) {
  return validatePlugin({ ...input, id: `custom-${newId()}` });
}

export async function customPlugins(user) {
  return (await readLocal(keyFor(user))) || [];
}

export async function allPlugins(user) {
  return [...presets, ...(await customPlugins(user))];
}

/** 同一编号的不同定义不能悄悄覆盖，以免旧任务中的字段失去解释。 */
export async function installPlugin(user, input) {
  const plugin = validatePlugin(input);
  await updateLocal(keyFor(user), (current = []) => {
    const old = current.find((item) => item.id === plugin.id);
    requireValue(
      !old || JSON.stringify(old) === JSON.stringify(plugin),
      "同名插件定义不同，请先手动处理冲突",
    );
    requireValue(old || current.length < 100, "最多保存100个自定义插件");
    return old ? current : [...current, plugin];
  });
  return plugin;
}

export async function deletePlugin(user, id, tasks) {
  requireValue(
    !tasks.some((task) => task.plugin_id === id),
    "已有任务使用这个插件，不能删除",
  );
  await updateLocal(keyFor(user), (current = []) => {
    requireValue(
      current.some((item) => item.id === id),
      "自定义插件不存在",
    );
    return current.filter((item) => item.id !== id);
  });
}
