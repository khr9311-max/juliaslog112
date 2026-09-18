import React from 'react';
import { AbsoluteFill, Audio, staticFile } from 'remotion';
import { Captions } from './Captions';
import { KenBurnsImage, presetForScene } from './KenBurnsImage';
import { SceneData } from '../types';
import { DEFAULT_SFX_VOLUME } from '../constants';

/** 로컬 에셋(public/)과 원격 URL을 모두 지원한다. */
export const resolveSrc = (p: string): string =>
  p.startsWith('http://') || p.startsWith('https://') ? p : staticFile(p);

/**
 * 한 개 씬의 이미지/오디오/자막 레이어.
 * TransitionSeries.Sequence 안에서 렌더되므로 useCurrentFrame()은 항상 씬 기준 0부터 시작한다.
 */
export const SceneItem: React.FC<{
  scene: SceneData;
  /** 씬 길이(프레임). Ken Burns 진행률 계산에 필요해 상위에서 명시적으로 내려준다. */
  durationInFrames: number;
}> = ({ scene, durationInFrames }) => {
  return (
    <AbsoluteFill style={{ backgroundColor: '#050505' }}>
      {/* 1. 이미지 레이어 + Ken Burns (정지 이미지에 영화적 호흡 부여) */}
      <KenBurnsImage
        src={resolveSrc(scene.imageSource)}
        durationInFrames={durationInFrames}
        preset={scene.kenBurns ?? presetForScene(scene.sceneId)}
      />

      {/* 2. 나레이션 (edge-tts ko-KR 여성) */}
      {scene.narrationAudio ? <Audio src={resolveSrc(scene.narrationAudio)} /> : null}

      {/* 3. 효과음 (ASMR) — 나레이션을 덮지 않도록 기본 볼륨을 낮게 */}
      {scene.sfxAudio ? (
        <Audio src={resolveSrc(scene.sfxAudio)} volume={scene.sfxVolume ?? DEFAULT_SFX_VOLUME} />
      ) : null}

      {/* 4. Spring 물리엔진 자막 */}
      <Captions subtitles={scene.subtitles} />
    </AbsoluteFill>
  );
};
