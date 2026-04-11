# Design System & Brand Positioning

## Target Audience (Implicit, Never Stated)
Disciplined high-performers who balance early gym sessions, professional leadership, and personal wellness. The aesthetic should communicate aspiration through restraint — not through demographic signals. Gender-neutral in language and design; the audience self-selects through the vibe.

Key lifestyle touchpoints: pilates/reformer studios, weight training, MacBook + Oura ring, coffee on the go, black corporate dress code, wellness retreats. Think: the person in an all-black suit holding a coffee in a steel elevator — composed, not trying.

Reference brands: **Puresport, PROMIX, Aesop** — premium performance, not supplement store.

## Brand Pillars
- **Dark chocolate flavour**: deep, grounded, disciplined performance
- **White chocolate raspberry**: light, clean, balanced
- These two axes map directly to the colour system (see below)

## Colour System
All tokens live in `app/globals.css`. Current palette:

| Token | Value | Why |
|---|---|---|
| `--background` | `oklch(0.975 0.008 75)` | Warm ivory/cream — white chocolate box |
| `--foreground` / `--primary` | `oklch(0.19 0.04 115)` | Dark olive-green — dark chocolate box |
| `--card` | `oklch(0.99 0.005 75)` | Slightly lighter warm white |
| `--secondary` | `oklch(0.93 0.014 75)` | Warm linen — alternate section bg |
| `--muted-foreground` | `oklch(0.50 0.02 100)` | Warm mid-olive grey |
| `--accent` | `oklch(0.68 0.10 25)` | Warm sand/stone |
| `--accent-price` | `oklch(0.55 0.15 25)` | Denser accent for sale prices only |
| `--stripe-brand` | `oklch(0.51 0.24 285)` | Stripe purple — footer badge |
| `--trustpilot-green` | `oklch(0.65 0.17 160)` | Trustpilot stars |
| `--border` | `oklch(0.87 0.012 95)` | Warm cream-olive border |

**Do not** reintroduce pink/rose (hue 350). That palette was removed intentionally — it read as generic supplement-brand, not premium wellness.

The olive-green primary is the dark chocolate box colour. The cream background is the white chocolate box colour. Both product lines are literally embedded in the design system.

## Typography Rules

### Logo lockup
Uniform weight throughout — `font-medium tracking-[0.35em] uppercase`. Do not split EGG bold / Origin light on the website; that treatment belongs on the physical packaging only.
```jsx
<span className="font-medium tracking-[0.35em] uppercase">Egg Origin</span>
```

### Eyebrow / label text
- Size: `text-[11px]` or `text-[10px]`
- Always `uppercase tracking-[0.3em]` to `tracking-[0.4em]`
- Color: `text-muted-foreground`
- These mirror the label typography on the packaging ("20G PROTEIN · LOW SUGAR")

### Headings
- H1: `text-4xl font-light leading-[1.05] tracking-[-0.04em] sm:text-5xl` — never bold headings
- Two-tone split pattern: primary line in `text-foreground`, secondary in `<span className="block text-muted-foreground">`
- Legal pages (terms, privacy) use smaller scale: `text-3xl sm:text-4xl`
- H2 section headings: `text-lg font-medium tracking-wide`
- No serif fonts — the packaging uses geometric sans-serif; Geist is correct

### Body
- `text-sm leading-7 text-muted-foreground` — generous line height
- Constrain width with `max-w-xl` or `max-w-md` for readability
- Never `text-base` with tight leading — reads as supplement copy

### Buttons
**Primary CTA:** `h-11 gap-2 rounded-full bg-primary px-6 text-[10px] uppercase tracking-[0.16em] text-primary-foreground hover:opacity-90` — pill-shaped, understated
**Secondary link buttons:** `inline-flex items-center gap-3 rounded-full border border-border/60 px-6 py-3 text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground hover:bg-muted/30 hover:text-accent` — used for "Виж всички", "Виж продуктите", Instagram, Trustpilot-style links

### Button variants (components/ui/button.tsx)
- `outline`: `hover:bg-secondary hover:text-foreground` (not accent)
- `ghost`: `hover:bg-secondary hover:text-foreground` (not accent)
- The accent color is used for hover on text links, not on button backgrounds

