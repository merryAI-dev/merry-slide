#!/usr/bin/env node
/**
 * 확정된 slide_plan.json을 편집 가능한 PPTX로 조립한다. (Stage 4A)
 *
 * CP3 프리뷰에서 내려받은 `slide_plan.confirmed.json`을 그대로 입력으로 받는다.
 * 프리뷰에서 본 배치와 같은 좌표를 쓰므로 확정한 모습이 그대로 덱이 된다.
 *
 *   node components/build-from-plan.mjs --plan slide_plan.confirmed.json --out deck.pptx
 *
 * 형식별 content 구조는 references/composition-format.md 참고.
 * 표·텍스트·도형은 PowerPoint 네이티브 객체로 남아 사용자가 직접 수정할 수 있다.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { applyLayout, coverSlide, sectionDivider, T, ASSET_DIR } from './base.mjs';
import { startRun, endRun } from '../scripts/worklog.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = path.resolve(HERE, '..');
const DEFAULT_OUT = 'merry-slide-deck.pptx';

/**
 * 배치 격자는 base.mjs의 토큰에서 가져온다.
 * 프리뷰도 같은 토큰을 읽으므로 확정한 모습과 결과가 어긋나지 않는다.
 */
const L = { band: T.header.bandH, ...T.grid };

function usage() {
  console.log(`사용법:
  node build-from-plan.mjs --plan slide_plan.confirmed.json --out deck.pptx

옵션:
  --plan   확정된 slide_plan JSON 경로. 생략하면 현재 폴더와 ~/Downloads에서
           slide_plan.confirmed.json을 자동으로 찾습니다.
  --out    출력 .pptx 경로. 기본값은 ${DEFAULT_OUT}입니다.
  --title  덱 메타데이터 제목. 없으면 plan의 title을 씁니다.
  --images 이미지 폴더. page_<슬라이드번호>.png|jpg 를 찾아 그 장의 이미지 자리에
           채웁니다. 프리뷰에서 이미 고른 이미지가 있으면 그쪽이 우선합니다.
  --drop-empty-figures
           사진이 없는 이미지 자리를 빗금 박스로 남기지 않고 지웁니다. 한 줄이
           통째로 비면 그 공간까지 콘텐츠가 차지합니다. 최종본을 낼 때 씁니다.

지원 형식: 표지, 목차, 간지, 좌우 2단, 표 중심, 전폭 도식, 숫자 강조, 단계 흐름, 차트(막대/선/파이/도넛/간트)
`);
}

/**
 * 확정 파일을 알아서 찾는다.
 *
 * 프리뷰의 `확정 저장`은 브라우저 다운로드라 보통 ~/Downloads에 떨어진다.
 * 사용자가 파일을 옮기거나 경로를 알려주지 않아도 되도록 여기서 찾는다.
 */
function discoverPlan(explicit) {
  if (explicit) return explicit;
  const home = process.env.HOME || '';
  const candidates = [
    path.join(process.cwd(), 'slide_plan.confirmed.json'),
    path.join(home, 'Downloads', 'slide_plan.confirmed.json'),
    path.join(process.cwd(), 'slide_plan.json'),
  ].filter(Boolean);

  const found = candidates
    .filter((p) => fs.existsSync(p))
    .map((p) => ({ p, mtime: fs.statSync(p).mtimeMs }))
    .sort((a, b) => b.mtime - a.mtime);

  if (!found.length) {
    throw new Error([
      'slide_plan을 찾을 수 없습니다.',
      '프리뷰에서 "확정 저장"을 눌렀는지 확인하거나 --plan으로 경로를 지정하세요.',
      `확인한 위치: ${candidates.join(' / ')}`,
    ].join(' '));
  }
  return found[0].p;
}

function parseArgs(argv) {
  const args = { plan: '', out: DEFAULT_OUT, title: '', images: '', dropEmpty: false };
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
    } else if (key === '--images') {
      args.images = value || ''; i += 1;
    } else if (key === '--drop-empty-figures') {
      args.dropEmpty = true;
    } else if (key === '--brand') {
      args.brand = value || ''; i += 1;
    } else {
      throw new Error(`알 수 없는 인자입니다: ${key}`);
    }
  }
  return args;
}

function loadPptxGenJS() {
  const attempts = [
    () => createRequire(path.join(process.cwd(), 'package.json'))('pptxgenjs'),
    () => createRequire(path.join(SKILL_DIR, 'vendor', 'package.json'))('pptxgenjs'),
    () => createRequire(path.join(SKILL_DIR, 'package.json'))('pptxgenjs'),
  ];
  for (const attempt of attempts) {
    try {
      return attempt();
    } catch { /* 다음 후보 */ }
  }
  throw new Error('pptxgenjs를 찾을 수 없습니다. 먼저 bash scripts/setup-deps.sh를 실행하세요.');
}

