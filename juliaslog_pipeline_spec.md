# 📌 [고도화 버전] 프로젝트 명세서: '쥴리아스로그' 감성 쇼츠 자동화 파이프라인

이 문서는 AI 기반 감성 쇼츠 채널 '쥴리아스로그(Juliaslog)'의 100만 구독자 달성을 위한 **초고화질/시네마틱 영상 제작 완전 자동화 기술 명세서**입니다. Claude Code는 본 문서의 지침에 따라 렌더링 엔진(Remotion)을 구축해야 합니다.

## 1. 하이엔드(High-end) 연출 핵심 규격

*   **시각(Visual)**: AI 특유의 튀는 색감을 잡기 위해 전체 영상 위에 **비네팅(Vignette)과 필름 그레인(Film Grain)** 오버레이를 씌워 룩앤필(Look & Feel) 통일.
*   **전환(Transition)**: 컷과 컷 사이는 반드시 부드러운 **Crossfade(크로스페이드)** 로 연결하여 서정적인 호흡 유지.
*   **청각(Audio)**: ElevenLabs 생성 시 단순 텍스트가 아닌 **SSML(Speech Synthesis Markup Language)** 을 사용하여 문장 간 0.5~1초의 물리적 호흡(Pause) 강제.
*   **자막(Typography)**: Remotion의 `spring` 물리 엔진을 사용해 단어가 물결치듯 부드럽게 떠오르는 모션 적용.

## 2. 시스템 아키텍처 & 디렉토리 구조

```text
juliaslog-renderer/
├── package.json
├── tsconfig.json
├── remotion.config.ts
├── sample_input.json          
├── render.ts                  
├── public/
│   ├── fonts/                 # GowunBatang-Regular.ttf
│   └── assets/                
└── src/
    ├── index.ts               
    ├── Root.tsx               
    ├── types.ts               
    ├── compositions/
    │   └── JuliasLogShorts.tsx # 메인 시퀀스 (TransitionSeries 적용)
    └── components/
        ├── SceneItem.tsx      # 비디오/오디오 레이어
        ├── Captions.tsx       # Spring 물리엔진 기반 감성 자막
        └── CinematicLook.tsx  # 비네팅 및 그레인 오버레이 (New)
```

## 3. 데이터 계약 (JSON Schema)

### `src/types.ts`
```typescript
export interface SubtitleWord {
  text: string;
  startMs: number; 
  endMs: number;   
}

export interface SceneData {
  sceneId: number;
  durationInSeconds: number;
  videoSource: string;     
  narrationAudio: string;  
  sfxAudio?: string;       
  sfxVolume?: number;      
  subtitles: SubtitleWord[];
}

export interface ShortsInputProps {
  title: string;
  bgmAudio: string;        
  bgmVolume?: number;      // 기본 0.12 (너무 크면 목소리를 가림)
  scenes: SceneData[];
}
```

## 4. LLM 마스터 프롬프트 (오케스트레이터용)

비디오 생성(Runway/Kling)과 오디오 생성(ElevenLabs)을 완벽히 통제하기 위한 LLM 프롬프트입니다.

```markdown
당신은 150만 구독자를 보유한 감성 채널 '쥴리아스로그'의 수석 디렉터입니다.
45~55초 분량의 쇼츠 기획안을 다음 규칙에 따라 JSON으로 작성하세요.

[규칙]
1. 나레이션(ssml_narration): 기계음을 없애기 위해 문장 사이에 반드시 `<break time="0.6s"/>` 또는 `<break time="0.8s"/>`를 삽입하세요.
2. 비디오 프롬프트(video_prompt): "Cinematic, 35mm film, soft diffused lighting, slow subtle pan" 키워드를 기본으로 포함하여 공간의 여백을 묘사하세요.
3. 효과음(sfx_keyword): 나레이션의 공백을 채워줄 ASMR(예: "soft rain falling", "pouring warm tea") 키워드를 작성하세요.

[출력 JSON 스키마]
{
  "title": "서정적 제목",
  "bgm_mood": "Minimalist piano",
  "scenes": [
    {
      "scene_id": 1,
      "duration_sec": 5.0,
      "ssml_narration": "혹시 오늘,<break time=\"0.6s\"/> 온종일 아무 말도 하지 않은 순간이 있었나요?",
      "video_prompt": "Cinematic slow push-in shot, dark wood Korean Hanok veranda, warm interior amber light, soft rain outside. 35mm lens.",
      "sfx_keyword": "soft raindrops on clay roof"
    }
  ]
}
```

