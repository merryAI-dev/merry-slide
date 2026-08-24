#!/usr/bin/env node
/**
 * slide_plan.json을 한 장씩 넘기며 확정하는 구성 검토 화면으로 만든다.
 *
 * CP3(스토리와 장수) 체크포인트용이다. 와이어프레임이 아니라 실제 텍스트를
 * 넣어 디자인 토큰 그대로 렌더하므로, 사용자는 최종 슬라이드에 가까운 모습을
 * 보면서 형식과 문구와 순서를 확정한다.
 *
 * 확정 JSON을 Stage 4A 빌더에 넘기면 그대로 PPTX가 된다. 채팅으로
 * "3번은 2단, 7번은 표" 하고 주고받지 않으므로 왕복과 토큰이 줄고
 * 구성이 파일로 확정되어 모호함이 없다.
 *
 *   node scripts/preview-composition.mjs --plan slide_plan.json --out preview.html
 *
 * 형식별 content 구조는 references/composition-format.md 참고.
 * 사용자에게는 그림과 한글 이름만 보여주고 내부 키를 노출하지 않는다.
 */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { T } from '../components/mysc-proposal.mjs';
import { startRun, endRun } from './worklog.mjs';

const DEFAULT_OUT = 'slide-composition-preview.html';
const SELF_DIR = path.dirname(fileURLToPath(import.meta.url));

/** 장표 형식. MYSC 레퍼런스 덱 32장을 분류해서 나온 유형이다. */
const FORMATS = [
  { name: '표지', desc: '덱의 첫 장. 제목과 발행 주체' },
  { name: '목차', desc: '전체 장 구성을 한눈에' },
  { name: '간지', desc: '장이 바뀌는 구분 슬라이드' },
  { name: '좌우 2단', desc: '두 내용을 나란히 비교하거나 이어서' },
  { name: '표 중심', desc: '수치나 항목을 표로 정리' },
  { name: '전폭 도식', desc: '구조나 흐름을 한 폭으로 크게' },
  { name: '숫자 강조', desc: '핵심 수치 여러 개를 나열' },
  { name: '단계 흐름', desc: '순서나 과정을 단계로 표현' },
  { name: '차트', desc: '수치 추이나 비중을 그래프로' },
];

function usage() {
  console.log(`사용법:
  node preview-composition.mjs --plan slide_plan.json --out preview.html

옵션:
  --plan   slide_plan.json 경로. 기본값은 slide_plan.json입니다.
  --out    출력 HTML 경로. 기본값은 ${DEFAULT_OUT}입니다.
  --title  검토 화면 제목입니다.
  --lead-min  리드 문단 최소 글자수. 기본값 150.
  --lead-max  리드 문단 최대 글자수. 기본값 200.
  --images    이미지 폴더. 폴더 안 사진을 갤러리로 실어 슬라이드의 이미지 자리에
              골라 넣을 수 있게 합니다.
  --serve     검토 화면을 로컬 서버로 띄웁니다. 이때 'PPTX 생성'을 누르면 JSON을
              내려받는 대신 서버가 바로 PPTX까지 만들어 줍니다. 사람이 JSON을
              다시 옮길 필요가 없습니다.
  --port      --serve 포트. 기본값 18888. 흔히 쓰는 포트와 겹치지 않게 골랐습니다.
  --pptx      --serve에서 만들 PPTX 경로. 기본값은 HTML 옆의 deck.pptx입니다.

장표 형식: ${FORMATS.map((f) => f.name).join(', ')}
`);
}

function parseArgs(argv) {
  const args = { plan: 'slide_plan.json', out: DEFAULT_OUT, title: '', leadMin: 150, leadMax: 200,
                 images: '', serve: false, port: 18888, pptx: '', lan: false };
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i];
    const value = argv[i + 1];
    if (key === '--help' || key === '-h') {
      args.help = true;
    } else if (key === '--plan') {
      args.plan = value || args.plan; i += 1;
    } else if (key === '--out') {
      args.out = value || args.out; i += 1;
    } else if (key === '--title') {
      args.title = value || args.title; i += 1;
    } else if (key === '--lead-min') {
      args.leadMin = Number.parseInt(value, 10); i += 1;
    } else if (key === '--lead-max') {
      args.leadMax = Number.parseInt(value, 10); i += 1;
    } else if (key === '--images') {
      args.images = value || ''; i += 1;
    } else if (key === '--brand') {
      args.brand = value || ''; i += 1;
    } else if (key === '--lan') {
      args.lan = true;
    } else if (key === '--serve') {
      args.serve = true;
    } else if (key === '--port') {
      args.port = Number.parseInt(value, 10); i += 1;
    } else if (key === '--pptx') {
      args.pptx = value || ''; i += 1;
    } else {
      throw new Error(`알 수 없는 인자입니다: ${key}`);
    }
  }
  return args;
}

const IMG_MIME = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp' };

/**
 * 이미지 폴더를 읽어 갤러리에 실을 목록을 만든다.
 *
 * inline이면 사진을 base64로 HTML에 박아 넣는다. 파일 하나로 끝나는 대신
 * 사진이 수백 장이면 HTML이 수십~수백 MB가 되어 브라우저가 멈춘다.
 * --serve로 띄울 때는 inline을 끄고 서버가 /img/<i>로 원본을 내준다.
 */
function loadGallery(dir, inline = true) {
  if (!dir) return [];
  if (!fs.existsSync(dir) || !fs.statSync(dir).isDirectory()) {
    throw new Error(`이미지 폴더를 찾을 수 없습니다: ${dir}`);
  }
  const skipped = [];
  const items = fs.readdirSync(dir)
    // 숨김 파일과 맥의 ._ 리소스 파일은 사진이 아니다.
    .filter((n) => !n.startsWith('.') && IMG_MIME[path.extname(n).toLowerCase()])
    .sort()
    .map((n, i) => {
      const file = path.resolve(dir, n);
      // 권한이 막힌 파일이 폴더에 섞여 있을 수 있다. 그 한 장 때문에 전체가 멈추면 안 된다.
      try {
        const kb = Math.round(fs.statSync(file).size / 1024);
        if (!inline) return { name: n, kb, file, data: `/img/${i}` };
        const buf = fs.readFileSync(file);
        return {
          name: n,
          kb,
          file,
          data: `data:${IMG_MIME[path.extname(n).toLowerCase()]};base64,${buf.toString('base64')}`,
        };
      } catch (err) {
        skipped.push(`${n} (${err.code || err.message})`);
        return null;
      }
    })
    .filter(Boolean);

  if (skipped.length) {
    console.error(`읽지 못해 건너뛴 사진 ${skipped.length}장: ` +
                  skipped.slice(0, 3).join(', ') + (skipped.length > 3 ? ' 외' : ''));
  }
  return items;
}

