import test from "node:test";
import assert from "node:assert/strict";
import "fake-indexeddb/auto";
import {
  overviewSignature,
  buildOverviewPrompt,
  parseOverviewReply,
} from "../src/home/overview-ai.mjs";
import { createLocalHandler } from "../src/local/adapter.mjs";
import { writeLocal } from "../src/sync/storage.mjs";

const task = (id, extra = {}) => ({
  id,
  title: `任务${id}`,
  course: "数学",
  goal: "掌握基础概念",
  status: "paused",
  revision: 2,
  updated_at: "2026-10-24T08:00:00Z",
  draft: {
    current_step: "做到第二章",
    blocker: "公式不熟",
    next_action: "复习例题",
  },
  steps: [{ id: "step", title: "读完第一章", done: true }],
  ...extra,
});

test("总览提示词只送出有限的当前学习事实并保留任务来源ID", () => {
  const tasks = Array.from({ length: 14 }, (_, i) =>
    task(String(i), { status: i === 13 ? "archived" : "paused" }),
  );
  const prompt = buildOverviewPrompt(tasks);
  assert.match(prompt, /"id":"0"/);
  assert.match(prompt, /"next_action":"复习例题"/);
  assert.doesNotMatch(prompt, /"id":"13"/);
  assert.doesNotMatch(prompt, /"id":"12"/);
  assert.match(prompt, /不得编造/);
});

test("总览回复不能推荐不存在的任务，也不能含空的关键结论", () => {
  const valid = JSON.stringify({
    progress: "已完成第一章",
    blockers: "公式不熟",
    next_step: "复习例题",
    recommended_task_id: "a",
  });
  assert.equal(parseOverviewReply(valid, ["a"]).recommended_task_id, "a");
  assert.throws(() => parseOverviewReply(valid, ["b"]), /未知任务/);
  assert.throws(
    () => parseOverviewReply('{"progress":"","next_step":"试试"}', ["a"]),
    /格式/,
  );
});

test("任务的状态或版本变化会使本机总结缓存失效", () => {
  assert.notEqual(
    overviewSignature([task("a")]),
    overviewSignature([task("a", { status: "done" })]),
  );
  assert.notEqual(
    overviewSignature([task("a")]),
    overviewSignature([task("a", { revision: 3 })]),
  );
});

test("总览生成使用当前本机模型且不会改写任务", async () => {
  const user = "overview-test";
  await writeLocal(user + ":local:settings", {
    ai: {
      default_provider: "http_provider",
      active_profile_id: "chosen",
      profiles: [
        {
          id: "chosen",
          name: "本机模型",
          api_url: "http://localhost/v1/chat/completions",
          model: "local",
          timeout: 30,
          encrypted_key: "sealed",
        },
      ],
    },
  });
  let request;
  const remote = async (path, options) => {
    request = { path, body: JSON.parse(options.body) };
    return {
      raw: JSON.stringify({
        progress: "已完成一章",
        blockers: "公式不熟",
        next_step: "复习例题",
        recommended_task_id: "",
      }),
    };
  };
  const handler = createLocalHandler(user, remote, { skipMigration: true });
  await handler("/tasks", {
    method: "POST",
    body: JSON.stringify({ title: "数学复习" }),
  });
  const before = await handler("/tasks");
  const result = await handler("/overview/ai-summary", {
    method: "POST",
    body: "{}",
  });
  assert.equal(request.path, "/local-ai/chat");
  assert.equal(request.body.config.model, "local");
  assert.match(request.body.prompt, /数学复习/);
  assert.equal(result.progress, "已完成一章");
  assert.deepEqual(await handler("/tasks"), before);
});

test("未选用模型时总览不会把学习信息发送到网络", async () => {
  let sent = false;
  const handler = createLocalHandler(
    "overview-no-model",
    async () => {
      sent = true;
    },
    { skipMigration: true },
  );
  await handler("/tasks", {
    method: "POST",
    body: JSON.stringify({ title: "未配置模型" }),
  });
  await assert.rejects(
    () => handler("/overview/ai-summary", { method: "POST", body: "{}" }),
    /选用模型/,
  );
  assert.equal(sent, false);
});
