import React from 'react';
import { Composition } from 'remotion';
import { JuliasLogShorts } from './compositions/JuliasLogShorts';
import { calculateShortsDurationInFrames } from './duration';
import { ShortsInputProps } from './types';
import { COMPOSITION_ID, FPS, VIDEO_HEIGHT, VIDEO_WIDTH } from './constants';
import sampleInput from '../sample_input.json';

export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id={COMPOSITION_ID}
      component={JuliasLogShorts}
      // calculateMetadata가 inputProps 기준으로 덮어쓴다. (스튜디오 초기값 역할)
      durationInFrames={calculateShortsDurationInFrames(
        (sampleInput as ShortsInputProps).scenes,
        FPS
      )}
      fps={FPS}
      width={VIDEO_WIDTH}
      height={VIDEO_HEIGHT}
      defaultProps={sampleInput as ShortsInputProps}
      calculateMetadata={({ props }: { props: ShortsInputProps }) => {
        if (!props?.scenes?.length) {
          throw new Error(
            '[juliaslog] inputProps.scenes 가 비어 있습니다. sample_input.json 형식을 확인하세요.'
          );
        }
        return {
          durationInFrames: calculateShortsDurationInFrames(props.scenes, FPS),
          fps: FPS,
          width: VIDEO_WIDTH,
          height: VIDEO_HEIGHT,
        };
      }}
    />
  );
};
