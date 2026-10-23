/** 所有网络请求经过这里，页面不用重复处理登录、JSON和错误状态。 */
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export async function remoteApi<T>(
  path: string,
  options: RequestInit = {},
): Promise<T> {
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
