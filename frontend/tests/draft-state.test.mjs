import { test } from "node:test";
import assert from "node:assert/strict";
import { DraftGuard } from "../src/sync/draft-state.mjs";
import { selectCachedResume } from "../src/resume/select-card.mjs";

const task = (revision) => ({ revision, session: { id: "session-1" } });

test("上传附件等刷新不能把另一设备的新版本号套给本机旧草稿", () => {
  const g = new DraftGuard(task(1));
  g.edit();
  g.observe(task(2));
  assert.equal(g.conflict, true);
  assert.throws(() => g.beginWrite(), /版本/);
  g.chooseLocal(task(2));
  assert.equal(g.beginWrite().revision, 2);
});

test("旧同步请求返回成功后，期间新增的输入仍标记为未同步且不能清除", () => {
  const g = new DraftGuard(task(1));
  g.edit();
  const submission = g.beginWrite();
  g.edit();
  assert.equal(g.finishWrite(task(2), submission), false);
  assert.equal(g.dirty, true);
  assert.equal(g.beginWrite().revision, 2);
});

test("恢复旧草稿后必须检测会话接管，自己的元数据修改可以推进基准", () => {
  const g = new DraftGuard(task(1));
  g.restore({ revision: 1, session_id: "old-session" });
  g.observe(task(1));
  assert.throws(() => g.beginWrite(), /版本/);
  g.chooseLocal(task(1));
  g.observe(task(2), true);
  assert.equal(g.beginWrite().revision, 2);
});

test("离线优先展示当前快照已确认的续学卡，不被其他快照或候选卡替代", () => {
  const cp = {
    id: "cp1",
    payload: { current_step: "原始步骤", next_action: "原始下一步" },
  };
  const cards = [
    {
      checkpoint_id: "cp2",
      status: "accepted",
      created_at: "2026-10-23T12:00:00Z",
      content: { summary: "另一快照" },
    },
    {
      checkpoint_id: "cp1",
      status: "draft",
      created_at: "2026-10-23T12:00:00Z",
      content: { summary: "未确认" },
    },
    {
      checkpoint_id: "cp1",
      status: "accepted",
      created_at: "2026-10-23T11:00:00Z",
      content: { summary: "已确认整理结果" },
    },
  ];
  assert.equal(selectCachedResume(cp, cards).content.summary, "已确认整理结果");
  assert.equal(selectCachedResume(cp, []).content.summary, "原始步骤");
});