/* ── 본문 슬라이드 공통 요소 ─────────────────────────────────── */

/** 헤더 밴드 + 대분류 + 쪽수 + 제목줄 + 구분선 + 리드 문단 */
function chrome(pptx, slide, s, index) {
  const c = s.content || {};

  slide.addShape(pptx.ShapeType.rect, {
    x: 0, y: 0, w: T.canvas.w, h: L.band,
    fill: { color: T.color.headerBandTo }, line: { type: 'none' },
  });

  if (c.section) {
    slide.addText(c.section, {
      x: 0.657, y: 0.42, w: 2.4, h: 0.328,
      fontFace: T.font.family, fontSize: 15, bold: true, color: T.color.white,
      valign: 'middle', margin: 0,
    });
  }

  slide.addText(`${String(index + 1).padStart(2, '0')} 쪽`, {
    x: 9.9, y: 0.505, w: 1.18, h: 0.26,
    fontFace: T.font.family, fontSize: 10, bold: true, color: T.color.white,
    align: 'right', valign: 'middle', margin: 0,
  });

  const lead = [];
  if (c.label) {
    lead.push({ text: c.label, options: { color: T.color.cyanLabel, bold: true } });
    lead.push({ text: ' ｜ ', options: { color: T.color.navyMid, bold: true } });
  }
  lead.push({ text: s.title || '', options: { color: T.color.navy, bold: true } });
  slide.addText(lead, {
    x: 0.55, y: 0.9, w: 10.45, h: 0.42,
    fontFace: T.font.family, fontSize: 14.5, valign: 'middle', margin: 0,
  });

  slide.addShape(pptx.ShapeType.line, {
    x: T.header.rule.x, y: T.header.rule.y, w: T.header.rule.w, h: 0,
    line: { color: T.color.rule, width: T.header.rule.pt },
  });

  checkFit(index + 1, '제목줄', s.title, 10.45 - (c.label ? 2.2 : 0), 0.42, 14.5, 1.2);

  if (c.intro) {
    checkFit(index + 1, '리드 문단', c.intro, L.intro.w, L.intro.h, 12, 1.35);
    slide.addText(c.intro, {
      x: L.intro.x, y: L.intro.y, w: L.intro.w, h: L.intro.h,
      fontFace: T.font.family, fontSize: 12, color: '1A2233',
      lineSpacingMultiple: 1.35, valign: 'top', margin: 0,
    });
  }
}

/** 네이비 pill 소제목 */
function pill(pptx, slide, text, x, y, w) {
  // 텍스트 없는 pill은 그냥 빈 네이비 바다. content.pill을 안 쓴 형식(예: 숫자 강조)에서
  // 그런 바가 생기지 않도록 여기서 한 번에 막는다.
  if (!String(text ?? '').trim()) return;
  slide.addShape(pptx.ShapeType.roundRect, {
    x, y, w, h: T.pill.h,
    fill: { color: T.color.navy }, line: { type: 'none' }, rectRadius: T.pill.radius,
  });
  slide.addText(text || '', {
    x, y, w, h: T.pill.h,
    fontFace: T.font.family, fontSize: 12, color: T.color.white,
    align: 'center', valign: 'middle', margin: 0,
  });
}

/** 삼각형 마커 불릿. 레퍼런스는 원형 불릿 대신 작은 삼각형을 쓴다. */
function bullets(slide, items, x, y, w, h, slideNo) {
  const list = (items || []).filter(Boolean);
  if (!list.length) return;
  const totalLines = list.reduce((n, s) => n + lineCount(s, w - 0.19, 12), 0);
  if (totalLines * (12 / 72) * 1.45 > h + 0.05) {
    overflows.push({
      slide: slideNo, element: '본문 목록',
      needs_in: Math.round(totalLines * (12 / 72) * 1.45 * 100) / 100,
      has_in: Math.round(h * 100) / 100, lines: totalLines, text: `${list.length}개 항목`,
    });
  }
  slide.addText(
    list.map((t, i) => ({
      text: t,
      options: { breakLine: i < list.length - 1, bullet: { code: '25B8' } },
    })),
    {
      x, y, w, h,
      fontFace: T.font.family, fontSize: 12, color: '1A2233',
      lineSpacingMultiple: 1.25, paraSpaceAfter: 6, valign: 'top', margin: 0,
    },
  );
}

