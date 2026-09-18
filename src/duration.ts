import { TRANSITION_DURATION_IN_FRAMES } from './constants';
import { SceneData } from './types';

/**
 * TransitionSeries의 총 길이 계산.
 *
 * TransitionSeries는 트랜지션 구간만큼 앞뒤 씬이 "겹치므로",
 * 전체 길이 = Σ(씬 길이) - (트랜지션 길이 × 트랜지션 개수) 이다.
 * Composition의 durationInFrames가 이 값과 다르면 영상 끝이 잘리거나 검은 화면이 남는다.
 */
export const calculateShortsDurationInFrames = (scenes: SceneData[], fps: number): number => {
  const total = scenes.reduce((acc, scene) => acc + Math.round(scene.durationInSeconds * fps), 0);
  const overlap = TRANSITION_DURATION_IN_FRAMES * Math.max(0, scenes.length - 1);
  return Math.max(1, total - overlap);
};
