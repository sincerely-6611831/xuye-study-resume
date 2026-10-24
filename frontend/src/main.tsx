import { createRoot } from "react-dom/client";
import { MotionConfig } from "motion/react";
import App from "./App";
import "./styles.css";
import "./settings/settings.css";
import "./voice/voice.css";
import "./visual-refresh.css";

// Motion 的全局设置让后续新增动画默认尊重系统的“减少动态效果”。
createRoot(document.getElementById("root")!).render(
  <MotionConfig reducedMotion="user">
    <App />
  </MotionConfig>,
);
// HTTPS或localhost支持service worker；普通HTTP局域网仍可使用核心网页。
if (
  "serviceWorker" in navigator &&
  window.isSecureContext &&
  import.meta.env.PROD
) {
  navigator.serviceWorker.register("/sw.js").catch(() => {
    /* 缓存不可用时继续使用在线网页。 */
  });
}
