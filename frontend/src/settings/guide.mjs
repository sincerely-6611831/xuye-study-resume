/** 两种跨设备路径共用这一份名称，教程和设置页不会写出相互矛盾的说明。 */
export const syncMethods = [
  {
    id: "server",
    title: "自建服务器同步",
    summary: "自己部署续页服务；各设备登录同一账号，主动选择任务发送和接收。",
  },
  {
    id: "zip",
    title: "完整 ZIP 导出 / 导入",
    summary: "不需要服务器；在原设备导出完整 ZIP，再到目标设备导入为副本。",
  },
];

/** 只允许服务器根地址；避免把账号密码、令牌或任意路径带进导航。 */
export function normalizeServerUrl(input) {
  let url;
  try {
    url = new URL(String(input).trim());
  } catch {
    throw new Error("请输入完整的服务器地址，例如 https://study.example.com");
  }
  if (
    !["http:", "https:"].includes(url.protocol) ||
    !url.hostname ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash
  )
    throw new Error(
      "服务器地址只能填写 HTTP(S) 根地址，不要包含路径、账号或参数。",
    );
  return url.origin + "/";
}
