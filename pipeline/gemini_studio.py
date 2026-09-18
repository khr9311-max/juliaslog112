"""Gemini 기반 기획(대본) + 이미지 생성.

핵심 설계:
  1. 대본은 구조화 출력(JSON Schema)으로 받아 파싱 실패를 원천 차단한다.
  2. 인물 일관성은 "캐릭터 시트 1장을 먼저 만들고, 이후 모든 씬 생성에 그 이미지를
     레퍼런스로 함께 넣는" 방식으로 확보한다. (Nano Banana 계열의 이미지 조건부 생성)
  3. 생성된 이미지는 디스크에 캐시한다. 재실행해도 돈이 다시 나가지 않는다.
"""
from __future__ import annotations

import json
import random
import re
import time
from pathlib import Path
from typing import Any

from google import genai
from google.genai import types

from . import config

# ──────────────────────────────────────────────────────────────
# 공통: 재시도
# ──────────────────────────────────────────────────────────────
RETRYABLE = ("429", "500", "502", "503", "504", "UNAVAILABLE", "RESOURCE_EXHAUSTED", "INTERNAL")


def _with_retry(fn, *, what: str, attempts: int = 4):
    """일시적 오류(rate limit / 5xx)에만 지수 백오프 재시도."""
    last: Exception | None = None
    for i in range(attempts):
        try:
            return fn()
        except Exception as err:  # noqa: BLE001 - SDK 예외 타입이 버전마다 다름
            last = err
            text = str(err)
            if not any(code in text for code in RETRYABLE) or i == attempts - 1:
                raise
            wait = (2**i) + random.uniform(0, 1)
            print(f"   ⏳ {what} 일시 오류 → {wait:.1f}s 후 재시도 ({i + 1}/{attempts - 1}): {text[:120]}")
            time.sleep(wait)
    raise last  # pragma: no cover


def make_client() -> genai.Client:
    return genai.Client(api_key=config.get_api_key())


# ──────────────────────────────────────────────────────────────
# 1. 대본/기획 생성
# ──────────────────────────────────────────────────────────────
PLAN_SCHEMA: dict[str, Any] = {
    "type": "object",
    "properties": {
        "title": {"type": "string", "description": "서정적인 한국어 제목"},
        "bgm_mood": {"type": "string"},
        "character_sheet_prompt": {
            "type": "string",
            "description": "영상 전체에 반복 등장할 인물의 외형을 고정하기 위한 영문 캐릭터 시트 프롬프트",
        },
        "style_guide": {
            "type": "string",
            "description": "모든 씬에 공통 적용할 영문 아트 디렉션 (렌즈/조명/색온도/필름)",
        },
        "scenes": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "scene_id": {"type": "integer"},
                    "narration": {"type": "string", "description": "해당 씬의 한국어 나레이션 한두 문장"},
                    "image_prompt": {"type": "string", "description": "영문 이미지 생성 프롬프트"},
                    "sfx_keyword": {"type": "string", "description": "영문 ASMR 효과음 키워드"},
                },
                "required": ["scene_id", "narration", "image_prompt", "sfx_keyword"],
            },
        },
    },
    "required": ["title", "bgm_mood", "character_sheet_prompt", "style_guide", "scenes"],
}

SYSTEM_PROMPT = """당신은 150만 구독자를 보유한 한국 감성 채널 '쥴리아스로그'의 수석 디렉터입니다.
45~55초 분량의 세로 쇼츠 기획안을 작성합니다.

[규칙]
1. 나레이션은 한국어로, 시청자에게 말을 거는 차분한 존댓말. 한 씬당 1~2문장(15~40자)으로 짧게.
   과장된 수사나 이모지는 쓰지 마세요.
2. image_prompt 는 영문으로 작성하고 반드시 다음을 포함하세요:
   "Cinematic, 35mm film, soft diffused lighting, slow subtle pan, vertical 9:16 composition,
    generous negative space". 화면에 글자(text/letters/captions)가 생기지 않도록
    "no text, no watermark" 를 명시하세요.
3. character_sheet_prompt 는 영상 내내 동일하게 등장할 인물 1명의 외형을 못박는 영문 설명입니다.
   나이대, 머리 길이/색, 얼굴 특징, 의상(색/재질), 분위기를 구체적으로 기술하세요.
   각 씬의 image_prompt 에서는 인물을 "the same woman" 처럼 지칭하고 외형을 다시 묘사하지 마세요.
4. style_guide 는 모든 씬에 공통 적용할 영문 아트 디렉션(렌즈, 조명, 색온도, 필름 질감)입니다.
5. sfx_keyword 는 나레이션의 공백을 채울 ASMR 키워드(영문)."""


