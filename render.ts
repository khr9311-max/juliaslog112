/**
 * juliaslog-renderer / render.ts
 *
 * 사용법:
 *   npm run render                                     (sample_input.json -> out/output_shorts.mp4)
 *   npm run render -- <input.json> <output.mp4>
 *   npm run render -- sample_input.json out/test.mp4 --frames=0-89   (스모크 테스트용 부분 렌더)
 *
 * 옵션:
 *   --frames=<a-b>      프레임 구간만 렌더 (테스트용)
 *   --composition=<id>  컴포지션 ID (기본: JuliasLogShorts)
 *   --concurrency=<n>   동시 렌더 탭 수 (기본: 자동)
 *   --crf=<n>           화질, 낮을수록 고화질 (기본 18)
 *   --no-overwrite      기존 출력 파일이 있으면 덮어쓰지 않고 실패
 *   --verbose           Remotion 상세 로그 + 브라우저 콘솔 출력
 *
 * 종료 코드:
 *   0 성공 / 2 인자 오류 / 3 입력 JSON 오류 / 4 에셋 누락 / 5 번들 실패 / 6 렌더 실패 / 1 기타
 */
import { bundle } from '@remotion/bundler';
import {
  ensureBrowser,
  getCompositions,
  renderMedia,
  selectComposition,
  type LogLevel,
} from '@remotion/renderer';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

import { COMPOSITION_ID, FPS } from './src/constants';
import { calculateShortsDurationInFrames } from './src/duration';
import type { ShortsInputProps } from './src/types';

const PROJECT_ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(PROJECT_ROOT, 'public');
const ENTRY_POINT = path.join(PROJECT_ROOT, 'src', 'index.ts');

const EXIT = {
  OK: 0,
  UNKNOWN: 1,
  BAD_ARGS: 2,
  BAD_INPUT: 3,
  MISSING_ASSET: 4,
  BUNDLE_FAILED: 5,
  RENDER_FAILED: 6,
} as const;

/** 사용자에게 보여줄 메시지와 종료 코드를 가진 에러 */
class PipelineError extends Error {
  readonly exitCode: number;
  readonly details: string[];
  constructor(message: string, exitCode: number, details: string[] = []) {
    super(message);
    this.name = 'PipelineError';
    this.exitCode = exitCode;
    this.details = details;
  }
}

// ──────────────────────────────────────────────────────────────
// 1. 입력 스키마 (src/types.ts 와 1:1 대응)
// ──────────────────────────────────────────────────────────────
const SubtitleWordSchema = z
  .object({
    text: z.string().min(1, 'text 는 빈 문자열일 수 없습니다'),
    startMs: z.number().nonnegative(),
    endMs: z.number().nonnegative(),
  })
  .refine((s) => s.endMs > s.startMs, { message: 'endMs 는 startMs 보다 커야 합니다' });

const SceneDataSchema = z.object({
  sceneId: z.number().int(),
  durationInSeconds: z.number().positive('durationInSeconds 는 0보다 커야 합니다'),
  imageSource: z.string().min(1),
  narrationAudio: z.string().min(1),
  sfxAudio: z.string().min(1).optional(),
  sfxVolume: z.number().min(0).max(1).optional(),
  kenBurns: z.enum(['zoomIn', 'zoomOut', 'panLeft', 'panRight', 'panUp', 'panDown']).optional(),
  subtitles: z.array(SubtitleWordSchema),
});

const ShortsInputPropsSchema = z.object({
  title: z.string().min(1),
  bgmAudio: z.string(),
  bgmVolume: z.number().min(0).max(1).optional(),
  scenes: z.array(SceneDataSchema).min(1, '최소 1개의 씬이 필요합니다'),
});

// ──────────────────────────────────────────────────────────────
// 2. CLI 인자 파싱
// ──────────────────────────────────────────────────────────────
interface CliOptions {
  inputPath: string;
  outputPath: string;
  compositionId: string;
  frameRange: [number, number] | null;
  concurrency: number | null;
  crf: number;
  overwrite: boolean;
  verbose: boolean;
}

