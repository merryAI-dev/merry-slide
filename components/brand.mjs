/**
 * 브랜드 팩 로더 — extract-brand.py가 만든 brand.json을 T 토큰으로 주입한다.
 *
 * 이 파일이 없으면 파이프라인은 "추출 → 문서"에서 끊긴다. 추출 결과가 사람이
 * 읽는 tokens.md로만 남고, 빌더는 기본 토큰만 쓰기 때문이다.
 * 여기서 그 간극을 잇는다: --brand <이름|경로> → brand.json → T 덮어쓰기.
 *
 * 원칙:
 * - 기본 T를 "구조의 원본"으로 삼는다. 검증된 배치 비율을 새 캔버스에 스케일한다.
 * - brand.json에 실측값이 있으면(헤더 룰, 콘텐츠 경계, 표 행높이) 스케일값보다 우선한다.
 * - 실측이 없는 항목은 지어내지 않고 기본 비율을 따른다. 온보딩 화면에서 사람이
 *   확인하고 고치는 것이 이 스킬의 방식이다.
 */

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { T } from './base.mjs';

const SELF_DIR = path.dirname(fileURLToPath(import.meta.url));
const SKILL_DIR = path.resolve(SELF_DIR, '..');

/** 기본 캔버스. 모든 기존 좌표의 기준이므로 T가 바뀌기 전에 고정해 둔다. */
const BASE = { w: 11.693, h: 8.267 };

/** brand.json을 찾는다: 경로 그대로 → references/brands/<이름> → ~/.merry-slide/brands/<이름> */
export function resolveBrand(nameOrPath) {
  const cands = [];
  const p = nameOrPath.replace(/^~/, os.homedir());
  if (p.endsWith('.json')) cands.push(p);
  cands.push(
    path.join(p, 'brand.json'),
    path.join(SKILL_DIR, 'references', 'brands', nameOrPath, 'brand.json'),
    path.join(os.homedir(), '.merry-slide', 'brands', nameOrPath, 'brand.json'),
  );
  for (const c of cands) if (fs.existsSync(c)) return path.resolve(c);
  throw new Error(
    `브랜드를 찾을 수 없습니다: ${nameOrPath}\n` +
    `  확인한 위치:\n${cands.map((c) => `    ${c}`).join('\n')}\n` +
    `  먼저 추출하세요: python3 scripts/extract-brand.py 레퍼런스.pptx --name <이름> --out references/brands`,
  );
}

const isHex = (v) => /^[0-9A-Fa-f]{6}$/.test(v || '');
/** 무채색(검정/흰색/회색)은 브랜드 색이 아니다. */
function isChromatic(hex) {
  if (!isHex(hex)) return false;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16));
  return Math.max(r, g, b) - Math.min(r, g, b) > 24;
}

/** 팔레트에서 역할 색을 뽑는다. 못 찾은 역할은 기본 색을 유지하지 않고 primary 계열로 통일한다. */
function deriveColors(brand) {
  const fills = (brand.palette?.fill || []).filter((c) => isChromatic(c.hex));
  const texts = (brand.palette?.text || []).filter((c) => isChromatic(c.hex));

  // primary: 도형 fill 최빈 유채색. 없으면 텍스트 최빈 유채색.
  const primary = fills[0]?.hex || texts[0]?.hex || T.color.navy;
  // accent: primary와 다른 다음 후보. 없으면 표 헤더 색이 그 브랜드의 두 번째
  // 색인 경우가 많다(예: 그린 브랜드의 라임 헤더). 그것도 없으면 primary.
  const headFill = isHex(brand.table?.headFill) ? brand.table.headFill : '';
  const accent =
    [...texts, ...fills].map((c) => c.hex).find((h) => h !== primary) ||
    (isChromatic(headFill) && headFill !== primary ? headFill : primary);
  // 표 헤더 fill 실측이 있으면 tint로 쓴다.
  const tint = headFill || accent;

  return {
    ...T.color,
    navy: primary, navyDeep: primary, navyMid: primary,
    cyan: accent, cyanLabel: accent,
    cyanTint: tint, cyanTintStrong: tint,
    headerBandFrom: primary, headerBandTo: primary,
    rule: primary,
  };
}

