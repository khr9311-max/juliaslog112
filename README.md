# 쥴리아스로그 쇼츠 자동화 파이프라인

AI 감성 쇼츠 채널 '쥴리아스로그'의 세로 쇼츠(1080×1920 / 30fps) 렌더링 파이프라인입니다.
`juliaslog_pipeline_spec.md` 의 연출 규격을 따르되, **영상 생성(Kling)과 유료 TTS(ElevenLabs)를
이미지 + 무료 TTS 조합으로 대체**해 편당 비용을 크게 낮춘 구성입니다.

## 파이프라인

```
주제 한 줄
   │
   ├─ 1. Gemini (텍스트)   대본 · 캐릭터시트 프롬프트 · 씬별 이미지 프롬프트   → 무료 티어
   ├─ 2. Gemini (이미지)   캐릭터 시트 1장 → 레퍼런스로 주입해 씬 이미지 N장   → 유료(유일한 비용)
   ├─ 3. edge-tts          나레이션 mp3 + 단어 단위 타임스탬프                 → 무료 (API 키 불필요)
   └─ 4. Remotion          Ken Burns + 크로스페이드 + Spring 자막 + 시네마틱 룩 → 무료
```

**인물 일관성**은 캐릭터 시트 1장을 먼저 만들고, 이후 모든 씬 생성 요청에 그 이미지를
레퍼런스로 함께 넣어 확보합니다 (`pipeline/gemini_studio.py`).

**자막 싱크**는 edge-tts 가 합성 중에 흘려주는 WordBoundary 이벤트로 얻습니다.
Whisper 호출이 필요 없습니다.

## 준비

```powershell
npm install
pip install edge-tts google-genai pillow
$env:GEMINI_API_KEY = "your-key"
```

## 사용법

```powershell
# 1. 기획 + 이미지 + 나레이션 → sample_input.json
npm run pipeline -- --topic "혼자 있는 밤, 나에게 건네는 위로" --scenes 8

# 2. 렌더
npm run render                                    # out/output_shorts.mp4
npm run render -- sample_input.json out/test.mp4 --frames=0-89   # 부분 렌더(빠른 확인)

# 3. 미리보기 스튜디오
npm start
```

### 파이프라인 옵션

| 옵션 | 설명 |
|---|---|
| `--topic` | 쇼츠 주제 (필수) |
| `--scenes` | 씬 개수 (기본 8) |
| `--slug` | 에셋 하위 폴더명. 편마다 다르게 주면 서로 안 덮어씀 |
| `--skip-images` | 이미지 생성 건너뛰고 기존 파일 재사용 (비용 0) |
| `--force` | 캐시 무시하고 전부 재생성 (**비용 재발생**) |
| `--image-model` | 기본 `gemini-3-pro-image`. 저렴하게: `gemini-3.1-flash-lite-image` |
| `--voice` | 기본 `ko-KR-SunHiNeural` (한국어 여성) |

이미 생성된 이미지·나레이션은 디스크에 캐시되므로, 재실행해도 추가 비용이 들지 않습니다.
비용이 다시 드는 건 `--force` 를 줬을 때뿐입니다.

### 렌더 옵션

| 옵션 | 설명 |
|---|---|
| `--frames=a-b` | 구간만 렌더 (스모크 테스트) |
| `--crf=n` | 화질, 낮을수록 고화질 (기본 18) |
| `--concurrency=n` | 동시 렌더 탭 수 |
| `--no-overwrite` | 기존 출력 파일 보호 |
| `--verbose` | 상세 로그 + 브라우저 콘솔 |

종료 코드: `0` 성공 / `2` 인자 오류 / `3` 입력 JSON 오류 / `4` 에셋 누락 / `5` 번들 실패 / `6` 렌더 실패

## 구조

```
├── render.ts                      렌더 엔트리 (검증·에러처리·진행률)
├── sample_input.json              파이프라인 산출물 = 렌더 입력
├── remotion.config.ts
├── pipeline/
│   ├── config.py                  모델/보이스/규격 설정
│   ├── gemini_studio.py           대본 생성 + 이미지 생성(인물 일관성)
│   ├── narration.py               edge-tts + 단어 타임스탬프 + 자막 청킹
│   └── run.py                     오케스트레이터
├── public/
│   ├── fonts/GowunBatang-Regular.ttf
│   └── assets/<slug>/             생성된 이미지·나레이션
└── src/
    ├── Root.tsx, index.ts, types.ts, constants.ts, duration.ts, fonts.ts
    ├── compositions/JuliasLogShorts.tsx   TransitionSeries 크로스페이드
    └── components/
        ├── SceneItem.tsx          이미지 + 오디오 + 자막 레이어
        ├── KenBurnsImage.tsx      정지 이미지에 느린 줌/팬
        ├── Captions.tsx           Spring 물리엔진 자막
        └── CinematicLook.tsx      비네팅 + 웜 필터 + 필름 그레인
```

## 직접 챙겨야 하는 것

- **BGM**: `public/assets/bgm_ambient.mp3` 는 ffmpeg로 만든 임시 패드입니다.
  로열티프리 음원으로 교체하세요 (`pipeline/config.py` 의 `DEFAULT_BGM`).
- **효과음**: `public/assets/sfx/<키워드>.mp3` 로 넣어두면 자동으로 물립니다.
  키워드는 `.cache/plan_<slug>.json` 의 `sfx_keyword` 에 있습니다.
