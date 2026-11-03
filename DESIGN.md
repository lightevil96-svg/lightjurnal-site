# LightJurnal / TradeLog — UI design system

This design system records the principles used to improve the existing vanilla HTML/CSS/JavaScript trading journal. It is intentionally compatible with GitHub Pages and does not require a framework migration.

## Design intent
A calm, precise trading workspace: high information density without visual noise. The interface should help traders scan performance, understand risk, and navigate quickly on desktop and mobile.

## Tokens
- **Deep navy** `#111f34`: navigation and workspace frame.
- **Emerald** `#0f9f73`: primary actions, active navigation, and positive emphasis.
- **Canvas** `#f3f6fa`: page background.
- **Ink** `#18263b`: primary text.
- **Muted** `#68778d`: supporting labels.
- **Line** `#e3e9f1`: dividers and control borders.
- **Semantic red** `#d94e60`: negative P/L and destructive actions.
- **Semantic blue** `#4169d8`: informational / analytical emphasis.

## Rules
1. Preserve existing trade calculations, browser-local storage keys, MT5 import, and trading prompt flows when making visual changes.
2. Use tabular numerals for prices, account values, and metrics; never rely on color alone to communicate profit or loss.
3. Keep mobile controls touch-friendly, forms full-width where space is limited, and data tables horizontally scrollable rather than silently clipping columns.
4. Provide a visible keyboard focus state and respect `prefers-reduced-motion`.
5. Use motion only to confirm user interaction; avoid ambient animation that competes with market data.
6. Empty, loading, error, and unavailable-data states must explain what happened and what the user can do next.
7. Treat broker prices, proxy market feeds, and imported reports distinctly; do not imply that data sources are interchangeable.
8. Prefer targeted improvements over adding dependencies or migrating away from the current static architecture.

## Skills and references used
- Anthropic `frontend-design`: product-specific visual direction, typography and hierarchy.
- Impeccable: critique, hardening, polish, responsive and accessibility audit; anti-generic design checks.
- UI UX Pro Max: industry-aware design-system and UI-pattern reference for financial dashboards.
- Emil Kowalski Skills: motion restraint, interaction feedback, animation review and worst-case UI testing.
- Vercel `web-design-guidelines`: responsive, accessible and consistent interface behavior.
- Better Web UI: critique, simplification, edge cases and finishing pass.

## Verification checklist
- [ ] Desktop layout and all page navigation.
- [ ] Mobile sidebar open/close and no horizontal page overflow.
- [ ] Keyboard focus visible on buttons, links and fields.
- [ ] Reduced-motion preference respected.
- [ ] Trade create/edit/delete and local persistence unchanged.
- [ ] CSV/JSON backup and MT5 report import unchanged.
- [ ] Risk calculator and generated XAUUSD analysis prompt unchanged.
- [ ] Test with empty data, long numbers, and long table content.
- [ ] Verify deployed GitHub Pages site after merge; repository edits alone do not prove deployment success.


## Automated quality checks

Run the browser regression suite with `npm install`, `npx playwright install chromium`, and `npm test`. GitHub Actions also runs `node --check` on the application and test scripts plus `python3 -m py_compile mt5-bridge.py`.

The automated browser suite exercises real UI flows rather than checking only whether controls exist. External market and bridge services are mocked in tests so calculations, parsing, state changes, and error handling can be tested deterministically.
