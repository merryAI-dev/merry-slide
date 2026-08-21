#!/usr/bin/env python3
"""레퍼런스 슬라이드에서 브랜드 토큰을 뽑는다. (Stage 1)

덱 전체가 없어도 된다. 형태가 다른 대표 슬라이드 2~3장이면 반복 요소를 찾을 수 있다.
같은 좌표에 같은 요소가 두 번 이상 나오면 그 브랜드의 규칙으로 본다.

    python3 scripts/extract-brand.py 레퍼런스.pptx --name acme --out references/brands

만들어지는 것:
    brand.json   빌더와 프리뷰가 읽는 토큰
    tokens.md    근거가 붙은 관찰 표 (사람이 검토용)

외부 의존성 없이 표준 라이브러리만 쓴다. 읽기 전용이며 원본을 수정하지 않는다.
"""
import argparse
import json
import re
import sys
import zipfile
from collections import Counter, defaultdict
from pathlib import Path
from xml.etree import ElementTree as ET

NS = {
    'a': 'http://schemas.openxmlformats.org/drawingml/2006/main',
    'p': 'http://schemas.openxmlformats.org/presentationml/2006/main',
}
EMU = 914400.0


def inches(v):
    try:
        return round(int(v) / EMU, 3)
    except (TypeError, ValueError):
        return None


def slide_order(name):
    m = re.search(r'(\d+)', name)
    return int(m.group(1)) if m else 0


def load_slides(pptx_path):
    """슬라이드 XML을 번호 순으로 읽는다."""
    with zipfile.ZipFile(pptx_path) as z:
        names = [n for n in z.namelist()
                 if re.match(r'ppt/slides/slide\d+\.xml$', n)]
        names.sort(key=slide_order)
        slides = [(slide_order(n), ET.fromstring(z.read(n))) for n in names]
        pres = ET.fromstring(z.read('ppt/presentation.xml'))
    return slides, pres


def canvas_of(pres):
    sz = pres.find('p:sldSz', NS)
    if sz is None:
        return None
    w, h = inches(sz.get('cx')), inches(sz.get('cy'))
    return {'w': w, 'h': h, 'ratio': round(w / h, 3) if w and h else None}


def xfrm_of(sp):
    x = sp.find('.//a:xfrm', NS)
    if x is None:
        return None
    off, ext = x.find('a:off', NS), x.find('a:ext', NS)
    if off is None or ext is None:
        return None
    return {
        'x': inches(off.get('x')), 'y': inches(off.get('y')),
        'w': inches(ext.get('cx')), 'h': inches(ext.get('cy')),
    }


def solid_color(node):
    """직계 solidFill의 색상 hex."""
    if node is None:
        return None
    for child in node:
        if child.tag == f"{{{NS['a']}}}solidFill":
            srgb = child.find('a:srgbClr', NS)
            if srgb is not None:
                return srgb.get('val')
            scheme = child.find('a:schemeClr', NS)
            if scheme is not None:
                return f"scheme:{scheme.get('val')}"
    return None


