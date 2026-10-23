/** 所有网络请求经过这里，页面不用重复处理登录、JSON和错误状态。 */
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export async function api<T>(
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
export const post = <T>(path: string, body: unknown = {}) =>
  api<T>(path, { method: "POST", body: JSON.stringify(body) });
