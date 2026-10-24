import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
import { newId, requireValue } from "./repository.mjs";
import { readLocal, updateLocal } from "../sync/storage.mjs";

const keyFor = (user) => `${user}:local:fonts`;
const maxSize = 5 * 1024 * 1024;
const signature = (bytes, filename) => {
  const ascii = String.fromCharCode(...bytes.slice(0, 4));
  const extension = filename.split(".").at(-1)?.toLowerCase();
  return (
    {
      woff: "wOFF",
      woff2: "wOF2",
      otf: "OTTO",
      ttf: String.fromCharCode(0, 1, 0, 0),
    }[extension] === ascii
  );
};
const hash = (bytes) => bytesToHex(sha256(bytes));

export async function listFonts(user) {
  return (await readLocal(keyFor(user))) || [];
}

/** 字体文件保存在当前账号的IndexedDB，导出ZIP时会连同文件字节一起带走。 */
export async function addFont(user, file) {
  requireValue(
    /\.(woff2?|ttf|otf)$/i.test(file.name),
    "请选择WOFF、WOFF2、TTF或OTF字体文件",
  );
  requireValue(file.size > 0 && file.size <= maxSize, "字体文件需小于5MB");
  requireValue(
    file.name.replace(/\.[^.]+$/, "").trim().length > 0,
    "字体文件需要有名称",
  );
  const bytes = new Uint8Array(await file.arrayBuffer());
  requireValue(signature(bytes, file.name), "字体文件内容与扩展名不符");
  const font = {
    id: `font-${newId()}`,
    name: file.name.replace(/\.[^.]+$/, "").slice(0, 80),
    filename: file.name.slice(0, 160),
    sha256: hash(bytes),
    blob: new Blob([bytes]),
  };
  await updateLocal(keyFor(user), (old = []) => {
    requireValue(old.length < 20, "最多保存20款自定义字体");
    return [...old, font];
  });
  return font;
}

export async function removeFont(user, id) {
  await updateLocal(keyFor(user), (old = []) =>
    old.filter((font) => font.id !== id),
  );
}

function encode(bytes) {
  let value = "";
  for (let i = 0; i < bytes.length; i += 8192)
    value += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(value);
}
export async function exportFonts(user) {
  return Promise.all(
    (await listFonts(user)).map(async ({ blob, ...meta }) => ({
      ...meta,
      data: encode(new Uint8Array(await blob.arrayBuffer())),
    })),
  );
}
export function validateFontArchive(fonts) {
  requireValue(Array.isArray(fonts) && fonts.length <= 20, "字体列表无效");
  const ids = new Set();
  let total = 0;
  return fonts.map((font) => {
    requireValue(
      /^font-[a-zA-Z0-9-]{8,80}$/.test(font?.id) && !ids.has(font.id),
      "字体编号无效或重复",
    );
    ids.add(font.id);
    requireValue(
      typeof font.name === "string" &&
        font.name.length > 0 &&
        font.name.length <= 80,
      "字体名称无效",
    );
    requireValue(
      typeof font.filename === "string" &&
        /\.(woff2?|ttf|otf)$/i.test(font.filename) &&
        font.filename.length <= 160,
      "字体文件名无效",
    );
    requireValue(
      typeof font.data === "string" && font.data.length <= 7 * 1024 * 1024,
      "字体内容过大",
    );
    let bytes;
    try {
      bytes = Uint8Array.from(atob(font.data), (char) => char.charCodeAt(0));
    } catch {
      requireValue(false, "字体文件编码无效");
    }
    total += bytes.length;
    requireValue(
      bytes.length > 0 &&
        bytes.length <= maxSize &&
        total <= 30 * 1024 * 1024 &&
        signature(bytes, font.filename) &&
        hash(bytes) === font.sha256,
      "字体文件校验失败",
    );
    return {
      id: font.id,
      name: font.name,
      filename: font.filename,
      sha256: font.sha256,
      blob: new Blob([bytes]),
    };
  });
}