/** 하단 보조 설명 */
function note(slide, text, y) {
  if (!text) return;
  slide.addText(text, {
    x: L.full.x, y, w: L.full.w, h: 0.5,
    fontFace: T.font.family, fontSize: 10, color: '5B6678',
    lineSpacingMultiple: 1.3, valign: 'top', margin: 0,
  });
}

/**
 * 내용이 쓸 높이와 남는 하단 공간을 나눈다.
 * 남는 곳은 이미지 띠가 된다. 슬라이드 아래를 비워두지 않는 것이 이 톤의 기본이다.
 */
function splitBody(CT, naturalH, hasNote) {
  const avail = L.bottom - (hasNote ? L.noteH : 0) - CT;
  const h = Math.max(0.6, Math.min(naturalH, avail));
  const rest = avail - h - L.figGap;
  return { h, figY: CT + h + L.figGap, figH: rest > L.figMin ? rest : 0 };
}

/** n등분 좌표. 하단 이미지 띠를 위 도형과 같은 격자에 올린다. */
function evenCols(x0, total, n, gap) {
  const each = (total - gap * (n - 1)) / n;
  return Array.from({ length: n }, (_, i) => ({ x: x0 + i * (each + gap), w: each }));
}

/**
 * 하단 이미지 띠를 위 도형 개수만큼 나눠 그린다.
 * 위가 4칸이면 아래도 4칸. 격자가 어긋나면 슬라이드가 흐트러져 보인다.
 */
function figureRow(pptx, slide, c, cols, y, h) {
  if (!h) return;
  const arr = figuresOf(c);
  cols.forEach((col, i) => {
    if (DROP_EMPTY && !hasImage(arr[i])) { droppedSlots += 1; return; }
    figureBox(pptx, slide, orSlot(arr[i]), col.x, y, col.w, h);
  });
}

/** 선언된 이미지 자리가 없어도 남는 공간은 이미지 자리로 연다. */
const orSlot = (fig) => fig || { caption: '이미지 자리', hint: '사진을 넣어 주세요' };

/** 실제 사진이 들어 있는 자리인지. */
const hasImage = (fig) => Boolean(fig
  && (fig.data || (fig.assetId && ASSETS[fig.assetId]) || (fig.file && fs.existsSync(fig.file))));

/**
 * 이 슬라이드의 이미지 자리 목록.
 * 좌우 2단은 좌/우가 각자 하나씩이라 별도로 다룬다.
 */
const figuresOf = (c) => c.figures || (c.figure ? [c.figure] : []);

/**
 * 하단 이미지 띠를 열어야 하는지 판단한다.
 * --drop-empty-figures를 켰고 사진이 하나도 없으면 띠를 만들지 않는다.
 * 그 공간은 콘텐츠가 가져간다.
 */
let DROP_EMPTY = false;
let ASSETS = {};
let droppedSlots = 0;
const bandWanted = (figs) => !DROP_EMPTY || figs.some(hasImage);

/**
 * 이미지 자리.
 *
 * 이미지는 두 경로로 들어온다.
 *  1. 프리뷰에서 고른 경우 — fig.data에 data URL로 들어 있다
 *  2. --images 폴더 — page_<n>.png 규칙으로 찾아 fig.file에 채워둔다
 * 둘 다 없으면 무엇이 올 자리인지 표시만 한다.
 */
function figureBox(pptx, slide, fig, x, y, w, h) {
  if (!fig || h <= 0.2) return;

  const data = fig.data || (fig.assetId ? ASSETS[fig.assetId] : null);
  const src = data
    ? { data }
    : (fig.file && fs.existsSync(fig.file) ? { path: fig.file } : null);

  if (src) {
    // 자리 크기에 맞춰 늘리거나 줄여서 넣는다.
    // 원본을 잘라내지 않으므로 비율이 다르면 그만큼 변형된다.
    // 자리에 맞는 비율의 사진을 준비하는 편이 낫다.
    slide.addImage({ ...src, x, y, w, h });
    return;
  }
  slide.addShape(pptx.ShapeType.roundRect, {
    x, y, w, h,
    fill: { color: 'F4F8FC' },
    line: { color: '9FB4CC', width: 1, dashType: 'dash' },
    rectRadius: 0.06,
  });
  const runs = [{ text: fig.caption || '이미지', options: { fontSize: 10.5, bold: true } }];
  if (fig.hint) runs.push({ text: `\n${fig.hint}`, options: { fontSize: 9.5, color: '7B8EA3' } });
  slide.addText(runs, {
    x, y, w, h,
    fontFace: T.font.family, color: '5B7A99',
    align: 'center', valign: 'middle', margin: 0,
  });
}

