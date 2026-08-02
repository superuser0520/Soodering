# Design QA — Desktop menu redesign

## Evidence

- Selected source visual: `design-audit/design-1-reference.png`
- Final implementation: `design-audit/04-final-desktop.png`
- Side-by-side comparison: `design-audit/05-comparison.png`
- Browser viewport: 1536 × 1024 at device pixel ratio 1
- Tested state: authenticated menu screen using live account/menu data, with two meals selected locally in the basket

## Full-view comparison

The implementation preserves the selected design's core desktop hierarchy: a persistent left navigation and credit rail, a wide two-column menu workspace, and a sticky order summary on the right. Menu date groups, filters, availability notice, credit status, and primary order action remain visible without the narrow phone-like presentation.

Focused checks:

- Left rail: brand, primary navigation, credit information, and account actions are clearly separated and remain visible.
- Center workspace: date-grouped meal cards use the available width in two columns and show distinct International, Chinese, and Malay stall marks.
- Right rail: selected meals, quick actions, and the place-order action stay visible as a persistent desktop panel.

## Interaction and content verification

- Selecting a meal adds it to the basket and enables the Place order button.
- Two selected meals render with their matching stall logos.
- `Vegetarian Set`, `Economic Rice Set`, and `Nasi Padang Set` are absent from the rendered menu.
- Menu filters and navigation remain usable.
- No order was submitted or cancelled during QA.
- Browser console: 0 errors and 0 warnings.
- Automated checks: 10 tests passed; dependency audit found 0 vulnerabilities.

## Comparison history and findings

The pre-redesign screen used a narrow, vertically stacked layout on desktop. The first redesigned browser pass established the three-column shell but briefly showed empty wallet/order values while sequential account requests completed (P2). The initial account refresh was changed to load wallet and order data in parallel, and the post-fix screenshot confirms the populated state.

No P0, P1, or P2 issues remain.

Accepted differences from the generated concept:

- The implementation uses the requested generated stall logos instead of concept-only food photography.
- The concept's invented Top up control and product descriptions were not added because those capabilities/content do not exist in the current application.
- Real menu and account content determine card density and labels.

final result: passed
