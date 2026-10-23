"""领域插件注册表。增加插件通常只需添加字段和恢复提示，不必复制页面。"""

from fastapi import HTTPException


def field(key, label, hint):
    return {"key": key, "label": label, "hint": hint, "type": "textarea"}


PLUGINS = {
    "general": {
        "name": "通用学习",
        "description": "留下进度、思路和下一步。",
        "fields": [field("context", "补充背景", "下次的自己还需要知道什么？")],
        "warmup": "用一句话说说，你上次最想解决什么？",
    },
    "math": {
        "name": "数学推导",
        "description": "从最后一个确认无误的步骤继续。",
        "fields": [
            field("conditions", "题目与条件", "题目、已知条件和公式适用范围"),
            field("verified_steps", "已确认的推导", "哪些步骤已经通过教材或计算检查？"),
            field("uncertain_steps", "存疑的推导", "哪一步还没有把握？"),
        ],
        "warmup": "当前方法成立需要哪些条件？",
    },
    "coding": {
        "name": "编程排障",
        "description": "记住报错、环境和已经尝试过的修复。",
        "fields": [
            field("code", "相关代码", "粘贴最小相关片段"),
            field("error", "报错与环境", "保留报错原文，补充语言和版本"),
            field("expected", "预期行为", "正确运行时应该发生什么？"),
        ],
        "warmup": "怎样用最少的步骤重新观察这个问题？",
    },
    "reading": {
        "name": "阅读理解",
        "description": "找回阅读位置与作者的论证脉络。",
        "fields": [
            field("argument", "当前中心论点", "作者在这里想证明什么？"),
            field("terms", "未解术语", "哪些术语、概念还需要澄清？"),
            field("question", "继续阅读的问题", "接下来想在文中找到什么答案？"),
        ],
        "warmup": "当前段落与上一段有什么联系？",
    },
    "writing": {
        "name": "写作构思",
        "description": "找回段落意图，保留待补的论据。",
        "fields": [
            field("outline", "大纲", "列出文章的主要结构"),
            field("intent", "当前段落意图", "这一段想让读者理解什么？"),
            field("evidence", "待补证据", "哪些事实或引用还需查证？"),
        ],
        "warmup": "下一段最需要回答读者的哪个问题？",
    },
}


def get_plugin(plugin_id):
    if plugin_id not in PLUGINS:
        raise HTTPException(422, "未知的领域插件")
    return {"id": plugin_id, "version": "1.0.0", **PLUGINS[plugin_id]}


def validate_payload(plugin_id, payload):
    plugin = get_plugin(plugin_id)
    domain = payload.get("domain_data", {})
    allowed = {f["key"] for f in plugin["fields"]}
    if not isinstance(domain, dict) or any(
        k not in allowed or not isinstance(v, str) for k, v in domain.items()
    ):
        raise HTTPException(422, "插件字段必须是本插件支持的文本字段")
    return payload


def fallback_card(checkpoint):
    p = checkpoint["payload"]
    return {
        "summary": p.get("current_step") or "尚未填写当前步骤",
        "blocker": p.get("blocker") or "暂无明确障碍",
        "next_action": p.get("next_action") or "先回看原始笔记，补充一个最小行动",
        "warmup": get_plugin(checkpoint["plugin_id"])["warmup"],
        "source_ids": [checkpoint["id"]],
    }
