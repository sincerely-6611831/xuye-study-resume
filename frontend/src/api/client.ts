/** 所有网络请求经过这里，页面不用重复处理登录、JSON和错误状态。 */
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
type AndroidBridge = {
  isEmbedded?: () => boolean;
  requestAi?: (id: string, path: string, body: string) => void;
};
const androidWindow = window as Window & {
  XuYeAndroid?: AndroidBridge;
  __xuYeNativeResolve?: (id: string, ok: boolean, payload: string) => void;
};
const pendingNative = new Map<
  string,
  { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }
>();
// Android 的 Java 网络适配器在后台线程运行，结果通过一次性 ID 返回给对应请求。
androidWindow.__xuYeNativeResolve = (id, ok, payload) => {
  const waiting = pendingNative.get(id);
  if (!waiting) return;
  clearTimeout(waiting.timer);
  pendingNative.delete(id);
  if (ok) {
    try { waiting.resolve(JSON.parse(payload)); }
    catch { waiting.reject(new ApiError(502, "模型返回了无效数据")); }
  } else waiting.reject(new ApiError(502, payload));
};
function fileAsBase64(file: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || "").split(",")[1] || "");
    reader.onerror = () => reject(new ApiError(422, "无法读取音频文件"));
    reader.readAsDataURL(file);
  });
}
async function nativeAiRequest<T>(bridge: AndroidBridge, path: string, options: RequestInit): Promise<T> {
  if (!bridge.requestAi) throw new ApiError(0, "APK 的模型模块不可用，请更新安装包。");
  let body: Record<string, unknown>;
  if (options.body instanceof FormData) {
    const audio = options.body.get("file");
    if (!(audio instanceof File)) throw new ApiError(422, "请选择音频文件");
    body = {
      config: JSON.parse(String(options.body.get("config") || "{}")),
      name: audio.name,
      mime: audio.type,
      audio: await fileAsBase64(audio),
    };
  } else body = JSON.parse(String(options.body || "{}"));
  const id = crypto.randomUUID();
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      pendingNative.delete(id);
      reject(new ApiError(504, "模型请求超时"));
    }, 135000);
    pendingNative.set(id, { resolve: (value) => resolve(value as T), reject, timer });
    try { bridge.requestAi!(id, path, JSON.stringify(body)); }
    catch (error) {
      clearTimeout(timer);
      pendingNative.delete(id);
      reject(new ApiError(502, (error as Error).message));
    }
  });
}
export async function remoteApi<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  // Android 安装包内置网页与本机学习仓库。首次启动不依赖电脑网关。
  // 连接电脑时仍可使用 APK 中的“连接电脑”入口切换到远端登录空间。
  const android = androidWindow.XuYeAndroid;
  if (android?.isEmbedded?.()) {
    if (path === "/auth/me" || path === "/auth/login" || path === "/auth/register")
      return { id: "android-local", username: "本机用户" } as T;
    if (path === "/auth/logout") return {} as T;
    if (path.startsWith("/local-ai/") && path !== "/local-ai/settings-bootstrap")
      return nativeAiRequest<T>(android, path, options);
    throw new ApiError(0, "本机学习功能可离线使用；跨设备同步需先连接电脑。");
  }
  const isFile = options.body instanceof FormData;
  let response: Response;
  try {
    response = await fetch("/api" + path, {
      ...options,
      credentials: "same-origin",
      headers: {
        ...(!isFile ? { "Content-Type": "application/json" } : {}),
        ...options.headers,
      },
    });
  } catch {
    throw new ApiError(0, "当前无法连接服务，草稿会保存在本机。");
  }
  if (!response.ok) {
    let message = `请求失败（${response.status}）`;
    try {
      const data = await response.json();
      message =
        typeof data.detail === "string"
          ? data.detail
          : "填写内容不符合要求，请检查必填项、长度和格式。";
    } catch {
      /* 服务可能返回非JSON错误页，保留状态码。 */
    }
    throw new ApiError(response.status, message);
  }
  return response.json();
}
import { createLocalHandler } from "../local/adapter.mjs";
import { configureSync } from "../local/sync.mjs";
const handlers = new Map<string, ReturnType<typeof createLocalHandler>>();
let tabAccount: string | null = null;
configureSync(remoteApi);
/** 学习数据始终经过本机仓库；网络仅用于登录、主动同步和主动AI请求。 */
export async function api<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
  if (path.startsWith("/auth/")) {
    const result = await remoteApi<T>(path, options);
    if (["/auth/me", "/auth/login", "/auth/register"].includes(path))
      localStorage.setItem("study-last-user", JSON.stringify(result));
    if (result && typeof result === "object" && "id" in result)
      tabAccount = String(result.id);
    return result;
  }
  const user = JSON.parse(localStorage.getItem("study-last-user") || "null");
  if (!user?.id) throw new ApiError(401, "请先登录");
  tabAccount ??= user.id;
  if (tabAccount !== user.id)
    throw new ApiError(409, "账号已在其他页面切换，请重新登录或刷新当前页面。");
  if (!handlers.has(user.id))
    handlers.set(
      user.id,
      createLocalHandler(user.id, remoteApi, {
        downloadLegacy: async (url: string) => {
          const response = await fetch("/api" + url, {
            credentials: "same-origin",
            headers: { "X-Study-User": user.id },
          });
          if (!response.ok)
            throw new ApiError(
              response.status,
              "旧材料读取失败，请保持网关开启后重试。",
            );
          return response.blob();
        },
      }),
    );
  try {
    const result = await handlers.get(user.id)!(path, options);
    if (
      JSON.parse(localStorage.getItem("study-last-user") || "null")?.id !==
      user.id
    )
      throw new ApiError(409, "账号已切换，请刷新当前页面");
    return result as T;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    const e = error as Error & { status?: number };
    throw new ApiError(e.status || 422, e.message);
  }
}
export const post = <T>(path: string, body: unknown = {}) =>
  api<T>(path, { method: "POST", body: JSON.stringify(body) });
