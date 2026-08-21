#!/usr/bin/env node
/**
 * 시작하기 전에 환경을 점검한다.
 *
 * 실패는 대부분 작업 도중이 아니라 준비 단계에서 이미 정해져 있다.
 * 사진 폴더에 권한 막힌 파일이 섞여 있거나, 포트가 이미 쓰이고 있거나,
 * 의존성이 안 깔려 있는 것들이다. 그걸 시연 중에 발견하면 늦다.
 *
 * 각 항목은 ok / warn / fail 로 판정하고, fail이 하나라도 있으면 exit 1.
 * 사람이 고칠 수 있도록 판정마다 '어떻게 고치는지'를 같이 낸다.
 *
 * 사용법:
 *   node scripts/preflight.mjs --images ~/Desktop --plan plan.json --port 18888 --out ~/merry-demo
 *   node scripts/preflight.mjs --json      # 기계가 읽는 형식
 */

import fs from 'node:fs';
import net from 'node:net';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';

const SELF_DIR = path.dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = path.resolve(SELF_DIR, '..');
const IMG_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp']);

function parseArgs(argv) {
  const a = { images: '', plan: '', port: 18888, out: '', json: false };
  for (let i = 0; i < argv.length; i += 1) {
    const k = argv[i];
    if (k === '--json') a.json = true;
    else if (k === '--images') a.images = argv[++i];
    else if (k === '--plan') a.plan = argv[++i];
    else if (k === '--out') a.out = argv[++i];
    else if (k === '--port') a.port = Number(argv[++i]);
  }
  return a;
}

const checks = [];
const add = (name, status, detail, fix = '') => checks.push({ name, status, detail, fix });

/**
 * 포트가 비어 있는지 본다.
 *
 * 열어 보기만 하면 안 된다. 서버가 :: 로 잡고 있을 때 127.0.0.1로는 또 열려서
 * "비어 있다"는 거짓 통과가 나온다. 접속이 되는지를 먼저 확인한다.
 */
function portInUse(port) {
  return new Promise((resolve) => {
    const sock = net.connect({ port, host: '127.0.0.1' });
    const done = (used) => { sock.destroy(); resolve(used); };
    sock.setTimeout(700);
    sock.once('connect', () => done(true));     // 누군가 응답한다 = 쓰는 중
    sock.once('timeout', () => done(false));
    sock.once('error', () => done(false));      // 접속 거부 = 비어 있음
  });
}

function checkNode() {
  const major = Number(process.versions.node.split('.')[0]);
  if (major >= 18) add('Node.js', 'ok', `v${process.versions.node}`);
  else add('Node.js', 'fail', `v${process.versions.node} — 18 이상이 필요합니다`,
           'https://nodejs.org 에서 최신 LTS를 설치하세요.');
}

function checkDeps() {
  try {
    // 빌더와 똑같은 방식으로 불러 본다. package.json 하위 경로를 직접 요구하면
    // exports 맵에 막혀서 멀쩡한 설치를 없다고 오판한다.
    const req = createRequire(path.join(SKILL_DIR, 'vendor', 'package.json'));
    req('pptxgenjs');
    let v = '';
    try { v = JSON.parse(fs.readFileSync(
      path.join(SKILL_DIR, 'vendor', 'node_modules', 'pptxgenjs', 'package.json'), 'utf8')).version; } catch { /* 버전은 부가 정보 */ }
    add('PPTX 생성기', 'ok', v ? `pptxgenjs ${v}` : 'pptxgenjs 사용 가능');
  } catch {
    add('PPTX 생성기', 'fail', 'pptxgenjs를 찾을 수 없습니다',
        `bash ${path.join(SKILL_DIR, 'scripts', 'setup-deps.sh')}`);
  }
}

function checkPython() {
  try {
    const v = execFileSync('python3', ['--version'], { encoding: 'utf8' }).trim();
    add('브랜드 추출(python3)', 'ok', v);
  } catch {
    add('브랜드 추출(python3)', 'warn', 'python3가 없습니다',
        '레퍼런스에서 브랜드를 자동 추출할 때만 필요합니다. 기존 토큰을 쓰면 없어도 됩니다.');
  }
}

/**
 * 사진 폴더를 점검한다. 개수만 세지 않고 실제로 열어 본다.
 * macOS는 폴더 접근 권한(TCC) 때문에 목록은 보이는데 읽기는 막히는 경우가 있다.
 */