/* ── 넘침 검사 ───────────────────────────────────────────────
   렌더해서 눈으로 보기 전에 좌표로 잡을 수 있는 넘침은 미리 잡는다.
   한글은 폭이 거의 일정해서 글자수로 줄 수를 꽤 정확히 추정할 수 있다. */

const overflows = [];

/** 12pt 한글 기준 1글자 폭 ≈ 0.167in. 영문·숫자는 절반으로 센다. */
function visualLen(text) {
  let n = 0;
  for (const ch of String(text)) n += /[\uAC00-\uD7A3\u3131-\u318E]/.test(ch) ? 1 : 0.55;
  return n;
}

/** 주어진 폭·글자크기에서 몇 줄이 되는지. */
function lineCount(text, widthIn, pt) {
  const perLine = widthIn / (pt / 72);
  return String(text).split('\n')
    .reduce((sum, line) => sum + Math.max(1, Math.ceil(visualLen(line) / perLine)), 0);
}

/** 텍스트가 상자를 넘치면 기록한다. 빌드는 계속하고 마지막에 함께 보고한다. */
function checkFit(slideNo, what, text, widthIn, heightIn, pt, lineMul = 1.35) {
  if (!text) return;
  const lines = lineCount(text, widthIn, pt);
  const needed = lines * (pt / 72) * lineMul;
  if (needed > heightIn + 0.02) {
    overflows.push({
      slide: slideNo, element: what,
      needs_in: Math.round(needed * 100) / 100,
      has_in: Math.round(heightIn * 100) / 100,
      lines,
      text: String(text).slice(0, 40),
    });
  }
}

/* ── 형식별 조립 ─────────────────────────────────────────────── */

function twoColumn(pptx, slide, c, PT, CT, slideNo) {
  const rows = Math.max(((c.left || {}).body || []).length,
    ((c.right || {}).body || []).length, 1);
  // 좌우는 각자의 figure를 쓰되, 프리뷰가 figures 배열로 넘긴 경우도 받는다.
  const arr = c.figures || [];
  // 실제 사진이 있는 쪽이 이긴다. 빈 자리표시자가 사진을 가리지 않게.
  const figFor = (side, i) => {
    const own = side && side.figure;
    if (hasImage(own)) return own;
    if (hasImage(arr[i])) return arr[i];
    return own || arr[i];
  };
  const sideFigs = [figFor(c.left, 0), figFor(c.right, 1)];
  const natural = bandWanted(sideFigs)
    ? rows * L.natural.bulletRow + L.natural.bulletPad
    : Number.POSITIVE_INFINITY;
  const sp = splitBody(CT, natural, Boolean(c.note));
  const side = (s, x, i) => {
    if (!s) return;
    pill(pptx, slide, s.pill, x, PT, L.col.w);
    bullets(slide, s.body, x, CT, L.col.w, sp.h, slideNo);
    if (!sp.figH) return;
    const fig = figFor(s, i);
    if (DROP_EMPTY && !hasImage(fig)) { droppedSlots += 1; return; }
    figureBox(pptx, slide, orSlot(fig), x, sp.figY, L.col.w, sp.figH);
  };
  side(c.left, L.col.left, 0);
  side(c.right, L.col.right, 1);
  note(slide, c.note, L.bottom - L.noteH + 0.14);
}

function tableSlide(pptx, slide, c, PT, CT, slideNo) {
  const t = c.table || { headers: [], rows: [] };
  const tw = L.full.w;
  const nrows = (t.rows || []).length || 1;
  const sp = splitBody(CT, bandWanted(figuresOf(c))
    ? L.table.headH + nrows * L.table.rowH : Number.POSITIVE_INFINITY, Boolean(c.note));
  const th = sp.h;
  pill(pptx, slide, c.pill, L.full.x, PT, tw);

  const cols = (t.headers || []).length || 1;
  const head = (t.headers || []).map((h) => ({
    text: String(h),
    options: { fill: { color: T.color.cyanTint }, bold: true, color: T.color.navy, align: 'center' },
  }));
  const body = (t.rows || []).map((r) => r.map((x, i) => ({
    text: String(x),
    options: i === 0 ? { bold: true, fill: { color: 'F7FBFE' } } : {},
  })));

  // 헤더는 한 줄로 고정하고 남는 높이는 본문 행이 흡수한다.
  const headH = 0.275;
  const bodyH = Math.max(0.2, (th - headH) / Math.max(body.length, 1));

  slide.addTable([head, ...body], {
    x: L.full.x, y: CT, w: tw,
    colW: Array.from({ length: cols }, () => tw / cols),
    rowH: [headH, ...body.map(() => bodyH)],
    fontFace: T.font.family, fontSize: T.font.dense,
    border: { type: 'solid', color: 'D9D9D9', pt: 0.5 },
    valign: 'middle', margin: 3,
  });

  figureRow(pptx, slide, c,
    evenCols(L.full.x, L.full.w, Math.max((t.headers || []).length, 1), L.rowGap.table),
    sp.figY, sp.figH);
  note(slide, c.note, L.bottom - L.noteH + 0.14);
}

