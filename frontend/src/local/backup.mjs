import { zipSync, unzipSync, strToU8, strFromU8 } from "fflate";
import { LocalRepository, requireValue } from "./repository.mjs";
import { forkRecord, packBundle, unpackBundle } from "./bundles.mjs";
import { currentUserId } from "./sync.mjs";
import { atomicRecords } from "../sync/storage.mjs";
import { allPlugins } from "./custom-plugins.mjs";
import {
  exportPersonalization,
  validatePersonalization,
} from "./personalization.mjs";

/** 大备份按任务分卷，每卷均满足导入的50MB/解压100MB限制。 */
export function backupChunks(bundles, limit = 48 * 1024 * 1024) {
  const chunks = [];
  let group = [],
    size = 0;
  for (const bundle of bundles) {
    const bytes = strToU8(JSON.stringify(bundle)).length;
    requireValue(
      bytes + 1024 < limit,
      "单个任务超过备份容量，请先精简该任务的附件或历史记录。",
    );
    if (group.length && size + bytes + 1024 > limit) {
      chunks.push(group);
      group = [];
      size = 0;
    }
    group.push(bundle);
    size += bytes;
  }
  if (group.length || !chunks.length) chunks.push(group);
  return chunks;
}

export function downloadBlob(blob, name) {
  // Android 内嵌窗口没有普通浏览器的下载管理器，交给系统文件选择器。
  if (window.XuYeAndroid?.saveFile) {
    const reader = new FileReader();
    reader.onload = () => {
      const encoded = String(reader.result || "").split(",")[1];
      if (encoded)
        window.XuYeAndroid.saveFile(
          name,
          blob.type || "application/octet-stream",
          encoded,
        );
    };
    reader.readAsDataURL(blob);
    return;
  }
  const url = URL.createObjectURL(blob),
    link = document.createElement("a");
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}
export async function downloadResource(id) {
  const records = await new LocalRepository(currentUserId()).list();
  const record = records.find((r) => r.files[id]);
  requireValue(record, "本机没有这份材料");
  const meta = record.detail.resources.find((r) => r.id === id);
  downloadBlob(record.files[id], meta.filename);
}
export async function downloadBackup(format) {
  const exportingUser = currentUserId();
  const repo = new LocalRepository(exportingUser);
  const records = await Promise.all(
    (await repo.list()).map((r) => repo.effective(r.detail.task.id)),
  );
  const pluginMap = new Map(
    (await allPlugins(exportingUser)).map((plugin) => [plugin.id, plugin]),
  );
  const bundles = await Promise.all(
    records.map((record) => {
      const plugin = pluginMap.get(record.detail.task.plugin_id);
      requireValue(plugin, "有任务使用的自定义插件已丢失，请先修复该任务");
      return packBundle(record, plugin);
    }),
  );
  requireValue(
    currentUserId() === exportingUser,
    "导出期间账号已切换，请重新导出",
    409,
  );
  if (format === "markdown") {
    const text = records
      .map(
        (r) =>
          "# " +
          r.detail.task.title +
          "\n\n" +
          r.detail.checkpoints
            .map(
              (cp) =>
                "## " +
                cp.created_at +
                "\n" +
                Object.entries(cp.payload)
                  .map(([k, v]) => k + ": " + JSON.stringify(v))
                  .join("\n"),
            )
            .join("\n\n") +
          "\n\n" +
          r.detail.jobs
            .map((j) => "### AI原文\n" + (j.raw_output || ""))
            .join("\n"),
      )
      .join("\n\n");
    downloadBlob(new Blob([text], { type: "text/markdown" }), "study-local.md");
    return;
  }
  const personalization = await exportPersonalization(exportingUser);
  const preferencesSize = strToU8(JSON.stringify(personalization)).length;
  requireValue(
    preferencesSize < 48 * 1024 * 1024,
    "个性化设置过大，请移除部分字体后重试",
  );
  const chunks = backupChunks(bundles);
  requireValue(
    currentUserId() === exportingUser,
    "导出期间账号已切换，请重新导出",
    409,
  );
  // 如果字体占用较多，单独导出首卷；其他卷仍按任务大小分组。
  if (
    preferencesSize + strToU8(JSON.stringify(chunks[0])).length >
    48 * 1024 * 1024
  )
    chunks.unshift([]);
  for (let i = 0; i < chunks.length; i++) {
    const text = JSON.stringify({
      schema_version: 3,
      exported_at: new Date().toISOString(),
      bundles: chunks[i],
      ...(i === 0 ? { personalization } : {}),
    });
    const name = "study-local" + (chunks.length > 1 ? "-part-" + (i + 1) : "");
    if (format === "zip") {
      const zip = zipSync({ "local-backup.json": strToU8(text) }, { level: 3 });
      downloadBlob(new Blob([zip]), name + ".zip");
    } else
      downloadBlob(
        new Blob([text], { type: "application/json" }),
        name + ".json",
      );
  }
}
export async function restoreBackup(file) {
  const restoringUser = currentUserId();
  requireValue(file.size <= 50 * 1024 * 1024, "备份最多50MB");
  let data, legacyFiles;
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    if (file.name.toLowerCase().endsWith(".zip")) {
      let size = 0;
      legacyFiles = unzipSync(bytes, {
        filter: (entry) => {
          size += entry.originalSize;
          requireValue(size <= 100 * 1024 * 1024, "备份解压后过大");
          return true;
        },
      });
      data = JSON.parse(
        strFromU8(
          legacyFiles["local-backup.json"] || legacyFiles["backup.json"],
        ),
      );
    } else data = JSON.parse(strFromU8(bytes));
  } catch {
    throw new Error("备份格式无效或解压后超过100MB，请选择本应用导出的备份。");
  }
  let records;
  if (data.schema_version === 3 || data.schema_version === 2) {
    requireValue(
      Array.isArray(data.bundles) && data.bundles.length <= 500,
      "备份任务数量无效",
    );
    records = data.bundles.map(unpackBundle);
  } else if (data.schema_version === 1) {
    requireValue(
      Array.isArray(data.tasks) && data.tasks.length <= 500,
      "旧版备份无效",
    );
    records = data.tasks.map((detail) => {
      const files = {};
      for (const r of detail.resources) {
        const bytes = legacyFiles?.["resources/" + r.id];
        requireValue(bytes, "旧版JSON没有附件，请选择完整ZIP");
        files[r.id] = new Blob([bytes]);
      }
      return {
        detail,
        files,
        dirty: true,
        base_revision: null,
        local_version: 1,
        receipts: {},
      };
    });
  } else throw new Error("不支持此备份版本");
  const personalization =
    data.schema_version === 3 && data.personalization
      ? validatePersonalization(data.personalization)
      : null;
  const repo = new LocalRepository(restoringUser);
  // 旧ZIP也经过同一校验；所有任务验证完才进入一笔原子写入。
  const verified = await Promise.all(
    records.map(async (record) => unpackBundle(await packBundle(record))),
  );
  const copies = verified.map((record) => forkRecord(record, "（恢复副本）"));
  requireValue(
    currentUserId() === restoringUser,
    "恢复期间账号已切换，请重新选择备份。",
    409,
  );
  const importedPlugins = [
    ...(personalization?.plugins || []),
    ...verified.map((r) => r.plugin).filter(Boolean),
  ];
  const settingsKey = restoringUser + ":local:settings";
  const pluginsKey = restoringUser + ":local:custom-plugins";
  const fontsKey = restoringUser + ":local:fonts";
  if (copies.length || personalization || importedPlugins.length)
    await atomicRecords(
      [settingsKey, pluginsKey, fontsKey],
      ([oldSettings, oldPlugins = [], oldFonts = []]) => {
        const plugins = [...oldPlugins];
        for (const plugin of importedPlugins) {
          const existing = plugins.find((item) => item.id === plugin.id);
          requireValue(
            !existing || JSON.stringify(existing) === JSON.stringify(plugin),
            "目标设备已有同编号但内容不同的插件",
          );
          if (!existing) plugins.push(plugin);
        }
        requireValue(plugins.length <= 100, "目标设备插件数量已满");
        const fonts = [...oldFonts];
        for (const font of personalization?.fonts || []) {
          const existing = fonts.find((item) => item.id === font.id);
          requireValue(
            !existing || existing.sha256 === font.sha256,
            "目标设备已有同编号但内容不同的字体",
          );
          if (!existing) fonts.push(font);
        }
        requireValue(fonts.length <= 20, "目标设备字体数量已满");
        const writes = copies.map((record) => [
          repo.prefix + record.detail.task.id,
          record,
        ]);
        if (importedPlugins.length) writes.push([pluginsKey, plugins]);
        if (personalization) {
          writes.push([fontsKey, fonts]);
          writes.push([
            settingsKey,
            {
              ...(oldSettings || {}),
              version: oldSettings?.version || "1.4.0",
              appearance: personalization.appearance,
              ai: { ...(oldSettings?.ai || {}), ...personalization.ai },
              speech: personalization.speech,
            },
          ]);
        }
        return { writes };
      },
    );
  if (personalization && typeof window !== "undefined")
    window.dispatchEvent(new Event("study-personalization-restored"));
  return { imported: records.length, personalization: !!personalization };
}