function checkImages(dir) {
  if (!dir) { add('사진 폴더', 'warn', '지정하지 않았습니다', '사진 없이 진행하면 이미지 자리는 비워집니다.'); return; }
  const abs = path.resolve(dir.replace(/^~/, process.env.HOME || '~'));
  if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) {
    add('사진 폴더', 'fail', `폴더를 찾을 수 없습니다: ${abs}`, '경로를 다시 확인해 주세요.');
    return;
  }
  const names = fs.readdirSync(abs).filter((n) => !n.startsWith('.') && IMG_EXT.has(path.extname(n).toLowerCase()));
  if (!names.length) {
    add('사진 폴더', 'warn', `${abs} 안에 사진이 없습니다`, 'png/jpg/gif/webp 파일이 있는 폴더를 지정하세요.');
    return;
  }
  const unreadable = [];
  let bytes = 0;
  for (const n of names) {
    const f = path.join(abs, n);
    try {
      const fd = fs.openSync(f, 'r');      // 목록에 보이는 것과 읽히는 것은 다르다
      fs.closeSync(fd);
      bytes += fs.statSync(f).size;
    } catch (err) {
      unreadable.push(`${n} (${err.code || err.message})`);
    }
  }
  const mb = (bytes / 1024 / 1024).toFixed(0);
  if (!unreadable.length) {
    add('사진 폴더', 'ok', `${names.length}장 전부 읽힘 (${mb}MB)`);
  } else {
    add('사진 폴더', 'warn',
        `${names.length}장 중 ${unreadable.length}장을 읽을 수 없습니다: ${unreadable.slice(0, 3).join(', ')}` +
        (unreadable.length > 3 ? ' 외' : ''),
        'macOS 시스템 설정 > 개인정보 보호 및 보안 > 파일 및 폴더에서 터미널에 접근을 허용하거나, ' +
        '해당 사진을 폴더에서 빼세요. 읽히지 않는 사진은 갤러리에서 건너뜁니다.');
  }
}

/** 플랜 파일이 실제로 쓸 수 있는 모양인지 본다. */
function checkPlan(p) {
  if (!p) { add('슬라이드 플랜', 'warn', '지정하지 않았습니다', '먼저 구성안을 만든 뒤 미리보기를 띄웁니다.'); return; }
  const abs = path.resolve(p.replace(/^~/, process.env.HOME || '~'));
  if (!fs.existsSync(abs)) { add('슬라이드 플랜', 'fail', `파일이 없습니다: ${abs}`, '경로를 확인하세요.'); return; }
  let plan;
  try { plan = JSON.parse(fs.readFileSync(abs, 'utf8')); }
  catch (err) { add('슬라이드 플랜', 'fail', `JSON을 읽을 수 없습니다: ${err.message}`, '파일이 깨졌는지 확인하세요.'); return; }
  if (!Array.isArray(plan.slides) || !plan.slides.length) {
    add('슬라이드 플랜', 'fail', 'slides 배열이 비어 있습니다', '구성안을 다시 만드세요.');
    return;
  }
  const noTitle = plan.slides.filter((s) => !String(s.title || '').trim()).length;
  const detail = `${plan.slides.length}장` + (noTitle ? ` (제목 없는 장 ${noTitle}개)` : '');
  add('슬라이드 플랜', noTitle ? 'warn' : 'ok', detail,
      noTitle ? '제목이 빈 장은 미리보기에서 채울 수 있습니다.' : '');
}

async function checkPort(port) {
  if (!(await portInUse(port))) { add('포트', 'ok', `${port} 사용 가능`); return; }
  // 이미 우리 미리보기가 떠 있는 것과, 남의 프로그램이 물고 있는 것은 다르다.
  let mine = false;
  try {
    const r = await fetch(`http://127.0.0.1:${port}/ping`, { signal: AbortSignal.timeout(700) });
    mine = r.ok && (await r.text()).includes('merry-slide');
  } catch { /* 응답이 없으면 남의 것으로 본다 */ }
  if (mine) {
    add('포트', 'warn', `${port}에 미리보기가 이미 떠 있습니다`,
        '그대로 쓰려면 브라우저에서 열면 됩니다. 새로 띄우려면 먼저 끄세요: pkill -f preview-composition.mjs');
  } else {
    add('포트', 'fail', `${port}를 다른 프로그램이 쓰고 있습니다`,
        '--port 로 다른 번호를 지정하세요.');
  }
}

function checkOut(dir) {
  const abs = path.resolve((dir || path.join(process.env.HOME || '.', 'merry-demo'))
    .replace(/^~/, process.env.HOME || '~'));
  try {
    fs.mkdirSync(abs, { recursive: true });
    const probe = path.join(abs, '.write-probe');
    fs.writeFileSync(probe, 'x');           // 쓸 수 있다고 가정하지 말고 실제로 써 본다
    fs.unlinkSync(probe);
    add('산출물 폴더', 'ok', abs);
  } catch (err) {
    add('산출물 폴더', 'fail', `${abs} 에 쓸 수 없습니다 (${err.code || err.message})`,
        '다른 폴더를 --out 으로 지정하세요.');
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  checkNode();
  checkDeps();
  checkPython();
  checkImages(args.images);
  checkPlan(args.plan);
  await checkPort(args.port);
  checkOut(args.out);

  const fails = checks.filter((c) => c.status === 'fail');
  const warns = checks.filter((c) => c.status === 'warn');

  if (args.json) {
    console.log(JSON.stringify({ ok: !fails.length, checks }, null, 2));
  } else {
    const mark = { ok: '✓', warn: '!', fail: '✗' };
    console.log('\n준비 상태 점검\n');
    for (const c of checks) {
      console.log(`  ${mark[c.status]} ${c.name.padEnd(18, ' ')} ${c.detail}`);
      if (c.fix && c.status !== 'ok') console.log(`      → ${c.fix}`);
    }
    console.log('');
    if (fails.length) console.log(`막힌 곳 ${fails.length}개를 먼저 해결해야 합니다.\n`);
    else if (warns.length) console.log(`진행할 수 있습니다. 확인할 것 ${warns.length}개가 있습니다.\n`);
    else console.log('전부 통과했습니다.\n');
  }
  process.exit(fails.length ? 1 : 0);
}

main();
