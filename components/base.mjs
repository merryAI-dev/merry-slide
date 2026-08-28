/**
 * 기본(데모) 브랜드 네이티브 PPTX 컴포넌트.
 *
 * 구조(헤더 밴드, 리드 문단, 좁은 표 헤더, pill 소제목, stat 그리드)는 실제
 * 한국어 제안서 덱 실측에서 추출한 배치 문법이다. 색은 어떤 조직의 것도 아닌
 * 중립 팔레트다 — 실제 작업에서는 레퍼런스 2~3장에서 브랜드를 추출해
 * `--brand`로 주입한다 (scripts/extract-brand.py → components/brand.mjs).
 *
 * 캔버스 기본값은 A4 landscape(11.693 x 8.267in)다. 브랜드 팩이 16:9를
 * 쓰면 brand.mjs가 배치를 그 비율로 다시 유도한다.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

// 데모 브랜드는 이미지 자산이 없다. 표지·간지는 팔레트로 그린다.
export const ASSET_DIR = '';

/** 관찰된 디자인 토큰. 색상은 pptxgenjs 규칙대로 `#` 없는 6자리 hex. */
export const T = {
  canvas: { w: 11.693, h: 8.267 },

  /** 표지·간지 방식. 이미지 자산이 없으므로 팔레트 단색 + accent 바. */
  cover: { image: false, base: '24344D', accent: '5B9BD5' },

  color: {
    navy: '24344D',          // 주 색상 (헤더·pill·표지)
    navyDeep: '1B2838',
    navyMid: '33527A',       // 리드문 구분자, 소형 마커
    cyan: '5B9BD5',          // accent - 구조 화살표, 강조
    cyanLabel: '5B9BD5',     // 리드문 라벨
    cyanTintStrong: 'D6E4F0',// 태그/카드 배경
    cyanTint: 'D6E4F0',      // 표 헤더 fill
    yellow: 'FADE4B',        // 드문 하이라이트
    gray: '7F7F7F',          // 보조 설명
    white: 'FFFFFF',
    rule: '14213D',          // 헤더 구분선
    headerBandFrom: '1B2838',// 헤더 밴드 그라디언트 시작
    headerBandTo: '24344D',
  },

  font: {
    // 한국어 기본 제안. 대상 PC에 설치돼 있는지 온보딩 화면이 확인한다.
    family: 'Pretendard',
    coverYear: 48,      // Light
    sectionTitle: 44,   // Bold
    tocTitle: 32,
    lead: 14.5,         // Bold - 리드문
    headerLabel: 15,    // Bold - 좌상단 대분류
    headerSub: 14.5,    // Bold - 상단 소분류
    pageBadge: 10,      // Bold
    body: 12,           // 본문 최빈값
    dense: 9.7,         // 표/각주 (원본은 8.6~10.8 사용)
    statLabel: 10.8,
    statNumber: 30.2,
    statNote: 8.6,
  },

  /** 본문 슬라이드 헤더 기하 — 21개 슬라이드에서 좌표가 동일했다. */
  header: {
    bandH: 0.794,                                  // 상단 네이비 밴드 높이
    sectionLabel: { x: 0.657, y: 0.42, w: 1.586, h: 0.328 },
    subLabel:     { x: 2.928, y: 0.456, w: 5.431, h: 0.336 },
    pageBadge:    { x: 10.016, y: 0.505, w: 1.062, h: 0.26 },
    lead:         { x: 0.55, y: 0.935, w: 9.825, h: 0.336 },
    rule:         { x: 0.649, y: 1.343, w: 10.37, pt: 0.5 },
    contentTop:   1.55,                            // 본문 시작 y
  },

  /**
   * 본문 영역. 배치가 결과 품질을 좌우하므로 이 경계를 지킨다.
   * 좌측 0.65 / 우측 끝 11.01(폭 10.37, 헤더 룰과 정확히 동일) / 하단 7.58.
   */
  body: { x: 0.649, y: 1.55, w: 10.37, bottom: 7.58 },

  /** 2단 구성 (slide 7 등): 컬럼 5.095in, 거터 0.21in */
  col: { w: 5.095, gutter: 0.21 },

  /** 태그 pill 그리드 (slide 7 하단): 1.612 x 0.536, 간격 x 1.718 / y 0.636 */
  tag: { w: 1.612, h: 0.536, pitchX: 1.718, pitchY: 0.636 },

  /** 불릿 마커 삼각형 (slide 14): 0.226 x 0.095 */
  bulletMarker: { w: 0.226, h: 0.095 },

  /** 3열 stat 그리드 (slide 9 실측: 라벨 h=0.462, 숫자박스 h=0.68~0.753, 박스폭 1.373~1.385) */
  stat: {
    x0: 1.234, colPitch: 1.472, rows: [3.21, 4.772, 6.475],
    labelDy: -0.417, labelH: 0.462, valueH: 0.72, colW: 1.38,
  },

  pill: { h: 0.283, radius: 0.5 },

  /**
   * 본문 슬라이드 배치 격자. 프리뷰와 빌더가 같은 값을 읽어야 확정한 모습과 결과가 일치한다.
   * 좌표를 바꿀 일이 있으면 여기만 고친다.
   */
  grid: {
    intro: { x: 0.669, y: 1.46, w: 10.336, h: 0.86 },  // 리드 문단 150~200자 = 3~4줄
    pillTop: 2.42,          // 리드 문단이 있을 때 pill 상단
    pillTopBare: 1.72,      // 없을 때
    contentGap: 0.44,       // pill 아래 콘텐츠 시작까지
    bottom: 7.62,           // 콘텐츠 하단 한계
    noteH: 0.62,            // 하단 보조 설명이 차지하는 높이
    figGap: 0.16,           // 콘텐츠와 이미지 띠 사이
    figMin: 0.7,            // 이보다 좁으면 이미지 띠를 열지 않는다
    col: { left: 0.649, right: 5.954, w: 5.095 },
    full: { x: 0.649, w: 10.37 },
    table: { headH: 0.275, rowH: 0.44 },  // 헤더는 고정, 본문 행만 늘어난다
    // 형식별 콘텐츠의 자연 높이. 남는 공간은 하단 이미지 띠가 된다.
    natural: { bulletRow: 0.36, bulletPad: 0.12, flow: 2.4, steps: 1.5, stats: 1.35, chart: 3.4,
               // 이미지 띠가 없을 때 flow 박스가 바닥까지 늘어나 속이 비는 것을 막는 상한
               flowMax: 3.3 },
    // 하단 이미지 띠를 나눌 때 칸 사이 간격. 위 도형의 간격과 맞춘다.
    rowGap: { table: 0.08, flow: 0.16, steps: 0.07, stats: 0.2 },
  },
};

