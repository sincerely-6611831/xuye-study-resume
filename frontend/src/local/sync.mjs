import { LocalRepository, requireValue } from "./repository.mjs";
import { packBundle, unpackBundle, forkRecord } from "./bundles.mjs";
import { atomicRecords } from "../sync/storage.mjs";
import { allPlugins, installPlugin } from "./custom-plugins.mjs";
let remoteApi;
export function configureSync(remote) {
  remoteApi = remote;
}
export function currentUserId() {
  const user = JSON.parse(localStorage.getItem("study-last-user") || "null");
  requireValue(user?.id, "请先登录", 401);
  return user.id;
}
export async function listLocalTasks() {
  const repo = new LocalRepository(currentUserId());
  const records = await Promise.all(
    (await repo.list()).map((r) => repo.effective(r.detail.task.id)),
  );
  return records.map((r) => ({
    task_id: r.detail.task.id,
    title: r.detail.task.title,
    dirty: r.dirty,
    base_revision: r.base_revision,
    updated_at: r.detail.task.updated_at,
  }));
}
export const listRemoteTasks = () => remoteApi("/device-sync");
export async function pushRecord(repo, id, remote) {
  const record = await repo.effective(id),
    version = record.local_version;
  const plugin = (await allPlugins(repo.userId)).find(
    (p) => p.id === record.detail.task.plugin_id,
  );
  requireValue(plugin, "任务使用的自定义插件已丢失，请先从ZIP恢复插件");
  const response = await remote("/device-sync/" + id, {
    method: "PUT",
    headers: { "X-Study-User": repo.userId },
    body: JSON.stringify({
      expected_revision: record.base_revision,
      device_name: "学习设备",
      bundle: await packBundle(record, plugin),
    }),
  });
  // 在等待网络时可能继续编辑；只更新同步基准，绝不把新内容标成已上传。
  await atomicRecords(
    [repo.prefix + id, repo.userId + ":draft:" + id],
    ([current, draft]) => ({
      writes: [
        [
          repo.prefix + id,
          {
            ...current,
            base_revision: Math.max(
              current.base_revision || 0,
              response.revision,
            ),
            dirty:
              (current.base_revision || 0) > response.revision ||
              current.local_version !== version ||
              !!(
                draft?.dirty &&
                JSON.stringify(draft.payload) !==
                  JSON.stringify(record.detail.task.draft)
              ),
          },
        ],
      ],
    }),
  );
  return response;
}
export async function pullRecord(repo, id, remote) {
  const response = await remote("/device-sync/" + id, {
    headers: { "X-Study-User": repo.userId },
  });
  const incoming = unpackBundle(response.bundle);
  if (incoming.plugin) await installPlugin(repo.userId, incoming.plugin);
  incoming.base_revision = response.revision;
  // 本机活跃会话成为历史；接收后在本机重新开始，不能接管另一设备的旧session。
  incoming.detail.task.session = null;
  incoming.detail.sessions.forEach((s) => {
    s.ended_at ||= new Date().toISOString();
  });
  if (incoming.detail.task.status === "active")
    incoming.detail.task.status = "paused";
  return atomicRecords(
    [
      repo.prefix + id,
      repo.userId + ":draft:" + id,
      repo.userId + ":voice:" + id,
    ],
    ([previous, draft, voice]) => {
      requireValue(
        !previous?.base_revision || response.revision >= previous.base_revision,
        "已收到较旧的同步响应，本机较新版本已保留，请重新获取。",
        409,
      );
      const writes = [];
      let keptCopy = false;
      if (previous && (previous.dirty || draft?.dirty || voice)) {
        if (draft?.dirty) previous.detail.task.draft = draft.payload;
        const copy = forkRecord(previous);
        writes.push([repo.prefix + copy.detail.task.id, copy]);
        if (voice)
          writes.push([repo.userId + ":voice:" + copy.detail.task.id, voice]);
        keptCopy = true;
      }
      incoming.detail.task.revision = Math.max(
        incoming.detail.task.revision,
        (previous?.detail.task.revision || 0) + 1,
      );
      incoming.local_version = (previous?.local_version || 0) + 1;
      writes.push([repo.prefix + id, incoming]);
      return {
        writes,
        deletes: [repo.userId + ":draft:" + id, repo.userId + ":voice:" + id],
        result: { keptCopy },
      };
    },
  );
}
export const pushTask = (id) =>
  pushRecord(new LocalRepository(currentUserId()), id, remoteApi);
export const pullTask = (id) =>
  pullRecord(new LocalRepository(currentUserId()), id, remoteApi);
