import test from "node:test";
import assert from "node:assert/strict";
import { mergeVoiceFields, createTextGuard } from "../src/voice/fields.mjs";

test("语音只填选中白名单文本，默认追加并保留其他字段和插件值", () => {
  const draft = {
    current_step: "已有进度",
    thought: "原思路",
    reason: "fatigue",
    domain_data: { conditions: "原条件" },
  };
  const result = {
    fields: {
      current_step: "口述进度",
      thought: "新思路",
      status: "done",
      reason: "unknown",
    },
    domain_data: { conditions: "新条件", unknown: "非法" },
  };
  const merged = mergeVoiceFields(
    draft,
    result,
    ["current_step", "domain:conditions", "reason", "status", "domain:unknown"],
    ["conditions"],
    true,
  );
  assert.equal(merged.current_step, "已有进度\n口述进度");
  assert.equal(merged.thought, "原思路");
  assert.equal(merged.reason, "fatigue");
  assert.equal(merged.status, undefined);
  assert.deepEqual(merged.domain_data, { conditions: "原条件\n新条件" });
  assert.equal(draft.current_step, "已有进度");
});
test("确认替换只作用于选中内容，超长合并拒绝且原草稿保留", () => {
  const draft = { position: "原位置", domain_data: {} };
  assert.equal(
    mergeVoiceFields(
      draft,
      { fields: { position: "新位置" } },
      ["position"],
      [],
      false,
    ).position,
    "新位置",
  );
  assert.throws(
    () =>
      mergeVoiceFields(
        { position: "x".repeat(2000), domain_data: {} },
        { fields: { position: "超长" } },
        ["position"],
        [],
        true,
      ),
    /材料位置/,
  );
});
test("迟到转写不能覆盖用户新输入，作废的提取结果不能填入", () => {
  const guard = createTextGuard();
  const ticket = guard.ticket();
  guard.changed();
  assert.equal(guard.isCurrent(ticket), false);
  assert.equal(guard.isCurrent(guard.ticket()), true);
});
