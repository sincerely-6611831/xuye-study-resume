import { useState } from "react";
import { Plus, Trash2, Puzzle } from "lucide-react";
import { api } from "../api/client";
import type { Plugin } from "../types";

type FieldDraft = { key: string; label: string; hint: string };

/** 自定义插件只定义文本框，不运行用户提供的脚本，因而可在网页和APK中一致使用。 */
export function PluginSettings({
  plugins,
  changed,
  notify,
}: {
  plugins: Plugin[];
  changed: () => void;
  notify: (message: string) => void;
}) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [warmup, setWarmup] = useState("");
  const [fields, setFields] = useState<FieldDraft[]>([
    { key: "field_1", label: "", hint: "" },
  ]);
  const [busy, setBusy] = useState(false);
  const custom = plugins.filter((plugin) => plugin.id.startsWith("custom-"));
  async function save() {
    setBusy(true);
    try {
      await api("/plugins", {
        method: "POST",
        body: JSON.stringify({
          name,
          description,
          warmup,
          fields: fields.filter((f) => f.label.trim()),
        }),
      });
      setName("");
      setDescription("");
      setWarmup("");
      setFields([{ key: "field_1", label: "", hint: "" }]);
      changed();
      notify("自定义插件已保存，可在新建任务时选用。");
    } catch (error) {
      notify((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function remove(id: string) {
    setBusy(true);
    try {
      await api(`/plugins/${id}`, { method: "DELETE" });
      changed();
      notify("自定义插件已移除。");
    } catch (error) {
      notify((error as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="stack plugin-settings">
      <section className="panel">
        <span className="eyebrow">BUILD YOUR OWN FLOW</span>
        <h2>
          <Puzzle size={20} /> 自定义领域插件
        </h2>
        <p className="muted">
          插件决定中断时显示哪些专门文本框，以及续学时的热身问题。下面几个内置方案仅供参考；你可以按课程和习惯自行添加。
        </p>
        <div className="settings-grid">
          <label>
            插件名称
            <input
              value={name}
              maxLength={60}
              placeholder="例如：外语听力"
              onChange={(e) => setName(e.target.value)}
            />
          </label>
          <label>
            用途说明
            <input
              value={description}
              maxLength={300}
              placeholder="何时使用这个插件"
              onChange={(e) => setDescription(e.target.value)}
            />
          </label>
        </div>
        <label>
          续学热身问题
          <input
            value={warmup}
            maxLength={300}
            placeholder="例如：上次没有听懂的是哪一句？"
            onChange={(e) => setWarmup(e.target.value)}
          />
        </label>
        <div className="plugin-field-builder">
          <h3>专门记录字段</h3>
          {fields.map((field, index) => (
            <div className="plugin-field-line" key={field.key}>
              <span>{String(index + 1).padStart(2, "0")}</span>
              <input
                aria-label={`字段${index + 1}名称`}
                value={field.label}
                maxLength={60}
                placeholder="字段名称"
                onChange={(e) =>
                  setFields(
                    fields.map((f, i) =>
                      i === index ? { ...f, label: e.target.value } : f,
                    ),
                  )
                }
              />
              <input
                aria-label={`字段${index + 1}提示`}
                value={field.hint}
                maxLength={200}
                placeholder="填写提示（可选）"
                onChange={(e) =>
                  setFields(
                    fields.map((f, i) =>
                      i === index ? { ...f, hint: e.target.value } : f,
                    ),
                  )
                }
              />
              <button
                className="icon-button"
                type="button"
                aria-label={`删除字段${index + 1}`}
                disabled={busy}
                onClick={() => setFields(fields.filter((_, i) => i !== index))}
              >
                <Trash2 size={16} />
              </button>
            </div>
          ))}
          <button
            className="secondary small"
            type="button"
            disabled={busy || fields.length >= 12}
            onClick={() =>
              setFields([
                ...fields,
                {
                  key: `field_${Math.max(0, ...fields.map((f) => Number(f.key.split("_")[1]) || 0)) + 1}`,
                  label: "",
                  hint: "",
                },
              ])
            }
          >
            <Plus size={15} /> 添加字段
          </button>
        </div>
        <button
          className="primary"
          disabled={
            busy || !name.trim() || !description.trim() || !warmup.trim()
          }
          onClick={save}
        >
          保存插件
        </button>
      </section>
      <section className="panel">
        <h2>我的插件 · {custom.length}</h2>
        {custom.length ? (
          custom.map((plugin) => (
            <div className="plugin-row" key={plugin.id}>
              <div>
                <strong>{plugin.name}</strong>
                <p>{plugin.description}</p>
                <small>
                  字段：
                  {plugin.fields.map((f) => f.label).join("、") ||
                    "仅使用通用字段"}
                </small>
              </div>
              <button
                className="quiet"
                disabled={busy}
                onClick={() => remove(plugin.id)}
              >
                <Trash2 size={15} /> 删除
              </button>
            </div>
          ))
        ) : (
          <p className="muted">尚未添加自定义插件。</p>
        )}
        <p className="muted">
          被任务使用的插件不能删除，以免历史记录失去字段说明。插件会进入完整
          ZIP；关联任务手动同步时也会附带定义。
        </p>
      </section>
      <section className="panel">
        <h2>预设方案</h2>
        {plugins
          .filter((p) => !p.id.startsWith("custom-"))
          .map((plugin) => (
            <div className="plugin-row" key={plugin.id}>
              <div>
                <strong>{plugin.name}</strong>
                <p>{plugin.description}</p>
                <small>{plugin.fields.map((f) => f.label).join("、")}</small>
              </div>
              <span className="badge">预设</span>
            </div>
          ))}
      </section>
    </div>
  );
}
