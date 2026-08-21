#!/usr/bin/env node
/**
 * 브랜드 온보딩 확인 화면 (CP2).
 *
 * 추출된 brand.json이 "맞는지"는 코드가 판정할 수 없다. 강조색이 뒤바뀌거나
 * 표지 톤이 다른 것은 그 팀 사람만 안다. 그래서 플랫폼처럼 자동으로 확정하지
 * 않고, 브라우저 화면 하나로 보여주고 사람이 확인한다.
 *
 * 보여주는 것:
 *  - 폰트: 설치 여부를 브라우저가 직접 판정(document.fonts.check)하고,
 *    미설치면 어떤 글꼴로 대체되는지 그대로 드러낸다
 *  - 팔레트: 역할이 배정된 색 (primary / accent / 표 헤더)
 *  - 표지·간지·본문 골격: 이 브랜드로 만들면 나올 실제 모습의 축소판
 *  - needs_check: 추출기가 확신하지 못한 항목
 *
 * 사용법:
 *   node scripts/onboard-brand.mjs --brand green-test [--out onboard.html]
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyBrand } from '../components/brand.mjs';
import { T } from '../components/base.mjs';

const SELF_DIR = path.dirname(fileURLToPath(import.meta.url));

function parseArgs(argv) {
  const a = { brand: '', out: '' };
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i] === '--brand') a.brand = argv[++i];
    else if (argv[i] === '--out') a.out = argv[++i];
  }
  if (!a.brand) throw new Error('--brand <이름|경로>가 필요합니다.');
  return a;
}

function html(name, brand) {
  const C = T.color;
  const F = T.font;
  const cw = T.canvas.w;
  const ch = T.canvas.h;
  const scale = 460 / (cw * 96);                    // 미니 슬라이드 폭 460px
  const needs = brand.needs_check || [];
  const sizes = (brand.font?.sizes || []).slice(0, 6)
    .map((s) => `${s.pt}pt×${s.count}`).join(' · ');

  /* 본문 골격 미니어처: 밴드·룰·pill·표 헤더를 파생 좌표 그대로 그린다 */
  const mini = (inner) => `
    <div class="mini"><div class="page" style="width:${cw}in;height:${ch}in;transform:scale(${scale})">${inner}</div></div>`;

  const coverMini = mini(`
    <div style="position:absolute;inset:0;background:#${C.navy}"></div>
    <div style="position:absolute;left:0;right:0;bottom:0;height:.12in;background:#${C.cyan}"></div>
    <div style="position:absolute;left:.58in;top:.4in;width:${cw * 0.55}in;color:#fff;font-size:${F.coverYear}pt;font-weight:700;line-height:1.25">제안서 제목이 이 자리에</div>
    <div style="position:absolute;left:.58in;bottom:.5in;color:#ffffffcc;font-size:14pt;font-weight:700">회사·팀 이름</div>`);

  const dividerMini = mini(`
    <div style="position:absolute;inset:0;background:#${C.navy}"></div>
    <div style="position:absolute;left:0;right:0;bottom:0;height:.12in;background:#${C.cyan}"></div>
    <div style="position:absolute;left:.44in;top:.04in;font-size:150pt;color:#ffffff2e;font-weight:200;line-height:1">Ⅱ.</div>
    <div style="position:absolute;left:${cw * 0.5}in;top:.5in;width:${cw * 0.45}in;color:#fff;font-size:${F.sectionTitle}pt;font-weight:700">섹션 제목</div>
    <div style="position:absolute;left:${cw * 0.5}in;top:1.9in;color:#ffffffdd;font-size:19pt;line-height:1.9">1. 하위 항목<br>2. 하위 항목</div>`);

  const H = T.header;
  const G = T.grid;
  const bodyMini = mini(`
    <div style="position:absolute;inset:0;background:#fff"></div>
    <div style="position:absolute;left:0;right:0;top:0;height:${H.bandH}in;background:#${C.headerBandTo}"></div>
    <div style="position:absolute;left:${H.sectionLabel.x}in;top:${H.sectionLabel.y}in;color:#fff;font-size:15pt;font-weight:700">Ⅱ. 대분류</div>
    <div style="position:absolute;left:${H.pageBadge.x}in;top:${H.pageBadge.y}in;color:#fff;font-size:10pt;font-weight:700">07</div>
    <div style="position:absolute;left:${H.lead.x}in;top:${H.lead.y}in;font-size:14.5pt;font-weight:700"><span style="color:#${C.cyanLabel}">2-1. 소제목</span><span style="color:#${C.navyMid}"> ｜ </span><span style="color:#1a2233">이 장이 증명할 주장 한 문장</span></div>
    <div style="position:absolute;left:${H.rule.x}in;top:${H.rule.y}in;width:${H.rule.w}in;border-top:.5pt solid #${C.rule}"></div>
    <div style="position:absolute;left:${G.intro.x}in;top:${G.intro.y}in;width:${G.intro.w}in;font-size:${F.body}pt;color:#1a2233;line-height:1.35">리드 문단이 이 자리에 들어갑니다. 본문 ${F.body}pt 기준으로 서너 줄을 차지하며, 헤더 룰과 같은 폭으로 정렬됩니다.</div>
    <div style="position:absolute;left:${G.full.x}in;top:${G.pillTop}in;width:${G.full.w * 0.4}in;height:${T.pill.h}in;background:#${C.navy};border-radius:99px;color:#fff;font-size:12pt;font-weight:700;display:flex;align-items:center;justify-content:center">소제목 pill</div>
    <table style="position:absolute;left:${G.full.x}in;top:${G.pillTop + 0.5}in;width:${G.full.w}in;border-collapse:collapse;font-size:${F.dense}pt">
      <tr style="background:#${C.cyanTint};color:#${C.navy};font-weight:700;height:${G.table.headH}in"><td style="border:.5pt solid #D9D9D9;text-align:center">헤더</td><td style="border:.5pt solid #D9D9D9;text-align:center">헤더는 한 줄로 좁게</td><td style="border:.5pt solid #D9D9D9;text-align:center">헤더</td></tr>
      <tr style="height:${G.table.rowH}in"><td style="border:.5pt solid #D9D9D9;font-weight:600;background:#F7FBFE;padding:0 .08in">항목</td><td style="border:.5pt solid #D9D9D9;padding:0 .08in">본문 행은 이 높이</td><td style="border:.5pt solid #D9D9D9;padding:0 .08in">값</td></tr>
      <tr style="height:${G.table.rowH}in"><td style="border:.5pt solid #D9D9D9;font-weight:600;background:#F7FBFE;padding:0 .08in">항목</td><td style="border:.5pt solid #D9D9D9;padding:0 .08in">값</td><td style="border:.5pt solid #D9D9D9;padding:0 .08in">값</td></tr>
    </table>`);

  const sw = (hex, label) => `
    <div class="sw"><i style="background:#${hex}"></i><b>#${hex}</b><span>${label}</span></div>`;

  return `<!doctype html><meta charset="utf-8">
<title>브랜드 확인 — ${name}</title>
<style>
  * { box-sizing:border-box }
  body { margin:0; padding:24px 28px 40px; background:#eef1f6; color:#1a2233;
         font-family:'${F.family}',Pretendard,'Apple SD Gothic Neo',system-ui,sans-serif }
  h1 { font-size:17px; margin:0 0 4px } .sub { color:#6b7688; font-size:12.5px; margin:0 0 18px }
  h2 { font-size:13.5px; margin:22px 0 9px }
  .card { background:#fff; border:1px solid #dbe1ea; border-radius:11px; padding:14px 16px }
  .row { display:flex; gap:14px; flex-wrap:wrap }
  .fontline { font-size:19px; margin:2px 0 8px }
  .badge { display:inline-block; font-size:11px; font-weight:700; padding:2px 9px;
           border-radius:99px; margin-left:8px; vertical-align:2px }
  .ok { background:#dff3e6; color:#1c7a45 } .no { background:#fde9e9; color:#a33 }
  .hint { font-size:11.5px; color:#6b7688; line-height:1.55 }
  .sw { text-align:center; font-size:10.5px }
  .sw i { display:block; width:82px; height:44px; border-radius:6px; border:1px solid #0001 }
  .sw b { display:block; margin-top:4px } .sw span { color:#6b7688 }
  .mini { position:relative; overflow:hidden; border:1px solid #dbe1ea; border-radius:6px;
          width:462px; height:${Math.round(ch * 96 * scale) + 2}px; background:#fff }
  .page { position:absolute; top:0; left:0; transform-origin:top left; overflow:hidden;
          font-family:inherit }
  .cap { font-size:11.5px; color:#6b7688; margin-top:5px }
  .warn { background:#fff8e6; border:1px solid #f0dfa8; border-radius:9px; padding:10px 13px;
          font-size:12px; line-height:1.6; margin-top:10px }
  .ask { background:#0C2044; color:#fff; border-radius:11px; padding:14px 17px; margin-top:24px;
         font-size:13px; line-height:1.7 }
</style>

<h1>브랜드 확인 — ${name}</h1>
<p class="sub">레퍼런스 ${brand.slides}장에서 추출했습니다. 아래가 이 브랜드로 만들 때의 실제 모습입니다. 눈으로 확인해 주세요.</p>

<div class="card">
  <h2 style="margin-top:0">① 폰트 — ${F.family}</h2>
  <div class="fontline" id="fontline">가나다라마바사 ABC 123 — 제안서에 이 글꼴이 쓰입니다<span id="fontbadge"></span></div>
  <p class="hint">관측된 크기: ${sizes || '없음'}<br>
  <span id="fonthint"></span></p>
</div>

<h2>② 팔레트 — 역할이 이렇게 배정됐습니다</h2>
<div class="card"><div class="row">
  ${sw(C.navy, '주 색상 (헤더·pill·표지)')}
  ${sw(C.cyan, '강조 (accent)')}
  ${sw(C.cyanTint, '표 헤더 배경')}
  ${sw(C.rule, '헤더 구분선')}
</div>
<p class="hint" style="margin-top:10px">주 색상과 강조가 뒤바뀌어 보이면 알려주세요. 추출기가 가장 자주 틀리는 부분입니다.</p></div>

<h2>③ 표지 · 간지 · 본문 골격</h2>
<div class="row">
  <div><div class="cap">표지</div>${coverMini}</div>
  <div><div class="cap">간지 (섹션 구분)</div>${dividerMini}</div>
  <div><div class="cap">본문 (캔버스 ${cw} × ${ch}in)</div>${bodyMini}</div>
</div>

${needs.length ? `<div class="warn"><b>추출기가 확신하지 못한 항목 ${needs.length}개</b><br>${needs.map((n) => `· ${typeof n === 'string' ? n : JSON.stringify(n)}`).join('<br>')}</div>` : ''}

<div class="ask">
  이 모습이 맞으면 <b>"맞아, 이대로 가자"</b>라고 답해 주세요.<br>
  다르면 어느 항목이 다른지(폰트 / 색 역할 / 표지 톤 / 표 밀도) 알려주시면 고쳐서 다시 보여드립니다.
</div>

<script>
  (async () => {
    await document.fonts.ready;
    const fam = ${JSON.stringify(F.family)};
    const ok = document.fonts.check('16px "' + fam + '"');
    const b = document.getElementById('fontbadge');
    b.className = 'badge ' + (ok ? 'ok' : 'no');
    b.textContent = ok ? '설치됨' : '미설치';
    document.getElementById('fonthint').textContent = ok
      ? '이 컴퓨터에 설치되어 있어 위 문장이 실제 브랜드 글꼴로 보이고 있습니다.'
      : '이 컴퓨터에 없어서 지금 보이는 것은 대체 글꼴입니다. PowerPoint에서도 다른 글꼴로 대체되니, 최종 파일을 열 컴퓨터에 "' + fam + '"를 설치해 주세요.';
  })();
</script>`;
}

const args = parseArgs(process.argv.slice(2));
const { brand, name } = applyBrand(args.brand);
const out = path.resolve(args.out || path.join(SELF_DIR, '..', `onboard-${name}.html`));
fs.writeFileSync(out, html(name, brand), 'utf8');
console.log(out);
