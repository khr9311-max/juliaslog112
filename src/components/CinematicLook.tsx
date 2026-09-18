import React from 'react';
import { AbsoluteFill, useCurrentFrame } from 'remotion';

/**
 * 명세서 §5.2 CinematicLook
 * AI 영상의 이질감을 없애고 아날로그 감성을 부여하는 글로벌 오버레이.
 *
 * 레이어 구성 (명세서 §1 "비네팅 + 필름 그레인"):
 *  1. Vignette      - 가장자리 어둡게
 *  2. Soft Warm     - 색감 통일(오버레이 블렌드)
 *  3. Film Grain    - 프레임마다 시드가 바뀌는 아날로그 입자
 */
export const CinematicLook: React.FC<{
  /** 필름 그레인 on/off (기본 on) */
  grain?: boolean;
  /** 그레인 농도 0~1 (기본 0.055 — 과하면 유튜브 압축에서 뭉개짐) */
  grainOpacity?: number;
}> = ({ grain = true, grainOpacity = 0.055 }) => {
  const frame = useCurrentFrame();

  // 프레임별로 시드를 굴려 "살아있는" 입자를 만들되, 프레임 번호로만 결정되므로
  // 렌더는 완전히 결정론적이다(동일 프레임 = 동일 그레인).
  const grainSeed = frame % 12;

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
      {/* 3. Film Grain (35mm 필름 질감) */}
      {grain ? (
        <svg
          width="100%"
          height="100%"
          style={{
            position: 'absolute',
            width: '100%',
            height: '100%',
            opacity: grainOpacity,
            mixBlendMode: 'overlay',
          }}
        >
          <filter id="juliaslog-film-grain">
            <feTurbulence
              type="fractalNoise"
              baseFrequency="0.9"
              numOctaves={3}
              seed={grainSeed}
              stitchTiles="stitch"
            />
            <feColorMatrix type="saturate" values="0" />
          </filter>
          <rect width="100%" height="100%" filter="url(#juliaslog-film-grain)" />
        </svg>
      ) : null}
    </AbsoluteFill>
  );
};