/** A4 landscape 레이아웃 등록. 슬라이드 추가 전에 호출해야 한다. */
export function applyLayout(pptx) {
  pptx.defineLayout({ name: 'BASE_A4', width: T.canvas.w, height: T.canvas.h });
  pptx.layout = 'BASE_A4';
  pptx.theme = { headFontFace: T.font.family, bodyFontFace: T.font.family };
  pptx.lang = 'ko-KR';
  return pptx;
}

/**
 * 표지 슬라이드.
 * @param {'blue'|'green'} variant 원본은 블루가 기본, 그린은 대안 표지에 사용
 */
export function coverSlide(pptx, { year, title, subtitle, entity, variant = 'blue' } = {}) {
  const slide = pptx.addSlide();
  slide.background = { color: T.color.navy };
  if (T.cover && T.cover.image === false) {
    // 단색 배경 + 하단 accent 바. 장식을 발명하지 않는 최소 구성이다.
    slide.addShape('rect', {
      x: 0, y: T.canvas.h - 0.12, w: T.canvas.w, h: 0.12,
      fill: { color: T.cover.accent }, line: { type: 'none' },
    });
  } else {
    slide.addImage({
      path: path.join(ASSET_DIR, `cover-gradient-${variant}.jpg`),
      x: 0, y: 0, w: T.canvas.w, h: T.canvas.h,
    });
  }

  if (year || title) {
    slide.addText(
      [
        ...(year ? [{ text: `${year}년 `, options: { fontSize: T.font.coverYear, bold: false } }] : []),
        ...(title ? [{ text: title, options: { fontSize: T.font.coverYear, bold: true } }] : []),
      ],
      {
        x: 0.578, y: 0.411, w: 6.168, h: 2.524,
        fontFace: T.font.family, color: T.color.white, valign: 'top', margin: 0,
      },
    );
  }

  if (subtitle) {
    // 원본 박스는 x=8.236 w=3.973 → 우측 끝 12.209로 캔버스(11.693)를 0.52in 넘는다.
    // 원본은 좌측정렬이라 텍스트가 보였지만, 우측정렬로 재현하면 밖으로 밀려 잘린다.
    // 폭(3.973)은 원본 그대로 두고 x만 당겨 캔버스 안에 넣는다.
    slide.addText(subtitle, {
      x: 7.5, y: 0.468, w: 3.973, h: 0.925,
      fontFace: T.font.family, fontSize: 14, color: T.color.white,
      align: 'right', valign: 'top', margin: 0,
    });
  }

  if (entity) {
    const entityColor = T.color.white;   // 표지 배경이 primary 단색이므로
    slide.addText(entity, {
      x: 0.578, y: 7.245, w: 4.595, h: 0.337,
      fontFace: T.font.family, fontSize: 14, bold: true, color: entityColor, margin: 0,
    });
  }


  return slide;
}

