"""edge-tts 기반 나레이션 생성 (무료, API 키 불필요).

ElevenLabs + Whisper 조합을 대체한다. edge-tts는 음성을 합성하면서
WordBoundary 이벤트로 단어별 타임스탬프를 같이 흘려주므로,
자막 싱크용 Whisper 호출이 통째로 사라진다. (비용 0)
"""
from __future__ import annotations

import asyncio
import json
import subprocess
from dataclasses import dataclass
from pathlib import Path

import edge_tts

from . import config

# edge-tts 의 offset/duration 단위는 100나노초(tick)
TICKS_PER_MS = 10_000


@dataclass
class Word:
    text: str
    start_ms: float
    end_ms: float


@dataclass
class NarrationResult:
    audio_path: Path
    words: list[Word]
    duration_sec: float


async def _synthesize(text: str, voice: str, out_path: Path) -> list[Word]:
    communicate = edge_tts.Communicate(
        text,
        voice,
        rate=config.VOICE_RATE,
        pitch=config.VOICE_PITCH,
        volume=config.VOICE_VOLUME,
        # 기본값이 SentenceBoundary 라 단어 단위 타임스탬프가 안 나온다. 반드시 명시할 것.
        boundary="WordBoundary",
    )

    audio = bytearray()
    words: list[Word] = []

    async for chunk in communicate.stream():
        if chunk["type"] == "audio":
            audio.extend(chunk["data"])
        elif chunk["type"] in ("WordBoundary", "SentenceBoundary"):
            start = chunk["offset"] / TICKS_PER_MS
            words.append(
                Word(
                    text=chunk["text"],
                    start_ms=start,
                    end_ms=start + chunk["duration"] / TICKS_PER_MS,
                )
            )

    if not audio:
        raise RuntimeError(
            f"edge-tts 가 오디오를 반환하지 않았습니다 (voice={voice}).\n"
            "네트워크 연결 또는 보이스 이름을 확인하세요. `python -m edge_tts --list-voices`"
        )

    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_bytes(bytes(audio))
    return words


def _probe_duration(path: Path) -> float | None:
    try:
        out = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", str(path)],
            capture_output=True,
            text=True,
            check=True,
        ).stdout.strip()
        return float(out)
    except (OSError, subprocess.CalledProcessError, ValueError):
        return None


def synthesize(text: str, out_path: Path, *, voice: str, force: bool = False) -> NarrationResult:
    """나레이션 mp3 + 단어 타임스탬프. 타임스탬프는 mp3 옆에 .words.json 으로 캐시한다."""
    words_path = out_path.with_suffix(".words.json")

    if out_path.exists() and words_path.exists() and not force:
        cached = json.loads(words_path.read_text(encoding="utf-8"))
        words = [Word(**w) for w in cached]
    else:
        words = asyncio.run(_synthesize(text, voice, out_path))
        words_path.write_text(
            json.dumps([w.__dict__ for w in words], ensure_ascii=False, indent=2),
            encoding="utf-8",
        )

    duration = _probe_duration(out_path)
    if duration is None:
        # ffprobe 가 없으면 마지막 단어 끝 + 여유로 근사한다.
        duration = (max((w.end_ms for w in words), default=0.0) + 300) / 1000
    return NarrationResult(audio_path=out_path, words=words, duration_sec=duration)


SENTENCE_ENDINGS = ".?!…"
TRAILING_PUNCT = ",.?!…\"')」』·"


@dataclass
class Token:
    """WordBoundary 단어를 원문에 정렬해 구두점과 문장 경계를 복원한 것."""

    surface: str
    start_ms: float
    end_ms: float
    ends_sentence: bool


def align_to_source(words: list[Word], source_text: str) -> list[Token]:
    """edge-tts 의 WordBoundary 는 구두점을 떼고 준다.

    원문을 순서대로 훑으며 각 단어의 위치를 찾아 구두점을 다시 붙이고,
    문장이 끝나는 지점을 표시한다. (자막이 문장을 가로질러 묶이는 걸 막기 위함)
    """
    tokens: list[Token] = []
    cursor = 0

    for word in words:
        piece = word.text.strip()
        if not piece:
            continue

        idx = source_text.find(piece, cursor)
        if idx == -1:
            # 정렬 실패(합성 과정에서 표기가 바뀐 경우) → 원본 단어를 그대로 쓴다.
            tokens.append(Token(piece, word.start_ms, word.end_ms, False))
            continue

        end = idx + len(piece)
        while end < len(source_text) and source_text[end] in TRAILING_PUNCT:
            end += 1

        surface = source_text[idx:end]
        cursor = end
        tokens.append(
            Token(
                surface=surface,
                start_ms=word.start_ms,
                end_ms=word.end_ms,
                ends_sentence=any(p in surface for p in SENTENCE_ENDINGS),
            )
        )

    return tokens


def to_caption_chunks(
    words: list[Word],
    source_text: str | None = None,
    *,
    max_chars: int = config.CAPTION_MAX_CHARS,
) -> list[dict]:
    """단어 타임스탬프를 화면에 한 번에 띄울 덩어리로 묶는다.

    - 문장이 끝나면 무조건 끊는다 (한 자막에 두 문장이 섞이지 않게).
    - max_chars 를 넘으면 끊는다 (세로 화면 한 줄 가독성).
    - Captions 컴포넌트는 한 번에 하나만 표시하고 구간이 겹치면 앞의 것이 이기므로,
      각 덩어리의 끝을 다음 덩어리 시작 직전까지만 늘려 끊김 없이 이어지게 한다.
    """
    if not words:
        return []

    tokens = (
        align_to_source(words, source_text)
        if source_text
        else [Token(w.text.strip(), w.start_ms, w.end_ms, False) for w in words if w.text.strip()]
    )
    if not tokens:
        return []

    groups: list[list[Token]] = []
    current: list[Token] = []
    length = 0

    for token in tokens:
        addition = len(token.surface) + (1 if current else 0)
        if current and length + addition > max_chars:
            groups.append(current)
            current, length = [token], len(token.surface)
        else:
            current.append(token)
            length += addition

        if token.ends_sentence and current:
            groups.append(current)
            current, length = [], 0

    if current:
        groups.append(current)

    chunks: list[dict] = []
    for i, group in enumerate(groups):
        natural_end = group[-1].end_ms
        if i + 1 < len(groups):
            end = max(natural_end, groups[i + 1][0].start_ms - 20)
        else:
            end = natural_end + 400
        chunks.append(
            {
                "text": " ".join(t.surface for t in group),
                "startMs": round(group[0].start_ms),
                "endMs": round(end),
            }
        )
    return chunks
