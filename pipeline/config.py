"""쥴리아스로그 파이프라인 설정.

비용이 드는 부분은 이미지 생성 단 하나이므로, 모델/장수 관련 설정을 여기 모아둔다.
"""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
PUBLIC_DIR = PROJECT_ROOT / "public"
ASSETS_DIR = PUBLIC_DIR / "assets"
CACHE_DIR = PROJECT_ROOT / ".cache"
INPUT_JSON = PROJECT_ROOT / "sample_input.json"

# ── 모델 ──────────────────────────────────────────────────────
# 대본: 무료 티어로 충분한 Flash 계열
TEXT_MODEL = os.environ.get("JULIASLOG_TEXT_MODEL", "gemini-3.6-flash")

# 이미지: 인물 일관성(레퍼런스 이미지 조건부 생성)이 필요하므로 Pro 이미지 모델.
#   gemini-3-pro-image        ~$0.13/장  (일관성 최상)
#   gemini-3.1-flash-image    ~$0.045/장 (절충)
#   gemini-3.1-flash-lite-image ~$0.034/장 (최저가)
IMAGE_MODEL = os.environ.get("JULIASLOG_IMAGE_MODEL", "gemini-3-pro-image")

# 장당 대략 단가(원화 환산용, 표시 목적). 실제 청구는 Google 콘솔 기준.
IMAGE_UNIT_COST_USD = {
    "gemini-3-pro-image": 0.13,
    "gemini-3-pro-image-preview": 0.13,
    "gemini-3.1-flash-image": 0.045,
    "gemini-3.1-flash-image-preview": 0.045,
    "gemini-3.1-flash-lite-image": 0.034,
    "gemini-2.5-flash-image": 0.039,
}

# ── 나레이션 (edge-tts / 무료, API 키 불필요) ──────────────────
VOICE = os.environ.get("JULIASLOG_VOICE", "ko-KR-SunHiNeural")  # 한국어 여성
VOICE_RATE = os.environ.get("JULIASLOG_VOICE_RATE", "-8%")      # 감성 채널 톤: 약간 느리게
VOICE_PITCH = os.environ.get("JULIASLOG_VOICE_PITCH", "-2Hz")
VOICE_VOLUME = os.environ.get("JULIASLOG_VOICE_VOLUME", "+0%")

# ── 영상 규격 (src/constants.ts 와 일치해야 함) ────────────────
FPS = 30
WIDTH = 1080
HEIGHT = 1920
ASPECT_RATIO = "9:16"

# 문장 사이 호흡(초). 명세서 §1의 "0.5~1초 물리적 호흡"을 씬 여백으로 구현한다.
SCENE_TAIL_PAUSE_SEC = 0.7

# 자막 한 덩어리에 넣을 최대 글자 수 (세로 화면에서 한 줄로 읽히는 길이)
CAPTION_MAX_CHARS = 13

DEFAULT_BGM = "assets/bgm_ambient.mp3"
DEFAULT_BGM_VOLUME = 0.12


@dataclass
class PipelineConfig:
    topic: str
    scene_count: int = 8
    text_model: str = TEXT_MODEL
    image_model: str = IMAGE_MODEL
    voice: str = VOICE
    force: bool = False
    skip_images: bool = False
    slug: str = "shorts"
    extra: dict = field(default_factory=dict)

    @property
    def scene_dir(self) -> Path:
        return ASSETS_DIR / self.slug

    def estimated_image_cost_usd(self) -> float:
        unit = IMAGE_UNIT_COST_USD.get(self.image_model, 0.13)
        # 캐릭터 시트 1장 + 씬 이미지 N장
        return unit * (self.scene_count + 1)


def get_api_key() -> str:
    key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
    if not key:
        raise RuntimeError(
            "GEMINI_API_KEY 환경변수가 없습니다.\n"
            "  PowerShell:  $env:GEMINI_API_KEY = 'your-key'\n"
            "  영구 설정:    setx GEMINI_API_KEY \"your-key\""
        )
    return key