/**
 * 섹션 구분 슬라이드. 로마숫자 대형 워터마크 + 섹션명 + 하위 목차.
 */
export function sectionDivider(pptx, { numeral, title, items = [] } = {}) {
  const slide = pptx.addSlide();
  slide.background = { color: T.color.navy };
  if (T.cover && T.cover.image === false) {
    slide.addShape('rect', {
      x: 0, y: T.canvas.h - 0.12, w: T.canvas.w, h: 0.12,
      fill: { color: T.cover.accent }, line: { type: 'none' },
    });
  }

  if (numeral) {
    slide.addText(`${numeral}.`, {
      x: 0.435, y: 0.035, w: 6.481, h: 2.642,
      fontFace: T.font.family, fontSize: 150, color: T.color.white, margin: 0,
    });
  }
  if (title) {
    slide.addText(title, {
      x: 5.798, y: 0.496, w: 5.467, h: 0.858,
      fontFace: T.font.family, fontSize: T.font.sectionTitle, bold: true,
      color: T.color.white, margin: 0,
    });
  }
  if (items.length) {
    // 항목이 길어 줄이 늘면 세로 가운데 정렬 때문에 글이 위로 번져 제목을 덮는다.
    // 상단 정렬로 고정하고 남는 아래 공간까지 높이를 확보한다.
    slide.addText(
      items.map((t, i) => ({
        text: `${i + 1}. ${t}`,
        options: { breakLine: i < items.length - 1 },
      })),
      {
        x: 5.845, y: 1.713, w: T.canvas.w - 5.845 - 0.5, h: T.canvas.h - 1.713 - 0.6,
        fontFace: T.font.family, fontSize: 19.6, color: T.color.white,
        valign: 'top', margin: 0,
      },
    );
  }
  return slide;
}

/**
 * 본문 슬라이드 + 관찰된 헤더 블록을 그대로 재현한다.
 *
 * 헤더 구성: [네이비 밴드] 대분류 / 소분류 / 페이지배지 → 리드문 → 구분선
 *
 * @param {string} section    좌상단 대분류 (예: 'Ⅰ. 제안사 현황')
 * @param {string} subsection 상단 소분류 (예: '1. 일반현황')
 * @param {string} page       페이지 배지 텍스트 (예: '01')
 * @param {object} lead       { label, claim } — 리드문. label은 cyan, claim은 다크.
 */
export function bodySlide(pptx, { section, subsection, page, lead } = {}) {
  const slide = pptx.addSlide();
  slide.background = { color: T.color.white };

  // 상단 네이비 밴드 (원본은 레이아웃 배경 그라디언트. 단색 근사)
  slide.addShape(pptx.ShapeType.rect, {
    x: 0, y: 0, w: T.canvas.w, h: T.header.bandH,
    fill: { color: T.color.headerBandTo }, line: { type: 'none' },
  });

  if (section) {
    slide.addText(section, {
      ...T.header.sectionLabel,
      fontFace: T.font.family, fontSize: T.font.headerLabel, bold: true,
      color: T.color.white, valign: 'middle', margin: 0,
    });
  }
  if (subsection) {
    slide.addText(subsection, {
      ...T.header.subLabel,
      fontFace: T.font.family, fontSize: T.font.headerSub, bold: true,
      color: T.color.white, valign: 'middle', margin: 0,
    });
  }
  if (page) {
    // 원본은 페이지 번호를 footer가 아니라 헤더 우측 배지에 둔다.
    slide.addText(`${page} 쪽수`, {
      ...T.header.pageBadge,
      fontFace: T.font.family, fontSize: T.font.pageBadge, bold: true,
      color: T.color.white, align: 'right', valign: 'middle', margin: 0,
    });
  }

  if (lead) {
    const parts = [];
    if (lead.label) {
      parts.push({ text: lead.label, options: { color: T.color.cyanLabel, bold: true } });
      parts.push({ text: ' ｜ ', options: { color: T.color.navyMid, bold: true } });
    }
    if (lead.claim) {
      parts.push({ text: lead.claim, options: { color: T.color.navy, bold: true } });
    }
    slide.addText(parts, {
      ...T.header.lead,
      fontFace: T.font.family, fontSize: T.font.lead, valign: 'middle', margin: 0,
    });
  }

  slide.addShape(pptx.ShapeType.line, {
    x: T.header.rule.x, y: T.header.rule.y, w: T.header.rule.w, h: 0,
    line: { color: T.color.rule, width: T.header.rule.pt },
  });

  return slide;
}