function buildHtml(plan, args, gallery) {
  const slides = plan.slides || [];
  const deckTitle = args.title || plan.title || '슬라이드 구성 검토';

  return `<!doctype html>
<meta charset="utf-8">
<title>${String(deckTitle).replace(/[<&]/g, '')}</title>
<style>
  :root { --navy:#${T.color.navy}; --navy-deep:#${T.color.navyDeep}; --navy-mid:#${T.color.navyMid}; --cyan:#${T.color.cyan};
          --cyan-label:#${T.color.cyanLabel}; --tint:#${T.color.cyanTint}; --tint-strong:#${T.color.cyanTintStrong}; --rule:#${T.color.rule};
          --line:#dbe1ea; --ink:#1a2233; --mute:#6b7688; }
  * { box-sizing:border-box; }
  body { margin:0; padding:20px 24px 28px; background:#eef1f6; color:var(--ink);
         font-family:Pretendard,"Apple SD Gothic Neo",system-ui,sans-serif; }
  h1 { font-size:16px; margin:0 0 3px; }
  .sub { color:var(--mute); font-size:12.5px; margin:0 0 12px; }
  .prog { display:flex; align-items:center; gap:12px; margin-bottom:12px; }
  .prog .bar { flex:1; height:5px; background:#dde3ec; border-radius:99px; overflow:hidden; }
  .prog .bar i { display:block; height:100%; background:var(--cyan); transition:width .18s; }
  .prog .pos { font-size:13px; font-weight:700; white-space:nowrap; }

  .main { display:grid; grid-template-columns:1fr 268px; gap:16px; align-items:start; }
  .panel { background:#fff; border:1px solid var(--line); border-radius:11px; padding:14px; }
  .stage { position:relative; background:#fff; border:1px solid var(--line); border-radius:11px;
           padding:12px; overflow:hidden; }
  .holder { position:relative; width:100%; overflow:hidden; }
  .stagenav { position:absolute; top:50%; transform:translateY(-50%); z-index:5;
              width:46px; height:46px; border-radius:99px; border:1px solid var(--line);
              background:#ffffffea; backdrop-filter:blur(2px); font-size:24px; line-height:1;
              color:var(--navy); cursor:pointer; box-shadow:0 2px 10px #0002; padding:0;
              display:flex; align-items:center; justify-content:center; }
  .stagenav:hover:not(:disabled) { background:var(--navy); color:#fff; border-color:var(--navy); }
  .stagenav:disabled { opacity:.25; cursor:default; }
  .stagenav.left { left:20px; }
  .stagenav.right { right:20px; }

  /* ── 실제 슬라이드: A4 가로 11.693 x 8.267in, 96dpi 기준. pt/in 단위 그대로 사용 ── */
  .slide { position:absolute; top:0; left:0; width:${T.canvas.w}in; height:${T.canvas.h}in; background:#fff;
           transform-origin:top left; font-family:Pretendard,"Apple SD Gothic Neo",sans-serif;
           overflow:hidden; box-shadow:0 1px 4px #0002; }
  .slide .band { position:absolute; inset:0 0 auto 0; height:.794in;
                 background:linear-gradient(90deg,#${T.color.headerBandFrom},#${T.color.headerBandTo}); }
  .slide .sec  { position:absolute; left:.657in; top:.42in; width:2.2in; height:.328in;
                 color:#fff; font-size:15pt; font-weight:700; display:flex; align-items:center; }
  .slide .subl { position:absolute; left:2.928in; top:.456in; width:5.431in; height:.336in;
                 color:#fff; font-size:14.5pt; font-weight:700; display:flex; align-items:center; }
  .slide .badge{ position:absolute; left:9.9in; top:.505in; width:1.18in; height:.26in;
                 color:#fff; font-size:10pt; font-weight:700;
                 display:flex; align-items:center; justify-content:flex-end; }
  .slide .lead { position:absolute; left:.55in; top:.9in; width:10.45in; height:.42in;
                 font-size:14.5pt; font-weight:700; display:flex; align-items:center; }
  .slide .lead .lb { color:var(--cyan-label); white-space:nowrap; }
  .slide .lead .sp { color:var(--navy-mid); margin:0 .07in; }
  .slide .lead .cl { color:var(--navy); }
  .slide .rule { position:absolute; left:.649in; top:1.343in; width:10.37in;
                 border-top:.5pt solid var(--rule); }

  .slide .pill { position:absolute; height:.283in; background:var(--navy); border-radius:.1415in;
                 color:#fff; font-size:12pt; display:flex; align-items:center;
                 justify-content:center; padding:0 .12in; }
  .slide ul { margin:0; padding:0; list-style:none; }
  .slide li { font-size:12pt; line-height:1.5; color:#1a2233; margin-bottom:.11in;
              padding-left:.19in; position:relative; }
  .slide li::before { content:''; position:absolute; left:0; top:.085in;
                      border-left:.11in solid var(--navy-mid);
                      border-top:.047in solid transparent; border-bottom:.047in solid transparent; }

  .slide table { border-collapse:collapse; font-size:9.7pt; width:100%; table-layout:fixed; }
  .slide th, .slide td { border:.5pt solid #D9D9D9; padding:.055in .08in; }
  /* 헤더는 라벨 띠다. 한 줄 높이로 고정하고 여백을 최소화한다.
     레퍼런스 실측 헤더 행 중앙값 0.275in. 남는 세로 공간은 본문 행이 흡수한다. */
  .slide thead th { background:var(--tint); color:var(--navy); font-weight:700; text-align:center;
                    height:${T.grid.table.headH}in; padding:.03in .08in; line-height:1.25; }
  .slide tbody td:first-child { font-weight:600; background:#f7fbfe; }

  /* 본문 리드 문단: 레퍼런스 21개 본문 슬라이드 전부에 있는 y=1.503 / 12pt / 10.336in 문단 */
  .slide .intro { position:absolute; left:${T.grid.intro.x}in; top:${T.grid.intro.y}in; width:${T.grid.intro.w}in; height:${T.grid.intro.h}in;
                  font-size:12pt; line-height:1.35; color:#1a2233; overflow:hidden; }
  .slide .note { position:absolute; left:.649in; width:10.37in; font-size:10pt; color:#5b6678;
                 line-height:1.55; }
  .slide .fig { position:absolute; border:1pt dashed #9fb4cc; border-radius:.06in;
                background:repeating-linear-gradient(135deg,#f4f8fc 0 9px,#eaf1f8 9px 18px);
                display:flex; flex-direction:column; align-items:center; justify-content:center;
                gap:.06in; color:#5b7a99; text-align:center; padding:.1in; }
  .slide .fig b { font-size:10.5pt; }
  .slide .fig span { font-size:9.5pt; color:#7b8ea3; }
  .slide .fig, .slide .figimg { cursor:pointer; }
  .slide .fig em, .slide .figimg em { font-style:normal; font-size:8.5pt; color:#8aa0b8;
                                      margin-top:.04in; }
  .slide .fig:hover { border-color:var(--cyan); background:#eaf6fd; }
  .slide .figimg { position:absolute; border-radius:.06in; overflow:hidden;
                   display:flex; align-items:center; justify-content:center; background:#f4f8fc; }
  /* 빌더와 같은 방식. 자리 크기에 맞춰 늘리고 줄인다. 잘라내지 않는다. */
  .slide .figimg img { width:100%; height:100%; object-fit:fill; }
  .slide .figimg em { position:absolute; right:.06in; bottom:.05in; background:#ffffffd0;
                      padding:1px 6px; border-radius:99px; }
  .slide .flow { position:absolute; display:flex; align-items:stretch; gap:.16in; }
  .slide .fbox { flex:1; border:1pt solid #cfd8e5; border-radius:.06in; padding:.13in;
                 display:flex; flex-direction:column; gap:.07in; background:#fbfdff;
 }
  .slide .fbox b { font-size:10.5pt; color:var(--navy); }
  .slide .fbox p { margin:0; font-size:11pt; line-height:1.45; white-space:pre-line; color:#28313f; }
  .slide .farrow { align-self:center; color:var(--cyan); font-size:18pt; font-weight:700; }
  .slide .step { flex:1; background:var(--cyan); color:var(--navy); font-size:10.5pt;
                 font-weight:700; line-height:1.4; white-space:pre-line; padding:.13in .1in;
                 display:flex; align-items:center; justify-content:center; text-align:center;
                 clip-path:polygon(0 0, calc(100% - .13in) 0, 100% 50%, calc(100% - .13in) 100%, 0 100%); }
  .slide .chart { position:absolute; display:flex; align-items:flex-end; gap:.18in;
                  border-bottom:.5pt solid #c3ccd9; padding:0 .1in .02in; }
  .slide .chart .bar { flex:1; height:100%; display:flex; flex-direction:column;
                       align-items:center; justify-content:flex-end; }
  .slide .chart .bar i { display:block; width:70%; background:var(--navy); border-radius:2px 2px 0 0; }
  .slide .chart .bar b { font-size:9.5pt; color:var(--navy); margin-top:.03in; }
  .slide .chart .bar span { font-size:9.5pt; color:#5b6678; }
  .slide .chart em { font-style:normal; font-size:11pt; color:#a33; margin:auto; }
  .slide .gantt { position:absolute; display:flex; flex-direction:column; justify-content:space-evenly;
                  border-top:.5pt solid #c3ccd9; padding-top:.05in; }
  .slide .gtrack { display:grid; grid-template-columns:2in 1fr; align-items:center; gap:.1in; }
  .slide .glabel { font-size:10.5pt; color:#1a2233; text-align:right; }
  .slide .gbar-bg { position:relative; height:.28in; }
  .slide .gbar { position:absolute; top:0; height:100%; background:var(--navy); border-radius:2px; }
  .slide .gantt em { font-style:normal; font-size:11pt; color:#a33; }
  .slide .stat { position:absolute; }
  .slide .stat .sl { font-size:10.8pt; color:#000; margin-bottom:.05in; }
  .slide .sv { font-size:30.2pt; font-weight:700; color:#000; line-height:1; }
  .slide .su { font-size:10.8pt; font-weight:400; }
  .slide .sn { font-size:8.6pt; color:#5b6678; display:block; margin-top:.05in; }

  .slide.cover { background:var(--navy); }
  .slide.cover .cbg { position:absolute; inset:0;
      background:${T.cover && T.cover.image === false
        ? `#${T.cover.base}; border-bottom:.12in solid #${T.cover.accent}`
        : 'linear-gradient(160deg,#071426 0%,#0d2f5e 30%,#1e7fa8 62%,#bfe6ef 88%,#eaf6f8 100%)'}; }
  .slide.cover h2 { position:absolute; left:.578in; top:.5in; width:7in; margin:0;
                    font-size:34pt; font-weight:700; color:#fff; line-height:1.28; }
  .slide.cover .csub { position:absolute; left:7.3in; top:.55in; width:3.8in; color:#fff;
                       font-size:13pt; line-height:1.6; text-align:right; white-space:pre-line; }
  .slide.cover .cent { position:absolute; left:.578in; top:7.245in; font-size:14pt;
                       font-weight:700; color:var(--navy); }
  .slide.cover .clogo{ position:absolute; left:9.1in; top:7.1in; width:2.1in; height:.58in;
                       background:#fff9; border-radius:.05in; display:flex; align-items:center;
                       justify-content:center; font-size:13pt; font-weight:800; color:var(--navy);
                       letter-spacing:.02in; }
  .slide.divider { background:${T.cover && T.cover.image === false
        ? `#${T.cover.base}; border-bottom:.12in solid #${T.cover.accent}`
        : 'linear-gradient(160deg,#071426,#0d2f5e 55%,#1a6f96)'}; }
  .slide.divider .num { position:absolute; left:.6in; top:.2in; font-size:150pt; color:#ffffff2e;
                        font-weight:200; line-height:1; }
  .slide.divider h2 { position:absolute; left:5.8in; top:.9in; width:5.4in; margin:0;
                      font-size:40pt; font-weight:700; color:#fff; line-height:1.25; }
  .slide.divider ol { position:absolute; left:5.85in; top:2.6in; margin:0; padding-left:.25in;
                      color:#ffffffdd; font-size:16pt; line-height:2; }
  .slide.toc h2 { position:absolute; left:3.2in; top:.8in; margin:0; font-size:32pt;
                  font-weight:700; color:var(--navy); }
  .slide.toc ol { position:absolute; left:3.2in; top:1.9in; width:6in; margin:0; padding:0;
                  list-style:none; counter-reset:t; }
  .slide.toc li { counter-increment:t; font-size:16pt; font-weight:600; color:var(--navy-deep);
                  padding:.16in 0 .16in .75in; border-bottom:.5pt solid #dbe4ee; position:relative; }
  .slide.toc li::before { content:counter(t); position:absolute; left:.1in; top:.16in;
                          color:var(--cyan); font-size:18pt; font-weight:700; border:none; }

  label { display:block; font-size:11.5px; color:var(--mute); margin:12px 0 5px; font-weight:600; }
  .title-in { width:100%; font:inherit; font-size:13.5px; font-weight:600; line-height:1.45;
              border:1px solid var(--line); border-radius:7px; padding:8px 9px; resize:vertical;
              min-height:48px; color:var(--ink); }
  .title-in:focus { outline:none; border-color:var(--cyan); box-shadow:0 0 0 3px #59c2e233; }

  .cnt { font-weight:400; font-size:10.5px; padding:1px 6px; border-radius:99px;
         background:#e9eef5; color:var(--mute); }
  .cnt.ok { background:#dff3e6; color:#1c7a45; }
  .cnt.no { background:#fde9e9; color:#a33; }
  .gallery { display:grid; grid-template-columns:repeat(auto-fill,minmax(132px,1fr)); gap:9px;
             max-height:58vh; overflow-y:auto; padding:2px; }
  .gcard { border:1.5px solid var(--line); border-radius:8px; padding:6px; background:#fff;
           cursor:pointer; text-align:center; }
  .gcard:hover { border-color:var(--cyan); background:#f3fbff; }
  .gcard img { width:100%; height:88px; object-fit:contain; background:#f4f7fb;
               border-radius:4px; display:block; }
  .gcard b { display:block; font-size:10.5px; font-weight:600; margin-top:5px;
             overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
  .gcard span { display:block; font-size:9.5px; color:var(--mute); }
  .hintbox { font-size:11.5px; color:var(--mute); background:#f7f9fc; border:1px solid var(--line);
             border-radius:7px; padding:8px 9px; line-height:1.5; }
  .cands { display:flex; flex-direction:column; gap:5px; margin-bottom:6px; }
  .cand { text-align:left; font-size:11.5px; line-height:1.5; padding:7px 9px;
          border:1.5px solid var(--line); border-radius:7px; background:#fff; cursor:pointer;
          color:#33404f; }
  .cand:hover { border-color:#b9c4d4; }
  .cand.on { border-color:var(--cyan); background:#f2fbff; }
  .cand i { display:block; font-style:normal; font-size:10px; color:var(--mute); margin-top:3px; }
  .lead-in { font-weight:400; font-size:12px; min-height:62px; }
  .picker { display:grid; grid-template-columns:1fr 1fr; gap:8px; }
  .opt .mini { display:block; position:relative; width:100%; overflow:hidden;
               border:1px solid #e3e8f0; border-radius:4px; background:#fff; margin-bottom:5px; }
  .opt .mini .slide { position:absolute; top:0; left:0; transform-origin:top left;
                      box-shadow:none; pointer-events:none; }
  .opt .d { display:block; font-size:10px; color:var(--mute); line-height:1.35; margin-top:1px; }
  .opt { border:1.5px solid var(--line); border-radius:8px; padding:7px 6px; cursor:pointer;
         background:#fff; text-align:center; }
  .opt:hover { border-color:#b9c4d4; }
  .opt.on { border-color:var(--cyan); background:#f2fbff; box-shadow:0 0 0 3px #59c2e233; }
  .opt b { display:block; font-size:11.5px; font-weight:600; }

  select { font:inherit; font-size:12.5px; border:1px solid var(--line); border-radius:7px;
           padding:7px 9px; background:#fff; color:var(--ink); cursor:pointer; }
  button { font:inherit; font-size:12.5px; border:1px solid var(--line); background:#fff;
           border-radius:7px; padding:8px 13px; cursor:pointer; color:var(--ink); }
  button:hover:not(:disabled) { background:#eef2f8; }
  button:disabled { opacity:.4; cursor:default; }
  button.primary { background:var(--navy); color:#fff; border-color:var(--navy); font-weight:600; }
  button.primary:hover:not(:disabled) { background:#16305f; }
  button.danger:hover { background:#ffecec; border-color:#f0b8b8; }
  .nav { display:flex; gap:7px; align-items:center; margin-top:12px; flex-wrap:wrap; }
  .nav .spacer { flex:1; }

  .offline { display:none; position:fixed; left:0; right:0; top:0; z-index:99;
             background:#a33; color:#fff; font-size:13px; font-weight:600;
             padding:9px 16px; text-align:center; }
  .offline.on { display:block; }
  .striphead { font-size:12px; font-weight:700; color:var(--ink); margin:16px 0 8px; }
  .strip { display:flex; gap:5px; flex-wrap:wrap; padding-top:10px;
           border-top:1px solid var(--line); }
  .chip { font-size:11px; padding:4px 9px; border-radius:99px; border:1px solid var(--line);
          background:#fff; cursor:pointer; color:var(--mute); }
  .chip.on { background:var(--navy); border-color:var(--navy); color:#fff; font-weight:700; }
  .chip.done { border-color:var(--cyan); background:#f2fbff; color:#1c5a75; }
  .chip.done.on { background:var(--navy); border-color:var(--navy); color:#fff; }
  .strip .empty { font-size:11.5px; color:var(--mute); }

  dialog { border:1px solid var(--line); border-radius:12px; padding:18px; max-width:min(720px,92vw); }
  dialog textarea { width:100%; height:42vh; font-family:ui-monospace,monospace; font-size:11.5px;
                    border:1px solid var(--line); border-radius:8px; padding:10px; }
  .hint { font-size:12px; color:var(--mute); margin:0 0 10px; }
</style>

<div class="offline" id="offline">미리보기 서버가 꺼졌습니다. 지금 화면에서 계속 고칠 수는 있지만 PPTX 생성은 안 됩니다. 터미널에서 다시 띄워 주세요.</div>
<h1>${String(deckTitle).replace(/[<&]/g, '')}</h1>
<p class="sub">실제 문구를 넣은 미리보기입니다. 장을 넘기며 <b>이 장 확정</b>을 누르면 누른 순서대로 쌓이고, 다 고른 뒤 <b>PPTX 생성</b>을 누르면 그 순서로 만들어집니다. ← → 키로 이동합니다.</p>

<div class="prog">
  <span class="pos" id="pos"></span>
  <span class="bar"><i id="fill"></i></span>
</div>

<div class="main">
  <div class="stage">
    <button class="stagenav left" id="stagePrev" title="이전 (←)" aria-label="이전 슬라이드">‹</button>
    <div class="holder" id="holder"><div class="slide" id="slide"></div></div>
    <button class="stagenav right" id="stageNext" title="다음 (→)" aria-label="다음 슬라이드">›</button>
  </div>

  <div class="panel">
    <label style="margin-top:0">장표 형식</label>
    <div class="picker" id="picker"></div>
    <label>제목 <span class="cnt" id="tcnt"></span></label>
    <textarea class="title-in" id="title"></textarea>
    <div id="leadwrap">
      <label>리드 문단 <span class="cnt" id="icnt"></span></label>
      <div class="cands" id="cands"></div>
      <textarea class="title-in lead-in" id="intro"></textarea>
    </div>
    <div class="nav">
      <button id="undo" title="되돌리기 (Ctrl+Z)">↶ 되돌리기</button>
      <button id="redo" title="다시 실행 (Ctrl+Shift+Z)">↷ 다시실행</button>
      <select id="move"></select>
    </div>
    <div id="figwrap" style="display:none">
      <label>이미지 <span class="cnt" id="figcnt"></span></label>
      <div class="hintbox" id="fighint"></div>
      <div class="nav"><button id="figclear">이미지 지우기</button></div>
    </div>
    <div class="nav">
      <button id="add">+ 장 추가</button>
      <button id="dup">복제</button>
      <button class="danger" id="del">삭제</button>
    </div>
    <div class="nav">
      <button class="primary" id="confirm" style="width:100%">이 장 확정</button>
    </div>
    <div class="nav">
      <button id="build" style="width:100%">PPTX 생성 <span id="bcnt"></span></button>
    </div>
  </div>
</div>

<div class="striphead">확정한 슬라이드 <span id="stripCount"></span></div>
<div class="strip" id="strip"></div>

<div class="striphead">전체 슬라이드 <span id="allCount"></span></div>
<div class="strip" id="allstrip"></div>

<dialog id="gal">
  <p class="hint" id="galhint"></p>
  <div class="gallery" id="gallist"></div>
  <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:12px">
    <button id="galclear">이 자리 비우기</button>
    <button class="primary" id="galclose">닫기</button>
  </div>
</dialog>

<dialog id="out">
  <p class="hint" id="outhint">확정된 구성을 <code>slide_plan.confirmed.json</code>으로 저장했습니다. 저장이 안 되면 복사해서 전달하세요.</p>
  <textarea id="json" readonly></textarea>
  <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:10px">
    <button id="copy">복사</button>
    <button class="primary" id="close">닫기</button>
  </div>
</dialog>

<script>
const FORMATS = ${JSON.stringify(FORMATS)};
const GALLERY = ${JSON.stringify(gallery)};
/* 형식 미리보기 캐시. 내용이 그대로면 8종을 다시 그리지 않는다. */
const miniCache = { sig: null, html: '' };
/* 배치 격자는 components/mysc-proposal.mjs의 토큰에서 온다. 빌더와 같은 값이다. */
const G = ${JSON.stringify(T.grid)};
let slides = ${JSON.stringify(slides)};
let cur = 0;
/* 장마다 고정 번호를 붙인다. 순서를 바꾸거나 지워도 확정 목록이 따라간다. */
let nextId = 1;
slides.forEach(s => { s._id = nextId; nextId += 1; });
/* 확정한 장을 누른 순서대로 쌓는다. PPTX는 이 순서 그대로 만든다. */
let confirmed = [];

/* ── 되돌리기 ──────────────────────────────────────────────
   실수로 지우거나 형식을 잘못 고른 걸 복구할 수 있어야 한다.
   상태를 바꾸기 직전에 스냅샷을 쌓고 Ctrl+Z로 되돌린다. */
const undoStack = [];
const redoStack = [];
const MAX_UNDO = 50;

function snapshot(label) {
  undoStack.push({ slides: JSON.stringify(slides), cur, confirmed: [...confirmed], label });
  if (undoStack.length > MAX_UNDO) undoStack.shift();
  redoStack.length = 0;
  updateUndoUI();
}

function applySnap(snap) {
  slides = JSON.parse(snap.slides);
  confirmed = [...snap.confirmed];
  cur = Math.min(snap.cur, slides.length - 1);
  render();
}

function undo() {
  if (!undoStack.length) return;
  redoStack.push({ slides: JSON.stringify(slides), cur, confirmed: [...confirmed], label: '되돌리기 취소' });
  applySnap(undoStack.pop());
}

function redo() {
  if (!redoStack.length) return;
  undoStack.push({ slides: JSON.stringify(slides), cur, confirmed: [...confirmed], label: '다시 실행' });
  applySnap(redoStack.pop());
}

function updateUndoUI() {
  const u = document.getElementById('undo');
  const r = document.getElementById('redo');
  if (u) u.disabled = !undoStack.length;
  if (r) r.disabled = !redoStack.length;
}

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"]/g, c =>
  ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const lines = s => esc(s).replace(/\\n/g, '<br>');

/* 본문형 공통 크롬: 헤더 밴드 + 대분류/소분류/쪽수 + 리드문 + 구분선 */
function chrome(s, i) {
  const c = s.content || {};
  const sec = c.section || '';
  const lead = c.label
    ? '<span class="lb">' + esc(c.label) + '</span><span class="sp">｜</span><span class="cl">' + esc(s.title || '') + '</span>'
    : '<span class="cl">' + esc(s.title || '') + '</span>';
  return '<i class="band"></i>' +
    '<div class="sec">' + esc(sec) + '</div>' +
    '<div class="badge">' + String(i + 1).padStart(2, '0') + ' 쪽</div>' +
    '<div class="lead">' + lead + '</div>' +
    '<i class="rule"></i>';
}


/* ── 형식 변환 ────────────────────────────────────────────────
   형식을 바꾸면 내용도 그 형식에 맞게 옮겨야 한다. 라벨만 바꾸면
   화면도 비고 빌드 결과도 빈 슬라이드가 된다.

   원래 내용은 지우지 않고 남겨둔다. 되돌아오면 그대로 복구된다. */

/** 어떤 형식이든 공통으로 뽑을 수 있는 항목 목록으로 정규화한다. */
function extractItems(c) {
  const out = [];
  const push = (label, detail, extra) => {
    if (label == null || String(label).trim() === '') return;
    out.push({ label: String(label), detail: detail ? String(detail) : '', ...(extra || {}) });
  };

  if (c.stats && c.stats.length) {
    c.stats.forEach(s => push(s.label, s.note, { value: s.value, unit: s.unit, note: s.note }));
  } else if (c.table && (c.table.rows || []).length) {
    c.table.rows.forEach(r => push(r[0], r.slice(1).filter(Boolean).join(' · ')));
  } else if (c.flow && c.flow.length) {
    c.flow.forEach(f => push(f.head, (f.body || '').replace(/\\n/g, ' ')));
  } else if (c.steps && c.steps.length) {
    c.steps.forEach(s => push(String(s).replace(/\\n/g, ' ')));
  } else if (c.left || c.right) {
    [c.left, c.right].filter(Boolean).forEach(side => (side.body || []).forEach(b => push(b)));
  } else if (c.items && c.items.length) {
    c.items.forEach(i => push(i));
  }
  return out;
}

/** 숫자로 시작하는 항목에서 수치와 단위를 떼어낸다. */
function splitValue(text) {
  const m = String(text).match(/(\\d[\\d,.]*)\\s*([가-힣%A-Za-z]{0,4})/);
  return m ? { value: m[1], unit: m[2] || '' } : null;
}

/**
 * 목표 형식에 필요한 필드가 없으면 기존 내용에서 만들어 채운다.
 * 이미 있으면 손대지 않는다.
 */
function adaptContent(c, target) {
  const items = extractItems(c);
  const heading = (c.pill || (c.left && c.left.pill) || '항목');

  if (target === '좌우 2단' && !c.left && !c.right) {
    const half = Math.ceil(items.length / 2) || 1;
    c.left = { pill: heading, body: items.slice(0, half).map(i => i.label) };
    c.right = { pill: '이어서', body: items.slice(half).map(i => i.label) };
  }

  if (target === '표 중심' && !(c.table && (c.table.rows || []).length)) {
    c.table = {
      headers: ['구분', '내용'],
      rows: (items.length ? items : [{ label: '내용', detail: '' }])
        .map(i => [i.label, i.detail || (i.value ? i.value + (i.unit || '') : '')]),
    };
    if (!c.pill) c.pill = heading;
  }

  if (target === '전폭 도식' && !(c.flow && c.flow.length)) {
    const src = items.length ? items.slice(0, 4) : [{ label: '내용', detail: '' }];
    c.flow = src.map(i => ({ head: i.label, body: i.detail || '' }));
    if (!c.pill) c.pill = heading;
  }

  if (target === '단계 흐름' && !(c.steps && c.steps.length)) {
    const src = items.length ? items.slice(0, 5) : [{ label: '내용' }];
    c.steps = src.map(i => i.label);
    if (!c.pill) c.pill = heading;
  }

  if (target === '숫자 강조' && !(c.stats && c.stats.length)) {
    const src = items.length ? items.slice(0, 3) : [{ label: '지표' }];
    c.stats = src.map(i => {
      const v = i.value ? { value: i.value, unit: i.unit || '' }
                        : (splitValue(i.detail || i.label) || { value: '—', unit: '' });
      return { label: i.label, value: v.value, unit: v.unit, note: i.note || '' };
    });
    if (!c.pill) c.pill = heading;
  }

  if (target === '차트' && !(c.chart && (c.chart.series || []).length)) {
    const src = items.length ? items.slice(0, 6) : [{ label: '항목' }];
    c.chart = {
      type: 'bar',
      categories: src.map(i => i.label),
      series: [{
        name: c.pill || '값',
        values: src.map(i => {
          const v = i.value || (splitValue(i.detail || i.label) || {}).value || '0';
          return Number(String(v).replace(/,/g, '')) || 0;
        }),
      }],
    };
    if (!c.pill) c.pill = heading;
  }

  if ((target === '목차' || target === '간지') && !(c.items && c.items.length)) {
    c.items = (items.length ? items : [{ label: '내용' }]).slice(0, 5).map(i => i.label);
  }

  if (target === '표지' && !c.subtitle) {
    c.subtitle = c.intro || '';
  }
  return c;
}

/* pill 텍스트가 없으면 그리지 않는다. 빌더의 pill() 가드와 동일한 규칙. */
const pillDiv = (text, style) => String(text ?? '').trim()
  ? '<div class="pill" style="' + style + '">' + esc(text) + '</div>' : '';

const bullets = arr => '<ul>' + (arr || []).map(t => '<li>' + lines(t) + '</li>').join('') + '</ul>';

/**
 * 내용이 쓸 높이와 남는 하단 공간을 나눈다.
 * 남는 곳은 이미지 띠가 된다. 슬라이드 아래를 비워두지 않는 것이 이 톤의 기본이다.
 */
function splitBody(CT, naturalH, hasNote) {
  const avail = G.bottom - (hasNote ? G.noteH : 0) - CT;
  const h = Math.max(0.6, Math.min(naturalH, avail));
  const rest = avail - h - G.figGap;
  return { h, figY: CT + h + G.figGap, figH: rest > G.figMin ? rest : 0 };
}

/** 선언된 이미지 자리가 없어도 남는 공간은 이미지 자리로 연다. */
const orSlot = fig => fig || { caption: '이미지 자리', hint: '클릭해서 사진을 넣으세요' };

/**
 * 하단 이미지 띠를 위 도형 개수만큼 나눈다.
 * 위가 4칸이면 아래도 4칸, x좌표와 폭을 그대로 맞춘다. 격자가 어긋나지 않게 하는 규칙이다.
 */
function figureRow(c, cols, y, h) {
  if (!h) return '';
  const arr = c.figures || (c.figure ? [c.figure] : []);
  return cols.map((col, i) =>
    figure(orSlot(arr[i]), 'left:' + col.x + 'in;top:' + y + 'in;width:' + col.w +
      'in;height:' + h + 'in', 'fig' + i)).join('');
}

/** n등분 좌표. 전체 폭 안에서 gap을 둔다. */
function evenCols(x0, total, n, gap) {
  const each = (total - gap * (n - 1)) / n;
  return Array.from({ length: n }, (_, i) => ({ x: +(x0 + i * (each + gap)).toFixed(3), w: +each.toFixed(3) }));
}

/* 이미지가 들어갈 자리. 빈 공간을 남기지 않고 무엇이 올지 명시한다. */
const figure = (fig, style, key) => !fig ? '' :
  (fig.data
    ? '<div class="figimg" style="' + style + '" data-fig="' + key + '">' +
        '<img src="' + fig.data + '" alt="">' +
        '<em>바꾸기</em></div>'
    : '<div class="fig" style="' + style + '" data-fig="' + key + '">' +
        '<b>' + esc(fig.caption || '이미지') + '</b>' +
        (fig.hint ? '<span>' + esc(fig.hint) + '</span>' : '') +
        '<em>클릭해서 이미지 넣기</em></div>');

function renderSlide(s, i) {
  const c = s.content || {};
  const f = s.layout;

  if (f === '표지') {
    return '<i class="cbg"></i>' +
      '<h2>' + lines(s.title) + '</h2>' +
      '<div class="csub">' + lines(c.subtitle) + '</div>' +
      '<div class="cent">' + esc(c.entity || '') + '</div>' +
      '<div class="clogo">MYSC</div>';
  }
  if (f === '목차') {
    return '<h2>' + esc(s.title || '목차') + '</h2>' +
      '<ol>' + (c.items || []).map(t => '<li>' + esc(t) + '</li>').join('') + '</ol>';
  }
  if (f === '간지') {
    return '<div class="num">' + esc(c.numeral || '') + '</div>' +
      '<h2>' + lines(s.title) + '</h2>' +
      '<ol>' + (c.items || []).map(t => '<li>' + esc(t) + '</li>').join('') + '</ol>';
  }

  /* 본문 슬라이드: 크롬 + 리드 문단. 콘텐츠는 2.18in부터 7.62in까지 채운다. */
  let inner = chrome(s, i) +
    (c.intro ? '<div class="intro">' + lines(c.intro) + '</div>' : '');
  const PT = c.intro ? G.pillTop : G.pillTopBare;
  const CT = PT + G.contentGap;
  const BOT = G.bottom;

  if (f === '좌우 2단') {
    const L = c.left || {}, R = c.right || {};
    const rows = Math.max((L.body || []).length, (R.body || []).length, 1);
    const sp = splitBody(CT, rows * G.natural.bulletRow + G.natural.bulletPad, !!c.note);
    const half = (side, x, key) =>
      pillDiv(side.pill, 'left:' + x + 'in;top:' + PT + 'in;width:5.095in') +
      '<div style="position:absolute;left:' + x + 'in;top:' + CT + 'in;width:5.095in;height:' + sp.h + 'in">' +
        bullets(side.body) + '</div>' +
      (sp.figH ? figure(orSlot(side.figure), 'left:' + x + 'in;top:' + sp.figY +
        'in;width:5.095in;height:' + sp.figH + 'in', key) : '');
    // 좌우는 이미 2칸이므로 위 도형 수와 맞는다.
    inner += half(L, 0.649, 'left') + half(R, 5.954, 'right') +
      (c.note ? '<div class="note" style="top:' + (BOT - G.noteH + 0.14) + 'in">' + esc(c.note) + '</div>' : '');
  } else if (f === '표 중심') {
    const t = c.table || { headers: [], rows: [] };
    const tw = 10.37;
    const nrows = (t.rows || []).length || 1;
    const sp = splitBody(CT, G.table.headH + nrows * G.table.rowH, !!c.note);
    const th = sp.h;
    inner += pillDiv(c.pill, 'left:.649in;top:' + PT + 'in;width:' + tw + 'in') +
      '<div style="position:absolute;left:.649in;top:' + CT + 'in;width:' + tw + 'in;height:' + th + 'in">' +
        '<table style="height:100%">' +
        '<thead><tr>' + (t.headers || []).map(h => '<th>' + esc(h) + '</th>').join('') + '</tr></thead>' +
        '<tbody>' + (t.rows || []).map(r =>
          '<tr>' + r.map(x => '<td>' + esc(x) + '</td>').join('') + '</tr>').join('') + '</tbody>' +
        '</table></div>' +
      figureRow(c, evenCols(G.full.x, G.full.w, Math.max((t.headers || []).length, 1), G.rowGap.table), sp.figY, sp.figH) +
      (c.note ? '<div class="note" style="top:' + (BOT - G.noteH + 0.14) + 'in">' + esc(c.note) + '</div>' : '');
  } else if (f === '전폭 도식') {
    const fl = c.flow || [];
    const boxes = fl.map((b, k) =>
      (k ? '<span class="farrow">›</span>' : '') +
      '<div class="fbox"><b>' + esc(b.head) + '</b><p>' + lines(b.body) + '</p></div>').join('');
    const sp = splitBody(CT, bandWanted(figuresOf(c)) ? G.natural.flow : G.natural.flowMax, !!c.note);
    const flowH = sp.h;
    inner += pillDiv(c.pill, 'left:.649in;top:' + PT + 'in;width:10.37in') +
      '<div class="flow" style="left:.649in;top:' + CT + 'in;width:10.37in;height:' + flowH + 'in">' + boxes + '</div>' +
      figureRow(c, evenCols(G.full.x, G.full.w, Math.max(fl.length, 1), G.rowGap.flow), sp.figY, sp.figH) +
      (c.note ? '<div class="note" style="top:' + (BOT - G.noteH + 0.14) + 'in">' + esc(c.note) + '</div>' : '');
  } else if (f === '단계 흐름') {
    const st = c.steps || [];
    const steps = st.map(t => '<div class="step">' + lines(t) + '</div>').join('');
    const spS = splitBody(CT, G.natural.steps, !!c.note);
    inner += pillDiv(c.pill, 'left:.649in;top:' + PT + 'in;width:10.37in') +
      '<div class="flow" style="left:.649in;top:' + CT + 'in;width:10.37in;height:1.5in;gap:.07in">' + steps + '</div>' +
      figureRow(c, evenCols(G.full.x, G.full.w, Math.max(st.length, 1), G.rowGap.steps), spS.figY, spS.figH) +
      (c.note ? '<div class="note" style="top:' + (BOT - G.noteH + 0.14) + 'in">' + esc(c.note) + '</div>' : '');
  } else if (f === '숫자 강조') {
    const arr = c.stats || [];
    const gap = 10.37 / Math.max(arr.length, 1);
    const sts = arr.map((x, k) =>
      '<div class="stat" style="left:' + (0.649 + k * gap) + 'in;top:' + CT + 'in;width:' + (gap - 0.2) + 'in">' +
        '<div class="sl" style="height:.4in">' + esc(x.label) + '</div>' +
        '<div><span class="sv">' + esc(x.value) + '</span><span class="su"> ' + esc(x.unit || '') + '</span>' +
        (x.note ? '<span class="sn">(' + esc(x.note) + ')</span>' : '') + '</div></div>').join('');
    const spN = splitBody(CT, G.natural.stats, !!c.note);
    inner += pillDiv(c.pill, 'left:.649in;top:' + PT + 'in;width:10.37in') +
      sts +
      figureRow(c, evenCols(G.full.x, G.full.w, Math.max(arr.length, 1), G.rowGap.stats), spN.figY, spN.figH) +
      (c.note ? '<div class="note" style="top:' + (BOT - G.noteH + 0.14) + 'in">' + esc(c.note) + '</div>' : '');
  } else if (f === '차트' && (c.chart || {}).type === 'gantt') {
    const g = (c.chart || {}).gantt || {};
    const rows = g.rows || [];
    const spC = splitBody(CT, G.natural.chart, !!c.note);
    const max = g.maxUnit || Math.max(1, ...rows.map(r => r.start + r.duration));
    const tracks = rows.map(r => {
      const left = (r.start / max) * 100;
      const width = (r.duration / max) * 100;
      return '<div class="gtrack"><span class="glabel">' + esc(r.label) + '</span>' +
        '<div class="gbar-bg"><i class="gbar" style="left:' + left + '%;width:' + width + '%"></i></div></div>';
    }).join('');
    inner += pillDiv(c.pill, 'left:.649in;top:' + PT + 'in;width:10.37in') +
      '<div class="gantt" style="left:.649in;top:' + CT + 'in;width:10.37in;height:' + spC.h + 'in">' +
        (tracks || '<em>일정 데이터가 없습니다</em>') + '</div>' +
      figureRow(c, evenCols(G.full.x, G.full.w, Math.max(rows.length, 1), G.rowGap.stats), spC.figY, spC.figH) +
      (c.note ? '<div class="note" style="top:' + (BOT - G.noteH + 0.14) + 'in">' + esc(c.note) + '</div>' : '');
  } else if (f === '차트') {
    const ch = c.chart || {};
    const spC = splitBody(CT, G.natural.chart, !!c.note);
    const cats = ch.categories || [];
    const ser = (ch.series || [])[0] || { values: [] };
    const vals = (ser.values || []).map(Number);
    const max = Math.max(1, ...vals);
    const bars = cats.map((cat, k) => {
      const pct = Math.round(((vals[k] || 0) / max) * 100);
      return '<div class="bar"><i style="height:' + pct + '%"></i>' +
        '<b>' + esc(vals[k] ?? '') + '</b><span>' + esc(cat) + '</span></div>';
    }).join('');
    inner += pillDiv(c.pill, 'left:.649in;top:' + PT + 'in;width:10.37in') +
      '<div class="chart" style="left:.649in;top:' + CT + 'in;width:10.37in;height:' + spC.h + 'in">' +
        (bars || '<em>차트 데이터가 없습니다</em>') + '</div>' +
      figureRow(c, evenCols(G.full.x, G.full.w, Math.max(cats.length, 1), G.rowGap.stats), spC.figY, spC.figH) +
      (c.note ? '<div class="note" style="top:' + (BOT - G.noteH + 0.14) + 'in">' + esc(c.note) + '</div>' : '');
  } else {
    inner += '<div class="note" style="top:2.2in">이 형식의 미리보기는 아직 없습니다.</div>';
  }
  return inner;
}

/** 형식 선택기의 미니 슬라이드를 칸 너비에 맞춰 축소한다. */
function fitMinis() {
  document.querySelectorAll('#picker .mini').forEach(box => {
    const inner = box.firstElementChild;
    if (!inner) return;
    const scale = box.clientWidth / (${T.canvas.w} * 96);
    inner.style.transform = 'scale(' + scale + ')';
    box.style.height = (${T.canvas.h} * 96 * scale) + 'px';
  });
}

function fit() {
  const holder = $('holder'), slide = $('slide');
  const w = holder.clientWidth;
  const scale = w / (${T.canvas.w} * 96);
  slide.style.transform = 'scale(' + scale + ')';
  holder.style.height = (${T.canvas.h} * 96 * scale) + 'px';
}

function render() {
  if (!slides.length) slides = [{ layout: '좌우 2단', title: '', content: {} }];
  cur = Math.max(0, Math.min(cur, slides.length - 1));
  const s = slides[cur];

  $('pos').textContent = (cur + 1) + ' / ' + slides.length + '장';
  $('fill').style.width = ((cur + 1) / slides.length * 100) + '%';

  const el = $('slide');
  el.className = 'slide' + (s.layout === '표지' ? ' cover' : s.layout === '간지' ? ' divider'
                          : s.layout === '목차' ? ' toc' : '');
  el.innerHTML = renderSlide(s, cur);
  fit();

  $('title').value = s.title || '';

  // 리드 문단: 후보 중에서 고르거나 직접 고친다. 본문 형식에만 표시한다.
  const isBody = !['표지', '목차', '간지'].includes(s.layout);
  $('leadwrap').style.display = isBody ? '' : 'none';
  if (isBody) {
    const c = s.content = s.content || {};
    const opts = c.introOptions || [];
    $('cands').innerHTML = opts.map((t, k) =>
      '<button class="cand' + (t === c.intro ? ' on' : '') + '" data-k="' + k + '">' +
        esc(t) + '<i>' + t.length + '자</i></button>').join('');
    $('intro').value = c.intro || '';
    counts();
  }

  // 8종 형식을 이름이 아니라 '이 슬라이드가 그 형식이면 어떻게 보이는지'로 보여준다.
  // 내용이 그대로면 다시 그리지 않는다. 슬라이드를 넘길 때마다 8번 렌더하면 느려진다.
  const sig = JSON.stringify(s);
  if (miniCache.sig !== sig) {
    miniCache.sig = sig;
    miniCache.html = FORMATS.map(f => {
    const probe = JSON.parse(JSON.stringify(s));
    probe.layout = f.name;
    probe.content = adaptContent(probe.content || {}, f.name);
    const cls = f.name === '표지' ? ' cover' : f.name === '간지' ? ' divider'
              : f.name === '목차' ? ' toc' : '';
    return '<button class="opt' + (f.name === s.layout ? ' on' : '') + '" data-name="' + esc(f.name) + '">' +
      '<span class="mini"><span class="slide' + cls + '">' + renderSlide(probe, cur) + '</span></span>' +
      '<b>' + esc(f.name) + '</b><span class="d">' + esc(f.desc) + '</span></button>';
    }).join('');
  }
  $('picker').innerHTML = miniCache.html;
  // 선택 표시는 캐시된 HTML에 매번 다시 입힌다.
  [...$('picker').children].forEach(el =>
    el.classList.toggle('on', el.dataset.name === s.layout));
  fitMinis();
  $('move').innerHTML = slides.map((_, i) =>
    '<option value="' + i + '"' + (i === cur ? ' selected' : '') + '>' + (i + 1) + '번째로</option>').join('');
  $('allstrip').innerHTML = slides.map((sl, i) =>
    '<button class="chip' + (i === cur ? ' on' : '') +
      (confirmed.includes(sl._id) ? ' done' : '') + '" data-i="' + i + '">' +
      (i + 1) + '. ' + esc((sl.title || '제목 없음').slice(0, 12)) + '</button>').join('');
  $('allCount').textContent = '(' + slides.length + '장, 클릭하면 이동)';

  // 확정 목록은 누른 순서 그대로다. PPTX도 이 순서로 만든다.
  $('strip').innerHTML = confirmed.length
    ? confirmed.map((id, n) => {
        const i = slides.findIndex(s => s._id === id);
        if (i < 0) return '';
        return '<button class="chip done' + (i === cur ? ' on' : '') + '" data-i="' + i + '">' +
          (n + 1) + '. ' + esc((slides[i].title || '제목 없음').slice(0, 12)) + '</button>';
      }).join('')
    : '<span class="empty">아직 확정한 장이 없습니다. 장을 넘기며 <b>이 장 확정</b>을 누르면 누른 순서대로 쌓입니다.</span>';
  $('stripCount').textContent = confirmed.length ? '(' + confirmed.length + '장, 이 순서로 만듭니다)' : '';

  const isDone = confirmed.includes(s._id);
  $('confirm').textContent = isDone ? '✓ 확정됨 (누르면 해제)' : '이 장 확정';
  $('confirm').classList.toggle('primary', !isDone);
  $('build').disabled = !confirmed.length;
  $('bcnt').textContent = confirmed.length ? '(' + confirmed.length + '장)' : '';

  const cc = s.content || {};
  const figs = [...(cc.figures || []), cc.figure,
                (cc.left || {}).figure, (cc.right || {}).figure].filter(Boolean);
  $('figwrap').style.display = figs.length ? '' : 'none';
  if (figs.length) {
    const filled = figs.filter(f => f.data).length;
    const el = $('figcnt');
    el.textContent = filled + ' / ' + figs.length + '개';
    el.className = 'cnt ' + (filled === figs.length ? 'ok' : '');
    $('figclear').disabled = filled === 0;
    $('fighint').textContent = GALLERY.length
      ? '슬라이드의 이미지 자리를 클릭하면 폴더에 있는 사진 ' + GALLERY.length + '장 중에서 고를 수 있습니다.'
      : '이미지 폴더를 받지 못했습니다. 사진이 있는 폴더 경로를 알려주면 여기서 골라 넣을 수 있습니다.';
  }

  updateUndoUI();
  $('stagePrev').disabled = cur === 0;
  $('stageNext').disabled = cur === slides.length - 1;
  $('del').disabled = slides.length <= 1;
}

/* 글자수 배지. 리드 문단 길이 기준은 CLI 인자로 조정한다. */
const LEAD_MIN = ${args.leadMin}, LEAD_MAX = ${args.leadMax};
/* 서버로 띄웠으면 확정 저장이 곧바로 PPTX까지 간다. 정적 HTML이면 JSON을 내려받는다. */
const SERVE = ${args.serve ? 'true' : 'false'};
function counts() {
  const s = slides[cur], c = s.content || {};
  const t = (s.title || '').length;
  $('tcnt').textContent = t + '자';
  $('tcnt').className = 'cnt';
  const n = (c.intro || '').length;
  const el = $('icnt');
  el.textContent = n + '자 / ' + LEAD_MIN + '~' + LEAD_MAX;
  el.className = 'cnt ' + (n >= LEAD_MIN && n <= LEAD_MAX ? 'ok' : 'no');
}

function redrawSlide() {
  $('slide').innerHTML = renderSlide(slides[cur], cur); fit();
}

$('cands').addEventListener('click', e => {
  const b = e.target.closest('[data-k]'); if (!b) return;
  snapshot('리드 문단 선택');
  const c = slides[cur].content;
  c.intro = (c.introOptions || [])[+b.dataset.k];
  $('intro').value = c.intro || '';
  [...$('cands').children].forEach((x, i) => x.classList.toggle('on', i === +b.dataset.k));
  counts(); redrawSlide();
});
$('intro').addEventListener('input', e => {
  slides[cur].content.intro = e.target.value;
  [...$('cands').children].forEach(x => x.classList.remove('on'));
  counts(); redrawSlide();
});

/* ── 이미지 넣기 ──────────────────────────────────────────────
   브라우저는 고른 파일의 경로를 알려주지 않는다. 그래서 내용을 읽어
   축소한 뒤 확정 JSON에 data URL로 심는다. 빌더가 그대로 디코드한다. */
const MAX_PX = 1600, JPEG_Q = 0.82;
const fileInput = document.createElement('input');
fileInput.type = 'file'; fileInput.accept = 'image/*';
document.body.appendChild(fileInput);
let pendingKey = null;

function figOf(key) {
  const c = slides[cur].content || {};
  if (key === 'left') return (c.left = c.left || {}), (c.left.figure = c.left.figure || {});
  if (key === 'right') return (c.right = c.right || {}), (c.right.figure = c.right.figure || {});
  const m = /^fig(\\d+)$/.exec(key);
  if (m) {
    c.figures = c.figures || (c.figure ? [c.figure] : []);
    const i = Number(m[1]);
    while (c.figures.length <= i) c.figures.push({});
    return c.figures[i];
  }
  return (c.figure = c.figure || {});
}

function shrinkDataUrl(dataUrl, name) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, MAX_PX / Math.max(img.width, img.height));
      const cv = document.createElement('canvas');
      cv.width = Math.round(img.width * scale);
      cv.height = Math.round(img.height * scale);
      cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
      const png = /\.png$/i.test(name || '');
      resolve({
        data: cv.toDataURL(png ? 'image/png' : 'image/jpeg', JPEG_Q),
        w: cv.width, h: cv.height, name: name || '',
      });
    };
    img.onerror = () => reject(new Error('이미지를 읽지 못했습니다.'));
    img.src = dataUrl;
  });
}

function shrink(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, MAX_PX / Math.max(img.width, img.height));
      const cv = document.createElement('canvas');
      cv.width = Math.round(img.width * scale);
      cv.height = Math.round(img.height * scale);
      cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
      const png = /\.png$/i.test(file.name);
      resolve({
        data: cv.toDataURL(png ? 'image/png' : 'image/jpeg', JPEG_Q),
        w: cv.width, h: cv.height, name: file.name,
      });
      URL.revokeObjectURL(img.src);
    };
    img.onerror = () => reject(new Error('이미지를 읽지 못했습니다.'));
    img.src = URL.createObjectURL(file);
  });
}

fileInput.onchange = async () => {
  const file = fileInput.files && fileInput.files[0];
  if (!file || !pendingKey) return;
  try {
    const out = await shrink(file);
    const fig = figOf(pendingKey);
    if (fig) Object.assign(fig, out);
    render();
  } catch (err) {
    alert(err.message);
  }
  fileInput.value = '';
};

async function assign(key, item) {
  snapshot('이미지 넣기');
  const fig = figOf(key);
  if (!fig) return;
  try {
    const out = await shrinkDataUrl(item.data, item.name);
    Object.assign(fig, out);
    render();
  } catch (err) {
    alert(err.message);
  }
}

$('slide').addEventListener('click', e => {
  const box = e.target.closest('[data-fig]');
  if (!box) return;
  pendingKey = box.dataset.fig;

  if (GALLERY.length) {
    const fig = figOf(pendingKey) || {};
    $('galhint').textContent =
      (fig.caption ? '"' + fig.caption + '" 자리에 넣을 사진을 고르세요. ' : '사진을 고르세요. ') +
      '폴더에 ' + GALLERY.length + '장이 있습니다.';
    $('gallist').innerHTML = GALLERY.map((g, i) =>
      '<button class="gcard" data-g="' + i + '">' +
        '<img src="' + g.data + '" alt="">' +
        '<b>' + esc(g.name) + '</b><span>' + g.kb + 'KB</span></button>').join('');
    $('gal').showModal();
  } else {
    // 폴더를 받지 못했으면 파일 선택창으로 대체한다. 샌드박스 브라우저에서는 열리지 않을 수 있다.
    fileInput.click();
  }
});

$('gallist').addEventListener('click', async e => {
  const b = e.target.closest('[data-g]'); if (!b) return;
  $('gal').close();
  await assign(pendingKey, GALLERY[+b.dataset.g]);
});
$('galclear').onclick = () => {
  snapshot('이미지 비우기');
  const fig = figOf(pendingKey);
  if (fig) { delete fig.data; delete fig.w; delete fig.h; delete fig.name; }
  $('gal').close(); render();
};
$('galclose').onclick = () => $('gal').close();

$('figclear').onclick = () => {
  const c = slides[cur].content || {};
  [...(c.figures || []), c.figure, c.left && c.left.figure, c.right && c.right.figure].forEach(f => {
    if (f) { delete f.data; delete f.w; delete f.h; delete f.name; }
  });
  render();
};

$('picker').addEventListener('click', e => {
  const b = e.target.closest('[data-name]'); if (!b) return;
  snapshot('형식 변경');
  const s = slides[cur];
  s.layout = b.dataset.name;
  s.content = adaptContent(s.content || {}, s.layout);
  render();
});
['strip', 'allstrip'].forEach(id => $(id).addEventListener('click', e => {
  const b = e.target.closest('[data-i]'); if (!b) return;
  cur = +b.dataset.i; render();
}));
$('title').addEventListener('input', e => {
  slides[cur].title = e.target.value; counts(); redrawSlide();
});
$('stagePrev').onclick = () => { cur -= 1; render(); };
$('stageNext').onclick = () => { cur += 1; render(); };
$('move').onchange = e => {
  snapshot('순서 이동');
  const to = +e.target.value;
  const [s] = slides.splice(cur, 1); slides.splice(to, 0, s); cur = to; render();
};
$('dup').onclick = () => {
  snapshot('복제');
  const copy = JSON.parse(JSON.stringify(slides[cur]));
  copy._id = nextId; nextId += 1;   // 복제본은 따로 확정해야 한다
  slides.splice(cur + 1, 0, copy); cur += 1; render();
};
$('del').onclick = () => {
  snapshot('삭제');
  const [gone] = slides.splice(cur, 1);
  confirmed = confirmed.filter(id => id !== gone._id);
  render();
};
$('add').onclick = () => {
  snapshot('장 추가');
  slides.splice(cur + 1, 0, { _id: nextId, layout: '좌우 2단', title: '', content: {} });
  nextId += 1; cur += 1; render();
};
/* 확정은 이 장 하나만 목록에 넣고 뺀다. 누른 순서가 곧 만들 순서다. */
$('confirm').onclick = () => {
  snapshot('확정');
  const id = slides[cur]._id;
  if (confirmed.includes(id)) confirmed = confirmed.filter(x => x !== id);
  else confirmed.push(id);
  render();
};

/* 확정한 순서 그대로 묶는다. 같은 사진이 여러 자리에 쓰이면 한 번만 싣는다. */
function packConfirmed() {
  const pool = {};
  const seen = new Map();
  const picked = confirmed
    .map(id => slides.find(s => s._id === id))
    .filter(Boolean);
  const packed = JSON.parse(JSON.stringify(picked.map((s, i) => ({ ...s, number: i + 1 }))));
  packed.forEach(s => {
    delete s._id;
    const c = s.content || {};
    [...(c.figures || []), c.figure, (c.left || {}).figure, (c.right || {}).figure]
      .filter(f => f && f.data)
      .forEach(f => {
        let id = seen.get(f.data);
        if (!id) {
          id = 'img' + (Object.keys(pool).length + 1);
          seen.set(f.data, id);
          pool[id] = f.data;
        }
        f.assetId = id;
        delete f.data;
      });
  });
  return { title: ${JSON.stringify(deckTitle)}, assets: pool, slides: packed };
}

/* 서버가 죽으면 화면이 먼저 안다. 눌러 보고 나서 알면 늦다. */
if (SERVE) {
  setInterval(async () => {
    let alive = false;
    try {
      const r = await fetch('/ping', { cache: 'no-store', signal: AbortSignal.timeout(2500) });
      alive = r.ok;
    } catch { alive = false; }
    $('offline').classList.toggle('on', !alive);
    $('build').disabled = !alive || !confirmed.length;
  }, 5000);
}

/* 생성은 따로다. 확정 목록이 곧 덱이 된다. */
$('build').onclick = () => {
  if (!confirmed.length) return;
  const text = JSON.stringify(packConfirmed(), null, 2);
  $('json').value = text;

  // 서버로 띄운 경우엔 JSON을 내려받게 하지 않는다. 그대로 넘겨서 PPTX까지 만든다.
  if (SERVE) {
    const btn = $('build');
    const label = btn.innerHTML;
    btn.disabled = true;
    btn.textContent = 'PPTX 만드는 중…';
    fetch('/build', { method: 'POST', headers: { 'content-type': 'application/json' }, body: text })
      .then(r => r.json())
      .then(r => {
        if (!r.ok) throw new Error(r.error || '빌드에 실패했습니다.');
        $('outhint').innerHTML = '확정한 ' + confirmed.length + '장으로 PPTX를 만들었습니다.<br><b>' +
          esc(r.pptx) + '</b>' +
          (r.overflows && r.overflows.length
            ? '<br><span style="color:#a33">글자가 넘치는 곳 ' + r.overflows.length + '군데를 확인하세요.</span>'
            : '');
        $('out').showModal();
      })
      .catch(e => {
        // 서버가 죽은 것과 빌드가 실패한 것은 다르다. 구분해서 말한다.
        const down = (e instanceof TypeError);
        $('outhint').innerHTML = down
          ? '<b style="color:#a33">미리보기 서버가 응답하지 않습니다.</b><br>' +
            '터미널에서 미리보기가 꺼졌는지 확인하고 다시 띄워 주세요. ' +
            '작업한 내용은 아래 JSON에 그대로 있으니 복사해 두면 잃지 않습니다.'
          : '<span style="color:#a33">' + esc(e.message) + '</span><br>' +
            '아래 JSON을 복사해서 전달하면 수동으로 만들 수 있습니다.';
        $('out').showModal();
      })
      .finally(() => { btn.disabled = false; btn.innerHTML = label; render(); });
    return;
  }

  const blob = new Blob([text], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = 'slide_plan.confirmed.json'; a.click();
  URL.revokeObjectURL(a.href);
  $('out').showModal();
};
$('copy').onclick = () => navigator.clipboard.writeText($('json').value);
$('close').onclick = () => $('out').close();
addEventListener('resize', () => { fit(); fitMinis(); });
$('undo').onclick = undo;
$('redo').onclick = redo;

document.addEventListener('keydown', e => {
  if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') {
    e.preventDefault();
    if (e.shiftKey) redo(); else undo();
    return;
  }
  if (e.target.tagName === 'TEXTAREA' || e.target.tagName === 'SELECT') return;
  if (e.key === 'ArrowLeft' && cur > 0) { cur -= 1; render(); }
  if (e.key === 'ArrowRight' && cur < slides.length - 1) { cur += 1; render(); }
});

render();
</script>
`;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  // 브랜드 주입은 buildHtml이 T를 읽기 전에 끝나야 한다.
  if (args.brand) {
    const { applyBrand } = await import('../components/brand.mjs');
    const b = applyBrand(args.brand);
    console.error(`브랜드 적용: ${b.name}`);
  }
  if (args.help) {
    usage();
    return;
  }
  if (!fs.existsSync(args.plan)) {
    throw new Error(`slide_plan.json을 찾을 수 없습니다: ${args.plan}`);
  }

  let plan;
  try {
    plan = JSON.parse(fs.readFileSync(args.plan, 'utf8'));
  } catch (error) {
    throw new Error(`slide_plan.json 파싱에 실패했습니다: ${error.message}`);
  }
  if (!Array.isArray(plan.slides) || !plan.slides.length) {
    throw new Error('slide_plan.json에 slides 배열이 없습니다.');
  }

  const known = new Set(FORMATS.map((f) => f.name));
  const unknown = [...new Set(plan.slides.map((s) => s.layout).filter((l) => l && !known.has(l)))];

  const run = startRun('미리보기 생성', {
    플랜: args.plan, 사진폴더: args.images || '(없음)', 장수: plan.slides.length,
  });

  const outPath = path.resolve(args.out);
  // --serve면 사진을 HTML에 박지 않고 서버가 내준다. 수백 장이어도 화면이 가볍다.
  const gallery = loadGallery(args.images, !args.serve);
  const html = buildHtml(plan, args, gallery);
  fs.writeFileSync(outPath, html, 'utf8');

  const mb = fs.statSync(outPath).size / (1024 * 1024);
  console.log(JSON.stringify({
    output: outPath,
    slides: plan.slides.length,
    gallery: gallery.length,
    html_mb: Number(mb.toFixed(1)),
    unknown_formats: unknown,
  }, null, 2));

  // 사진을 통째로 박은 HTML이 커지면 브라우저가 멈춘다. 미리 알려준다.
  if (!args.serve && mb > 25) {
    console.error(`경고: HTML이 ${mb.toFixed(0)}MB입니다. 사진이 많아 브라우저가 멈출 수 있습니다. ` +
                  `--serve로 띄우면 사진을 따로 내주어 가벼워집니다.`);
  }

  endRun(run, {
    산출물: `\`${outPath}\``,
    사진: `${gallery.length}장`,
    HTML: `${mb.toFixed(1)}MB`,
    모르는형식: unknown.length ? unknown.join(', ') : undefined,
  });

  if (args.serve) serve(html, args, outPath, gallery);
}

/**
 * 검토 화면을 로컬 서버로 띄운다.
 * '확정 저장'이 /build로 들어오면 확정 JSON을 남기고 곧바로 PPTX까지 만든다.
 * 사람이 JSON을 내려받아 다시 넘길 일이 없다.
 */
function serve(html, args, outPath, gallery = []) {
  const dir = path.dirname(outPath);
  const jsonPath = path.join(dir, 'slide_plan.confirmed.json');
  const pptxPath = path.resolve(args.pptx || path.join(dir, 'deck.pptx'));
  const builder = path.resolve(SELF_DIR, '../components/build-from-plan.mjs');

  http.createServer((req, res) => {
    // 화면이 서버 생존을 확인하는 통로. preflight도 이걸로 우리 서버인지 가린다.
    if (req.url === '/ping') {
      res.writeHead(200, { 'content-type': 'text/plain' });
      res.end('merry-slide');
      return;
    }

    // 갤러리 사진은 HTML에 박지 않고 여기서 원본 그대로 내준다.
    const img = /^\/img\/(\d+)$/.exec(req.url || '');
    if (img) {
      const item = gallery[Number(img[1])];
      if (!item || !item.file || !fs.existsSync(item.file)) {
        res.writeHead(404); res.end('not found'); return;
      }
      // 사진 한 장을 못 읽는다고 서버가 죽으면 안 된다. macOS 권한(EPERM)으로
      // 막힌 파일이 데스크톱에 섞여 있는 경우가 실제로 있었다.
      // 헤더는 파일이 실제로 열린 뒤에 보낸다. 먼저 보내면 못 읽는 사진도
      // 200으로 나가서 브라우저가 깨진 이미지를 받는다.
      const stream = fs.createReadStream(item.file);
      stream.on('error', (err) => {
        console.error(`사진을 건너뜁니다: ${item.name} (${err.code || err.message})`);
        if (!res.headersSent) res.writeHead(404, { 'content-type': 'text/plain' });
        res.end('unreadable');
      });
      stream.on('open', () => {
        res.writeHead(200, {
          'content-type': IMG_MIME[path.extname(item.file).toLowerCase()] || 'application/octet-stream',
          'cache-control': 'max-age=3600',
        });
        stream.pipe(res);
      });
      return;
    }

    if (req.method === 'POST' && req.url === '/build') {
      const chunks = [];
      req.on('data', (c) => chunks.push(c));
      req.on('end', () => {
        const reply = (code, body) => {
          res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' });
          res.end(JSON.stringify(body));
        };
        try {
          const text = Buffer.concat(chunks).toString('utf8');
          JSON.parse(text);
          fs.writeFileSync(jsonPath, text, 'utf8');
          const r = spawnSync(process.execPath,
            [builder, '--plan', jsonPath, '--out', pptxPath, '--title', args.title || ''],
            { encoding: 'utf8', maxBuffer: 1 << 28 });
          if (r.status !== 0) {
            reply(500, { ok: false, error: (r.stderr || r.stdout || '빌드 실패').trim().slice(0, 500) });
            console.error(`빌드 실패:\n${r.stderr || r.stdout}`);
            return;
          }
          let overflows = [];
          try { overflows = (JSON.parse(r.stdout).overflows) || []; } catch { /* 요약 없으면 넘어간다 */ }
          console.log(`PPTX 완성: ${pptxPath}` +
                      (overflows.length ? ` (글자 넘침 ${overflows.length}군데)` : ''));
          reply(200, { ok: true, pptx: pptxPath, json: jsonPath, overflows });
        } catch (error) {
          reply(500, { ok: false, error: error.message });
        }
      });
      return;
    }
    // 검토 화면은 루트에서만 준다. 그 외 경로에 200을 주면 스캐너가 파일을
    // 캐내려는 시도에도 정상 응답처럼 보인다. 실제 파일 유출은 없지만 위생상 404.
    const reqPath = (req.url || '/').split('?')[0];
    if (reqPath !== '/' && reqPath !== '/index.html') {
      res.writeHead(404, { 'content-type': 'text/plain' });
      res.end('not found');
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    res.end(html);
  }).listen(args.port, args.lan ? '0.0.0.0' : '127.0.0.1', () => {
    console.log(`검토 화면: http://localhost:${args.port}  (PPTX 생성을 누르면 ${pptxPath} 로 바로 만들어집니다)`);
    if (args.lan) {
      console.log('주의: --lan 모드입니다. 같은 네트워크의 다른 기기에서도 이 화면과 사진에 접근할 수 있습니다.');
    }
  });

  // 검토 중에 서버가 내려가면 작업하던 내용을 잃는다. 어떤 예외도 프로세스를
  // 죽이지 못하게 막고 로그만 남긴다.
  process.on('uncaughtException', (err) => {
    console.error(`무시한 오류: ${err.message}`);
  });
}

main().catch((error) => {
  console.error(`preview-composition.mjs: ${error.message}`);
  process.exit(1);
});