function diagramSlide(pptx, slide, c, PT, CT, slideNo) {
  const flow = c.flow || [];
  pill(pptx, slide, c.pill, L.full.x, PT, L.full.w);
  const sp = splitBody(CT, bandWanted(figuresOf(c)) ? L.natural.flow : L.natural.flowMax, Boolean(c.note));
  const flowH = sp.h;

  if (flow.length) {
    const gap = 0.16;
    const each = (L.full.w - gap * (flow.length - 1)) / flow.length;
    flow.forEach((b, i) => {
      const x = L.full.x + i * (each + gap);
      slide.addShape(pptx.ShapeType.roundRect, {
        x, y: CT, w: each, h: flowH,
        fill: { color: 'FBFDFF' }, line: { color: 'CFD8E5', width: 1 }, rectRadius: 0.06,
      });
      slide.addText(
        [
          { text: b.head || '', options: { fontSize: 10.5, bold: true, color: T.color.navy, breakLine: true } },
          { text: b.body || '', options: { fontSize: 11, color: '28313F' } },
        ],
        {
          x: x + 0.1, y: CT + 0.1, w: each - 0.2, h: flowH - 0.2,
          fontFace: T.font.family, lineSpacingMultiple: 1.2, valign: 'top', margin: 0,
        },
      );
      // 레퍼런스에 화살표 커넥터가 없으므로 선이 아니라 문자로 방향만 표시한다.
      if (i < flow.length - 1) {
        slide.addText('›', {
          x: x + each, y: CT, w: gap, h: flowH,
          fontFace: T.font.family, fontSize: 18, bold: true, color: T.color.cyan,
          align: 'center', valign: 'middle', margin: 0,
        });
      }
    });
  }

  figureRow(pptx, slide, c,
    evenCols(L.full.x, L.full.w, Math.max(flow.length, 1), L.rowGap.flow), sp.figY, sp.figH);
  note(slide, c.note, L.bottom - L.noteH + 0.14);
}

function stepsSlide(pptx, slide, c, PT, CT, slideNo) {
  const steps = c.steps || [];
  const sp = splitBody(CT, bandWanted(figuresOf(c)) ? L.natural.steps : Number.POSITIVE_INFINITY, Boolean(c.note));
  pill(pptx, slide, c.pill, L.full.x, PT, L.full.w);

  if (steps.length) {
    const gap = 0.07;
    const each = (L.full.w - gap * (steps.length - 1)) / steps.length;
    steps.forEach((label, i) => {
      const x = L.full.x + i * (each + gap);
      slide.addShape(pptx.ShapeType.homePlate, {
        x, y: CT, w: each, h: 1.5,
        fill: { color: T.color.cyan }, line: { type: 'none' },
      });
      slide.addText(String(label), {
        x, y: CT, w: each, h: 1.5,
        fontFace: T.font.family, fontSize: 10.5, bold: true, color: T.color.navy,
        align: 'center', valign: 'middle', margin: 0,
      });
    });
  }

  figureRow(pptx, slide, c,
    evenCols(L.full.x, L.full.w, Math.max(steps.length, 1), L.rowGap.steps), sp.figY, sp.figH);
  note(slide, c.note, L.bottom - L.noteH + 0.14);
}

function statsSlide(pptx, slide, c, PT, CT, slideNo) {
  const stats = c.stats || [];
  const sp = splitBody(CT, bandWanted(figuresOf(c)) ? L.natural.stats : Number.POSITIVE_INFINITY, Boolean(c.note));
  pill(pptx, slide, c.pill, L.full.x, PT, L.full.w);

  const gap = L.full.w / Math.max(stats.length, 1);
  stats.forEach((s, i) => {
    const x = L.full.x + i * gap;
    const w = gap - 0.2;
    slide.addText(s.label || '', {
      x, y: CT, w, h: 0.4,
      fontFace: T.font.family, fontSize: T.font.statLabel, color: '000000',
      valign: 'bottom', margin: 0,
    });
    const runs = [{ text: String(s.value ?? ''), options: { fontSize: T.font.statNumber, bold: true } }];
    if (s.unit) runs.push({ text: ` ${s.unit}`, options: { fontSize: T.font.statLabel } });
    if (s.note) runs.push({ text: ` (${s.note})`, options: { fontSize: T.font.statNote } });
    slide.addText(runs, {
      x, y: CT + 0.42, w, h: 0.72,
      fontFace: T.font.family, color: '000000', valign: 'top', margin: 0,
    });
  });

  figureRow(pptx, slide, c,
    evenCols(L.full.x, L.full.w, Math.max(stats.length, 1), L.rowGap.stats), sp.figY, sp.figH);
  note(slide, c.note, L.bottom - L.noteH + 0.14);
}

