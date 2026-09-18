"""쥴리아스로그 오케스트레이터.

    python -m pipeline.run --topic "혼자 있는 밤의 위로" --scenes 8

흐름:
    1. Gemini(텍스트)  : 주제 → 제목/캐릭터시트/스타일가이드/씬별 나레이션·이미지프롬프트
    2. Gemini(이미지)  : 캐릭터 시트 1장 → 이를 레퍼런스로 넣어 씬 이미지 N장 (인물 일관성)
    3. edge-tts        : 씬별 나레이션 mp3 + 단어 타임스탬프 (무료)
    4. 조립            : sample_input.json  → `npm run render` 로 최종 mp4
"""
from __future__ import annotations

import argparse
import json
import math
import sys
from pathlib import Path

from . import config, gemini_studio, narration

MIN_SCENE_SEC = 2.5


def _frames_to_seconds(frames: int) -> float:
    return round(frames / config.FPS, 4)


def _build_scene(
    scene_plan: dict,
    *,
    slug: str,
    image_path: Path,
    voice: str,
    force: bool,
) -> dict:
    sid = scene_plan["scene_id"]
    audio_path = config.ASSETS_DIR / slug / f"narration_{sid:02d}.mp3"

    print(f"   🎙️  scene {sid} 나레이션 합성...")
    result = narration.synthesize(scene_plan["narration"], audio_path, voice=voice, force=force)

    # 명세서 §1의 "문장 간 물리적 호흡"을 씬 꼬리 여백으로 구현한다.
    raw_sec = max(MIN_SCENE_SEC, result.duration_sec + config.SCENE_TAIL_PAUSE_SEC)
    frames = math.ceil(raw_sec * config.FPS)

    subtitles = narration.to_caption_chunks(result.words, scene_plan["narration"])
    # 자막이 씬 밖으로 새어나가지 않도록 잘라준다.
    scene_ms = frames / config.FPS * 1000
    subtitles = [s for s in subtitles if s["startMs"] < scene_ms]
    for sub in subtitles:
        sub["endMs"] = min(sub["endMs"], round(scene_ms))

    rel_image = image_path.relative_to(config.PUBLIC_DIR).as_posix()
    rel_audio = audio_path.relative_to(config.PUBLIC_DIR).as_posix()

    scene: dict = {
        "sceneId": sid,
        "durationInSeconds": _frames_to_seconds(frames),
        "imageSource": rel_image,
        "narrationAudio": rel_audio,
        "subtitles": subtitles,
    }

    # 효과음은 무료 소스를 직접 넣는 구조. 파일이 있으면 자동으로 물린다.
    sfx_path = config.ASSETS_DIR / "sfx" / f"{scene_plan.get('sfx_keyword', '')}.mp3"
    if sfx_path.exists():
        scene["sfxAudio"] = sfx_path.relative_to(config.PUBLIC_DIR).as_posix()
        scene["sfxVolume"] = 0.2

    return scene


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="쥴리아스로그 쇼츠 입력 JSON 생성")
    parser.add_argument("--topic", required=True, help="쇼츠 주제")
    parser.add_argument("--scenes", type=int, default=8, help="씬 개수 (기본 8)")
    parser.add_argument("--slug", default="shorts", help="에셋 하위 폴더명 (기본 shorts)")
    parser.add_argument("--voice", default=config.VOICE, help=f"edge-tts 보이스 (기본 {config.VOICE})")
    parser.add_argument("--image-model", default=config.IMAGE_MODEL)
    parser.add_argument("--text-model", default=config.TEXT_MODEL)
    parser.add_argument("--force", action="store_true", help="캐시 무시하고 전부 재생성 (비용 재발생)")
    parser.add_argument("--skip-images", action="store_true", help="이미지 생성을 건너뜀 (기존 파일 재사용)")
    parser.add_argument("--yes", action="store_true", help="비용 확인 프롬프트 건너뜀")
    parser.add_argument("--out", default=str(config.INPUT_JSON), help="출력 JSON 경로")
    args = parser.parse_args(argv)

    cfg = config.PipelineConfig(
        topic=args.topic,
        scene_count=args.scenes,
        text_model=args.text_model,
        image_model=args.image_model,
        voice=args.voice,
        force=args.force,
        skip_images=args.skip_images,
        slug=args.slug,
    )

    print(f"🎬 쥴리아스로그 파이프라인 — \"{cfg.topic}\"")
    print(f"   대본 모델: {cfg.text_model} / 이미지 모델: {cfg.image_model} / 보이스: {cfg.voice}")

    if not cfg.skip_images:
        cost = cfg.estimated_image_cost_usd()
        print(f"   💰 예상 이미지 비용: 약 ${cost:.2f} (캐릭터시트 1 + 씬 {cfg.scene_count}장)")
        print("      ※ 이미 생성된 이미지는 캐시를 쓰므로 재실행 시 추가 비용이 없습니다.")
        if not args.yes:
            answer = input("   계속할까요? [y/N] ").strip().lower()
            if answer not in ("y", "yes"):
                print("   중단했습니다.")
                return 1

    try:
        client = gemini_studio.make_client()
    except RuntimeError as err:
        print(f"\n❌ {err}", file=sys.stderr)
        return 2

    # 1. 대본
    print("\n📝 대본 생성...")
    try:
        plan = gemini_studio.generate_plan(client, cfg.topic, cfg.scene_count, cfg.text_model)
    except Exception as err:  # noqa: BLE001
        print(f"\n❌ 대본 생성 실패: {err}", file=sys.stderr)
        return 3

    config.CACHE_DIR.mkdir(parents=True, exist_ok=True)
    plan_path = config.CACHE_DIR / f"plan_{cfg.slug}.json"
    plan_path.write_text(json.dumps(plan, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f"   제목: {plan['title']}  ({len(plan['scenes'])}씬)  → {plan_path.name}")

    # 2. 이미지
    scene_dir = cfg.scene_dir
    sheet_path = scene_dir / "character_sheet.png"

    if cfg.skip_images:
        print("\n🖼️  이미지 생성 건너뜀 (--skip-images)")
        image_paths = [scene_dir / f"scene_{s['scene_id']:02d}.png" for s in plan["scenes"]]
        missing = [p for p in image_paths if not p.exists()]
        if missing:
            print(f"\n❌ 재사용할 이미지가 없습니다: {', '.join(p.name for p in missing)}", file=sys.stderr)
            return 4
    else:
        print("\n🖼️  이미지 생성...")
        try:
            reference = gemini_studio.generate_character_sheet(
                client, plan, sheet_path, model=cfg.image_model, force=cfg.force
            )
            image_paths = gemini_studio.generate_scene_images(
                client,
                plan,
                scene_dir,
                model=cfg.image_model,
                reference=reference,
                force=cfg.force,
            )
        except Exception as err:  # noqa: BLE001
            print(f"\n❌ 이미지 생성 실패: {err}", file=sys.stderr)
            return 4

    # 3. 나레이션 + 자막
    print("\n🔊 나레이션/자막 생성 (edge-tts, 무료)...")
    scenes: list[dict] = []
    try:
        for scene_plan, image_path in zip(plan["scenes"], image_paths, strict=False):
            scenes.append(
                _build_scene(
                    scene_plan,
                    slug=cfg.slug,
                    image_path=image_path,
                    voice=cfg.voice,
                    force=cfg.force,
                )
            )
    except Exception as err:  # noqa: BLE001
        print(f"\n❌ 나레이션 생성 실패: {err}", file=sys.stderr)
        return 5

    # 4. 조립
    bgm_path = config.PUBLIC_DIR / config.DEFAULT_BGM
    if not bgm_path.exists():
        print(f"   ⚠️  BGM 파일이 없습니다: {config.DEFAULT_BGM} (무음으로 렌더됩니다)")

    payload = {
        "title": plan["title"],
        "bgmAudio": config.DEFAULT_BGM if bgm_path.exists() else "",
        "bgmVolume": config.DEFAULT_BGM_VOLUME,
        "scenes": scenes,
    }

    out_path = Path(args.out)
    out_path.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")

    total_sec = sum(s["durationInSeconds"] for s in scenes)
    overlap_sec = 0.5 * max(0, len(scenes) - 1)
    print(f"\n✅ {out_path}")
    print(f"   {len(scenes)}씬 · 씬 합계 {total_sec:.1f}s · 크로스페이드 중첩 후 최종 {total_sec - overlap_sec:.1f}s")
    print("   다음: npm run render")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
