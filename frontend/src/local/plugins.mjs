/** 本机内置插件，与后端注册表同版本。 */
export default [
  {
    id: "general",
    version: "1.0.0",
    name: "通用学习",
    description: "留下进度、思路和下一步。",
    fields: [
      {
        key: "context",
        label: "补充背景",
        hint: "下次的自己还需要知道什么？",
        type: "textarea",
      },
    ],
    warmup: "用一句话说说，你上次最想解决什么？",
  },
  {
    id: "math",
    version: "1.0.0",
    name: "数学推导",
    description: "从最后一个确认无误的步骤继续。",
    fields: [
      {
        key: "conditions",
        label: "题目与条件",
        hint: "题目、已知条件和公式适用范围",
        type: "textarea",
      },
      {
        key: "verified_steps",
        label: "已确认的推导",
        hint: "哪些步骤已经通过教材或计算检查？",
        type: "textarea",
      },
      {
        key: "uncertain_steps",
        label: "存疑的推导",
        hint: "哪一步还没有把握？",
        type: "textarea",
      },
    ],
    warmup: "当前方法成立需要哪些条件？",
  },
  {
    id: "coding",
    version: "1.0.0",
    name: "编程排障",
    description: "记住报错、环境和已经尝试过的修复。",
    fields: [
      {
        key: "code",
        label: "相关代码",
        hint: "粘贴最小相关片段",
        type: "textarea",
      },
      {
        key: "error",
        label: "报错与环境",
        hint: "保留报错原文，补充语言和版本",
        type: "textarea",
      },
      {
        key: "expected",
        label: "预期行为",
        hint: "正确运行时应该发生什么？",
        type: "textarea",
      },
    ],
    warmup: "怎样用最少的步骤重新观察这个问题？",
  },
  {
    id: "reading",
    version: "1.0.0",
    name: "阅读理解",
    description: "找回阅读位置与作者的论证脉络。",
    fields: [
      {
        key: "argument",
        label: "当前中心论点",
        hint: "作者在这里想证明什么？",
        type: "textarea",
      },
      {
        key: "terms",
        label: "未解术语",
        hint: "哪些术语、概念还需要澄清？",
        type: "textarea",
      },
      {
        key: "question",
        label: "继续阅读的问题",
        hint: "接下来想在文中找到什么答案？",
        type: "textarea",
      },
    ],
    warmup: "当前段落与上一段有什么联系？",
  },
  {
    id: "writing",
    version: "1.0.0",
    name: "写作构思",
    description: "找回段落意图，保留待补的论据。",
    fields: [
      {
        key: "outline",
        label: "大纲",
        hint: "列出文章的主要结构",
        type: "textarea",
      },
      {
        key: "intent",
        label: "当前段落意图",
        hint: "这一段想让读者理解什么？",
        type: "textarea",
      },
      {
        key: "evidence",
        label: "待补证据",
        hint: "哪些事实或引用还需查证？",
        type: "textarea",
      },
    ],
    warmup: "下一段最需要回答读者的哪个问题？",
  },
];
