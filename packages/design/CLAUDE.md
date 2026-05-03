# Design Package Rules

`packages/design` contains reusable UI primitives consumed through
`@earntools/design/*`. Apps must not duplicate equivalent primitives in their
own `src/components/` directories.

Token rules and design tokens themselves live in
`packages/theme/SPEC.md`. This file covers component-level conventions only;
when in doubt, theme/SPEC.md wins.

## Shadcn Coverage Rules

The package tracks the approved shadcn component list from
`openspec/changes/expand-design-shadcn-components`.

- A: existing shadcn/Radix-style components are kept and aligned in place.
- B: old project semantic primitives are replaced by shadcn-named entries.
- C: missing shadcn entries are added as package components.
- D: project-only components with no shadcn equivalent stay as extensions.

Components must use the shadcn-style flat utilities mapped through
`@earntools/theme/compat-shadcn.css` — `bg-card`, `text-foreground`,
`bg-popover`, `border-input`, `ring-ring`, `bg-card-hover`,
`text-foreground-tertiary`, etc. Do not introduce independent OKLCH variables
or a second token system.

## Current Shadcn Entries

Root-barrel friendly entries include:

- `accordion`
- `alert`
- `alert-dialog`
- `aspect-ratio`
- `avatar`
- `badge`
- `breadcrumb`
- `button`
- `button-group`
- `card`
- `checkbox`
- `collapsible`
- `context-menu`
- `direction`
- `dialog`
- `dropdown-menu`
- `empty`
- `field`
- `hover-card`
- `input`
- `input-group`
- `item`
- `kbd`
- `label`
- `menubar`
- `native-select`
- `navigation-menu`
- `pagination`
- `popover`
- `progress`
- `radio-group`
- `scroll-area`
- `select`
- `separator`
- `sheet`
- `sidebar`
- `skeleton`
- `slider`
- `sonner`
- `spinner`
- `switch`
- `table`
- `tabs`
- `textarea`
- `toggle`
- `toggle-group`
- `tooltip`

Heavy entries must be consumed only by subpath imports and are not exported
from `packages/design/src/index.ts`:

- `calendar`
- `carousel`
- `chart`
- `combobox`
- `command`
- `data-table`
- `date-picker`
- `drawer`
- `input-otp`
- `resizable`

Toast is provided by `sonner`; the recommended import is:
`import { toast, Toaster } from '@earntools/design/sonner'`.

## B-Class Replacements

The following old entries are removed from current inventory and must not be
used in new code:

- `progress-bar` -> `progress`
- `range-slider` -> `slider`
- `empty-state` -> `empty`
- `primary-nav` -> `navigation-menu`
- `date-input` -> `date-picker`
- `warning-banner` -> `alert`
- `segmented-control` -> `toggle-group`
- `panel` -> `card`

`card` supports `variant="default" | "plain" | "card"`. The `plain` and
`card` variants allow bare children so app pages can use Card as the old panel
surface without forcing CardHeader/CardContent structure.

## Project Extensions

These project-only components remain available because the approved shadcn list
has no 1:1 equivalent:

- `info-block`: muted information block, not a structured alert.
- `info-tooltip`: question/help icon plus tooltip wrapper.
- `log-block`: preformatted logs, commands, and path previews.
- `number-input`: business numeric stepper with min/max behavior.
- `page-header`: page title, description, and right-side meta layout.
- `section`: page section wrapper with loading/count business affordances.
- `stat-item`: financial metric display.
- `theme-toggle`: UI-only theme toggle; apps wire theme state.

## Component Boundaries

- Use `NavigationMenu` for route navigation links and active route state.
- Use `ToggleGroup` for in-page single or grouped state switching.
- Use `PageHeader` for page tops and `Section` for page sections.
- Use `InfoBlock` for small title/description information blocks.
- Use `LogBlock` for logs, commands, paths, and preformatted previews.
- Use `Progress` for simple progress bars. Its percentage must clamp to `0%`
  through `100%`; invalid inputs render `0%`.
- Use `Slider` for interactive numeric ranges. Do not hand-style native
  `input type="range"` in app-local CSS.

## Component Authoring Conventions

Apply consistently across `packages/design/src/`:

