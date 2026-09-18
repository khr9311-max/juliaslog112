import React from 'react';
import { AbsoluteFill, Easing, Img, interpolate, useCurrentFrame } from 'remotion';
import { KenBurnsPreset } from '../types';

interface KenBurnsMotion {
  scaleFrom: number;
  scaleTo: number;
  xFrom: number; // % 단위
  xTo: number;
  yFrom: number;
  yTo: number;
}

/**
 * 팬(pan)을 줄 때는 확대 배율을 넉넉히 줘서 이미지 가장자리가 화면 안으로
 * 들어오는(검은 띠) 사고를 막는다. 최대 이동량 2.5% < (scale-1)/2 를 유지.
 */
const MOTIONS: Record<KenBurnsPreset, KenBurnsMotion> = {
  zoomIn: { scaleFrom: 1.02, scaleTo: 1.16, xFrom: 0, xTo: 0, yFrom: 0, yTo: 0 },
  zoomOut: { scaleFrom: 1.16, scaleTo: 1.02, xFrom: 0, xTo: 0, yFrom: 0, yTo: 0 },
  panLeft: { scaleFrom: 1.14, scaleTo: 1.2, xFrom: 2.5, xTo: -2.5, yFrom: 0, yTo: 0 },
  panRight: { scaleFrom: 1.14, scaleTo: 1.2, xFrom: -2.5, xTo: 2.5, yFrom: 0, yTo: 0 },
  panUp: { scaleFrom: 1.14, scaleTo: 1.2, xFrom: 0, xTo: 0, yFrom: 2.5, yTo: -2.5 },
  panDown: { scaleFrom: 1.14, scaleTo: 1.2, xFrom: 0, xTo: 0, yFrom: -2.5, yTo: 2.5 },
};

const PRESET_CYCLE: KenBurnsPreset[] = ['zoomIn', 'panRight', 'zoomOut', 'panLeft', 'panUp', 'panDown'];

/** kenBurns 미지정 시 씬 번호로 프리셋을 돌려 연속 씬이 같은 움직임을 갖지 않게 한다. */
export const presetForScene = (sceneId: number): KenBurnsPreset =>
  PRESET_CYCLE[Math.abs(sceneId) % PRESET_CYCLE.length];

export const KenBurnsImage: React.FC<{
  src: string;
  durationInFrames: number;
  preset: KenBurnsPreset;
}> = ({ src, durationInFrames, preset }) => {
  const frame = useCurrentFrame();
  const motion = MOTIONS[preset] ?? MOTIONS.zoomIn;

  // 가속/감속이 붙은 아주 느린 움직임 (35mm slow subtle pan 느낌)
  const progress = interpolate(frame, [0, Math.max(1, durationInFrames - 1)], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
    easing: Easing.inOut(Easing.ease),
  });

  const scale = motion.scaleFrom + (motion.scaleTo - motion.scaleFrom) * progress;
  const x = motion.xFrom + (motion.xTo - motion.xFrom) * progress;
  const y = motion.yFrom + (motion.yTo - motion.yFrom) * progress;

  return (
    <AbsoluteFill style={{ overflow: 'hidden', backgroundColor: '#050505' }}>
      <Img
        src={src}
        style={{
          width: '100%',
          height: '100%',
          objectFit: 'cover',
          transform: `scale(${scale}) translate(${x}%, ${y}%)`,
          transformOrigin: 'center center',
          willChange: 'transform',
        }}
      />
    </AbsoluteFill>
  );
};
