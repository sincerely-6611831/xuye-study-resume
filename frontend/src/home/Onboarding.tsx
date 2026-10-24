import { useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Bookmark,
  CloudUpload,
  CirclePause,
  Plus,
} from "lucide-react";
import { Modal } from "../components/Modal";

const pages = [
  {
    icon: Plus,
    title: "先建立一项学习任务",
    body: "写下课程、目标和几个小步骤。以后每次学习，都从这个任务进入。",
  },
  {
    icon: CirclePause,
    title: "中断时留下线索",
    body: "记下现在做到哪里、卡住的点与下一步。可以用语音转写和 AI 帮你整理，确认后再保存。",
  },
  {
    icon: Bookmark,
    title: "回来时继续",
    body: "首页总览会指出待续接任务。打开任务，阅读断点和续学卡，从最小行动重新开始。",
  },
  {
    icon: CloudUpload,
    title: "跨设备只选两条路",
    body: "学习数据先存当前设备。需要迁移时，到个人 → 设置 → 数据与同步，选择自建服务器手动发送/接收，或导出完整 ZIP 再到目标设备导入。",
  },
];

/** 每个设备、每个账号只自动显示一次；个人页仍提供重新查看入口。 */
export function Onboarding({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState(0);
  const item = pages[step];
  const Icon = item.icon;
  return (
    <Modal title="欢迎使用续页" onClose={onClose}>
      <div className="onboarding">
        <div className="onboarding-icon">
          <Icon size={30} />
        </div>
        <span className="eyebrow">
          {step + 1} / {pages.length}
        </span>
        <h2>{item.title}</h2>
        <p>{item.body}</p>
        <div className="onboarding-dots" aria-label="引导进度">
          {pages.map((_, index) => (
            <span key={index} className={index === step ? "current" : ""} />
          ))}
        </div>
        <div className="actions">
          <button className="quiet" onClick={onClose}>
            跳过
          </button>
          {step > 0 && (
            <button className="secondary" onClick={() => setStep(step - 1)}>
              <ArrowLeft size={16} />
              上一步
            </button>
          )}
          <button
            className="primary"
            onClick={() =>
              step === pages.length - 1 ? onClose() : setStep(step + 1)
            }
          >
            {step === pages.length - 1 ? "开始使用" : "下一步"}
            <ArrowRight size={16} />
          </button>
        </div>
      </div>
    </Modal>
  );
}
