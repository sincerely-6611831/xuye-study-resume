import { Moon, Sun, Monitor, Check, Type, PanelsTopLeft } from "lucide-react";
import type { Appearance } from "./types";

export function AppearanceSettings({
  value,
  busy,
  onChange,
}: {
  value: Appearance;
  busy: boolean;
  onChange: (value: Appearance) => void;
}) {
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
          <p className="muted">调整文字大小，便于阅读和操作。</p>
          <select
            aria-label="界面字号"
            disabled={busy}
            value={value.font_size}
            onChange={(e) =>
              onChange({
                ...value,
                font_size: e.target.value as Appearance["font_size"],
              })
            }
          >
            <option value="small">较小</option>
            <option value="medium">标准</option>
            <option value="large">较大</option>
          </select>
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
    </div>
  );
}
