/** 这些类型对应后端接口；修改字段时，两端应保持一致。 */
export interface User {
  id: string;
  username: string;
}
export interface Plugin {
  id: string;
  version: string;
  name: string;
  description: string;
  warmup: string;
  fields: { key: string; label: string; hint: string }[];
}
export interface Snapshot {
  current_step: string;
  position: string;
  completed: string;
  thought: string;
  attempts: string;
  blocker: string;
  next_action: string;
  notes: string;
  reason: string;
  domain_data: Record<string, string>;
}
export interface Session {
  id: string;
  task_id: string;
  device_id: string;
  started_at: string;
  ended_at: string | null;
  source_checkpoint_id: string | null;
}
export interface Task {
  id: string;
  title: string;
  course: string;
  goal: string;
  plugin_id: string;
  status: string;
  stage: string;
  revision: number;
  updated_at: string;
  draft: Partial<Snapshot>;
  session: Session | null;
  steps: { id: string; title: string; done: boolean }[];
}
export interface Checkpoint {
  id: string;
  task_id: string;
  session_id: string;
  payload: Snapshot;
  plugin_id: string;
  plugin_version: string;
  created_at: string;
}
export interface CardContent {
  summary: string;
  blocker: string;
  next_action: string;
  warmup: string;
}
export interface Card {
  id: string;
  checkpoint_id: string;
  content: CardContent;
  status: string;
  created_at: string;
}
export interface AIJob {
  id: string;
  checkpoint_id: string;
  provider: string;
  status: string;
  prompt: string;
  raw_output: string | null;
  error: string | null;
  created_at: string;
}
export interface Resource {
  id: string;
  filename: string;
  size: number;
  sha256: string;
}
export interface Detail {
  task: Task;
  checkpoints: Checkpoint[];
  cards: Card[];
  jobs: AIJob[];
  resources: Resource[];
  sessions: Session[];
  events: { session_id: string; event_type: string; created_at: string }[];
}
export const emptySnapshot = (): Snapshot => ({
  current_step: "",
  position: "",
  completed: "",
  thought: "",
  attempts: "",
  blocker: "",
  next_action: "",
  notes: "",
  reason: "time_limit",
  domain_data: {},
});
export const statusNames: Record<string, string> = {
  todo: "未开始",
  active: "学习中",
  paused: "已暂停",
  blocked: "遇到障碍",
  done: "已完成",
  archived: "已归档",
};
export const reasons: Record<string, string> = {
  time_limit: "时间到了",
  external_interrupt: "临时有事",
  knowledge_gap: "知识卡点",
  waiting_resource: "等待资料",
  fatigue: "需要休息",
  unknown: "其他原因",
};
export const dateText = (value: string) =>
  new Date(value).toLocaleString("zh-CN", {
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
// HTTP局域网环境不一定支持randomUUID；这只是本地标识，不用作登录凭据。
export const newId = () =>
  globalThis.crypto?.randomUUID?.() ??
  `${Date.now()}-${Math.random().toString(36).slice(2)}`;
export function deviceId(): string {
  let value = localStorage.getItem("study-device");
  if (!value) {
    value = newId();
    localStorage.setItem("study-device", value);
  }
  return value;
}
