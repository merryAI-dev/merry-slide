#!/usr/bin/env node
/**
 * 개인정보 보호 테스트 — 개인정보보호위원회 「개인정보 영향평가 수행안내서」
 * (2025.10.) 평가항목을 이 도구의 실제 위험면에 맞게 옮긴 것이다.
 *
 * 이 도구가 만지는 개인정보: 슬라이드용 사진(인물 가능), 작업 기록(발주처·
 * 사업 정보), 제안서 산출물, 레퍼런스 덱의 본문 텍스트.
 *
 * 원칙은 코드 검사가 아니라 실행 검증이다. 서버를 실제로 띄워 바인딩을 보고,
 * 개인정보를 심은 레퍼런스를 실제로 추출해 새어 나오는지 본다.
 *
 *   node tests/privacy.mjs
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import net from 'node:net';
import { execFileSync, spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'merry-privacy-'));
const require = createRequire(path.join(ROOT, 'vendor', 'package.json'));
const PORT = 18930;

let failed = 0;
function check(pia, name, ok, detail = '') {
  console.log(`  ${ok ? '✓' : '✗'} [${pia}] ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failed += 1;
}

const fetchStatus = async (url) => {
  try { return (await fetch(url, { signal: AbortSignal.timeout(2500) })).status; }
  catch { return 0; }
};

console.log('\n개인정보 보호 테스트 (PIA 평가항목 기준)\n');

/* ── 서버를 하나 띄워 접근통제 계열을 실측한다 ─────────────────── */
const plan = { title: 't', slides: [{ number: 1, layout: '표지', title: 'x', content: {} }] };
fs.writeFileSync(path.join(TMP, 'plan.json'), JSON.stringify(plan));
// 갤러리에 파일을 하나 두어 /img 라우트가 살아 있게 한다
fs.mkdirSync(path.join(TMP, 'imgs'));
// 1x1 투명 PNG. 배포판에는 이미지 자산이 없으므로 코드로 만든다.
fs.writeFileSync(path.join(TMP, 'imgs', 'a.png'), Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64'));

const srv = spawn(process.execPath, [
  path.join(ROOT, 'scripts', 'preview-composition.mjs'),
  '--plan', path.join(TMP, 'plan.json'), '--out', path.join(TMP, 'p.html'),
  '--images', path.join(TMP, 'imgs'), '--serve', '--port', String(PORT),
], { stdio: 'ignore', env: { ...process.env, MERRY_WORKLOG_AUTOCOMMIT: '0' } });

// 서버가 뜰 때까지
for (let i = 0; i < 40; i += 1) {
  if ((await fetchStatus(`http://127.0.0.1:${PORT}/ping`)) === 200) break;
  await new Promise((r) => setTimeout(r, 250));
}

/* 4.2.3 — 공유망을 통한 노출 방지: 기본 바인딩은 이 컴퓨터 안(loopback)이어야 한다 */
{
  const nics = Object.values(os.networkInterfaces()).flat()
    .filter((n) => n && !n.internal && n.family === 'IPv4').map((n) => n.address);
  let lanOpen = false;
  for (const ip of nics) {
    // 같은 호스트에서도 non-loopback 주소로의 접속은 바인딩 범위를 그대로 드러낸다
    const ok = await new Promise((res) => {
      const s = net.connect({ host: ip, port: PORT });
      s.setTimeout(1200);
      s.once('connect', () => { s.destroy(); res(true); });
      s.once('error', () => res(false));
      s.once('timeout', () => { s.destroy(); res(false); });
    });
    if (ok) lanOpen = true;
  }
  check('4.2.3', '프리뷰 서버가 LAN에 열려 있지 않다', !lanOpen,
    lanOpen ? `외부 인터페이스(${nics.join(',')})에서 접속됨 — 같은 네트워크 전체에 사진·제안서 노출`
            : `loopback 전용 (검사한 인터페이스: ${nics.length}개)`);
}

/* 4.1.11 — 최소 권한: 사진 라우트는 갤러리 목록에 실린 파일만 내준다 (경로 탐색 차단) */
{
  const okNormal = (await fetchStatus(`http://127.0.0.1:${PORT}/img/0`)) === 200;
  const t1 = await fetchStatus(`http://127.0.0.1:${PORT}/img/../../../../etc/passwd`);
  const t2 = await fetchStatus(`http://127.0.0.1:${PORT}/img/%2e%2e%2f%2e%2e%2fetc%2fpasswd`);
  const t3 = await fetchStatus(`http://127.0.0.1:${PORT}/img/999999`);
  check('4.1.11', '갤러리 사진은 정상 제공된다', okNormal);
  check('4.1.11', '경로 탐색으로 임의 파일을 못 꺼낸다',
    t1 !== 200 && t2 !== 200 && t3 !== 200, `탐색 시도 응답: ${t1}/${t2}/${t3}`);
}

srv.kill();

/* ── 3.1 수집 최소화: 브랜드 추출은 서식만 뽑고 본문 개인정보를 저장하지 않는다 ── */
{
  // 개인정보를 일부러 심은 레퍼런스를 만든다
  const PptxGenJS = require('pptxgenjs');
  const p = new PptxGenJS();
  p.defineLayout({ name: 'W', width: 13.333, height: 7.5 });
  p.layout = 'W';
  const SECRETS = ['김철수', '900101-1234567', 'chulsoo@example.com', '010-1234-5678'];
  for (let i = 0; i < 2; i += 1) {
    const s = p.addSlide();
    s.addShape('line', { x: 0.8, y: 1.1, w: 11.7, h: 0, line: { color: '336699', width: 1.5 } });
    s.addText(`담당자 ${SECRETS[0]} / 주민번호 ${SECRETS[1]} / ${SECRETS[2]} / ${SECRETS[3]}`,
      { x: 0.8, y: 2, w: 11, h: 1, fontSize: 12, fontFace: 'Noto Sans KR' });
  }
  await p.writeFile({ fileName: path.join(TMP, 'pii-ref.pptx') });
  execFileSync('python3', [path.join(ROOT, 'scripts', 'extract-brand.py'),
    path.join(TMP, 'pii-ref.pptx'), '--name', 'pii', '--out', TMP], { stdio: 'pipe' });
  const dumped = fs.readdirSync(path.join(TMP, 'pii'))
    .map((n) => fs.readFileSync(path.join(TMP, 'pii', n), 'utf8')).join('\n');
  const leaked = SECRETS.filter((sv) => dumped.includes(sv));
  check('3.1', '브랜드 추출 결과에 레퍼런스 본문의 개인정보가 없다', leaked.length === 0,
    leaked.length ? `유출: ${leaked.join(', ')}` : '이름·주민번호·이메일·전화번호 모두 미포함');
}

/* ── 3.3 제3자 제공: 작업 기록의 공개 저장소 커밋은 기본 꺼짐 + 명시적 동의 구조 ── */
{
  // 설정이 전혀 없는 새 HOME에서 기본값을 본다 (신규 사용자 = 새 컴퓨터)
  const fakeHome = path.join(TMP, 'home');
  fs.mkdirSync(fakeHome, { recursive: true });
  const out = execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'worklog.mjs'), 'autocommit'],
    { encoding: 'utf8', env: { ...process.env, HOME: fakeHome, MERRY_WORKLOG_AUTOCOMMIT: '' } });
  check('3.3', '작업 기록 자동 공개(커밋)는 기본 꺼짐이다', out.includes('꺼짐'), out.trim());
}

