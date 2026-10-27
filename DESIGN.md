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
- Vercel `web-interface-guidelines`: responsive, accessible, consistent interface behavior.
- UI UX Pro Max: design-system and UI-pattern reference.
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
