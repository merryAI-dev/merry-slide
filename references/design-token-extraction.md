# Merry-slide Design Token Extraction

레퍼런스가 있는 Merry-slide 작업은 Stage 1에서 이 문서를 반드시 적용한다. 토큰을 많이 쓰더라도 생략하지 않는다.

## Why This Exists

레퍼런스를 “깔끔한 보고서 톤”처럼 요약하면 실제 디자인 시스템이 사라진다. 보고서형 레퍼런스는 작은 반복 토큰으로 구성된다.

- header rule, section marker, side rail, footer rule 같은 반복 구조가 있음
- 특정 색상 역할이 제목, 표, 차트, 다이어그램에서 반복됨
- 표 header, border, row fill, chart axis, chart grid가 같은 neutral/accent 체계를 공유함
- 차트 series, axis, label, grid의 색상 역할이 분리됨

이런 관찰을 token으로 뽑지 않으면 이후 Plan, Prompt, Render, Native PPT 단계가 generic output으로 무너진다.

## Mandatory Token Table

`DESIGN.md`에는 반드시 아래 표가 들어가야 한다. 관찰하지 못한 값은 `not observed`라고 쓰고 추측하지 않는다.

| Token group | Required tokens |
| --- | --- |
| Canvas | background fill, page aspect ratio, outer margin, safe area |
| Header | title position, header rule if observed, section label treatment, header spacing |
| Layout primitives | side rail if observed, section marker, divider, frame, rule, grid, safe-area relationship |
| Typography | title font class, title size range, body font class, body size minimum, caption size |
| Palette | primary accent, secondary accent, neutral dark, neutral mid, neutral light, border/grid color |
| Table | header fill, header text color, row fill, alternating row fill, border color, border weight, alignment |
| Chart | grid color, axis color, label color, primary series color, secondary series color, marker style, legend style |
| Diagram | connector color, connector weight, box fill, box border, label treatment |
| Footer | footer rule, page number treatment, source note treatment |
| Forbidden | colors, cards, shadows, icon styles, chart treatments not seen in the reference |

## Required Columns

Each token row must include:

- `token`: stable name such as `header.rule.primary_segment`
- `observed_value`: approximate hex, size, ratio, placement, or `not observed`
- `evidence`: page/slide number, region, or screenshot crop where it was observed
- `reuse_rule`: when and how to reuse it
- `confidence`: `high`, `medium`, or `low`

Example:

| token | observed_value | evidence | reuse_rule | confidence |
| --- | --- | --- | --- | --- |
| header.rule.primary_segment | observed accent segment, approx ratio if split | body page header | Use only if the reference shows a split rule | medium |
| header.rule.secondary_segment | observed secondary/neutral segment | body page header | Continue from primary segment only when split rules are observed | medium |
| table.border | observed thin grid/border treatment | body table grid | Use for all table borders unless a slide type shows a different rule | high |
| chart.primary_series | observed main line/bar treatment | body chart | Use for primary data series only | medium |

## Extraction Rules

- Prefer observed ratios over vague adjectives. Write “primary segment about half of the observed rule” instead of “nice accent line”.
- Separate color role from color name. `table.header.fill` and `chart.primary_series` may share a color but remain separate tokens.
- If the reference uses split lines, side rails, alternating rows, or repeated grid colors, record those as tokens.
- If a token appears on both table and chart elements, note the shared reuse rule.
- If exact hex cannot be measured, give an approximate hex and mark confidence `medium` or `low`.
- Do not invent a token because it would look good. Only observed or directly inferred system tokens are allowed.

## Prompt Handoff Rules

Stage 3 must convert tokens into concrete per-slide constraints:

- “Use `header.rule.primary_segment` followed by `header.rule.secondary_segment` when the reference shows a split rule.”
- “Use `table.border` for all table grid lines.”
- “Use `chart.grid` for chart grid lines and keep it lower contrast than axis labels.”
- “Use `chart.primary_series` for the main line or bar only.”

Do not pass tokens forward as generic text like “use the reference colors”.

## Native PPT Rules

When using `slides` or PptxGenJS:

- Implement observed split rules as separate line or rectangle segments.
- Define helper constants from the extracted tokens.
- Do not collapse token roles into one `TEAL` variable unless the reference genuinely uses one color for all roles.
- Native tables and charts must use tokenized border/grid/series colors.
- If a token is missing, stop and inspect the reference again before generating.

## Stage Gate

Stage 1 fails if:

- `DESIGN.md` has no token table.
- header/layout, table, or chart tokens are missing when the reference visibly contains those elements.
- palette is only summarized with color names or adjectives without role-based tokens.
- prompt handoff does not name the tokens that must be reused.
