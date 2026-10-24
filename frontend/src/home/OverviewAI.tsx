import { useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { ArrowRight, RefreshCw, Sparkles } from "lucide-react";
import { api, post } from "../api/client";
import { localKey, readLocal, writeLocal } from "../sync/storage.mjs";
import { overviewSignature } from "./overview-ai.mjs";
import type { Task } from "../types";
import type { AppSettings } from "../settings/types";

type Summary = {
  progress: string;
  blockers: string;
  next_step: string;
  recommended_task_id: string;
};
type SavedSummary = { signature: string; summary: Summary; created_at: string };

/** 总结只在点击按钮时请求模型，结果按账号缓存到当前设备的 IndexedDB。 */
export function OverviewAI({
  userId,
  tasks,
  onOpen,
  onSettings,
}: {
  userId: string;
  tasks: Task[];
  onOpen: (id: string) => void;
  onSettings: () => void;
}) {
  const signature = overviewSignature(tasks);
  const latestSignature = useRef(signature);
  latestSignature.current = signature;
  const [saved, setSaved] = useState<SavedSummary | null>(null);
  const [modelName, setModelName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    let active = true;
    setSaved(null);
    setError("");
    // 任务发生变化后，旧结论不再展示；打开首页不会触发模型请求。
    readLocal(localKey(userId, "overview-ai", "latest"))
      .then((value: SavedSummary | undefined) => {
        if (active && value?.signature === signature) setSaved(value);
      })
      .catch(() => {
        if (active) setError("本机总结缓存暂时无法读取。");
      });
    return () => {
      active = false;
    };
  }, [userId, signature]);

  useEffect(() => {
    let active = true;
    const refreshModel = () =>
      api<AppSettings>("/settings")
        .then((settings) => {
          if (active)
            setModelName(
              settings.ai.default_provider === "http_provider" &&
                settings.http_ai_configured
                ? settings.model || "已选模型"
                : "",
            );
        })
        .catch(() => {
          if (active) setModelName("");
        });
    refreshModel();
    window.addEventListener("focus", refreshModel);
    return () => {
      active = false;
      window.removeEventListener("focus", refreshModel);
    };
  }, [userId]);

  async function generate() {
    if (busy) return;
    setBusy(true);
    setError("");
    const startedWith = signature;
    try {
      // 本机适配层按当前设置挑选模型；页面不读取 API 密钥。
      const summary = await post<Summary>("/overview/ai-summary");
      if (latestSignature.current !== startedWith) return;
      const next = {
        signature: startedWith,
        summary,
        created_at: new Date().toISOString(),
      };
      await writeLocal(localKey(userId, "overview-ai", "latest"), next);
      setSaved(next);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const available = tasks.some((task) => task.status !== "archived");
  const recommendation = tasks.find(
    (task) => task.id === saved?.summary.recommended_task_id,
  );
  return (
    <section className="panel overview-ai" aria-label="AI学习总结">
      <div className="section-heading">
        <div>
          <span className="eyebrow">AI STUDY BRIEF</span>
          <h2>
            <Sparkles size={19} /> AI学习总结
          </h2>
        </div>
        {modelName && <span className="badge">{modelName}</span>}
      </div>
      <p className="muted">
        按需整理当前进展、卡点和下一步。仅点击生成时，才会把精简的任务信息发给所选模型。
      </p>
      {saved ? (
        <motion.div
          className="overview-ai-output"
          key={saved.created_at}
          initial={reduceMotion ? false : { opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, ease: "easeOut" }}
        >
          <div className="overview-ai-results">
            <div>
              <span>目前进展</span>
              <p>{saved.summary.progress}</p>
            </div>
            <div>
              <span>需要留意</span>
              <p>{saved.summary.blockers}</p>
            </div>
            <div>
              <span>下一小步</span>
              <p>{saved.summary.next_step}</p>
            </div>
          </div>
          {recommendation && (
            <button className="quiet" onClick={() => onOpen(recommendation.id)}>
              打开建议任务：{recommendation.title} <ArrowRight size={15} />
            </button>
          )}
          <small>
            生成于 {new Date(saved.created_at).toLocaleString("zh-CN")} ·
            AI建议仅供参考，请以自己的记录为准。
          </small>
        </motion.div>
      ) : (
        <p className="overview-ai-empty">
          {available
            ? "还没有本机总结。点击下方按钮，让 AI 帮你梳理。"
            : "创建学习任务后，这里可以生成学习总结。"}
        </p>
      )}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      <div className="actions">
        {modelName ? (
          <button
            className="primary"
            disabled={busy || !available}
            onClick={generate}
          >
            {busy ? <RefreshCw size={16} /> : <Sparkles size={16} />}
            {busy ? "正在整理…" : saved ? "重新生成" : "生成学习总结"}
          </button>
        ) : (
          <button className="secondary" onClick={onSettings}>
            配置 AI 模型 <ArrowRight size={16} />
          </button>
        )}
      </div>
    </section>
  );
}