def generate_plan(client: genai.Client, topic: str, scene_count: int, model: str) -> dict[str, Any]:
    prompt = (
        f"주제: {topic}\n\n"
        f"정확히 {scene_count}개의 씬으로 구성하세요. scene_id 는 1부터 {scene_count}까지 순서대로."
    )

    def call():
        return client.models.generate_content(
            model=model,
            contents=prompt,
            config=types.GenerateContentConfig(
                system_instruction=SYSTEM_PROMPT,
                response_mime_type="application/json",
                response_json_schema=PLAN_SCHEMA,
                temperature=1.0,
            ),
        )

    resp = _with_retry(call, what="대본 생성")
    raw = (resp.text or "").strip()
    if not raw:
        raise RuntimeError("Gemini가 빈 응답을 반환했습니다. (안전필터 차단 가능성)")

    # 구조화 출력이지만 만약을 대비해 코드펜스를 제거한다.
    raw = re.sub(r"^```(?:json)?\s*|\s*```$", "", raw, flags=re.MULTILINE).strip()

    try:
        plan = json.loads(raw)
    except json.JSONDecodeError as err:
        raise RuntimeError(f"대본 JSON 파싱 실패: {err}\n--- 원문 ---\n{raw[:800]}") from err

    scenes = plan.get("scenes") or []
    if not scenes:
        raise RuntimeError("대본에 scenes 가 비어 있습니다.")
    if len(scenes) != scene_count:
        print(f"   ⚠️  요청한 씬 수({scene_count})와 생성된 씬 수({len(scenes)})가 다릅니다. 생성분을 그대로 사용합니다.")
    for i, scene in enumerate(scenes, start=1):
        scene["scene_id"] = i  # 모델이 번호를 건너뛰는 경우 방지
    return plan


# ──────────────────────────────────────────────────────────────
# 2. 이미지 생성 (인물 일관성)
# ──────────────────────────────────────────────────────────────
def _extract_image_bytes(resp) -> bytes:
    candidates = getattr(resp, "candidates", None) or []
    if not candidates:
        raise RuntimeError("이미지 응답에 candidate 가 없습니다. (안전필터 차단 가능성)")

    content = getattr(candidates[0], "content", None)
    parts = getattr(content, "parts", None) or []
    texts: list[str] = []
    for part in parts:
        inline = getattr(part, "inline_data", None)
        if inline is not None and getattr(inline, "data", None):
            return inline.data
        if getattr(part, "text", None):
            texts.append(part.text)

    finish = getattr(candidates[0], "finish_reason", None)
    hint = f" finish_reason={finish}." if finish else ""
    if texts:
        hint += " 모델 텍스트 응답: " + " ".join(texts)[:300]
    raise RuntimeError(f"이미지 데이터가 응답에 없습니다.{hint}")


def _generate_image(
    client: genai.Client,
    *,
    model: str,
    prompt: str,
    reference: bytes | None,
    what: str,
) -> bytes:
    contents: list[Any] = []
    if reference is not None:
        contents.append(types.Part.from_bytes(data=reference, mime_type="image/png"))
    contents.append(prompt)

    def call():
        return client.models.generate_content(
            model=model,
            contents=contents,
            config=types.GenerateContentConfig(
                response_modalities=["IMAGE"],
                image_config=types.ImageConfig(
                    aspect_ratio=config.ASPECT_RATIO,
                    image_size="2K",
                ),
            ),
        )

    resp = _with_retry(call, what=what)
    return _extract_image_bytes(resp)


def generate_character_sheet(
    client: genai.Client, plan: dict[str, Any], out_path: Path, *, model: str, force: bool
) -> bytes:
    """영상 전체의 인물 기준이 될 레퍼런스 1장."""
    if out_path.exists() and not force:
        print(f"   ♻️  캐릭터 시트 캐시 사용: {out_path.name}")
        return out_path.read_bytes()

    prompt = (
        f"{plan['character_sheet_prompt']}\n\n"
        f"Art direction: {plan['style_guide']}\n"
        "Full-body to waist-up reference portrait of this single person, neutral calm expression, "
        "looking slightly away from camera, cinematic 35mm film, soft diffused lighting, "
        "vertical 9:16 composition, no text, no watermark, no logo."
    )
    print("   🎨 캐릭터 시트 생성 중... (이후 모든 씬의 인물 기준)")
    data = _generate_image(client, model=model, prompt=prompt, reference=None, what="캐릭터 시트")
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_bytes(data)
    return data


def generate_scene_images(
    client: genai.Client,
    plan: dict[str, Any],
    scene_dir: Path,
    *,
    model: str,
    reference: bytes,
    force: bool,
) -> list[Path]:
    scene_dir.mkdir(parents=True, exist_ok=True)
    paths: list[Path] = []

    for scene in plan["scenes"]:
        sid = scene["scene_id"]
        out_path = scene_dir / f"scene_{sid:02d}.png"

        if out_path.exists() and not force:
            print(f"   ♻️  scene {sid} 이미지 캐시 사용: {out_path.name}")
            paths.append(out_path)
            continue

        prompt = (
            "Use the person in the reference image as the exact same character: keep the face, "
            "hairstyle, hair color and outfit identical.\n\n"
            f"Scene: {scene['image_prompt']}\n\n"
            f"Art direction: {plan['style_guide']}\n"
            "Vertical 9:16 composition, cinematic 35mm film, soft diffused lighting, "
            "generous negative space in the lower third for subtitles, no text, no watermark, no logo."
        )
        print(f"   🎨 scene {sid} 이미지 생성 중...")
        data = _generate_image(
            client, model=model, prompt=prompt, reference=reference, what=f"scene {sid} 이미지"
        )
        out_path.write_bytes(data)
        paths.append(out_path)

    return paths
