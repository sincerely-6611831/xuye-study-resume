import { useState, type FormEvent } from "react";
import { motion, useReducedMotion } from "motion/react";
import {
  ArrowUpRight,
  Bookmark,
  ArrowRight,
  CornerDownRight,
  ShieldCheck,
} from "lucide-react";
import { post } from "../api/client";
import type { User } from "../types";

export function Login({ onLogin }: { onLogin: (u: User) => void }) {
  const [register, setRegister] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const reduceMotion = useReducedMotion();
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
        <div className="login-story-top">
          <div className="wordmark">
            <span className="brand-icon">
              <Bookmark size={23} />
            </span>
            <b>续页</b>
            <span>RESUME</span>
          </div>
          <span className="login-edition">一个给学习留书签的地方</span>
        </div>
        <motion.div
          className="login-copy"
          initial={reduceMotion ? false : { opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.42, ease: "easeOut" }}
        >
          <span className="eyebrow">PAUSE IS PART OF PROGRESS</span>
          <h1>
            停下来，
            <br />
            也能接得上。
          </h1>
          <p>
            把此刻的思路留在这一页。下次回来，
            <br className="desktop-only" />
            不必从头想起，只需往前一步。
          </p>
          {/* 示例只说明续学卡的结构，不读取或展示尚未登录用户的学习记录。 */}
          <motion.div
            className="paper-preview"
            initial={reduceMotion ? false : { opacity: 0, rotate: -3, y: 18 }}
            animate={
              reduceMotion
                ? { opacity: 1, rotate: 0, y: 0 }
                : { opacity: 1, rotate: [0, -0.7, 0], y: [0, -5, 0] }
            }
            transition={
              reduceMotion
                ? { duration: 0 }
                : {
                    duration: 5.5,
                    delay: 0.5,
                    repeat: Infinity,
                    ease: "easeInOut",
                  }
            }
          >
            <div className="paper-preview-top">
              <span>示例续学卡</span>
              <span>01 / CONTINUE</span>
            </div>
            <div className="paper-preview-title">
              <span>高等数学 · 定积分</span>
              <h3>换元积分，例题 04</h3>
            </div>
            <div className="paper-preview-trail">
              <div>
                <span className="trail-dot done" />
                <p>已完成：整理两种常见换元方法</p>
              </div>
              <div>
                <span className="trail-dot current" />
                <p>停在：第二种方法的适用条件</p>
              </div>
            </div>
            <div className="paper-preview-next">
              <CornerDownRight size={18} />
              <span>下一步</span>
              <strong>先写出换元关系，再回到题目。</strong>
            </div>
            <ArrowUpRight className="paper-preview-corner" size={22} />
          </motion.div>
        </motion.div>
        <small>把每一段学习，接成自己的路。</small>
      </section>
      <section className="login-form">
        <motion.div
          className="login-form-content"
          initial={reduceMotion ? false : { opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.42, delay: 0.08, ease: "easeOut" }}
        >
          <div className="login-form-heading">
            <span className="eyebrow">YOUR SPACE · YOUR PACE</span>
            <h2>{register ? "从这里，开始记录。" : "欢迎回来。"}</h2>
            <p>
              {register
                ? "创建一个空间，为下一次继续做好准备。"
                : "打开自己的学习空间，接着上次的思路。"}
            </p>
          </div>
          <form onSubmit={submit} aria-busy={busy}>
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
          <div className="login-privacy">
            <ShieldCheck size={18} />
            <span>
              学习记录优先保存在本机。跨设备可用自建服务器或完整 ZIP。
            </span>
          </div>
        </motion.div>
      </section>
    </main>
  );
}
