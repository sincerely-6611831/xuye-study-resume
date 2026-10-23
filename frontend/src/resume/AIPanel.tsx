import { useState, useEffect } from "react";
import { Sparkles, Copy, Check, ArrowRight } from "lucide-react";
import { api, post } from "../api/client";
import { Modal } from "../components/Modal";
import { selectCachedResume } from "./select-card.mjs";
import {
  dateText,
  type Card,
  type CardContent,
  type Detail,
  type AIJob,
} from "../types";

export function AIPanel({
  detail,
  notify,
  reload,
}: {
  detail: Detail;
  notify: (s: string) => void;
  reload: () => Promise<void>;
}) {
  // 三种内容分开：模板卡用于立即恢复，AI候选卡等待审核，确认卡才作为正式入口。
  const cp = detail.checkpoints[0];
  const [resume, setResume] = useState<{
    content: CardContent;
    provider: string;
  } | null>(null);
  const [job, setJob] = useState<AIJob | null>(null);
  const [raw, setRaw] = useState("");
  const [editing, setEditing] = useState<Card | null>(null);
  const [busy, setBusy] = useState(false);
  const [configured, setConfigured] = useState(false);
  useEffect(() => {
    if (cp)
      api<{ content: CardContent; provider: string }>(
        `/checkpoints/${cp.id}/resume`,
      )
        .then(setResume)
        .catch(() => {
          // 离线时优先使用已经缓存的人工确认版本，不能把用户整理的结果退回原模板。
          setResume(selectCachedResume(cp, detail.cards));
        });
    api<{ http_ai_configured: boolean }>("/settings")
      .then((s) => setConfigured(s.http_ai_configured))
      .catch(() => {});
  }, [cp?.id, detail.cards.length]);
  async function create(provider: string) {
    setBusy(true);
    try {
      const j = await post<AIJob>(`/checkpoints/${cp.id}/ai-jobs`, {
        provider,
      });
      if (provider === "manual_lianxiaoli") {
        setJob(j);
        setRaw("");
      } else {
        notify("已提交生成请求，可刷新查看结果。");
        await reload();
      }
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  async function copy() {
    try {
      await navigator.clipboard.writeText(job!.prompt);
      notify("上下文已复制，请粘贴到连小理中实际对话。");
    } catch {
      notify("浏览器未开放剪贴板，请直接选中下方文字复制。");
    }
  }
  async function importReply() {
    setBusy(true);
    try {
      const result = await post<{ card: Card }>(`/ai-jobs/${job!.id}/import`, {
        raw_text: raw,
      });
      setJob(null);
      setEditing(result.card);
      await reload();
    } catch (e) {
      notify((e as Error).message);
      await reload();
    } finally {
      setBusy(false);
    }
  }
  async function accept() {
    setBusy(true);
    try {
      await post(`/cards/${editing!.id}/accept`, {
        content: {
          summary: editing!.content.summary,
          blocker: editing!.content.blocker,
          next_action: editing!.content.next_action,
          warmup: editing!.content.warmup,
        },
      });
      setEditing(null);
      await reload();
      notify("续学卡已确认，原始快照仍完整保留。");
    } catch (e) {
      notify((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  if (!cp)
    return (
      <div className="empty">
        <Sparkles size={30} />
        <h3>先留下一次真实的中断</h3>
        <p>
          在工作台填写进度并暂停后，这里会生成续学卡，也能请连小理帮你整理。
        </p>
      </div>
    );
  return (
    <div className="stack">
      <section className="panel resume-card">
        <div className="section-heading">
          <div>
            <span className="eyebrow">YOUR RESUME CARD</span>
            <h2>给下次自己的接力棒</h2>
          </div>
          <span className="badge">
            {resume?.provider === "confirmed" ? "已人工确认" : "记录模板"}
          </span>
        </div>
        {resume && (
          <div className="resume-sections">
            {[
              ["summary", "上次做到这里"],
              ["blocker", "还没解决的是"],
              ["next_action", "先做这一小步"],
              ["warmup", "可选的回忆问题"],
            ].map(([key, name]) => (
              <div key={key}>
                <span>{name}</span>
                <p>{resume.content[key as keyof CardContent] || "未填写"}</p>
              </div>
            ))}
          </div>
        )}
        <small>
          来源：{dateText(cp.created_at)}{" "}
          的中断快照。AI候选卡须确认后才作为正式恢复入口。
        </small>
      </section>
      <section className="panel">
        <div className="section-heading">
          <h2>
            <Sparkles size={18} />
            让连小理帮你整理
          </h2>
          <span className="badge">真实对话导入</span>
        </div>
        <p className="muted">
          复制这次中断的上下文，在连小理中完成实际交互，再导入回复。你可以修改并确认续学卡。
        </p>
        <div className="actions">
          <button
            className="primary"
            onClick={() => create("manual_lianxiaoli")}
            disabled={busy}
          >
            准备对话上下文
            <ArrowRight size={16} />
          </button>
          {configured && (
            <button
              className="secondary"
              onClick={() => create("http_provider")}
              disabled={busy}
            >
              调用已配置的AI接口
            </button>
          )}
        </div>
      </section>
      {detail.cards
        .filter((c) => c.status === "draft")
        .map((c) => (
          <section className="panel" key={c.id}>
            <div className="section-heading">
              <h3>
                AI候选卡 <span className="badge amber">待确认</span>
              </h3>
              <button className="secondary" onClick={() => setEditing(c)}>
                查看并确认
              </button>
            </div>
            <p className="prewrap">{c.content.summary}</p>
            <small>
              {c.checkpoint_id !== cp.id
                ? "这是较早快照的候选卡，不会覆盖最新中断。"
                : dateText(c.created_at)}
            </small>
          </section>
        ))}
      {detail.jobs.length > 0 && (
        <section className="panel">
          <h3>交互记录</h3>
          {detail.jobs.map((j) => (
            <details className="history-item" key={j.id}>
              <summary>
                {j.provider === "manual_lianxiaoli"
                  ? "连小理 · 手动导入"
                  : "HTTP AI接口"}
                <span>
                  {j.status} · {dateText(j.created_at)}
                </span>
              </summary>
              {j.error && <p className="error">{j.error}</p>}
              <h4>发送的上下文</h4>
              <pre>{j.prompt}</pre>
              <h4>原始回复</h4>
              <pre>{j.raw_output || "尚无回复"}</pre>
              {j.provider === "manual_lianxiaoli" && (
                <button
                  className="secondary"
                  onClick={() => {
                    setJob(j);
                    setRaw(j.raw_output || "");
                  }}
                >
                  导入 / 重新整理回复
                </button>
              )}
            </details>
          ))}
        </section>
      )}
      {job && (
        <Modal title="与连小理完成一次真实交互" onClose={() => setJob(null)}>
          <div className="stack">
            <p className="muted">
              ①复制上下文 → ②在连小理中对话 →
              ③粘贴回复。普通文本和JSON均可导入。
            </p>
            <textarea
              aria-label="AI上下文"
              value={job.prompt}
              readOnly
              rows={7}
            />
            <button className="secondary" onClick={copy}>
              <Copy size={16} />
              复制上下文
            </button>
            <label>
              连小理的原始回复
              <textarea
                rows={7}
                value={raw}
                onChange={(e) => setRaw(e.target.value)}
                placeholder="把实际收到的回复粘贴到这里"
              />
            </label>
            <button
              className="primary"
              disabled={busy || !raw.trim()}
              onClick={importReply}
            >
              保留原文并整理
            </button>
          </div>
        </Modal>
      )}
      {editing && (
        <Modal title="检查并确认续学卡" onClose={() => setEditing(null)}>
          <div className="stack">
            <p className="muted">
              核对事实与建议。确认会新增一个版本，不修改中断快照。
            </p>
            {[
              ["summary", "事实回顾"],
              ["blocker", "未解决的问题"],
              ["next_action", "下一步最小行动"],
              ["warmup", "可选的恢复问题"],
            ].map(([key, name]) => (
              <label key={key}>
                {name}
                <textarea
                  rows={3}
                  value={editing.content[key as keyof CardContent] || ""}
                  onChange={(e) =>
                    setEditing({
                      ...editing,
                      content: { ...editing.content, [key]: e.target.value },
                    })
                  }
                />
              </label>
            ))}
            <button className="primary" disabled={busy} onClick={accept}>
              <Check size={17} />
              确认保存
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