/**
 * 네이비 pill 소제목 바. 원본에서 18개 슬라이드에 45회 등장하는 지배적 컴포넌트.
 * 카드/윤곽선 박스가 아니라 단색 pill이다.
 */
export function sectionPill(pptx, slide, { text, x, y, w, h = T.pill.h, fill = T.color.navy } = {}) {
  slide.addShape(pptx.ShapeType.roundRect, {
    x, y, w, h,
    fill: { color: fill }, line: { type: 'none' }, rectRadius: T.pill.radius,
  });
  if (text) {
    slide.addText(text, {
      x, y, w, h,
      fontFace: T.font.family, fontSize: T.font.body, color: T.color.white,
      align: 'center', valign: 'middle', margin: 0,
    });
  }
  return slide;
}

/**
 * 3열 stat 그리드. 원본은 배경 카드 없이 [라벨 → 큰 숫자 → 각주] 만 쌓는다.
 * 다색 KPI 카드를 만들지 않는 것이 이 컴포넌트의 요점이다.
 *
 * @param {Array<{label:string, value:string, unit?:string, note?:string}>} stats
 */
export function statGrid(pptx, slide, stats, { x0 = T.stat.x0, rows = T.stat.rows, colW = T.stat.colW } = {}) {
  stats.forEach((s, i) => {
    const col = i % 3;
    const row = Math.floor(i / 3);
    if (row >= rows.length) return;
    const x = x0 + col * T.stat.colPitch;
    const y = rows[row];

    // 라벨은 2줄까지 흔하다(원본 h=0.462). 아래 정렬해서 숫자와 붙여 읽히게 한다.
    slide.addText(s.label, {
      x, y: y + T.stat.labelDy, w: colW, h: T.stat.labelH,
      fontFace: T.font.family, fontSize: T.font.statLabel, color: '000000',
      valign: 'bottom', margin: 0,
    });

    // 각주는 원본처럼 같은 박스 안 run으로 흐르되, 박스 높이를 원본 실측(0.72)만큼 준다.
    const runs = [{ text: s.value, options: { fontSize: T.font.statNumber, bold: true } }];
    if (s.unit) runs.push({ text: ` ${s.unit}`, options: { fontSize: T.font.statLabel } });
    if (s.note) runs.push({ text: ` (${s.note})`, options: { fontSize: T.font.statNote } });
    slide.addText(runs, {
      x, y, w: colW, h: T.stat.valueH,
      fontFace: T.font.family, color: '000000', valign: 'top', margin: 0,
    });
  });
  return slide;
}

/**
 * 표. 헤더 fill은 관찰된 옅은 하늘색(D6E4F0), 본문은 밀도 높은 9.7pt.
 * 원본 톤은 표 본문에 12pt를 쓰지 않는다.
 */
export function dataTable(pptx, slide, { headers, rows, x, y, w, colW, fontSize = T.font.dense } = {}) {
  const head = headers.map((h) => ({
    text: h,
    options: { fill: { color: T.color.cyanTint }, bold: true, color: T.color.navy, align: 'center' },
  }));
  const body = rows.map((r) => r.map((c) => ({ text: String(c), options: { align: 'center' } })));

  slide.addTable([head, ...body], {
    x, y, w, colW,
    fontFace: T.font.family, fontSize,
    border: { type: 'solid', color: 'D9D9D9', pt: 0.5 },
    valign: 'middle',
  });
  return slide;
}

/**
 * 프로세스 chevron 밴드 (homePlate). 원본 slide 27에서 cyan(5B9BD5)으로 관찰.
 */
export function processChevrons(pptx, slide, steps, { x, y, w, h = 0.36, gap = 0.06 } = {}) {
  const each = (w - gap * (steps.length - 1)) / steps.length;
  steps.forEach((label, i) => {
    const sx = x + i * (each + gap);
    slide.addShape(pptx.ShapeType.homePlate, {
      x: sx, y, w: each, h,
      fill: { color: T.color.cyan }, line: { type: 'none' },
    });
    slide.addText(label, {
      x: sx, y, w: each, h,
      fontFace: T.font.family, fontSize: T.font.dense, bold: true,
      color: T.color.navy, align: 'center', valign: 'middle', margin: 0,
    });
  });
  return slide;
}
