import {
  UserRound,
  Settings as SettingsIcon,
  LogOut,
  Bookmark,
  History,
  Check,
} from "lucide-react";
import { Settings } from "../settings/Settings";
import type { User, Task, Plugin } from "../types";
import type { Appearance } from "../settings/types";

/** “个人”负责账号与设置导航，不接管学习工作台的草稿状态。 */
export function Personal({
  user,
  tasks,
  plugins,
  section,
  onSectionChange,
  onLogout,
  onShowGuide,
  notify,
  changed,
  appearance,
  onAppearanceChange,
}: {
  user: User;
  tasks: Task[];
  plugins: Plugin[];
  section: string;
  onSectionChange: (section: string) => void;
  onLogout: () => void;
  onShowGuide: () => void;
  notify: (text: string) => void;
  changed: () => void;
  appearance: Appearance;
  onAppearanceChange: (value: Appearance) => void;
}) {
  const androidLocal = user.id === "android-local";
  return (
    <div className="personal-page">
      <div className="page-heading">
        <div>
          <span className="eyebrow">YOUR PERSONAL SPACE</span>
          <h1>个人</h1>
          <p>管理账号与偏好，让工具适应你的学习方式。</p>
        </div>
        <span className="avatar personal-avatar">
          {user.username.slice(0, 1).toUpperCase()}
        </span>
      </div>
      <nav className="tabs personal-tabs" aria-label="个人分类">
        <button
          className={section === "account" ? "selected" : ""}
          onClick={() => onSectionChange("account")}
        >
          <UserRound size={17} />
          账号信息
        </button>
        <button
          className={section === "settings" ? "selected" : ""}
          onClick={() => onSectionChange("settings")}
        >
          <SettingsIcon size={17} />
          设置
        </button>
      </nav>
      {section === "settings" ? (
        <Settings
          plugins={plugins}
          notify={notify}
          changed={changed}
          appearance={appearance}
          onAppearanceChange={onAppearanceChange}
        />
      ) : (
        <div className="stack">
          <section className="panel">
            <div className="section-heading">
              <h2>
                <UserRound size={20} />
                账号信息
              </h2>
              <span className="badge">{androidLocal ? "当前设备" : "当前登录"}</span>
            </div>
            <dl className="team-details">
              <div>
                <dt>用户名</dt>
                <dd>{user.username}</dd>
              </div>
              <div>
                <dt>账号ID</dt>
                <dd className="account-id">{user.id}</dd>
              </div>
              <div>
                <dt>学习空间</dt>
                <dd>个人学习空间</dd>
              </div>
            </dl>
            <p className="muted">
              {androidLocal
                ? "任务只保存在这台设备。需要带到其他设备时，在“设置 → 数据与同步”导出 ZIP，再到目标设备恢复。"
                : "在其他设备登录同一账号，即可查看已经同步的学习记录。"}
            </p>
          </section>
          <div className="personal-stats">
            {[
              {
                label: "学习任务",
                count: tasks.filter(
                  (t) => !["done", "archived"].includes(t.status),
                ).length,
                Icon: Bookmark,
              },
              {
                label: "已完成",
                count: tasks.filter((t) => t.status === "done").length,
                Icon: Check,
              },
              {
                label: "已归档",
                count: tasks.filter((t) => t.status === "archived").length,
                Icon: History,
              },
            ].map(({ label, count, Icon }) => (
              <section key={label} className="panel">
                <Icon size={20} />
                <strong>{count}</strong>
                <span>{label}</span>
              </section>
            ))}
          </div>
          <section className="panel personal-actions">
            <div>
              <h3>应用设置</h3>
              <p className="muted">
                模型API、语音记录、外观、数据与插件、关于我们。
              </p>
            </div>
            <button
              className="secondary"
              onClick={() => onSectionChange("settings")}
            >
              <SettingsIcon size={16} />
              打开设置
            </button>
          </section>
          <section className="panel personal-actions">
            <div><h3>使用引导</h3><p className="muted">重新查看创建任务、记录中断、续接和手动同步的步骤。</p></div>
            <button className="secondary" onClick={onShowGuide}>查看引导</button>
          </section>
          {!androidLocal && <section className="panel personal-actions">
            <div>
              <h3>登录管理</h3>
              <p className="muted">
                未同步的草稿保留在当前浏览器，之后登录此账号可继续处理。
              </p>
            </div>
            <button className="secondary" onClick={onLogout}>
              <LogOut size={16} />
              退出登录
            </button>
          </section>}
        </div>
      )}
    </div>
  );
}
