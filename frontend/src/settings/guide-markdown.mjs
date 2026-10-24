/** 本手册只用一小组Markdown语法。渲染为React文本节点，不解释HTML或脚本。 */
export function parseGuide(markdown) {
  const chapters = [];
  let chapter = { title: "阅读本手册", blocks: [] };
  let paragraph = [];
  let list = null;
  let code = null;
  const flushParagraph = () => {
    if (paragraph.length)
      chapter.blocks.push({ type: "paragraph", text: paragraph.join(" ") });
    paragraph = [];
  };
  const flushList = () => {
    if (list) chapter.blocks.push(list);
    list = null;
  };
  for (const line of markdown.replace(/\r\n?/g, "\n").split("\n")) {
    if (line.startsWith("```")) {
      flushParagraph();
      flushList();
      if (code) {
        chapter.blocks.push({ type: "code", text: code.join("\n") });
        code = null;
      } else code = [];
      continue;
    }
    if (code) {
      code.push(line);
      continue;
    }
    if (line.startsWith("# ")) {
      chapter.title = line.slice(2).trim();
      continue;
    }
    if (line.startsWith("## ")) {
      flushParagraph();
      flushList();
      chapters.push(chapter);
      chapter = { title: line.slice(3).trim(), blocks: [] };
      continue;
    }
    if (line.startsWith("### ")) {
      flushParagraph();
      flushList();
      chapter.blocks.push({ type: "subheading", text: line.slice(4).trim() });
      continue;
    }
    const ordered = line.match(/^(\d+)\.\s+(.+)$/);
    const bullet = line.match(/^-\s+(.+)$/);
    if (ordered || bullet) {
      flushParagraph();
      const type = ordered ? "ordered" : "bullets";
      if (list?.type !== type) flushList();
      list ||= { type, items: [] };
      list.items.push((ordered?.[2] || bullet?.[1]).trim());
      continue;
    }
    if (!line.trim()) {
      flushParagraph();
      flushList();
      continue;
    }
    flushList();
    paragraph.push(line.trim());
  }
  flushParagraph();
  flushList();
  chapters.push(chapter);
  return chapters.filter((item) => item.title || item.blocks.length);
}
