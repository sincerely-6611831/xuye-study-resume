/**
 * 草稿的版本守卫独立于React页面：读取了新版本，并不意味着旧草稿已完成合并。
 * 只有明确选择版本或确认自己的写操作后，才允许推进草稿的基准版本。
 */
export class DraftGuard {
  constructor(task) {
    this.revision = task.revision;
    this.sessionId = task.session?.id ?? null;
    this.generation = 0;
    this.dirty = false;
    this.conflict = false;
  }
  edit() {
    this.generation += 1;
    this.dirty = true;
  }
  restore(local) {
    this.revision = local.revision;
    this.sessionId = local.session_id;
    this.edit();
  }
  observe(task, ownChange = false) {
    const different =
      task.revision !== this.revision ||
      (task.session?.id ?? null) !== this.sessionId;
    if (this.dirty && different && !ownChange) {
      this.conflict = true;
      return;
    }
    this.revision = task.revision;
    this.sessionId = task.session?.id ?? null;
  }
  beginWrite() {
    if (this.conflict)
      throw new Error("版本已经变化，请先对照并选择保留哪一份草稿。");
    return {
      generation: this.generation,
      revision: this.revision,
      sessionId: this.sessionId,
    };
  }
  finishWrite(updated, submission) {
    this.observe(updated, true);
    // 旧请求只能确认提交时的那一代输入，不能清除后续新增的编辑。
    const unchanged = submission.generation === this.generation;
    this.dirty = !unchanged;
    return unchanged;
  }
  chooseServer(task) {
    this.dirty = false;
    this.conflict = false;
    this.observe(task, true);
  }
  chooseLocal(task) {
    this.conflict = false;
    this.observe(task, true);
    this.edit();
  }
}