/* ── 3.5 / 4.7 — 파기: 개인정보가 담긴 산출물을 지우는 절차가 있는가 ── */
{
  const helps = ['scripts/worklog.mjs', 'scripts/preview-composition.mjs', 'components/build-from-plan.mjs']
    .map((f) => fs.readFileSync(path.join(ROOT, f), 'utf8')).join('\n');
  const hasPurge = /파기|clean|purge/.test(helps) && /worklog\.mjs (clean|purge)/.test(helps);
  check('3.5/4.7', '산출물·기록 파기 절차가 도구에 존재한다', hasPurge,
    hasPurge ? '' : '사진이 박힌 확정 JSON·덱·기록을 지우는 명령이 없다 (보완 필요)');
}

/* ── 4.8.1 — 개발환경 통제: 저장소의 테스트·예제에 실제 개인정보가 없다 ── */
{
  const files = execFileSync('git', ['ls-files'], { cwd: ROOT, encoding: 'utf8' })
    .split('\n').filter((f) => f && /\.(md|mjs|py|json)$/.test(f) && !f.includes('vendor'));
  const pat = /\d{6}-[1-4]\d{6}|01[016-9]-?\d{3,4}-?\d{4}|[\w.]+@(?!example\.|anthropic\.com)[\w-]+\.(com|net|kr)/;
  const hits = [];
  for (const f of files) {
    const body = fs.readFileSync(path.join(ROOT, f), 'utf8');
    const m = body.match(pat);
    if (m) hits.push(`${f}: ${m[0]}`);
  }
  check('4.8.1', '저장소 추적 파일에 주민번호·전화번호·실이메일이 없다', hits.length === 0,
    hits.slice(0, 3).join(' / ') || `${files.length}개 파일 스캔`);
}

/* ── 4.4 — 접속기록: 서버가 접속 로그를 남기는가 (현황 파악용) ── */
{
  const src = fs.readFileSync(path.join(ROOT, 'scripts', 'preview-composition.mjs'), 'utf8');
  const hasLog = /접속기록|access[_ ]?log/i.test(src);
  // 기본이 loopback 전용(4.2.3 충족)인 동안 접속기록은 법적 요건이 아니다.
  // LAN 공개를 정식 기능으로 여는 순간 결함으로 승격해야 한다.
  console.log(`  ${hasLog ? '✓' : '!'} [4.4] 프리뷰 서버 접속기록 — ${hasLog ? '보관함' : '없음 (loopback 전용인 동안은 해당 없음, LAN 기능 도입 시 필수로 전환)'}`);
}

fs.rmSync(TMP, { recursive: true, force: true });
console.log(failed ? `\n미충족 ${failed}건 — 위 항목이 보완 지점이다\n` : '\n전부 충족\n');
process.exit(failed ? 1 : 0);
