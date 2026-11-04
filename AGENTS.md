# LightJurnal engineering and design rules

## Product identity

LightJurnal is a personal trading journal and read-only MT5 companion. It should feel like a carefully crafted financial tool: calm, precise, legible, fast, and trustworthy. Do not turn it into a generic SaaS landing page or an AI-themed dashboard.

## Existing architecture

- Keep the production app in vanilla HTML, CSS, and JavaScript unless a migration is explicitly approved.
- Preserve the current browser-local data model and existing localStorage keys.
- Do not invent account data, market prices, broker connections, analytics, or user activity.
- MT5 Live is read-only and requires the separately deployed Python bridge. Never add order execution.
- Market-analysis data is a Yahoo Finance GC=F futures proxy, not broker XAUUSD spot quotes. Keep this limitation visible.

## Design references

Use these upstream projects as references, not as permission to copy a template:

- [Impeccable](https://github.com/pbakaus/impeccable): critique, audit, harden, polish, and detect generic AI-generated design patterns.
- [UI UX Pro Max](https://github.com/nextlevelbuilder/ui-ux-pro-max-skill): product-specific design systems, data visualization, accessibility, and resilient UI patterns.
- [Anthropic Skills](https://github.com/anthropics/skills): frontend-design and webapp-testing workflows.
- [Emil Kowalski Skills](https://github.com/emilkowalski/skills): restrained motion and high-quality interaction feedback.
- [Vercel Agent Skills](https://github.com/vercel-labs/agent-skills): web design guidelines and production-quality implementation patterns.

## Visual quality bar

- Prefer a distinctive, restrained financial-workspace identity over gradients, excessive pills, nested cards, decorative icon tiles, or generic dashboard patterns.
- Typography, spacing, alignment, number formatting, and table density must support scanning and comparison.
- Use motion only when it explains state change or improves feedback. Respect `prefers-reduced-motion`.
- Every control must have a meaningful outcome. Never ship a button that only changes its label or displays a fake success.
- Every async action needs loading, success, empty, and actionable error states.
- Forms need inline validation, clear units, sensible defaults, and protection against invalid or destructive input.
- Keep keyboard focus visible; use semantic buttons, labels, tables, and live regions.
- Test narrow mobile widths, long symbols/IDs, empty datasets, large datasets, and browser zoom.

## Data and reliability rules

- Treat localStorage writes as transactions: restore in-memory state when persistence fails.
- Avoid overlapping polling requests and ignore stale responses after disconnect/reconfiguration.
- Bound network requests with timeouts; validate HTTP status and response shape before rendering.
- Do not use an incomplete candle for closed-candle analysis. Label any aggregated timeframe accurately.
- Imported data must be escaped before insertion into HTML and deduplicated without silently discarding distinct deals.
- Exports must remain valid long enough for the browser to finish downloading.
- Explain when a feature depends on a third-party service or a separately hosted backend.

## Required quality gate

Before declaring a feature complete:

1. Run `node --check app.js` and `node --check mt5-journal.js`.
2. Run `python3 -m py_compile mt5-bridge.py`.
3. Run `npm test` with Playwright/Chromium.
4. Exercise the real UI path, not just the presence of a button.
5. Verify data persistence after reload and safe rollback after a failed save.
6. Verify errors and offline states; do not hide failures behind a success toast.
7. Do not claim full production verification while the public site's SSL certificate is invalid or an external integration is unavailable.


## Video Studio UX rule

- The Video Studio creative workflow is prompt-only: one natural-language prompt drives the AI storyboard and Remotion render.
- Do not add manual controls for scene duration, background color, palette, aspect ratio, FPS, music, transitions, or individual scene content. These are inferred from the story and may vary from scene to scene.
- The generated storyboard is read-only feedback about the AI's decisions, not a settings form.
- API URL and API key are infrastructure connection details only. Keep them separate from creative controls and never expose model-provider credentials in this frontend.