def collect(slides):
    """슬라이드별로 도형·텍스트·표를 훑어 관찰값을 모은다."""
    fonts, sizes, text_colors, fills, line_widths = Counter(), Counter(), Counter(), Counter(), Counter()
    geoms = Counter()
    boxes = defaultdict(list)      # (x,y,w) -> [slide, ...]  반복 요소 탐지용
    rules = Counter()              # 가로선
    table_head_fill = Counter()
    table_rows = []
    body_left, body_right, body_bottom = [], [], []

    for num, root in slides:
        tree = root.find('.//p:cSld/p:spTree', NS)
        if tree is None:
            continue
        for sp in tree.iter():
            tag = sp.tag.split('}')[-1]
            if tag not in ('sp', 'pic', 'cxnSp', 'graphicFrame'):
                continue

            box = xfrm_of(sp)
            spPr = sp.find('p:spPr', NS)

            prst = sp.find('.//a:prstGeom', NS)
            if prst is not None:
                geoms[prst.get('prst')] += 1

            fill = solid_color(spPr)
            if fill:
                fills[fill] += 1

            ln = spPr.find('a:ln', NS) if spPr is not None else None
            if ln is not None and ln.get('w'):
                line_widths[round(int(ln.get('w')) / 12700, 2)] += 1

            if box and box['w'] and box['h'] is not None:
                # 가로선: 높이 0에 가깝고 폭이 넓은 것
                if box['h'] < 0.02 and box['w'] > 5:
                    rules[(box['x'], box['y'], round(box['w'], 2))] += 1
                # 본문 영역은 구조 블록(폭 2in 이상)만 보고 잡는다.
                # 작은 장식 도형까지 넣으면 경계가 안쪽으로 끌려온다.
                if box['y'] is not None and box['y'] > 1.2 and box['w'] >= 2:
                    body_left.append(box['x'])
                    body_right.append(round(box['x'] + box['w'], 2))
                    body_bottom.append(round(box['y'] + box['h'], 2))
                boxes[(box['x'], box['y'], round(box['w'], 2))].append(num)

            for r in sp.iter(f"{{{NS['a']}}}r"):
                rPr = r.find('a:rPr', NS)
                t = r.find('a:t', NS)
                if t is None or not (t.text or '').strip():
                    continue
                if rPr is not None:
                    latin = rPr.find('a:latin', NS)
                    ea = rPr.find('a:ea', NS)
                    face = (latin.get('typeface') if latin is not None else None) \
                        or (ea.get('typeface') if ea is not None else None)
                    if face:
                        fonts[face] += 1
                    if rPr.get('sz'):
                        sizes[int(rPr.get('sz')) / 100] += 1
                    col = solid_color(rPr)
                    if col:
                        text_colors[col] += 1

            for tbl in sp.iter(f"{{{NS['a']}}}tbl"):
                trs = tbl.findall('a:tr', NS)
                if not trs:
                    continue
                heights = [inches(tr.get('h')) for tr in trs if tr.get('h')]
                if len(heights) >= 2:
                    table_rows.append({'head': heights[0], 'body': heights[1:]})
                first_cell = trs[0].find('a:tc', NS)
                if first_cell is not None:
                    c = solid_color(first_cell.find('a:tcPr', NS))
                    if c:
                        table_head_fill[c] += 1

    return {
        'fonts': fonts, 'sizes': sizes, 'text_colors': text_colors, 'fills': fills,
        'line_widths': line_widths, 'geoms': geoms, 'boxes': boxes, 'rules': rules,
        'table_head_fill': table_head_fill, 'table_rows': table_rows,
        'body_left': body_left, 'body_right': body_right, 'body_bottom': body_bottom,
    }


