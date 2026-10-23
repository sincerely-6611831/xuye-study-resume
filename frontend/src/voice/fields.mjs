/** 与服务端Snapshot的文本限制一致。AI不能修改暂停原因、步骤勾选或任务状态。 */
/** @type {Record<string, [string, number]>} */
export const VOICE_FIELDS = {
  current_step: ["当前做到哪里", 10000],
  next_action: ["下一步最小行动", 10000],
  thought: ["我当时在想什么", 20000],
  position: ["材料位置", 2000],
  completed: ["已经完成的内容", 20000],
  attempts: ["已经尝试的方法及结果", 20000],
  blocker: ["卡住的问题", 10000],
  notes: ["原始笔记", 30000],
};

export function mergeVoiceFields(
  draft,
  result,
  selected,
  domainKeys,
  append = true,
) {
  const next = { ...draft, domain_data: { ...draft.domain_data } };
  for (const key of selected) {
    const domainKey = key.startsWith("domain:") ? key.slice(7) : null;
    if (
      domainKey
        ? !domainKeys.includes(domainKey)
        : !Object.hasOwn(VOICE_FIELDS, key)
    )
      continue;
    const value = domainKey
      ? result.domain_data?.[domainKey]
      : result.fields?.[key];
    if (typeof value !== "string" || !value.trim()) continue;
    const current = domainKey ? next.domain_data[domainKey] : next[key];
    const merged =
      append && current ? current + "\n" + value.trim() : value.trim();
    const [label, limit] = domainKey ? ["专门记录", 30000] : VOICE_FIELDS[key];
    if (merged.length > limit)
      throw new Error(
        `${label}合并后过长，请缩短建议或改为替换。原草稿未改变。`,
      );
    if (domainKey) next.domain_data[domainKey] = merged;
    else next[key] = merged;
  }
  return next;
}

/** 异步开始时取票；用户输入、换文件或卸载后，旧结果只能作废。 */
export function createTextGuard() {
  let version = 0;
  return {
    ticket: () => version,
    changed: () => {
      version += 1;
    },
    isCurrent: (ticket) => ticket === version,
  };
}