/**
 * 차트. PowerPoint 네이티브 차트로 넣어 사용자가 데이터를 직접 고칠 수 있게 한다.
 * 이미지로 굽지 않는다. 발표 직전 숫자가 바뀌는 일이 흔하다.
 */
function chartSlide(pptx, slide, c, PT, CT, slideNo) {
  const ch = c.chart || {};
  const sp = splitBody(CT, bandWanted(figuresOf(c)) ? L.natural.chart : Number.POSITIVE_INFINITY,
    Boolean(c.note));
  pill(pptx, slide, c.pill, L.full.x, PT, L.full.w);

  if (ch.type === 'gantt') {
    ganttChart(pptx, slide, ch.gantt || {}, L.full.x, CT, L.full.w, sp.h);
    figureRow(pptx, slide, c,
      evenCols(L.full.x, L.full.w, Math.max(((ch.gantt || {}).rows || []).length || 1, 1), L.rowGap.stats),
      sp.figY, sp.figH);
    note(slide, c.note, L.bottom - L.noteH + 0.14);
    return;
  }

  const kind = { bar: 'bar', column: 'bar', line: 'line', pie: 'pie', doughnut: 'doughnut' }[ch.type] || 'bar';
  const series = (ch.series || []).map((s) => ({
    name: s.name || '',
    labels: ch.categories || [],
    values: (s.values || []).map(Number),
  }));

  if (series.length) {
    // 팔레트는 관찰된 브랜드 색에서 가져온다. 임의의 무지개색을 쓰지 않는다.
    const colors = [T.color.navy, T.color.cyan, T.color.navyMid, T.color.cyanTintStrong];
    slide.addChart(pptx.ChartType[kind], series, {
      x: L.full.x, y: CT, w: L.full.w, h: sp.h,
      chartColors: colors.slice(0, Math.max(series.length, kind === 'pie' || kind === 'doughnut'
        ? (ch.categories || []).length : 1)),
      showLegend: series.length > 1,
      legendPos: 'b',
      legendFontFace: T.font.family,
      legendFontSize: 10,
      showValue: kind !== 'line',
      dataLabelPosition: kind === 'bar' ? 'outEnd' : 'ctr',
      dataLabelFontFace: T.font.family,
      dataLabelFontSize: 9,
      catAxisLabelFontFace: T.font.family,
      catAxisLabelFontSize: 10,
      catAxisLabelColor: '5B6678',
      valAxisLabelFontFace: T.font.family,
      valAxisLabelFontSize: 10,
      valAxisLabelColor: '5B6678',
      valGridLine: { color: 'E4E9F1', size: 0.5 },
      catGridLine: { style: 'none' },
      border: { pt: 0, color: 'FFFFFF' },
    });
  } else {
    slide.addText('차트 데이터가 없습니다.', {
      x: L.full.x, y: CT, w: L.full.w, h: sp.h,
      fontFace: T.font.family, fontSize: 12, color: 'A33333',
      align: 'center', valign: 'middle', margin: 0,
    });
  }

  figureRow(pptx, slide, c,
    evenCols(L.full.x, L.full.w, Math.max((ch.categories || []).length || 1, 1), L.rowGap.stats),
    sp.figY, sp.figH);
  note(slide, c.note, L.bottom - L.noteH + 0.14);
}

/**
 * 간트차트. 누적 가로 막대로 만든다 — 시작 구간은 투명, 기간 구간만 브랜드 색.
 * PowerPoint/엑셀에서 간트차트를 만드는 표준 방식이며, 네이티브 차트라 일정이
 * 바뀌면 사용자가 셀 값만 고치면 된다.
 */