def median(xs):
    xs = sorted(x for x in xs if x is not None)
    return xs[len(xs) // 2] if xs else None


def repeated(boxes, min_slides):
    """서로 다른 슬라이드에서 같은 좌표에 나타난 요소만 남긴다."""
    out = []
    for key, slides_seen in boxes.items():
        uniq = len(set(slides_seen))
        if uniq >= min_slides:
            out.append({'x': key[0], 'y': key[1], 'w': key[2], 'slides': uniq})
    return sorted(out, key=lambda b: (b['y'], b['x']))


def build_tokens(obs, canvas, n_slides):
    canvas = canvas or {'w': None, 'h': None}
    min_rep = 2 if n_slides >= 2 else 1
    reps = repeated(obs['boxes'], min_rep)

    header = [b for b in reps if b['y'] is not None and b['y'] < 1.2]
    rule = None
    for key, count in obs['rules'].most_common():
        if count >= min_rep:
            rule = {'x': key[0], 'y': key[1], 'w': key[2], 'slides': count}
            break

    # 경계는 중앙값이 아니라 바깥값이다. 튀는 값 하나에 끌리지 않도록 캔버스 밖은 버린다.
    lefts = [x for x in obs['body_left'] if x is not None and x >= 0]
    rights = [x for x in obs['body_right'] if x is not None and canvas and x <= canvas['w'] + 0.01]
    bottoms = [y for y in obs['body_bottom'] if y is not None and canvas and y <= canvas['h'] + 0.01]
    # 콘텐츠 폭은 헤더 구분선이 가장 확실한 신호다. 도형 최대 확장은 튀는 값을 포함한다.
    if rule:
        left, right = rule['x'], round(rule['x'] + rule['w'], 3)
    else:
        left = min(lefts) if lefts else None
        right = max(rights) if rights else None
    # 하단은 최대값 대신 95퍼센타일. 한 장에서 흘러넘친 도형에 끌리지 않는다.
    if bottoms:
        s = sorted(bottoms)
        bottom = s[min(len(s) - 1, int(len(s) * 0.95))]
    else:
        bottom = None

    heads = [t['head'] for t in obs['table_rows'] if t['head']]
    bodies = [h for t in obs['table_rows'] for h in t['body'] if h]

    def top_hex(counter, n=6):
        return [{'hex': k, 'count': v} for k, v in counter.most_common(n)
                if not str(k).startswith('scheme:')]

    content_top = round(rule['y'] + 0.21, 3) if rule else None

    return {
        'canvas': canvas,
        'font': {
            'family': obs['fonts'].most_common(1)[0][0] if obs['fonts'] else None,
            'observed': [{'name': k, 'count': v} for k, v in obs['fonts'].most_common(6)],
            'sizes': [{'pt': k, 'count': v} for k, v in obs['sizes'].most_common(10)],
        },
        'palette': {
            'text': top_hex(obs['text_colors']),
            'fill': top_hex(obs['fills']),
        },
        'line': {'widths_pt': [{'pt': k, 'count': v} for k, v in obs['line_widths'].most_common(5)]},
        'geometry': [{'preset': k, 'count': v} for k, v in obs['geoms'].most_common(10)],
        'header': {
            'rule': rule,
            'repeated_boxes': header,
            'band_h': round(min((b['y'] for b in header), default=0) + 0.37, 3) if header else None,
        },
        'grid': {
            'full': {'x': left, 'w': round(right - left, 3) if (left and right) else None},
            'bottom': bottom,
            'contentTop': content_top,
        },
        'table': {
            'headFill': obs['table_head_fill'].most_common(1)[0][0] if obs['table_head_fill'] else None,
            'headH': median(heads),
            'bodyH': median(bodies),
            'samples': len(obs['table_rows']),
        },
    }


def confidence(tok, n_slides):
    """슬라이드 수와 반복 횟수로 신뢰도를 매긴다. 추측을 사실처럼 쓰지 않기 위한 표시다."""
    notes = []
    if n_slides < 2:
        notes.append('슬라이드가 1장이라 반복 검증을 못 했습니다. 값은 참고용입니다.')
    elif n_slides < 3:
        notes.append('슬라이드가 2장입니다. 3장 이상이면 반복 요소를 더 정확히 가릅니다.')
    if not tok['header']['rule']:
        notes.append('헤더 구분선을 찾지 못했습니다. 본문형 슬라이드가 포함됐는지 확인하세요.')
    if not tok['table']['samples']:
        notes.append('표가 없어 표 스타일을 뽑지 못했습니다. 표가 있는 장을 한 장 넣어주세요.')
    if not tok['font']['family']:
        notes.append('폰트를 찾지 못했습니다. 텍스트가 이미지로 들어간 슬라이드일 수 있습니다.')
    return notes


def write_markdown(tok, notes, src, n_slides, out_dir):
    lines = [
        f'# 브랜드 토큰 — {Path(src).name}',
        '',
        f'슬라이드 {n_slides}장에서 추출했다. 값은 관찰된 것이고 추측은 넣지 않았다.',
        '`not found`는 그 요소가 이 슬라이드들에 없었다는 뜻이며, 없다고 단정하지 않는다.',
        '',
    ]
    if notes:
        lines += ['## 확인이 필요한 점', ''] + [f'- {n}' for n in notes] + ['']

    c = tok['canvas'] or {}
    lines += [
        '## 캔버스', '',
        '| 항목 | 값 |', '| --- | --- |',
        f"| 크기 | {c.get('w')} x {c.get('h')} in |",
        f"| 비율 | {c.get('ratio')} ({'16:9' if c.get('ratio') and abs(c['ratio']-1.778)<0.02 else 'A4 가로' if c.get('ratio') and abs(c['ratio']-1.414)<0.02 else '기타'}) |",
        '',
        '## 폰트', '',
        '| 폰트 | 등장 |', '| --- | --- |',
    ]
    for f in tok['font']['observed']:
        lines.append(f"| {f['name']} | {f['count']} |")
    lines += ['', '자주 쓰인 크기(pt): ' + ', '.join(
        f"{s['pt']}({s['count']})" for s in tok['font']['sizes'][:8]) or 'not found', '']

    lines += ['## 팔레트', '', '| 역할 | 색상 | 등장 |', '| --- | --- | --- |']
    for c2 in tok['palette']['text']:
        lines.append(f"| 텍스트 | `#{c2['hex']}` | {c2['count']} |")
    for c2 in tok['palette']['fill']:
        lines.append(f"| 채우기 | `#{c2['hex']}` | {c2['count']} |")

    r = tok['header']['rule']
    rule_desc = (f"x={r['x']} y={r['y']} w={r['w']}, {r['slides']}장에서 반복"
                 if r else 'not found')
    lines += [
        '', '## 헤더', '',
        f'- 구분선: {rule_desc}',
        f"- 밴드 높이 추정: {tok['header']['band_h'] or 'not found'}",
        f"- 반복 요소 {len(tok['header']['repeated_boxes'])}개",
        '',
        '## 본문 영역', '',
        f"- 좌측 {tok['grid']['full']['x']} / 폭 {tok['grid']['full']['w']} / 하단 {tok['grid']['bottom']}",
        f"- 콘텐츠 상단 추정 {tok['grid']['contentTop']}",
        '',
        '## 표', '',
        f"- 헤더 채우기: {('`#' + tok['table']['headFill'] + '`') if tok['table']['headFill'] else 'not found'}",
        f"- 헤더 행 높이 {tok['table']['headH'] or 'not found'} / 본문 행 높이 {tok['table']['bodyH'] or 'not found'}",
        f"- 표 표본 {tok['table']['samples']}개",
        '',
        '## 도형', '',
        ' · '.join(f"{g['preset']} {g['count']}" for g in tok['geometry']) or 'not found',
        '',
    ]
    (out_dir / 'tokens.md').write_text('\n'.join(lines), encoding='utf-8')


def main():
    ap = argparse.ArgumentParser(description='레퍼런스 슬라이드에서 브랜드 토큰을 뽑는다.')
    ap.add_argument('pptx', help='레퍼런스 .pptx 경로')
    ap.add_argument('--name', required=True, help='브랜드 이름 (폴더명으로 쓰인다)')
    ap.add_argument('--out', default='references/brands', help='출력 상위 폴더')
    args = ap.parse_args()

    src = Path(args.pptx)
    if not src.exists():
        sys.exit(f'extract-brand.py: 파일을 찾을 수 없습니다: {src}')

    try:
        slides, pres = load_slides(src)
    except (zipfile.BadZipFile, KeyError) as e:
        sys.exit(f'extract-brand.py: pptx를 읽지 못했습니다: {e}')
    if not slides:
        sys.exit('extract-brand.py: 슬라이드가 없습니다.')

    obs = collect(slides)
    tok = build_tokens(obs, canvas_of(pres), len(slides))
    notes = confidence(tok, len(slides))

    out_dir = Path(args.out) / args.name
    out_dir.mkdir(parents=True, exist_ok=True)
    tok_out = {'brand': args.name, 'source': src.name, 'slides': len(slides), **tok}
    (out_dir / 'brand.json').write_text(
        json.dumps(tok_out, ensure_ascii=False, indent=2), encoding='utf-8')
    write_markdown(tok, notes, src, len(slides), out_dir)

    print(json.dumps({
        'brand': args.name,
        'slides': len(slides),
        'out': str(out_dir),
        'font': tok['font']['family'],
        'canvas': tok['canvas'],
        'needs_check': notes,
    }, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
