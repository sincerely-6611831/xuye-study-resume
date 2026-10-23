import { useState, type FormEvent } from "react";
import {
  ArrowUpRight,
  BookOpen,
  Bookmark,
  Layers,
  ArrowRight,
} from "lucide-react";
import { post } from "../api/client";
import type { User } from "../types";

export function Login({ onLogin }: { onLogin: (u: User) => void }) {
  const [register, setRegister] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError("");
    const data = new FormData(e.currentTarget);
    try {
      onLogin(
        await post<User>(register ? "/auth/register" : "/auth/login", {
          username: data.get("username"),
          password: data.get("password"),
        }),
      );
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <main className="login-layout">
      <section className="login-story">
        <div className="wordmark">
          <span className="brand-icon">
            <Bookmark size={23} />
          </span>
          <b>续页</b>
          <span>RESUME</span>
        </div>
        <div className="login-copy">
          <span className="eyebrow">给每一次暂停，留一个起点</span>
          <h1>
            思路暂时停下，
            <br />
            学习依然接得上。
          </h1>
          <p>
            记住做到哪里、正在想什么，以及下一步。
            <br />
            重新打开时，从熟悉的地方继续。
          </p>
          <div className="paper-preview">
            <span className="eyebrow">你的下一张续学卡</span>
            <h3>留住的，不只是进度。</h3>
            <div>
              <Layers size={19} /> 已完成的步骤与尝试
            </div>
            <div>
              <BookOpen size={19} /> 当时的想法与疑问
            </div>
            <div>
              <ArrowUpRight size={19} /> 一个清楚的下一步
            </div>
            <span className="paper-mark">继续发生 / KEEP GOING</span>
          </div>
        </div>
        <small>学习断片续接器 · 第一版</small>
      </section>
      <section className="login-form">
        <span className="eyebrow">WELCOME BACK</span>
        <h2>{register ? "建立你的学习空间" : "回到你的学习空间"}</h2>
        <p>在不同设备登录同一账号，接着上次继续。</p>
        <form onSubmit={submit}>
          <label>
            用户名
            <input
              name="username"
              autoComplete="username"
              required
              minLength={2}
              maxLength={40}
              placeholder="字母、数字、中文或下划线"
            />
          </label>
          <label>
            密码
            <input
              name="password"
              type="password"
              autoComplete={register ? "new-password" : "current-password"}
              required
              minLength={8}
              maxLength={128}
              placeholder="至少8个字符"
            />
          </label>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <button className="primary full" disabled={busy}>
            {busy ? "请稍候…" : register ? "创建账号并进入" : "登录"}
            <ArrowRight size={17} />
          </button>
        </form>
        <p className="switch-auth">
          {register ? "已经有账号？" : "第一次使用？"}
          <button
            className="link-button"
            onClick={() => {
              setRegister(!register);
              setError("");
            }}
          >
            {register ? "去登录" : "创建账号"}
          </button>
        </p>
        <div className="help-note">
          首次使用请创建账号。记录归属于你的账号；本机草稿会在同步后出现在其他设备上。
        </div>
      </section>
    </main>
  );
}