function ganttChart(pptx, slide, gantt, x, y, w, h) {
  const rows = gantt.rows || [];
  if (!rows.length) {
    slide.addText('일정 데이터가 없습니다.', {
      x, y, w, h, fontFace: T.font.family, fontSize: 12, color: 'A33333',
      align: 'center', valign: 'middle', margin: 0,
    });
    return;
  }
  // 첫 행이 위로 오도록 뒤집는다. 가로 막대 차트는 아래→위 순서로 그린다.
  const ordered = [...rows].reverse();
  const max = gantt.maxUnit || Math.max(...rows.map((r) => r.start + r.duration));

  const series = [
    { name: '시작', labels: ordered.map((r) => r.label), values: ordered.map((r) => r.start) },
    { name: '기간', labels: ordered.map((r) => r.label), values: ordered.map((r) => r.duration) },
  ];

  slide.addChart(pptx.ChartType.bar, series, {
    x, y, w, h,
    barDir: 'bar', barGrouping: 'stacked',
    chartColors: ['FFFFFF', T.color.navy],
    showLegend: false,
    showValue: false,
    valAxisMinVal: 0, valAxisMaxVal: max,
    valAxisTitle: gantt.unit || '',
    showValAxisTitle: Boolean(gantt.unit),
    catAxisLabelFontFace: T.font.family,
    catAxisLabelFontSize: 10.5,
    catAxisLabelColor: '1A2233',
    valAxisLabelFontFace: T.font.family,
    valAxisLabelFontSize: 9,
    valAxisLabelColor: '5B6678',
    valGridLine: { color: 'E4E9F1', size: 0.5 },
    catGridLine: { style: 'none' },
    border: { pt: 0, color: 'FFFFFF' },
  });
}

function tocSlide(pptx, s) {
  const slide = pptx.addSlide();
  slide.background = { color: T.color.white };
  slide.addText(s.title || '목차', {
    x: 3.2, y: 0.8, w: 4, h: 0.8,
    fontFace: T.font.family, fontSize: 32, bold: true, color: T.color.navy, margin: 0,
  });
  const items = (s.content || {}).items || [];
  items.forEach((t, i) => {
    const y = 1.9 + i * 0.62;
    slide.addText(String(i + 1), {
      x: 3.3, y, w: 0.5, h: 0.5,
      fontFace: T.font.family, fontSize: 18, bold: true, color: T.color.cyan,
      valign: 'middle', margin: 0,
    });
    slide.addText(t, {
      x: 3.9, y, w: 5.3, h: 0.5,
      fontFace: T.font.family, fontSize: 16, bold: true, color: T.color.navyDeep,
      valign: 'middle', margin: 0,
    });
    slide.addShape(pptx.ShapeType.line, {
      x: 3.2, y: y + 0.5, w: 6, h: 0,
      line: { color: 'DBE4EE', width: 0.5 },
    });
  });
  return slide;
}

/** 이미지 자리 집계 */
function countFigures(plan, pred) {
  let n = 0;
  plan.slides.forEach((s) => {
    const c = s.content || {};
    [...(c.figures || []), c.figure, c.left && c.left.figure, c.right && c.right.figure]
      .filter(Boolean).forEach((f) => { if (pred(f)) n += 1; });
  });
  return n;
}

/* ── 조립 ────────────────────────────────────────────────────── */

