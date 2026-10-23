/** 离线恢复使用与在线相同的选择顺序：本快照的最近确认卡 → 原始记录模板。 */
export function selectCachedResume(checkpoint, cards) {
  const card = cards
    .filter((c) => c.checkpoint_id === checkpoint.id && c.status === "accepted")
    .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
  if (card) return { provider: "confirmed", content: card.content };
  return {
    provider: "template",
    content: {
      summary: checkpoint.payload.current_step || "尚未填写当前步骤",
      blocker: checkpoint.payload.blocker || "暂无明确障碍",
      next_action: checkpoint.payload.next_action || "先回看原始记录",
      warmup: "回顾一下上次的思路，再继续。",
    },
  };
}
