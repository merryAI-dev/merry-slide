# Merry-slide Design Quality Gate

레퍼런스가 있는 Merry-slide 작업은 Stage 1 이후와 최종 산출 전 이 체크를 통과해야 한다.

## Root Cause This Gate Prevents

실패 패턴은 레퍼런스에서 관찰하지 않은 generic PPT 문법을 Codex가 임의로 채우는 것이다.

- 다색 KPI 카드
- 두꺼운 테두리와 작은 설명문
- 무관한 dashboard widget
- 12pt 미만 본문을 `fit`으로 억지 축소
- reference palette보다 많은 accent color

이런 요소는 내용이 맞아도 디자인 실패로 본다.

## Mandatory Defaults

| 항목 | 기준 |
| --- | --- |
| Korean font | `Pretendard` fixed unless user explicitly chooses another font |
| Body text | 12pt minimum |
| Table body | 12pt minimum, unless the user asks for dense appendix tables |
| Chart labels | 12pt minimum where editable; tiny labels require simplification |
| Footer/source/page number | 8-10pt allowed |
| Accent colors | Use observed reference colors; max 1-2 accents unless the reference itself uses more |
| Render model | `gpt-image-2` by default; ask before using older GPT Image or DALL-E fallback |

## Reference Fidelity Checklist

Before planning or rendering, write down:

- Observed layout primitives: header, footer, rule, rail/marker if observed, grid, table, chart, callout
- Observed line weight and border style
- Observed palette: dominant, neutral, accent
- Observed typography: font family if known, weight, title/body scale
- Explicit forbidden patterns: components/colors/shadows/icons not seen in the reference

If font, body minimum size, editability, or render model are not specified, ask the user during Intake instead of guessing silently. Recommended defaults are Pretendard, 12pt body minimum, and gpt-image-2.

## Design Token Gate

Stage 1 must also pass `references/design-token-extraction.md`.

Do not accept a `DESIGN.md` that only says “clean report style” or lists color names without roles. The design must be decomposed into role-based tokens.

Required token areas:

- Header: title block, section label, rule/segment treatment if observed, spacing
- Layout primitives: rail/marker/frame/divider if observed, position, width, relationship to content
- Table: header fill, grid/border, row fills, text alignment
- Chart: grid, axis, labels, primary series, secondary series, marker style
- Footer: footer rule, source note, page number

If the reference visibly contains split rules, side rails, mixed table treatments, or recurring chart color roles, those must appear as explicit token rows with evidence and reuse rules. Do not require those elements when the reference does not show them.

## Native PPT Checklist

When using `slides` for editable output:

- Set `pptx.theme.headFontFace` and `bodyFontFace` to `Pretendard`.
- Keep all body-level text boxes at 12pt or above.
- Do not use `fit: shrink` to hide overflow. Shorten content or split the slide.
- Tables must be native PowerPoint tables when the user asks for editable tables.
- Simple charts must be native PowerPoint charts when the user asks for editable charts.
- Inspect generated slide thumbnails or renders before delivery.

## Rejection Rules

Reject and revise any slide that:

- Uses a color because it looks nice rather than because the reference uses it.
- Adds KPI cards, badges, icon chips, shadows, or outlines absent from the reference.
- Has body text visually smaller than 12pt.
- Has more component types than the reference body pages show.
- Replaces a reference-style table/chart with decorative cards.
- Was rendered with a downgraded image model without user approval.
- Collapses observed split rules or repeated multi-role palette behavior into a single generic accent color.
- Uses table or chart colors without token names and evidence from Stage 1.
