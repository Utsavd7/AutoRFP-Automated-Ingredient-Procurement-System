# QuotePlate brand kit

## Provisional identity

**QuotePlate** is the working product name and **QuotePlate Technologies** is the working company name. Both remain provisional until formal company-name, trademark, and domain clearance is complete.

The name joins the product's two sides: supplier **quotes** and the restaurant **plate** those purchases ultimately serve. The promise is deliberately operational: **Every quote, accountable.**

## Mark meaning

The mark uses two offset document forms. The first is a restaurant request; the second is a supplier quote. Their shared negative space creates a forward route toward a recorded decision, with a restrained Q/P hint at small sizes.

The React component in `src/components/brand/BrandMark.tsx` is the canonical geometry. The SVG files in `public/brand/` use the same path data and are guarded by an automated synchronization test.

## Asset files

| File | Use |
| --- | --- |
| `public/brand/mark-ink.svg` | One-colour print, document, and light-surface mark |
| `public/brand/mark-duotone.svg` | Primary copper-and-ink mark on light surfaces |
| `public/brand/wordmark-horizontal.svg` | Navigation, documents, presentations, and partner listings; Newsreader lettering is converted to real vector outlines |
| `public/brand/app-icon.svg` | Square application, social, and shortcut icon |
| `public/brand/social-card.png` | 1200 × 630 Open Graph and large Twitter/X link preview |

The logo assets are scalable SVGs with clean view boxes and no gradients or embedded raster images. The outlined wordmark is self-contained and does not require Newsreader to be installed. The social card is a static PNG so sharing crawlers do not need JavaScript, a font service, or a paid image API.

## Colour

| Token | Hex | Role |
| --- | --- | --- |
| Ink | `#101817` | Primary text, dark surfaces, and one-colour mark |
| Raised ink | `#172521` | Elevated dark surfaces |
| Stone | `#F5F1E8` | Primary light surface |
| Soft stone | `#EBE5D9` | Secondary light surface and table headers |
| Copper | `#D8834F` | Brand decoration and logo accent |
| Copper text | `#9B4C26` | Contrast-safe copper text on light surfaces |
| Success green | `#285E4D` | Real valid or successful states only |

Copper is the only brand accent. Do not replace it with purple, blue, a glow, or a gradient. Green is semantic, not decorative.

## Typography and licence

- **Newsreader Variable**: display headings and the QuotePlate wordmark.
- **Manrope Variable**: navigation, body copy, controls, and product UI.
- Use tabular numerals for INR values, quantities, and dates.

Both typefaces are open-source and distributed under the SIL Open Font License 1.1. The bundled notice and licence are in `public/fonts/OFL-1.1.txt`.

## Clear space and minimum size

Keep clear space around the mark equal to at least one internal notch width, approximately one quarter of the mark's width. Do not allow text, rules, or other marks inside that area.

- Standalone mark: minimum **20 px** digital or **6 mm** print.
- Horizontal wordmark: minimum **120 px** digital or **32 mm** print.
- Below the wordmark minimum, use the standalone mark.

## One-colour use

Use the ink mark on stone or white. On ink backgrounds, reverse the complete mark to stone. Copper may be used as a complete one-colour mark only when it has sufficient contrast for the context; it is primarily an accent in the duotone version.

## Misuse

- Do not redraw, rotate, stretch, outline, bevel, or add shadows to the mark.
- Do not change the spacing or overlap of the two document forms.
- Do not place the mark on a busy image or low-contrast colour.
- Do not introduce gradients, glows, extra colours, or decorative symbols.
- Do not use a chef hat, plate illustration, speech bubble, or unrelated procurement icon in place of the mark.
- Do not treat the provisional name as legally cleared until formal checks are complete.
