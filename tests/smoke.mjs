#!/usr/bin/env node
/**
 * 스모크 테스트: 추출 → 브랜드 주입 → 빌드 → 검증을 한 번에 돌린다.
 *
 * "MYSC와 다른 양식에서도 파이프라인이 도는가"를 검증한다. MYSC와 정반대
 * 성격(16:9, 그린 팔레트, 사이드바, footer 쪽수, 다른 폰트)의 레퍼런스를
 * 코드로 만들고, 추출기에 넣고, 그 결과로 실제 덱을 빌드한 뒤 OOXML을 열어
 * 캔버스·색·폰트가 주입됐는지 확인한다.
 *
 * CI와 로컬에서 같은 명령으로 돈다. LibreOffice 같은 외부 도구는 쓰지 않는다.
 *
 *   node tests/smoke.mjs
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const SELF_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SELF_DIR, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'merry-smoke-'));
const require = createRequire(path.join(ROOT, 'vendor', 'package.json'));

let failed = 0;
function check(name, ok, detail = '') {
  console.log(`  ${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failed += 1;
}

/* ── 1. MYSC와 정반대 양식의 레퍼런스 3장을 만든다 ── */
const PptxGenJS = require('pptxgenjs');
const GREEN = '1B5E20', LIME = '8BC34A';

async function makeRef() {
  const p = new PptxGenJS();
  p.defineLayout({ name: 'W', width: 13.333, height: 7.5 });
  p.layout = 'W';
  const chrome = (s, num) => {
    s.addShape('rect', { x: 0, y: 0, w: 0.35, h: 7.5, fill: { color: GREEN } });
    s.addShape('line', { x: 0.8, y: 1.1, w: 11.7, h: 0, line: { color: GREEN, width: 1.5 } });
    s.addText('스모크 테스트', { x: 0.8, y: 0.35, w: 4, h: 0.5, fontSize: 20, bold: true, color: GREEN, fontFace: 'Noto Sans KR' });
    s.addText(String(num), { x: 12.5, y: 7.0, w: 0.6, h: 0.35, fontSize: 9, color: '424242', fontFace: 'Noto Sans KR' });
  };
  let s = p.addSlide(); chrome(s, 2);
  s.addTable([
    [{ text: '구분', options: { fill: { color: LIME }, bold: true } }, { text: '1차', options: { fill: { color: LIME }, bold: true } }],
    ['설비', '12억'], ['인력', '4억'],
  ], { x: 0.8, y: 2.0, w: 11.5, rowH: [0.32, 0.55, 0.55], fontSize: 11, fontFace: 'Noto Sans KR' });
  s = p.addSlide(); chrome(s, 3);
  s.addText('본문 내용', { x: 0.8, y: 2.0, w: 11, h: 3, fontSize: 12, fontFace: 'Noto Sans KR' });
  s = p.addSlide(); chrome(s, 4);
  s.addText('60%', { x: 1.2, y: 3.0, w: 3, h: 1, fontSize: 40, bold: true, color: GREEN, fontFace: 'Noto Sans KR' });
  await p.writeFile({ fileName: path.join(TMP, 'ref.pptx') });
}

/* ── 실행 ── */
console.log('\n스모크 테스트\n');
await makeRef();
check('레퍼런스 생성', fs.existsSync(path.join(TMP, 'ref.pptx')));

/* 2. 추출 */
try {
  execFileSync('python3', [
    path.join(ROOT, 'scripts', 'extract-brand.py'),
    path.join(TMP, 'ref.pptx'), '--name', 'smoke', '--out', TMP,
  ], { stdio: 'pipe' });
} catch (e) {
  check('브랜드 추출', false, String(e.stderr || e.message).split('\n')[0]);
  process.exit(1);
}
const brandFile = path.join(TMP, 'smoke', 'brand.json');
const brand = JSON.parse(fs.readFileSync(brandFile, 'utf8'));
check('브랜드 추출', true);
check('캔버스 16:9 검출', Math.abs((brand.canvas?.ratio || 0) - 1.778) < 0.01, `ratio ${brand.canvas?.ratio}`);
check('폰트 검출', brand.font?.family === 'Noto Sans KR', brand.font?.family);
check('헤더 룰 검출', brand.header?.rule?.slides === 3, `x=${brand.header?.rule?.x} y=${brand.header?.rule?.y}`);
check('표 헤더 검출', brand.table?.headFill === LIME, brand.table?.headFill);

/* 3. 브랜드 주입 (applyBrand가 T를 실제로 바꾸는지) */
const { applyBrand } = await import(path.join(ROOT, 'components', 'brand.mjs'));
const { T } = await import(path.join(ROOT, 'components', 'mysc-proposal.mjs'));
applyBrand(brandFile);
check('T.canvas 주입', T.canvas.w === 13.333 && T.canvas.h === 7.5, `${T.canvas.w}x${T.canvas.h}`);
check('T.color 주입', T.color.navy === GREEN, T.color.navy);
check('T.font 주입', T.font.family === 'Noto Sans KR', T.font.family);
check('표 행높이 주입', T.grid.table.headH === 0.32, `headH ${T.grid.table.headH}`);

