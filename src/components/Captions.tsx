import React from 'react';
import { spring, useCurrentFrame, useVideoConfig } from 'remotion';
import { SubtitleWord } from '../types';
import { CAPTION_FONT_FAMILY } from '../fonts';

/**
 * 명세서 §5.3 Captions
 * 단순 선형 페이드(linear fade)가 아닌, spring 물리 엔진 기반의
 * "물결치듯 떠오르는" 고급 텐션 자막.
 *
 * subtitles의 startMs/endMs는 해당 씬(Sequence) 시작 기준 상대 시간이다.
 */
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
          fontFamily: CAPTION_FONT_FAMILY,
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
