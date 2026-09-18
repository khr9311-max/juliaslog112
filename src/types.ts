/** 씬에 적용할 Ken Burns(느린 줌/팬) 프리셋. AI 정지 이미지에 영화적 호흡을 준다. */
export type KenBurnsPreset =
  | 'zoomIn'
  | 'zoomOut'
  | 'panLeft'
  | 'panRight'
  | 'panUp'
  | 'panDown';

export type SubtitleWord = {
  text: string;
  startMs: number;
  endMs: number;
};

export type SceneData = {
  sceneId: number;
  durationInSeconds: number;
  /** public/ 기준 상대경로 또는 http(s) URL. Gemini 이미지 생성 결과. */
  imageSource: string;
  /** edge-tts 로 생성한 나레이션 (ko-KR 여성) */
  narrationAudio: string;
  sfxAudio?: string;
  sfxVolume?: number;
  /** 생략 시 sceneId 기준으로 자동 배정 (연속된 씬이 같은 움직임을 갖지 않도록) */
  kenBurns?: KenBurnsPreset;
  /** edge-tts WordBoundary 에서 추출한 단어 단위 타임스탬프 (씬 시작 기준 상대시간) */
  subtitles: SubtitleWord[];
};

export type ShortsInputProps = {
  title: string;
  bgmAudio: string;
  bgmVolume?: number; // 기본 0.12 (너무 크면 목소리를 가림)
  scenes: SceneData[];
};