/* 4. 빌드 — 별도 프로세스(주입 전 상태에서 --brand로) */
const plan = {
  title: '스모크', slides: [
    { number: 1, layout: '표지', title: '스모크 테스트 덱', content: {} },
    { number: 2, layout: '표 중심', title: '표 확인', content: {
      intro: '스모크 테스트용 리드 문단입니다. 길이는 검증 대상이 아니므로 짧게 둡니다.',
      table: { headers: ['구분', '값'], rows: [['설비', '12억'], ['인력', '4억']] } } },
    { number: 3, layout: '간지', title: '섹션', content: { numeral: 'Ⅱ', items: ['하나', '둘'] } },
  ],
};
fs.writeFileSync(path.join(TMP, 'plan.json'), JSON.stringify(plan));
const deck = path.join(TMP, 'deck.pptx');
try {
  execFileSync(process.execPath, [
    path.join(ROOT, 'components', 'build-from-plan.mjs'),
    '--brand', brandFile, '--plan', path.join(TMP, 'plan.json'), '--out', deck,
  ], { stdio: 'pipe', env: { ...process.env, MERRY_WORKLOG_AUTOCOMMIT: '0' } });
} catch (e) {
  check('브랜드 빌드', false, String(e.stderr || e.message).split('\n').slice(-3).join(' '));
  process.exit(1);
}
check('브랜드 빌드', fs.existsSync(deck));

/* 5. OOXML 검증 — 열어 보지 않고 믿지 않는다. zip 파싱은 python3 표준 라이브러리를 쓴다 */
const probe = execFileSync('python3', ['-c', `
import zipfile, re, json
z = zipfile.ZipFile(${JSON.stringify(deck)})
pres = z.read('ppt/presentation.xml').decode()
m = re.search(r'sldSz cx="(\\d+)" cy="(\\d+)"', pres)
slides = [n for n in z.namelist() if re.match(r'ppt/slides/slide\\d+\\.xml$', n)]
s2 = z.read('ppt/slides/slide2.xml').decode()
print(json.dumps({
  'slides': len(slides),
  'cx': round(int(m.group(1))/914400, 3), 'cy': round(int(m.group(2))/914400, 3),
  'green': '${GREEN}' in s2, 'lime': '${LIME}' in s2,
  'font': 'Noto Sans KR' in s2, 'mysc': '0C2044' in s2,
}))
`], { encoding: 'utf8' });
const r = JSON.parse(probe);
check('슬라이드 수', r.slides === 3, String(r.slides));
check('덱 캔버스 16:9', r.cx === 13.333 && r.cy === 7.5, `${r.cx}x${r.cy}`);
check('primary 그린 사용', r.green);
check('표 헤더 라임 사용', r.lime);
check('브랜드 폰트 사용', r.font);
check('MYSC 색 잔존 없음', !r.mysc);

/* 6. 프리뷰 생성 + 생성물 스크립트 실행 검증 (pillDiv 사고의 교훈) */
const prevOut = path.join(TMP, 'preview.html');
try {
  execFileSync(process.execPath, [
    path.join(ROOT, 'scripts', 'preview-composition.mjs'),
    '--plan', path.join(TMP, 'plan.json'), '--brand', brandFile, '--out', prevOut,
  ], { stdio: 'pipe', env: { ...process.env, MERRY_WORKLOG_AUTOCOMMIT: '0' } });
  const html = fs.readFileSync(prevOut, 'utf8');
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]).join('\n');
  new Function(scripts);   // 문법 오류면 여기서 던진다
  check('프리뷰 생성 + 스크립트 파싱', true);
  check('프리뷰 캔버스 주입', html.includes('width:13.333in'), '13.333in');
} catch (e) {
  check('프리뷰 생성 + 스크립트 파싱', false, String(e.message).split('\n')[0]);
}

/* 7. 프리뷰가 빌더 전용 함수를 부르지 않는지 확인한다.
 *
 * 실제 사고: 전폭 도식 분기에서 빌더의 bandWanted·figuresOf를 호출했는데
 * 프리뷰에는 그 함수가 없어 ReferenceError로 화면 전체가 멈췄다. 문법 검사와
 * 파싱은 통과했고 그 형식을 열어 보기 전까지 드러나지 않았다.
 *
 * 프리뷰는 빌더에서 아무것도 import하지 않으므로, 빌더에만 있는 이름을
 * 프리뷰가 부른다면 그 자체로 결함이다. */
{
  const names = (src) => new Set(
    [...src.matchAll(/(?:^|\n)\s*(?:function\s+([A-Za-z_$][\w$]*)|const\s+([A-Za-z_$][\w$]*)\s*=\s*(?:\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>)/g)]
      .map((m) => m[1] || m[2]).filter(Boolean));

  const builderSrc = fs.readFileSync(path.join(ROOT, 'components', 'build-from-plan.mjs'), 'utf8');
  const previewSrc = fs.readFileSync(path.join(ROOT, 'scripts', 'preview-composition.mjs'), 'utf8');
  const builderOnly = [...names(builderSrc)].filter((n) => !names(previewSrc).has(n));

  // 주석은 코드가 아니므로 지우고 검사한다.
  const code = previewSrc.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1 ');
  const called = builderOnly.filter((n) => new RegExp(`[^\\w$.]${n}\\s*\\(`).test(code));

  check('프리뷰가 빌더 전용 함수를 부르지 않음', called.length === 0,
    called.length ? `호출됨: ${called.join(', ')}` : `빌더 전용 ${builderOnly.length}개 대조`);
}