const KNOWN_FLAGS = ['frames', 'composition', 'concurrency', 'crf', 'no-overwrite', 'verbose'];

const parseArgs = (argv: string[]): CliOptions => {
  const positional: string[] = [];
  const flags = new Map<string, string>();

  for (const arg of argv) {
    if (arg.startsWith('--')) {
      const [key, value] = arg.slice(2).split('=');
      flags.set(key, value ?? 'true');
    } else {
      positional.push(arg);
    }
  }

  const unknown = [...flags.keys()].filter((k) => !KNOWN_FLAGS.includes(k));
  if (unknown.length > 0) {
    throw new PipelineError(
      `알 수 없는 옵션: ${unknown.map((u) => `--${u}`).join(', ')}`,
      EXIT.BAD_ARGS,
      [`사용 가능한 옵션: ${KNOWN_FLAGS.map((f) => `--${f}`).join(', ')}`]
    );
  }

  let frameRange: [number, number] | null = null;
  const framesFlag = flags.get('frames');
  if (framesFlag && framesFlag !== 'true') {
    const match = /^(\d+)-(\d+)$/.exec(framesFlag);
    if (!match) {
      throw new PipelineError(
        `--frames 형식이 잘못되었습니다: "${framesFlag}" (예: --frames=0-89)`,
        EXIT.BAD_ARGS
      );
    }
    const from = Number(match[1]);
    const to = Number(match[2]);
    if (to < from) {
      throw new PipelineError(
        `--frames 의 끝 값이 시작 값보다 작습니다: ${framesFlag}`,
        EXIT.BAD_ARGS
      );
    }
    frameRange = [from, to];
  }

  const concurrencyFlag = flags.get('concurrency');
  const concurrency = concurrencyFlag && concurrencyFlag !== 'true' ? Number(concurrencyFlag) : null;
  if (concurrency !== null && (!Number.isInteger(concurrency) || concurrency < 1)) {
    throw new PipelineError(
      `--concurrency 는 1 이상의 정수여야 합니다: ${concurrencyFlag}`,
      EXIT.BAD_ARGS
    );
  }

  const crfFlag = flags.get('crf');
  const crf = crfFlag && crfFlag !== 'true' ? Number(crfFlag) : 18;
  if (!Number.isInteger(crf) || crf < 1 || crf > 51) {
    throw new PipelineError(`--crf 는 1~51 사이의 정수여야 합니다: ${crfFlag}`, EXIT.BAD_ARGS);
  }

  const compositionFlag = flags.get('composition');

  return {
    inputPath: path.resolve(PROJECT_ROOT, positional[0] ?? 'sample_input.json'),
    outputPath: path.resolve(PROJECT_ROOT, positional[1] ?? 'out/output_shorts.mp4'),
    compositionId: compositionFlag && compositionFlag !== 'true' ? compositionFlag : COMPOSITION_ID,
    frameRange,
    concurrency,
    crf,
    overwrite: !flags.has('no-overwrite'),
    verbose: flags.has('verbose'),
  };
};