## 5. Remotion 소스 코드 (하이엔드 구현체)

### 5.1. `package.json` (전환 효과 패키지 추가)
```json
{
  "name": "juliaslog-renderer",
  "version": "1.0.0",
  "scripts": {
    "start": "remotion preview src/index.ts",
    "build": "remotion bundle src/index.ts",
    "render": "ts-node render.ts"
  },
  "dependencies": {
    "@remotion/bundler": "^4.0.0",
    "@remotion/cli": "^4.0.0",
    "@remotion/media-utils": "^4.0.0",
    "@remotion/renderer": "^4.0.0",
    "@remotion/transitions": "^4.0.0",
    "react": "^18.2.0",
    "react-dom": "^18.2.0",
    "remotion": "^4.0.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "@types/react": "^18.2.0",
    "ts-node": "^10.9.2",
    "typescript": "^5.0.0"
  }
}
```

### 5.2. `src/components/CinematicLook.tsx` (필름 질감통일)
AI 영상의 이질감을 없애고 아날로그 감성을 부여하는 글로벌 오버레이입니다.
```tsx
import React from 'react';
import { AbsoluteFill } from 'remotion';

export const CinematicLook: React.FC = () => {
  return (
    <AbsoluteFill style={{ pointerEvents: 'none', zIndex: 9999 }}>
      {/* 1. Vignette (가장자리 어둡게) */}
      <div
        style={{
          position: 'absolute',
          width: '100%',
          height: '100%',
          boxShadow: 'inset 0 0 150px rgba(0,0,0,0.5)',
        }}
      />
      {/* 2. Soft Warm Filter (색감 통일) */}
      <div
        style={{
          position: 'absolute',
          width: '100%',
          height: '100%',
          backgroundColor: 'rgba(50, 30, 10, 0.05)',
          mixBlendMode: 'overlay',
        }}
      />
    </AbsoluteFill>
  );
};
```

### 5.3. `src/components/Captions.tsx` (Spring 물리 엔진 자막)
단순 선형 페이드(linear fade)가 아닌, 고급스러운 텐션을 가진 애니메이션입니다.
```tsx
import React from 'react';
import { spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { SubtitleWord } from '../types';

export const Captions: React.FC<{ subtitles: SubtitleWord[] }> = ({ subtitles }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const currentTimeMs = (frame / fps) * 1000;

  const currentWord = subtitles.find(
    (sub) => currentTimeMs >= sub.startMs && currentTimeMs <= sub.endMs
  );

  if (!currentWord) return null;

  const wordStartFrame = (currentWord.startMs / 1000) * fps;
  const progressFrame = frame - wordStartFrame;

  // 물결치듯 떠오르는 Spring 모션
  const popIn = spring({
    frame: progressFrame,
    fps,
    config: { damping: 14, stiffness: 120, mass: 0.8 },
  });

  const translateY = (1 - popIn) * 15; // 15px 아래에서 위로
  const opacity = spring({
    frame: progressFrame,
    fps,
    config: { damping: 20, stiffness: 100 },
  });

  return (
    <div
      style={{
        position: 'absolute',
        bottom: '250px',
        width: '100%',
        display: 'flex',
        justifyContent: 'center',
        padding: '0 50px',
        pointerEvents: 'none',
      }}
    >
      <div
        style={{
          opacity,
          transform: `translateY(${translateY}px)`,
          fontFamily: '"Gowun Batang", "Noto Serif KR", serif',
          fontSize: '48px',
          fontWeight: 600,
          color: '#FAF8F5',
          textAlign: 'center',
          lineHeight: 1.6,
          textShadow: '0 4px 16px rgba(0, 0, 0, 0.85), 0 1px 4px rgba(0, 0, 0, 0.5)',
          letterSpacing: '-0.03em',
        }}
      >
        {currentWord.text}
      </div>
    </div>
  );
};
```

