import React from 'react';
import { Audio, staticFile, useVideoConfig } from 'remotion';
import { TransitionSeries, linearTiming } from '@remotion/transitions';
import { fade } from '@remotion/transitions/fade';
import { SceneItem } from '../components/SceneItem';
import { CinematicLook } from '../components/CinematicLook';
import { ShortsInputProps } from '../types';
import { DEFAULT_BGM_VOLUME, TRANSITION_DURATION_IN_FRAMES } from '../constants';

/**
 * 명세서 §5.4 JuliasLogShorts
 * 장면 간 딱딱한 끊김을 방지하는 @remotion/transitions 크로스페이드 적용.
 */
export const JuliasLogShorts: React.FC<ShortsInputProps> = ({
  bgmAudio,
  bgmVolume = DEFAULT_BGM_VOLUME,
  scenes,
}) => {
  const { fps } = useVideoConfig();
  const resolvePath = (p: string) => (p.startsWith('http') ? p : staticFile(p));

  return (
    <div style={{ flex: 1, backgroundColor: '#050505' }}>
      <TransitionSeries>
        {scenes.map((scene, index) => {
          const sceneFrames = Math.round(scene.durationInSeconds * fps);
          return (
            <React.Fragment key={scene.sceneId}>
              <TransitionSeries.Sequence durationInFrames={sceneFrames}>
                <SceneItem scene={scene} durationInFrames={sceneFrames} />
              </TransitionSeries.Sequence>

              {/* 마지막 씬이 아니면 0.5초 크로스페이드 연결 */}
              {index < scenes.length - 1 && (
                <TransitionSeries.Transition
                  presentation={fade()}
                  timing={linearTiming({ durationInFrames: TRANSITION_DURATION_IN_FRAMES })}
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