/**
 * 배치를 새 캔버스로 유도한다.
 * x축 값은 폭 비율로, y축 값은 높이 비율로 스케일하고, 실측(헤더 룰·콘텐츠 경계·표)이
 * 있으면 그 값으로 덮는다. 좌우 폭은 헤더 룰이 곧 본문 폭이라는 관찰 규칙을 그대로 쓴다.
 */
function deriveLayout(brand) {
  const cw = brand.canvas?.w || BASE.w;
  const ch = brand.canvas?.h || BASE.h;
  const sx = cw / BASE.w;
  const sy = ch / BASE.h;
  const X = (v) => Number((v * sx).toFixed(3));
  const Y = (v) => Number((v * sy).toFixed(3));

  const rule = brand.header?.rule;                    // 실측 헤더 룰
  const fullX = rule?.x ?? X(T.grid.full.x);
  const fullW = rule?.w ?? X(T.grid.full.w);
  const contentTop = brand.grid?.contentTop ?? Y(T.header.contentTop);
  const bottom = brand.grid?.bottom ?? Y(T.grid.bottom);
  const bandH = brand.header?.bandH ?? Y(T.header.bandH);
  const ruleY = rule?.y ?? Y(T.header.rule.y);

  const colW = Number(((fullW - X(T.col.gutter)) / 2).toFixed(3));
  const gap = Number((fullW - colW * 2).toFixed(3));

  return {
    canvas: { w: cw, h: ch },
    header: {
      bandH,
      sectionLabel: { x: X(0.657), y: bandH * 0.53, w: X(1.586), h: 0.328 },
      subLabel: { x: X(2.928), y: bandH * 0.57, w: X(5.431), h: 0.336 },
      pageBadge: { x: fullX + fullW - X(1.062), y: bandH * 0.64, w: X(1.062), h: 0.26 },
      lead: { x: fullX, y: (bandH + ruleY) / 2 - 0.168, w: fullW - X(0.545), h: 0.336 },
      rule: { x: fullX, y: ruleY, w: fullW, pt: rule ? 0.5 : T.header.rule.pt },
      contentTop,
    },
    body: { x: fullX, y: contentTop, w: fullW, bottom: bottom - 0.04 },
    col: { w: colW, gutter: gap },
    grid: {
      ...T.grid,
      intro: { x: fullX + 0.02, y: contentTop - 0.09, w: fullW - 0.034, h: Y(T.grid.intro.h) },
      pillTop: contentTop + Y(T.grid.pillTop - T.header.contentTop),
      pillTopBare: contentTop + Y(T.grid.pillTopBare - T.header.contentTop),
      bottom,
      col: { left: fullX, right: fullX + colW + gap, w: colW },
      full: { x: fullX, w: fullW },
      table: {
        headH: brand.table?.headH ?? T.grid.table.headH,
        rowH: brand.table?.bodyH ?? T.grid.table.rowH,
      },
    },
    stat: { ...T.stat, x0: X(T.stat.x0), colPitch: X(T.stat.colPitch), rows: T.stat.rows.map(Y) },
  };
}

/**
 * brand.json을 T에 주입한다. T는 객체 하나를 모두가 참조하므로
 * 속성을 바꿔치기하면 빌더·프리뷰·컴포넌트 전부에 즉시 반영된다.
 * 반환값은 온보딩 화면이 쓸 요약이다.
 */
export function applyBrand(nameOrPath) {
  const file = resolveBrand(nameOrPath);
  const brand = JSON.parse(fs.readFileSync(file, 'utf8'));
  const layout = deriveLayout(brand);
  const color = deriveColors(brand);

  const bodySize = (brand.font?.sizes || [])
    .filter((s) => s.pt >= 9 && s.pt <= 13.5)
    .sort((a, b) => b.count - a.count)[0]?.pt;

  Object.assign(T, {
    canvas: layout.canvas,
    color,
    font: {
      ...T.font,
      family: brand.font?.family || T.font.family,
      ...(bodySize ? { body: bodySize } : {}),
    },
    header: layout.header,
    body: layout.body,
    col: layout.col,
    grid: layout.grid,
    stat: layout.stat,
    // 표지/간지: 컴포넌트가 이 플래그를 보고 팔레트 기반으로 그린다.
    cover: { image: false, base: color.navy, accent: color.cyan },
  });

  return { file, brand, name: brand.brand || nameOrPath };
}