// ──────────────────────────────────────────────────────────────
// 3. 입력 JSON 로드 + 검증
// ──────────────────────────────────────────────────────────────
const loadInputProps = (inputPath: string): ShortsInputProps => {
  if (!fs.existsSync(inputPath)) {
    throw new PipelineError(`입력 JSON을 찾을 수 없습니다: ${inputPath}`, EXIT.BAD_INPUT, [
      'pipeline/run.py 를 먼저 실행해 sample_input.json 을 생성하세요.',
    ]);
  }

  let raw: string;
  try {
    raw = fs.readFileSync(inputPath, 'utf-8');
  } catch (err) {
    throw new PipelineError(`입력 JSON을 읽을 수 없습니다: ${inputPath}`, EXIT.BAD_INPUT, [
      String((err as Error).message),
    ]);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new PipelineError(`입력 JSON 문법 오류: ${path.basename(inputPath)}`, EXIT.BAD_INPUT, [
      String((err as Error).message),
      'LLM이 생성한 JSON에 트레일링 콤마나 코드펜스가 남아있지 않은지 확인하세요.',
    ]);
  }

  const result = ShortsInputPropsSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues.map(
      (issue) => `  • ${issue.path.length ? issue.path.join('.') : '(root)'}: ${issue.message}`
    );
    throw new PipelineError('입력 JSON이 스키마와 맞지 않습니다.', EXIT.BAD_INPUT, issues);
  }

  // 자막 타임스탬프가 씬 길이를 넘어가면 화면에 절대 안 나온다 → 경고
  for (const scene of result.data.scenes) {
    const sceneMs = scene.durationInSeconds * 1000;
    for (const sub of scene.subtitles) {
      if (sub.startMs >= sceneMs) {
        console.warn(
          `⚠️  scene ${scene.sceneId}: 자막 "${sub.text}" 이 씬 길이(${scene.durationInSeconds}s)를 벗어나 표시되지 않습니다.`
        );
      }
    }
  }

  return result.data as ShortsInputProps;
};

// ──────────────────────────────────────────────────────────────
// 4. 에셋 존재 여부 검증 (렌더 다 돌린 뒤 404 나는 사고 방지)
// ──────────────────────────────────────────────────────────────
const isRemote = (src: string) => src.startsWith('http://') || src.startsWith('https://');

const verifyAssets = (props: ShortsInputProps): void => {
  const missing: string[] = [];
  const check = (src: string | undefined, label: string) => {
    if (!src || isRemote(src)) return;
    const abs = path.join(PUBLIC_DIR, src);
    if (!fs.existsSync(abs)) missing.push(`  • ${label}: ${src}  →  ${abs}`);
  };

  check(props.bgmAudio, 'bgmAudio');
  for (const scene of props.scenes) {
    check(scene.imageSource, `scene ${scene.sceneId} / imageSource`);
    check(scene.narrationAudio, `scene ${scene.sceneId} / narrationAudio`);
    check(scene.sfxAudio, `scene ${scene.sceneId} / sfxAudio`);
  }

  if (missing.length > 0) {
    throw new PipelineError(
      `public/ 아래에서 에셋 ${missing.length}개를 찾을 수 없습니다.`,
      EXIT.MISSING_ASSET,
      [...missing, '', 'JSON의 경로는 public/ 기준 상대경로여야 합니다 (예: "assets/scene_01.png").']
    );
  }
};

/** ffprobe가 있으면 나레이션이 씬 길이를 넘는지 미리 경고한다 (없으면 조용히 건너뜀). */
const warnOnAudioOverflow = (props: ShortsInputProps): void => {
  const probe = (abs: string): number | null => {
    try {
      const out = execFileSync(
        'ffprobe',
        ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', abs],
        { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'ignore'] }
      );
      const value = Number(out.trim());
      return Number.isFinite(value) ? value : null;
    } catch {
      return null; // ffprobe 미설치 또는 probe 실패 → 검사 생략
    }
  };

  for (const scene of props.scenes) {
    if (isRemote(scene.narrationAudio)) continue;
    const duration = probe(path.join(PUBLIC_DIR, scene.narrationAudio));
    if (duration !== null && duration > scene.durationInSeconds + 0.05) {
      console.warn(
        `⚠️  scene ${scene.sceneId}: 나레이션이 ${duration.toFixed(2)}s 인데 씬은 ${scene.durationInSeconds}s 입니다. 말이 잘립니다.`
      );
    }
  }
};

// ──────────────────────────────────────────────────────────────
// 5. 진행률 표시
// ──────────────────────────────────────────────────────────────
const makeProgressLogger = (label: string) => {
  let lastPrinted = -1;
  return (ratio: number) => {
    const percent = Math.max(0, Math.min(100, Math.round(ratio * 100)));
    if (percent === lastPrinted) return;
    lastPrinted = percent;
    if (process.stdout.isTTY) {
      const filled = Math.round(percent / 4);
      process.stdout.write(
        `\r   ${label} [${'█'.repeat(filled)}${'░'.repeat(25 - filled)}] ${percent}%`
      );
      if (percent === 100) process.stdout.write('\n');
    } else if (percent % 10 === 0) {
      console.log(`   ${label} ${percent}%`);
    }
  };
};

