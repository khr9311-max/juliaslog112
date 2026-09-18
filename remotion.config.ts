import { Config } from '@remotion/cli/config';

// 명세서 §2 기준 엔트리포인트
Config.setEntryPoint('src/index.ts');

// 쇼츠(세로) 고화질 기본값
Config.setVideoImageFormat('jpeg');
Config.setJpegQuality(95);
Config.setCodec('h264');
Config.setOverwriteOutput(true);
Config.setChromiumOpenGlRenderer('angle');
