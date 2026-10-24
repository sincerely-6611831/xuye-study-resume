import { useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ArrowLeft, ArrowRight, BookOpen, Download } from "lucide-react";
import markdown from "./guide.md?raw";
import { parseGuide } from "./guide-markdown.mjs";
import { downloadBlob } from "../local/backup.mjs";

type Block = { type: string; text?: string; items?: string[] };
const chapters = parseGuide(markdown) as { title: string; blocks: Block[] }[];

function inline(text = "") {
  return text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g).map((part, index) => {
    if (part.startsWith("`") && part.endsWith("`"))
      return <code key={index}>{part.slice(1, -1)}</code>;
    if (part.startsWith("**") && part.endsWith("**"))
      return <strong key={index}>{part.slice(2, -2)}</strong>;
    return part;
  });
}

function ChapterBlock({ block }: { block: Block }) {
  if (block.type === "subheading") return <h4>{inline(block.text)}</h4>;
  if (block.type === "code")
    return (
      <pre>
        <code>{block.text}</code>
      </pre>
    );
  if (block.type === "ordered")
    return (
      <ol>
        {block.items?.map((text, index) => <li key={index}>{inline(text)}</li>)}
      </ol>
    );
  if (block.type === "bullets")
    return (
      <ul>
        {block.items?.map((text, index) => <li key={index}>{inline(text)}</li>)}
      </ul>
    );
  return <p>{inline(block.text)}</p>;
}

/** guide.md是唯一手册正文；既能在应用中读，也能导出给没有网络的设备。 */
export function TutorialSettings() {
  const [index, setIndex] = useState(0);
  const reduceMotion = useReducedMotion();
  const chapter = chapters[index];
  return (
    <section className="tutorial-shell" aria-label="完整使用手册">
      <div className="tutorial-intro panel">
        <div>
          <span className="eyebrow">THE FIELD GUIDE · MARKDOWN</span>
          <h2>
            <BookOpen size={24} /> 完整使用手册
          </h2>
          <p>
            从首次进入到图表、插件、字体和跨设备迁移。左侧按主题查找，也可以下载原始
            Markdown 文件。
          </p>
        </div>
        <button
          className="secondary"
          onClick={() =>
            downloadBlob(
              new Blob([markdown], { type: "text/markdown;charset=utf-8" }),
              "续页-完整使用手册.md",
            )
          }
        >
          <Download size={16} /> 下载 .md
        </button>
      </div>
      <div className="tutorial-layout">
        <nav className="tutorial-index panel" aria-label="手册目录">
          {chapters.map((item, position) => (
            <button
              type="button"
              key={item.title}
              className={position === index ? "selected" : ""}
              aria-current={position === index ? "page" : undefined}
              onClick={() => setIndex(position)}
            >
              <span>{String(position + 1).padStart(2, "0")}</span>
              <strong>{item.title}</strong>
              {position === index && <ArrowRight size={16} />}
            </button>
          ))}
        </nav>
        <article className="tutorial-content panel guide-markdown">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={chapter.title}
              initial={reduceMotion ? false : { opacity: 0, x: 12 }}
              animate={{ opacity: 1, x: 0 }}
              exit={reduceMotion ? undefined : { opacity: 0, x: -10 }}
              transition={{ duration: 0.2 }}
            >
              <span className="eyebrow">
                CHAPTER {String(index + 1).padStart(2, "0")} / {chapters.length}
              </span>
              <h3>{chapter.title}</h3>
              {chapter.blocks.map((block, position) => (
                <ChapterBlock block={block} key={position} />
              ))}
            </motion.div>
          </AnimatePresence>
          <div className="tutorial-actions">
            <button
              className="secondary"
              disabled={index === 0}
              onClick={() => setIndex(index - 1)}
            >
              <ArrowLeft size={16} /> 上一章
            </button>
            <button
              className="primary"
              disabled={index === chapters.length - 1}
              onClick={() => setIndex(index + 1)}
            >
              下一章 <ArrowRight size={16} />
            </button>
          </div>
        </article>
      </div>
    </section>
  );
}