// ──────────────────────────────────────────────────────────────
// 6. 메인
// ──────────────────────────────────────────────────────────────
const main = async (): Promise<void> => {
  const startedAt = Date.now();
  const options = parseArgs(process.argv.slice(2));
  const logLevel: LogLevel = options.verbose ? 'verbose' : 'error';

  console.log('🎬 쥴리아스로그 쇼츠 렌더링 시작');
  console.log(`   입력: ${path.relative(PROJECT_ROOT, options.inputPath)}`);
  console.log(`   출력: ${path.relative(PROJECT_ROOT, options.outputPath)}`);

  // 6-1. 입력 검증
  const inputProps = loadInputProps(options.inputPath);
  verifyAssets(inputProps);
  warnOnAudioOverflow(inputProps);

  const expectedFrames = calculateShortsDurationInFrames(inputProps.scenes, FPS);
  console.log(
    `   "${inputProps.title}" — ${inputProps.scenes.length}씬 / ${expectedFrames}프레임 (${(
      expectedFrames / FPS
    ).toFixed(1)}초, 크로스페이드 중첩 반영)`
  );

  // 6-2. 출력 경로 준비
  const outputDir = path.dirname(options.outputPath);
  try {
    fs.mkdirSync(outputDir, { recursive: true });
  } catch (err) {
    throw new PipelineError(`출력 폴더를 만들 수 없습니다: ${outputDir}`, EXIT.UNKNOWN, [
      String((err as Error).message),
    ]);
  }
  if (fs.existsSync(options.outputPath) && !options.overwrite) {
    throw new PipelineError(`출력 파일이 이미 존재합니다: ${options.outputPath}`, EXIT.BAD_ARGS, [
      '--no-overwrite 를 빼거나 다른 파일명을 지정하세요.',
    ]);
  }

  // 6-3. 렌더용 브라우저 확보
  console.log('\n🌐 렌더 브라우저 확인...');
  try {
    await ensureBrowser({ logLevel });
  } catch (err) {
    throw new PipelineError('Chrome Headless Shell을 준비하지 못했습니다.', EXIT.RENDER_FAILED, [
      String((err as Error).message),
      '네트워크(프록시/방화벽)를 확인하거나 `npx remotion browser ensure` 를 직접 실행해 보세요.',
    ]);
  }

  // 6-4. 번들
  console.log('📦 Webpack 번들 생성...');
  const bundleProgress = makeProgressLogger('bundle');
  let serveUrl: string;
  try {
    serveUrl = await bundle({
      entryPoint: ENTRY_POINT,
      publicDir: PUBLIC_DIR,
      onProgress: (p) => bundleProgress(p / 100),
    });
  } catch (err) {
    throw new PipelineError('번들 생성에 실패했습니다.', EXIT.BUNDLE_FAILED, [
      String((err as Error).stack ?? (err as Error).message),
      'src/ 의 TypeScript 오류일 가능성이 높습니다. `npm run typecheck` 로 확인하세요.',
    ]);
  }

  // 6-5. 컴포지션 선택
  console.log('🔎 컴포지션 조회...');
  let composition;
  try {
    composition = await selectComposition({
      serveUrl,
      id: options.compositionId,
      inputProps,
      logLevel,
    });
  } catch (err) {
    let available = '';
    try {
      const comps = await getCompositions(serveUrl, { inputProps, logLevel });
      available = comps.map((c) => c.id).join(', ');
    } catch {
      /* 목록 조회까지 실패하면 생략 */
    }
    throw new PipelineError(
      `컴포지션 "${options.compositionId}" 을 찾을 수 없습니다.`,
      EXIT.RENDER_FAILED,
      [String((err as Error).message), available ? `사용 가능한 컴포지션: ${available}` : ''].filter(
        Boolean
      )
    );
  }

  if (composition.durationInFrames !== expectedFrames) {
    console.warn(
      `⚠️  계산된 길이(${expectedFrames}f)와 컴포지션 길이(${composition.durationInFrames}f)가 다릅니다. Root.tsx 의 calculateMetadata 를 확인하세요.`
    );
  }

  const totalToRender = options.frameRange
    ? Math.min(options.frameRange[1], composition.durationInFrames - 1) - options.frameRange[0] + 1
    : composition.durationInFrames;
  console.log(
    `   ${composition.id} · ${composition.width}x${composition.height} · ${composition.fps}fps · ${totalToRender}프레임 렌더 예정` +
      (options.frameRange ? ` (부분 렌더 ${options.frameRange[0]}-${options.frameRange[1]})` : '')
  );

  // 6-6. 렌더
  console.log('\n🎥 렌더링...');
  const renderProgress = makeProgressLogger('render');
  const browserErrors: string[] = [];

  try {
    await renderMedia({
      composition,
      serveUrl,
      codec: 'h264',
      outputLocation: options.outputPath,
      inputProps,
      jpegQuality: 95,
      crf: options.crf,
      x264Preset: 'slow',
      audioCodec: 'aac',
      audioBitrate: '256k',
      concurrency: options.concurrency,
      frameRange: options.frameRange ?? undefined,
      overwrite: options.overwrite,
      chromiumOptions: { gl: 'angle' },
      timeoutInMilliseconds: 120_000,
      logLevel,
      onProgress: ({ progress }) => renderProgress(progress),
      onBrowserLog: (log) => {
        if (log.type === 'error') browserErrors.push(log.text);
        if (options.verbose) console.log(`   [browser:${log.type}] ${log.text}`);
      },
    });
  } catch (err) {
    throw new PipelineError('렌더링 중 오류가 발생했습니다.', EXIT.RENDER_FAILED, [
      String((err as Error).stack ?? (err as Error).message),
      ...(browserErrors.length
        ? ['', '브라우저 콘솔 에러:', ...browserErrors.slice(0, 10).map((e) => `  • ${e}`)]
        : []),
      '',
      '자주 나는 원인: 에셋 경로 오타 / 이미지 로드 실패 / delayRender() 타임아웃(폰트 로딩).',
    ]);
  }

  // 6-7. 결과 확인
  if (!fs.existsSync(options.outputPath)) {
    throw new PipelineError('렌더는 끝났지만 출력 파일이 생성되지 않았습니다.', EXIT.RENDER_FAILED);
  }
  const sizeMb = fs.statSync(options.outputPath).size / (1024 * 1024);
  if (sizeMb < 0.01) {
    throw new PipelineError(
      `출력 파일이 비어 있습니다 (${sizeMb.toFixed(3)} MB).`,
      EXIT.RENDER_FAILED
    );
  }

  const elapsed = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log(`\n✅ 완료: ${options.outputPath}`);
  console.log(`   ${sizeMb.toFixed(2)} MB · ${elapsed}초 소요`);
  if (browserErrors.length > 0) {
    console.log(`   ⚠️  브라우저 콘솔 에러 ${browserErrors.length}건 (--verbose 로 확인)`);
  }
};

process.on('unhandledRejection', (reason) => {
  console.error('\n❌ 처리되지 않은 비동기 오류:', reason);
  process.exit(EXIT.UNKNOWN);
});

process.on('SIGINT', () => {
  console.log('\n\n⛔ 사용자가 렌더링을 중단했습니다.');
  process.exit(130);
});

main()
  .then(() => process.exit(EXIT.OK))
  .catch((err: unknown) => {
    if (err instanceof PipelineError) {
      console.error(`\n❌ ${err.message}`);
      for (const detail of err.details) console.error(detail);
      process.exit(err.exitCode);
    }
    console.error('\n❌ 예기치 못한 오류:');
    console.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
    process.exit(EXIT.UNKNOWN);
  });
