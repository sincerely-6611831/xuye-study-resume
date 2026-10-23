import { useEffect, useRef, useState } from "react";
import { Sparkles, Mic, Check, ArrowRight } from "lucide-react";
import { api } from "../api/client";
import { Modal } from "../components/Modal";
import { VoiceCapture } from "./VoiceCapture";
import { ModelSettings } from "../settings/ModelSettings";
import type { AppSettings } from "../settings/types";
import { createTextGuard, VOICE_FIELDS } from "./fields.mjs";
import type { Plugin } from "../types";

export interface VoiceResult {
  fields: Record<string, string>;
  domain_data: Record<string, string>;
  model?: string;
  profile_name?: string;
}

/** 转写、编辑、整理、确认四步分开，用户总能看到将填入的内容。 */
export function VoiceAssistant({
  taskId,
  plugin,
  onClose,
  onApply,
}: {
  taskId: string;
  plugin?: Plugin;
  onClose: () => void;
  onApply: (result: VoiceResult, selected: string[], append: boolean) => void;
}) {
  const [audio, setAudio] = useState<File | null>(null);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState("");
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<VoiceResult | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [append, setAppend] = useState(true);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [configMessage, setConfigMessage] = useState("");
  const guard = useRef(createTextGuard());
  const mounted = useRef(true);
  const abortRef = useRef<AbortController | null>(null);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      guard.current.changed();
      abortRef.current?.abort();
    };
  }, []);
  function changeText(value: string) {
    guard.current.changed();
    setText(value);
    setResult(null);
    setSelected([]);
  }
  async function run(kind: "transcribe" | "summarize") {
    setBusy(kind);
    setError("");
    setResult(null);
    const ticket = guard.current.ticket();
    const abort = new AbortController();
    abortRef.current = abort;
    try {
      if (kind === "transcribe" && audio) {
        const data = new FormData();
        data.set("file", audio);
        const response = await api<{ transcript: string }>(
          `/tasks/${taskId}/voice/transcribe`,
          { method: "POST", body: data, signal: abort.signal },
        );
        if (guard.current.isCurrent(ticket) && mounted.current)
          changeText(response.transcript);
        else if (mounted.current)
          setError("转写期间文本发生了变化，保留你的最新输入。可再次转写。");
      } else {
        const response = await api<VoiceResult>(
          `/tasks/${taskId}/voice/summarize`,
          {
            method: "POST",
            body: JSON.stringify({ transcript: text }),
            signal: abort.signal,
          },
        );
        if (!mounted.current || !guard.current.isCurrent(ticket)) return;
        setResult(response);
        setSelected([
          ...Object.keys(response.fields),
          ...Object.keys(response.domain_data).map((key) => "domain:" + key),
        ]);
      }
    } catch (e) {
      if (mounted.current) setError((e as Error).message);
    } finally {
      if (mounted.current) setBusy("");
    }
  }
  async function openSettings() {
    setBusy("settings");
    setError("");
    try {
      const next = await api<AppSettings>("/settings");
      if (mounted.current) {
        setSettings(next);
        setConfigMessage("");
      }
    } catch (e) {
      if (mounted.current) setError((e as Error).message);
    } finally {
      if (mounted.current) setBusy("");
    }
  }
  const suggestions = result
    ? [
        ...Object.entries(result.fields)
          .filter(([key]) => Object.hasOwn(VOICE_FIELDS, key))
          .map(([key, value]) => ({ key, label: VOICE_FIELDS[key][0], value })),
        ...Object.entries(result.domain_data)
          .filter(([key]) => plugin?.fields.some((f) => f.key === key))
          .map(([key, value]) => ({
            key: "domain:" + key,
            label: plugin?.fields.find((f) => f.key === key)?.label || key,
            value,
          })),
      ]
    : [];
  return (
    <>
      <Modal title="语音整理中断记录" onClose={onClose}>
        <div className="stack voice-assistant">
          <p className="muted">
            说说做到哪里、刚才的思路、卡点和下一步。AI只整理你说出的内容，确认后才填入草稿。
          </p>
          <VoiceCapture
            audio={audio}
            disabled={!!busy}
            onRecordingChange={setRecording}
            onAudio={(file) => {
              guard.current.changed();
              setAudio(file);
              setResult(null);
              setError("");
            }}
          />
          <button
            className="secondary"
            disabled={!audio || !!busy || recording}
            onClick={() => run("transcribe")}
          >
            <Mic size={16} />
            {busy === "transcribe" ? "正在转写…" : "转写音频"}
          </button>
          <label>
            转写文本（可修改，也可直接输入）
            <textarea
              rows={6}
              maxLength={30000}
              value={text}
              onChange={(e) => changeText(e.target.value)}
              placeholder="例如：高数第3题已经列好条件，但还没确定分部积分怎么选。下次先比较两种选择。"
            />
          </label>
          <div className="actions">
            <button
              className="primary"
              disabled={!text.trim() || !!busy || recording}
              onClick={() => run("summarize")}
            >
              <Sparkles size={16} />
              {busy === "summarize" ? "AI正在整理…" : "AI整理为表单"}
            </button>
            <button
              className="quiet"
              disabled={recording || !!busy}
              onClick={openSettings}
            >
              配置识别与整理模型
              <ArrowRight size={14} />
            </button>
          </div>
          <small>
            转写文本会发送给你选用的整理模型。原始音频仅在本次请求中处理，不作为附件永久保存。
          </small>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          {result && (
            <section className="voice-preview stack">
              <div>
                <h3>检查待填内容</h3>
                <small>
                  整理模型：{result.profile_name} · {result.model}
                </small>
              </div>
              {suggestions.map((item) => (
                <div key={item.key} className="voice-suggestion">
                  <label className="inline-check">
                    <input
                      type="checkbox"
                      checked={selected.includes(item.key)}
                      onChange={(e) =>
                        setSelected(
                          e.target.checked
                            ? [...selected, item.key]
                            : selected.filter((key) => key !== item.key),
                        )
                      }
                    />
                    {item.label}
                  </label>
                  <textarea
                    aria-label={"建议：" + item.label}
                    rows={2}
                    maxLength={
                      item.key.startsWith("domain:")
                        ? 30000
                        : VOICE_FIELDS[item.key][1]
                    }
                    value={item.value}
                    onChange={(e) =>
                      setResult((prev) =>
                        prev
                          ? item.key.startsWith("domain:")
                            ? {
                                ...prev,
                                domain_data: {
                                  ...prev.domain_data,
                                  [item.key.slice(7)]: e.target.value,
                                },
                              }
                            : {
                                ...prev,
                                fields: {
                                  ...prev.fields,
                                  [item.key]: e.target.value,
                                },
                              }
                          : prev,
                      )
                    }
                  />
                </div>
              ))}
              <label className="inline-check">
                <input
                  type="checkbox"
                  checked={append}
                  onChange={(e) => setAppend(e.target.checked)}
                />
                追加到已有内容
              </label>
              {!append && (
                <p className="muted">
                  选中的文本框将使用以上内容替换，请检查后填入。
                </p>
              )}
              <button
                className="primary"
                disabled={!selected.length || !!busy || recording}
                onClick={() => {
                  try {
                    onApply(result, selected, append);
                  } catch (e) {
                    setError((e as Error).message);
                  }
                }}
              >
                <Check size={16} />
                填入选中字段
              </button>
              <small>
                填入后可继续修改。点击工作台的“保存并暂停”才会生成中断快照。
              </small>
            </section>
          )}
        </div>
      </Modal>
      {settings && (
        <Modal title="语音与模型设置" onClose={() => setSettings(null)}>
          <div className="stack">
            <p className="muted">
              录音和口述仍留在原弹窗中，配置完成后可以继续整理。
            </p>
            <ModelSettings
              settings={settings}
              onUpdated={setSettings}
              notify={setConfigMessage}
            />
            {configMessage && <p role="status">{configMessage}</p>}
            <button className="primary" onClick={() => setSettings(null)}>
              完成配置，返回语音记录
            </button>
          </div>
        </Modal>
      )}
    </>
  );
}
