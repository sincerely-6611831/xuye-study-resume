import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles.css";
import "./settings/settings.css";

createRoot(document.getElementById("root")!).render(<App />);
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
