# Merry-slide Stage Contract

Merry-slide 작업이 여러 stage를 걸치거나, 기존 산출물에서 재개되거나, 사용자에게 stage 선택지를 보여줘야 할 때 이 문서를 읽는다.

## Stage 완료 기준

| Stage | 완료 조건 |
| --- | --- |
| 0 Intake | 목표, 청중, 소스 목록, 디자인 권위, 콘텐츠 권위, 최종 산출물, 폰트/본문 크기/렌더 모델/편집성, 누락 입력이 명확하다. |
| 1 Design | `DESIGN.md`가 observed/inferred 규칙을 분리하고, layout family, font, body size, role-based design tokens, forbidden patterns를 명명한다. |
| 2 Plan | `slide_plan.json`이 유효한 JSON이고, slide 번호가 순차적이며, 근거와 `DESIGN.md`의 디자인 제약 및 token reuse rule을 반영한다. |
| 3 Prompt | `slide_prompts.json`이 유효한 JSON이고, 계획된 slide마다 prompt가 있으며, 배치와 reference-specific anti-pattern ban, token 이름을 포함한다. |
| 4 Render | 모든 slide image가 존재하고, 직접 시각 검수됐으며, 의도한 page family, design tokens, `references/design-quality-gate.md`를 따른다. |
| 5 Package | PPTX slide 수가 승인 이미지 수와 같고, 이미지가 slide canvas를 채우며, 사용자가 editable output을 요청한 경우 native table/chart 조건을 충족한다. |

## 재개 규칙

재시작보다 재개를 우선한다.

1. `DESIGN.md`가 없거나 약하면 Stage 1.
2. `slide_plan.json`이 없거나 invalid면 Stage 2.
3. `slide_prompts.json`이 없거나 invalid면 Stage 3.
4. 승인된 page image가 빠졌으면 Stage 4.
5. 사용자가 PPTX를 원하고 image가 있으면 Stage 5.

상위 산출물이 모순되면 하위 stage를 진행하지 말고 먼저 해당 산출물을 고친다. 깨진 plan을 render에 넘기지 않는다.

디자인 산출물이 약하면 하위 stage로 진행하지 않는다. 특히 font, body text minimum, observed palette, role-based design tokens, forbidden patterns가 비어 있으면 Stage 1을 다시 한다.

레퍼런스에 header rule, side rail/marker, 표, 차트 같은 반복 요소가 보이는데 `DESIGN.md`에 해당 token table이 없으면 Stage 1은 실패다. “깔끔한 보고서 스타일” 같은 요약은 완료 조건이 아니다. 단, 특정 레퍼런스에서만 보이는 요소를 모든 작업에 강제하지 않는다.

폰트, 본문 최소 크기, 렌더 모델, PPTX 편집성이 애매하면 먼저 Stage 0으로 돌아가 사용자에게 묻는다. 기본 제안은 `Pretendard`, `12pt 이상`, `gpt-image-2`, `raster PPTX`다.

## 레퍼런스 링크 처리

레퍼런스 URL은 스타일 판단에 필요한 시각 근거만 캡처한다.

- page/frame/screenshot 위치
- layout family 단서
- palette/typography/component 관찰
- token evidence: observed header/footer rules, layout markers/rails, table grid, chart grid/axis/series, footer treatment
- 접근 가능 여부

접근이 실패하면 스크린샷, PDF export, 이미지 crop을 요청한다. 접근 불가능한 링크에서 디자인 규칙을 지어내지 않는다.

## 디자인 품질 게이트

레퍼런스가 있으면 `references/design-quality-gate.md`를 기준으로 아래를 확인한다.

- 한국어 덱 기본 폰트는 `Pretendard`다.
- 본문, 표 본문, 차트 라벨, 다이어그램 설명은 12pt 이상이다.
- 렌더 모델은 `gpt-image-2`가 기본이며, fallback은 사용자 승인 후에만 한다.
- footer, 출처, 페이지 번호 같은 보조 메타데이터만 8-10pt를 허용한다.
- 레퍼런스에 없는 다색 KPI 카드, 두꺼운 카드 윤곽선, 그림자, badge, dashboard widget을 만들지 않는다.
- 팔레트는 observed dominant/neutral/accent 중심이며 accent는 1-2개를 넘기지 않는다.
- 공간이 부족하면 글씨를 줄이지 말고 내용을 줄이거나 slide를 나눈다.
- `references/design-token-extraction.md`의 token table을 작성하고, 각 token에 observed value, evidence, reuse rule, confidence를 기록한다.
- split rule, mixed table treatment, chart grid/axis/series color roles가 보이면 반드시 별도 token으로 분리한다.

## Stage 선택 문구

사용자가 stage를 지정하지 않았고 Auto로 판단하기에도 부족하면 아래 문구를 사용한다.

> 어떤 Merry-slide stage로 진행할까요? 추천은 `Auto`입니다. 옵션:
> `0 Intake`, `1 Design`, `2 Plan`, `3 Prompt`, `4 Render`, `5 Package`.

사용자가 “완성해줘”, “덱 만들어줘”, “PPT 생성해줘”라고 했거나 충분한 맥락을 줬다면 이 질문을 생략하고 Auto로 진행한다.

## 산출물 기본 이름

- `merry_slide_brief.md`
- `DESIGN.md`
- `slide_plan.json`
- `slide_prompts.json`
- `page_<n>.png`
- `merry-slide-deck.pptx`

사용자가 프로젝트별 명명 규칙을 주지 않았다면 파일명은 안정적으로 유지한다.
