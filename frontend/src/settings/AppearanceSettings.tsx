import { useEffect, useState } from "react";
import {
  Moon,
  Sun,
  Monitor,
  Check,
  Type,
  PanelsTopLeft,
  BookOpen,
  Sparkles,
  Upload,
  Trash2,
} from "lucide-react";
import type { Appearance } from "./types";
import { currentUserId } from "../local/sync.mjs";
import { addFont, listFonts, removeFont } from "../local/fonts.mjs";

export function AppearanceSettings({
  value,
  busy,
  onChange,
}: {
  value: Appearance;
  busy: boolean;
  onChange: (value: Appearance) => void;
}) {
  const [fonts, setFonts] = useState<{ id: string; name: string }[]>([]);
  const [fontError, setFontError] = useState("");
  const user = currentUserId();
  const refreshFonts = () =>
    listFonts(user)
      .then(setFonts)
      .catch((e: Error) => setFontError(e.message));
  useEffect(() => {
    void refreshFonts();
  }, [user]);
  async function upload(file?: File) {
    if (!file) return;
    try {
      const font = await addFont(user, file);
      await refreshFonts();
      onChange({ ...value, font_family: "custom", font_id: font.id });
      setFontError("");
    } catch (error) {
      setFontError((error as Error).message);
    }
  }
  async function remove(id: string) {
    try {
      await removeFont(user, id);
      await refreshFonts();
      setFontError("");
    } catch (error) {
      setFontError((error as Error).message);
    }
  }
  return (
    <div className="stack">
      <section className="panel">
        <div className="section-heading">
          <div>
            <h2>外观模式</h2>
            <p className="muted">
              选择适合当前环境的界面，设置会应用到整个程序。
            </p>
          </div>
          <span className="badge">即时生效</span>
        </div>
        <div className="theme-options">
          {(
            [
              { id: "light", title: "浅色模式", Icon: Sun },
              { id: "dark", title: "深色模式", Icon: Moon },
              { id: "system", title: "跟随系统", Icon: Monitor },
              { id: "paper", title: "暖纸", Icon: BookOpen },
              { id: "midnight", title: "深海夜读", Icon: Sparkles },
            ] as const
          ).map(({ id, title, Icon }) => (
            <button
              aria-pressed={value.theme === id}
              key={id}
              disabled={busy}
              className={
                "theme-choice " + (value.theme === id ? "selected" : "")
              }
              onClick={() => onChange({ ...value, theme: id })}
            >
              <div className={"theme-preview " + id}>
                <i />
                <span>
                  <b />
                  <b />
                  <b />
                </span>
              </div>
              <span>
                <Icon size={16} />
                {title}
                {value.theme === id && <Check size={15} />}
              </span>
            </button>
          ))}
        </div>
      </section>
      <section className="panel">
        <h2>强调色</h2>
        <p className="muted">用于主要按钮、选中项和界面重点。</p>
        <div className="accent-options">
          {(
            [
              { id: "sage", label: "鼠尾草绿", color: "#52765a" },
              { id: "blue", label: "静谧蓝", color: "#426b9a" },
              { id: "violet", label: "暮光紫", color: "#80609d" },
              { id: "amber", label: "琥珀橙", color: "#a66325" },
              { id: "rose", label: "玫瑰红", color: "#a34f69" },
              { id: "teal", label: "湖水青", color: "#147b79" },
            ] as const
          ).map((c) => (
            <button
              aria-pressed={value.accent === c.id}
              disabled={busy}
              key={c.id}
              onClick={() => onChange({ ...value, accent: c.id })}
              className={
                "accent-choice " + (value.accent === c.id ? "selected" : "")
              }
            >
              <i style={{ background: c.color }}>
                {value.accent === c.id && <Check size={15} />}
              </i>
              {c.label}
            </button>
          ))}
        </div>
      </section>
      <div className="settings-grid">
        <section className="panel">
          <h2>
            <Type size={18} />
            界面字号
          </h2>
          <p className="muted">在100%–130%之间逐级调整，避免文字缩得过小。</p>
          <div className="font-size-control">
            <input
              type="range"
              aria-label="界面字号"
              min="100"
              max="130"
              step="1"
              disabled={busy}
              value={Math.round(value.font_scale * 100)}
              onChange={(e) =>
                onChange({
                  ...value,
                  font_size: "medium",
                  font_scale: Number(e.target.value) / 100,
                })
              }
            />
            <output>{Math.round(value.font_scale * 100)}%</output>
          </div>
        </section>
        <section className="panel">
          <h2>
            <PanelsTopLeft size={18} />
            布局密度
          </h2>
          <p className="muted">舒适留白，或在同一屏中显示更多内容。</p>
          <select
            aria-label="布局密度"
            disabled={busy}
            value={value.density}
            onChange={(e) =>
              onChange({
                ...value,
                density: e.target.value as Appearance["density"],
              })
            }
          >
            <option value="comfortable">舒适</option>
            <option value="compact">紧凑</option>
          </select>
        </section>
      </div>
      <section className="panel font-library">
        <h2>
          <Type size={18} /> 界面字体
        </h2>
        <p className="muted">
          宋体、楷体等预设使用设备已安装的字体；也可添加字体文件，导出ZIP时会一起保存。
        </p>
        <div className="font-options">
          {(
            [
              ["system", "系统默认"],
              ["song", "宋体"],
              ["kai", "楷体"],
              ["hei", "黑体"],
            ] as const
          ).map(([id, label]) => (
            <button
              type="button"
              key={id}
              className={value.font_family === id ? "selected" : ""}
              onClick={() =>
                onChange({ ...value, font_family: id, font_id: "" })
              }
            >
              {label}
              {value.font_family === id && <Check size={15} />}
            </button>
          ))}
          {fonts.map((font) => (
            <div className="custom-font-row" key={font.id}>
              <button
                type="button"
                className={
                  value.font_id === font.id && value.font_family === "custom"
                    ? "selected"
                    : ""
                }
                onClick={() =>
                  onChange({
                    ...value,
                    font_family: "custom",
                    font_id: font.id,
                  })
                }
              >
                {font.name}
                {value.font_id === font.id &&
                  value.font_family === "custom" && <Check size={15} />}
              </button>
              <button
                type="button"
                className="icon-button"
                aria-label={`删除字体${font.name}`}
                title={
                  value.font_id === font.id && value.font_family === "custom"
                    ? "先切换到其他字体"
                    : "删除字体"
                }
                disabled={
                  busy ||
                  (value.font_id === font.id && value.font_family === "custom")
                }
                onClick={() => void remove(font.id)}
              >
                <Trash2 size={15} />
              </button>
            </div>
          ))}
        </div>
        <label className="secondary file-button">
          <Upload size={16} /> 添加自己的字体
          <input
            type="file"
            accept=".woff,.woff2,.ttf,.otf"
            onChange={(e) => {
              void upload(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </label>
        {fontError && (
          <p className="error" role="alert">
            {fontError}
          </p>
        )}
      </section>
    </div>
  );
}
