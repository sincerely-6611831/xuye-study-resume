import { useEffect, useRef, useState } from "react";
import { Mic, Square, Upload, Headphones } from "lucide-react";

const MAX_BYTES = 20 * 1024 * 1024;

/** 只负责采集声音，不在这里发网络请求。离开页面必须释放所有麦克风轨道。 */
export function VoiceCapture({
  audio,
  disabled,
  onAudio,
  onRecordingChange,
}: {
  audio: File | null;
  disabled: boolean;
  onAudio: (file: File) => void;
  onRecordingChange: (busy: boolean) => void;
}) {
  const [recording, setRecording] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [seconds, setSeconds] = useState(0);
  const [error, setError] = useState("");
  const [audioUrl, setAudioUrl] = useState("");
  const streamRef = useRef<MediaStream | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const mounted = useRef(true);
  const timerRef = useRef<ReturnType<typeof setInterval> | undefined>(
    undefined,
  );
  const recordingAvailable =
    !!navigator.mediaDevices?.getUserMedia &&
    typeof MediaRecorder !== "undefined";
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      clearInterval(timerRef.current);
      const recorder = recorderRef.current;
      if (recorder && recorder.state !== "inactive") recorder.stop();
      streamRef.current?.getTracks().forEach((track) => track.stop());
    };
  }, []);
  useEffect(() => {
    if (!audio) {
      setAudioUrl("");
      return;
    }
    const url = URL.createObjectURL(audio);
    setAudioUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [audio]);
  function choose(file?: File) {
    if (!file) return;
    if (!file.size || file.size > MAX_BYTES) {
      setError("请选择非空且不超过20MB的音频。");
      return;
    }
    setError("");
    onAudio(file);
  }
  async function start() {
    setError("");
    setRequesting(true);
    onRecordingChange(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!mounted.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      streamRef.current = stream;
      // 按浏览器能力选择格式；Safari通常支持mp4，Chrome通常支持webm。
      const mime = [
        "audio/webm;codecs=opus",
        "audio/mp4",
        "audio/ogg;codecs=opus",
      ].find((type) => MediaRecorder.isTypeSupported(type));
      const recorder = new MediaRecorder(
        stream,
        mime ? { mimeType: mime } : undefined,
      );
      recorderRef.current = recorder;
      const chunks: BlobPart[] = [];
      let size = 0;
      recorder.ondataavailable = (event) => {
        if (event.data.size) {
          chunks.push(event.data);
          size += event.data.size;
        }
        if (size > MAX_BYTES && recorder.state !== "inactive") recorder.stop();
      };
      recorder.onstop = () => {
        clearInterval(timerRef.current);
        stream.getTracks().forEach((track) => track.stop());
        if (!mounted.current) return;
        setRecording(false);
        onRecordingChange(false);
        if (size > MAX_BYTES) {
          setError("录音超过20MB，请重新录制更短的片段。");
          return;
        }
        const type = recorder.mimeType || mime || "audio/webm";
        const extension = type.includes("mp4")
          ? "m4a"
          : type.includes("ogg")
            ? "ogg"
            : "webm";
        choose(new File(chunks, "中断口述." + extension, { type }));
      };
      recorder.onerror = () => {
        stream.getTracks().forEach((track) => track.stop());
        clearInterval(timerRef.current);
        if (mounted.current) {
          setError("录音失败，请重新尝试或上传音频。");
          setRecording(false);
          onRecordingChange(false);
        }
      };
      recorder.start(1000);
      setSeconds(0);
      setRecording(true);
      const started = Date.now();
      timerRef.current = setInterval(() => {
        const elapsed = Math.floor((Date.now() - started) / 1000);
        setSeconds(elapsed);
        if (elapsed >= 180 && recorder.state !== "inactive") recorder.stop();
      }, 500);
    } catch {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      if (mounted.current) {
        setError("无法使用麦克风。请检查权限，或上传音频、直接输入转写文本。");
        onRecordingChange(false);
      }
    } finally {
      if (mounted.current) setRequesting(false);
    }
  }
  return (
    <div className="voice-capture stack">
      <div className="actions">
        {recording ? (
          <button
            type="button"
            className="primary"
            onClick={() => recorderRef.current?.stop()}
          >
            <Square size={16} />
            停止录音 · {seconds}秒
          </button>
        ) : (
          <button
            type="button"
            className="secondary"
            disabled={disabled || requesting || !recordingAvailable}
            onClick={start}
          >
            <Mic size={16} />
            {requesting ? "等待麦克风权限…" : "开始录音"}
          </button>
        )}
        <label className="secondary voice-upload">
          <Upload size={16} />
          上传音频
          <input
            type="file"
            aria-label="上传语音音频"
            accept=".wav,.mp3,.m4a,.mp4,.webm,.ogg,.flac,.mpeg,.mpga"
            disabled={disabled || requesting || recording}
            onChange={(e) => {
              choose(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
        </label>
      </div>
      <small>
        单次录音最多3分钟，音频不超过20MB。点击“转写音频”后才发送到你配置的识别服务。
      </small>
      {!recordingAvailable && (
        <p className="muted">
          此环境无法直接录音。可上传手机录音，或在下方使用输入法语音输入。网页麦克风需要HTTPS或本机localhost。
        </p>
      )}
      {audio && (
        <div className="voice-audio">
          <span>
            <Headphones size={15} />
            {audio.name} · {(audio.size / 1024 / 1024).toFixed(2)}MB
          </span>
          {audioUrl && <audio controls src={audioUrl} />}
        </div>
      )}
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
    </div>
  );
}