1. **Variants ≥ 2 → use `cva`.** Do not hand-roll string conditionals
   (`variant === 'x' && '...'` chains). Single-axis style toggles can use a
   plain object map (e.g. `valueSizeClassMap`).
2. **Interactive / size states → `data-*` attribute + group selector**
   (`group/component` + `group-data-[size=sm]/component:...`). Do not use
   conditional className for runtime states.
3. **No dead props.** A `variant` / `size` / `tone` prop must have an
   implementation that visibly changes output for each declared value.
   Removing dead enum values is preferred to keeping them as TODO.
4. **Composition slots → `data-slot`.** Every internal element a consumer
   might target must have a stable `data-slot="..."` attribute.
5. **Numeric content → `tabular-nums`.** Any component that displays
   financial / time / count values must apply `tabular-nums` on the
   numeric leaf.
6. **Transitions → `duration-fast` / `duration-base` + `ease-out`.** No bare
   `transition-all` without a duration token.

## Token Rules

Components must use project semantic tokens or the shadcn compatibility
utilities mapped by `@earntools/theme/theme.css` — `bg-card`, `text-foreground`,
`border-input`, `ring-ring`, `text-foreground-tertiary`, etc. The full token
list lives in `packages/theme/SPEC.md`.

The following are **forbidden inside `packages/design/src/`**:

- Hex / rgb / hsl literals — in className arbitrary values
  (`bg-[#00cd82]`), inline `style={{ color: '#...' }}`, and SVG `fill` /
  `stroke` attributes. Chart palette (`chart.tsx`) may request an exception.
- Arbitrary value color utilities (`bg-[...]`, `text-[...]`,
  `border-[...]`).
- Arbitrary value font-size (`text-[12px]`) and arbitrary / numeric
  line-height (`leading-4`, `leading-[1.2]`). Use scale tokens
  (`text-2xs`–`text-4xl`, `text-h1`–`text-h3`, `leading-tight` etc.).
- `font-[var(--font-weight-*)]` arbitrary writes. Use `font-medium` /
  `font-semibold` / `font-bold` / `font-button` utilities.
- Re-introducing `--bg-*` / `--text-*` / `--border-*` business prefixes.
- Direct `@import` of non-theme color sources.

App-level code (`frontend/*`, `backend/*`, `internal/**`) follows the same restrictions for hex literals and
arbitrary font-size/line-height. Chart label and printed-report edge cases may
use arbitrary values with a justifying inline comment.

## State Hierarchy

Interactive components have a layered state model. Visual strength must
follow the hierarchy:

```
disabled  <  rest  <  hover  <  active / current / selected
```

- **rest / hover** stay neutral (`bg-muted`, `text-muted-foreground` etc.).
  Hover is a transient mouse cue, never a brand state.
- **active / current / selected / data-state=on / data-active / data-selected**
  must carry at least one brand signal: `bg-brand-muted`, `text-brand-text`,
  or a brand border / inset shadow. Pure `bg-muted` is forbidden for these
  states because it collides with hover.
- **filled brand surfaces** (`bg-primary text-primary-foreground`) are
  reserved for "current step" cues such as `pagination[data-active]` and
  `calendar[data-selected]`. Use them sparingly — at most one per cluster.
- **today / persistent anchor cues** (calendar today, "live" badge) prefer
  outline (`ring-1 ring-brand text-brand-text`) over fill so they don't
  fight `selected`.
- **financial selected rows** use a soft tint plus a brand inset border:
  `bg-brand-muted/50 shadow-[inset_3px_0_0_var(--brand)]`. Never use solid
  brand fill on table rows — it overwhelms the digits.
- **link hover** inside descriptions is `hover:text-brand-text`, never
  `hover:text-foreground`. This applies to `dialog`, `alert`,
  `alert-dialog`, `accordion`, `field`, `empty` and any future
  description-style block.

The principle: **one component should only contribute one brand signal at
a time**. If a component already paints a brand background, do not also
add a brand border or brand text — pick the strongest one and let the rest
recede.

## Contrast Floor

Any color combination introduced by a component (text on background, badge
foreground on muted background, etc.) must reach WCAG AA 4.5:1 for normal
text or 3:1 for ≥ 18px / ≥ 14px bold. Use the dedicated foreground tokens
(`--brand-text`, `--warning-fg`) on tinted backgrounds rather than the saturated
brand color.
