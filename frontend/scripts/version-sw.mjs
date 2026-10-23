// 每次产物改变都更新缓存名，防止新旧JS/CSS混用。
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
const hash = createHash("sha256")
  .update(readFileSync("dist/index.html"))
  .digest("hex")
  .slice(0, 12);
const path = "dist/sw.js";
writeFileSync(
  path,
  readFileSync(path, "utf8").replace(
    "study-resume-shell-v1",
    `study-resume-shell-${hash}`,
  ),
);
