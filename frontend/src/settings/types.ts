/** 设置模块的接口类型。API密钥只有新输入的表单值，服务端列表不会返回密钥。 */
export interface Appearance {
  theme: "light" | "dark" | "system";
  accent: "sage" | "blue" | "violet";
  font_size: "small" | "medium" | "large";
  density: "comfortable" | "compact";
}
export interface ModelProfile {
  id: string;
  name: string;
  api_url: string;
  model: string;
  timeout: number;
  has_api_key: boolean;
}
export interface AppSettings {
  version: string;
  appearance: Appearance;
  ai: {
    default_provider: "manual_lianxiaoli" | "http_provider";
    active_profile_id: string | null;
    profiles: ModelProfile[];
    environment_available: boolean;
    environment_model: string;
  };
  http_ai_configured: boolean;
  model: string;
  speech: {
    enabled: boolean;
    api_url: string;
    model: string;
    language: string;
    timeout: number;
    has_api_key: boolean;
    summary_profile_id: string | null;
  };
}