function buildSlide(pptx, s, index) {
  const c = s.content || {};
  const f = s.layout;

  if (f === '표지') {
    return coverSlide(pptx, {
      title: s.title, subtitle: c.subtitle, entity: c.entity,
    });
  }
  if (f === '목차') return tocSlide(pptx, s);
  if (f === '간지') {
    return sectionDivider(pptx, { numeral: c.numeral, title: s.title, items: c.items });
  }

  const slide = pptx.addSlide();
  slide.background = { color: T.color.white };
  chrome(pptx, slide, s, index);

  const PT = c.intro ? L.pillTop : L.pillTopBare;
  const CT = PT + 0.44;

  const no = index + 1;
  if (f === '좌우 2단') twoColumn(pptx, slide, c, PT, CT, no);
  else if (f === '표 중심') tableSlide(pptx, slide, c, PT, CT, no);
  else if (f === '전폭 도식') diagramSlide(pptx, slide, c, PT, CT, no);
  else if (f === '단계 흐름') stepsSlide(pptx, slide, c, PT, CT, no);
  else if (f === '숫자 강조') statsSlide(pptx, slide, c, PT, CT, no);
  else if (f === '차트') chartSlide(pptx, slide, c, PT, CT, no);
  else {
    slide.addText(`지원하지 않는 형식입니다: ${f}`, {
      x: L.full.x, y: CT, w: L.full.w, h: 0.5,
      fontFace: T.font.family, fontSize: 12, color: 'A33333', margin: 0,
    });
  }
  return slide;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    usage();
    return;
  }
  // 브랜드 주입은 다른 무엇보다 먼저다. T를 읽는 코드가 돌기 전에 바꿔야 한다.
  if (args.brand) {
    const { applyBrand } = await import('./brand.mjs');
    const b = applyBrand(args.brand);
    console.error(`브랜드 적용: ${b.name} (${b.file})`);
  }
  const planPath = discoverPlan(args.plan);
  if (!fs.existsSync(planPath)) {
    throw new Error(`slide_plan을 찾을 수 없습니다: ${planPath}`);
  }

  let plan;
  try {
    plan = JSON.parse(fs.readFileSync(planPath, 'utf8'));
  } catch (error) {
    throw new Error(`slide_plan 파싱에 실패했습니다: ${error.message}`);
  }
  if (!Array.isArray(plan.slides) || !plan.slides.length) {
    throw new Error('slide_plan에 slides 배열이 없습니다.');
  }

  // --images 폴더에서 page_<n>.* 를 찾아 아직 비어 있는 자리에 채운다.
  const attached = [];
  if (args.images) {
    if (!fs.existsSync(args.images)) {
      throw new Error(`이미지 폴더를 찾을 수 없습니다: ${args.images}`);
    }
    const files = fs.readdirSync(args.images)
      .filter((n) => /^page[_-]\d+\.(png|jpe?g)$/i.test(n));
    const byNum = new Map();
    files.forEach((n) => byNum.set(Number.parseInt(n.match(/\d+/)[0], 10),
      path.resolve(args.images, n)));

    plan.slides.forEach((s, i) => {
      const file = byNum.get(i + 1);
      if (!file) return;
      const c = s.content || {};
      // 프리뷰가 여는 여러 칸 이미지 띠는 content.figures[]에 저장된다.
      // content.figure / left.figure / right.figure만 보면 그 자리들을 놓친다.
      const slot = [
        ...(Array.isArray(c.figures) ? c.figures : []),
        c.figure,
        c.left && c.left.figure,
        c.right && c.right.figure,
      ].filter(Boolean).find((fig) => !fig.data && !fig.file && !fig.assetId);
      if (slot) {
        slot.file = file;
        attached.push({ slide: i + 1, file: path.basename(file) });
      }
    });
  }

  const run = startRun('PPTX 생성', {
    플랜: planPath, 장수: plan.slides.length, 빈자리제거: args.dropEmpty ? '예' : '아니오',
  });

  DROP_EMPTY = args.dropEmpty;
  ASSETS = plan.assets || {};

  const PptxGenJS = loadPptxGenJS();
  const pptx = new PptxGenJS();
  applyLayout(pptx);
  const title = args.title || plan.title || 'Merry-slide deck';
  pptx.title = title;
  pptx.subject = title;
  pptx.author = 'Merry-slide';

  const unsupported = [];
  plan.slides.forEach((s, i) => {
    buildSlide(pptx, s, i);
    const known = ['표지', '목차', '간지', '좌우 2단', '표 중심', '전폭 도식', '숫자 강조', '단계 흐름', '차트'];
    if (!known.includes(s.layout)) unsupported.push({ number: i + 1, layout: s.layout });
  });

  const outPath = path.resolve(args.out);
  await pptx.writeFile({ fileName: outPath });

  console.log(JSON.stringify({
    output: outPath,
    plan: planPath,
    slides: plan.slides.length,
    canvas: T.canvas,
    images: {
      embedded: countFigures(plan, (f) => Boolean(f.data || f.assetId)),
      from_folder: attached.length,
      empty: countFigures(plan, (f) => !f.data && !f.assetId && !f.file),
      dropped_slots: droppedSlots,
    },
    unsupported,
    overflows,
  }, null, 2));

  endRun(run, {
    산출물: `\`${outPath}\``,
    사진: `${countFigures(plan, (f) => Boolean(f.data || f.assetId))}장 포함, ` +
          `빈 자리 ${countFigures(plan, (f) => !f.data && !f.assetId && !f.file)}개`,
    글자넘침: overflows.length ? `${overflows.length}건` : '없음',
    미지원형식: unsupported.length ? `${unsupported.length}건` : undefined,
  });

  if (overflows.length) {
    console.error(`\n넘침 ${overflows.length}건 — 슬라이드에서 직접 확인하세요:`);
    overflows.forEach((o) => console.error(
      `  ${o.slide}쪽 ${o.element}: ${o.needs_in}in 필요 / ${o.has_in}in 확보 (${o.lines}줄) "${o.text}…"`));
  }
}

main().catch((error) => {
  console.error(`build-from-plan.mjs: ${error.message}`);
  process.exit(1);
});