## Key UI Patterns

### Benefits strip (homepage)
Hairline dividers (`divide-x divide-border`) between stats, `font-extralight` for numbers. Do not use card/box approach — flat ruled strip only.

### Section structure
Numbered pillar blocks (01 / 02 / 03) with `border-l` column separators on desktop. Left-aligned headings. Editorial, not centred brochure.

### Cards
Custom card pattern (used on cart items, contact info, about values, homepage pillars):
`rounded-[26px] border border-border/40 bg-card/80 p-8 transition-all duration-500 hover:border-accent/30 hover:shadow-lg hover:shadow-accent/[0.05]`
- Hover gradient top line: `absolute h-px bg-gradient-to-r from-transparent via-accent/50 to-transparent opacity-0 group-hover:opacity-100`
- No `backdrop-blur-md` on solid backgrounds (dead CSS)

### Product cards
- Aspect ratio: `aspect-[3/4]` — portrait, matches box shot proportions
- Hover: `hover:border-foreground/30` border shift — no `hover:shadow-lg` (too generic)
- Card footer: always has `border-t border-border`
- Badges: `text-[9px] font-medium uppercase tracking-[0.2em]`

### Product detail — image gallery
- Main image: `aspect-[3/4]` with `object-contain` — handles both portrait box shots and landscape single-bar lifestyle shots without cropping
- Thumbnails: `aspect-square w-20` with `object-cover` — fine at small size

## Product Images (in `public/images/`)

| File | Description | Use |
|---|---|---|
| `dark-chocolate-bar.png` | Dark olive box, 12 bars — portrait | Main product image, dark choc card |
| `dark-chocolate-single-bar.png` | Dark wrapper bar on concrete, MacBook + ring props — landscape | Gallery second image, dark choc detail |
| `white-chocolate-raspberry-bar.png` | Cream/ivory box, 12 bars — portrait | Main product image, white choc card |
| `white-chocolate-single-bar.png` | Cream wrapper bar, MacBook + rose-gold ring props — landscape | Gallery second image, white choc detail |

The single-bar lifestyle shots (MacBook corner, titanium/smart ring) are the strongest signal props for the target audience. Use them in gallery position 2, not as hero.

Do not use `a-very-good-dark-chocolate-alternative.png` (cream-wrapped dark choc bar) — user explicitly rejected this for the dark chocolate product.

## Copy Register
- Direct, confident, no fluff — Puresport-level restraint
- Short sentences, no adjective stacking
- Bulgarian body copy; avoid supplement clichés ("зареди", "maximise gains" etc.)
- CTA buttons: "Поръчай" not "Купи сега" — slightly more understated
- Hero copy formula: short declarative + italic qualifier ("Чиста храна за *хора с цели*")

### Accent color usage
- Decorative lines: `h-px bg-accent/50` (section dividers, under headings)
- Hover on text links: `hover:text-accent`
- Product detail: check marks (`text-accent`), ingredient bullets (`bg-accent`), nutrition badges (`text-accent`)
- **Sale prices**: `text-accent-price` (denser variant) — used in `PriceDisplay` component only
- Original price shown inline in brackets with strikethrough: `19,90 € (<s>25,50 €</s>)`
- Third-party brand colors: `text-stripe-brand` (footer), `text-trustpilot-green` (social proof)
- Never use accent as a button background on the shop side
- No hardcoded hex colors in components — all colors go through `globals.css` + `@theme` mapping

### Spacing
- Section padding: `py-16 sm:py-20 lg:py-24` (consistent across all pages)
- Container: `mx-auto max-w-7xl px-6 lg:px-8`

## What NOT to Do
- No pink/rose anywhere — even subtle hue 350 tints were removed
- No `hover:shadow-lg` — shadows read as generic e-commerce
- No centred hero text — left-aligned is more editorial
- No explicit gender references in copy or UI
- No `hover:bg-accent` on buttons — use `hover:bg-secondary` or `hover:opacity-90`
- Do not change card aspect ratio back to `aspect-square` — portrait is correct for these box shots
- No `backdrop-blur-md` on cards with solid backgrounds
