"""HTTP模型协议与业务分开；连接测试和正式生成使用同一条调用路径。"""

import httpx


def send_chat(config, prompt):
    headers = (
        {"Authorization": "Bearer " + config["api_key"]} if config["api_key"] else {}
    )
    with httpx.Client(
        timeout=config["timeout"], follow_redirects=False, trust_env=False
    ) as client:
        response = client.post(
            config["api_url"],
            headers=headers,
            json={
                "model": config["model"],
                "messages": [{"role": "user", "content": prompt}],
            },
        )
        response.raise_for_status()
        raw = response.json()["choices"][0]["message"]["content"]
    if not isinstance(raw, str) or not 0 < len(raw) <= 60000:
        raise ValueError("模型回复为空、过长或格式不支持")
    return raw


def send_transcription(config, audio, filename, content_type):
    """兼容multipart转写协议：file、model、language，响应JSON中的text。"""
    headers = (
        {"Authorization": "Bearer " + config["api_key"]} if config["api_key"] else {}
    )
    data = {"model": config["model"], "response_format": "json"}
    if config["language"]:
        data["language"] = config["language"]
    with httpx.Client(
        timeout=config["timeout"], follow_redirects=False, trust_env=False
    ) as client:
        response = client.post(
            config["api_url"],
            headers=headers,
            data=data,
            files={"file": (filename, audio, content_type)},
        )
        response.raise_for_status()
        text = response.json()["text"]
    if not isinstance(text, str) or not 0 < len(text.strip()) <= 30000:
        raise ValueError("转写结果为空或过长")
    return text.strip()