### 5.4. `src/compositions/JuliasLogShorts.tsx` (크로스페이드 트랜지션 적용)
장면 간 딱딱한 끊김을 방지하는 `@remotion/transitions` 적용.
```tsx
import React from 'react';
import { Audio, staticFile } from 'remotion';
import { TransitionSeries, linearTiming } from '@remotion/transitions';
import { fade } from '@remotion/transitions/fade';
import { SceneItem } from '../components/SceneItem';
import { CinematicLook } from '../components/CinematicLook';
import { ShortsInputProps } from '../types';

export const JuliasLogShorts: React.FC<ShortsInputProps> = ({ bgmAudio, bgmVolume = 0.12, scenes }) => {
  const resolvePath = (p: string) => (p.startsWith('http') ? p : staticFile(p));

  return (
    <div style={{ flex: 1, backgroundColor: '#050505' }}>
      <TransitionSeries>
        {scenes.map((scene, index) => {
          const sceneFrames = Math.round(scene.durationInSeconds * 30);
          return (
            <React.Fragment key={scene.sceneId}>
              <TransitionSeries.Sequence durationInFrames={sceneFrames}>
                <SceneItem scene={scene} />
              </TransitionSeries.Sequence>
              
              {/* 마지막 씬이 아니면 0.5초 크로스페이드 연결 */}
              {index < scenes.length - 1 && (
                <TransitionSeries.Transition
                  presentation={fade()}
                  timing={linearTiming({ durationInFrames: 15 })} // 0.5초(15프레임)
                />
              )}
            </React.Fragment>
          );
        })}
      </TransitionSeries>

      {/* 시네마틱 오버레이 및 BGM */}
      <CinematicLook />
      {bgmAudio && <Audio src={resolvePath(bgmAudio)} volume={bgmVolume} loop />}
    </div>
  );
};
```
*(참고: `SceneItem.tsx`, `Root.tsx`, `render.ts`는 이전 스펙의 구조를 유지하되 TransitionSeries의 타이밍에 맞춰 동작하도록 결합됩니다.)*

## 6. [부록] 파이프라인 백엔드(Python) 동작 흐름도
완전 자동화를 위해 외부 서버(또는 n8n)에서 실행할 Python 오케스트레이터의 핵심 흐름입니다. 이 부분이 완성되어야 `render.ts`에 완벽한 JSON을 넘길 수 있습니다.

1. **LLM 기획 (Claude 3.5 Sonnet)**: 주제 전달 ➔ 대본/프롬프트 JSON 수신
2. **미디어 병렬 생성 (Kling API / ElevenLabs API)**:
   - 비디오 프롬프트로 Kling에 영상 생성 요청 (`.mp4` 다운로드).
   - SSML 나레이션 텍스트로 ElevenLabs에 음성 생성 요청 (`.mp3` 다운로드).
3. **타임스탬프 추출 (OpenAI Whisper)**:
   - 생성된 `.mp3`를 Whisper API(또는 로컬 WhisperX)에 넣어 단어별 타임스탬프(`start`, `end`) 추출.
4. **Remotion Input JSON 조립**:
   - 다운로드된 에셋들의 로컬 경로와 Whisper 타임스탬프를 묶어 `sample_input.json` 구조로 저장.
5. **빌드 트리거**:
   - `npm run render sample_input.json output_shorts.mp4` 실행 ➔ 최종 쇼츠 완성.

## 7. Claude Code 실행 지시문

> `"첨부된 [고도화 버전] juliaslog_pipeline_spec.md 명세서를 완벽히 숙지해줘. 
> 1. `@remotion/transitions`를 포함해 패키지를 셋업해.
> 2. `CinematicLook`, `Captions`(Spring 물리엔진), `JuliasLogShorts`(크로스페이드) 컴포넌트를 정확히 구현해.
> 3. 에러 처리 로직이 들어간 `render.ts`를 작성한 뒤, 테스트 렌더링까지 완료해줘."`