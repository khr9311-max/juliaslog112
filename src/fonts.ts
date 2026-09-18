import { cancelRender, continueRender, delayRender, staticFile } from 'remotion';

/** 명세서 §5.3의 자막 폰트 스택 */
export const CAPTION_FONT_FAMILY = '"Gowun Batang", "Noto Serif KR", serif';

const FONT_FILE = 'fonts/GowunBatang-Regular.ttf';

/**
 * public/fonts 의 로컬 TTF를 등록한다.
 * 네트워크(Google Fonts CDN)에 의존하지 않으므로 오프라인/CI 렌더에서도 동일한 결과가 나온다.
 * 폰트 로딩이 끝날 때까지 delayRender로 첫 프레임 캡처를 붙잡는다.
 */
if (typeof window !== 'undefined' && typeof FontFace !== 'undefined') {
  const handle = delayRender('Loading Gowun Batang font');

  const face = new FontFace('Gowun Batang', `url(${staticFile(FONT_FILE)}) format("truetype")`);

  face
    .load()
    .then((loaded) => {
      document.fonts.add(loaded);
      continueRender(handle);
    })
    .catch((err) => {
      // 폰트가 없다고 렌더 전체를 죽이지는 않는다. 대체 폰트(Noto Serif KR/serif)로 진행.
      console.warn(`[juliaslog] 자막 폰트 로드 실패 (${FONT_FILE}) — 대체 폰트로 진행합니다.`, err);
      if (process.env.REMOTION_STRICT_FONTS === 'true') {
        cancelRender(err);
        return;
      }
      continueRender(handle);
    });
}
