/**
 * CardTile.tsx — stylized, IP-safe credit-card representation.
 *
 * NOT a real card image: no bank logos, no network marks (Visa/Mastercard/RuPay/Amex), no photos.
 * A self-designed tile — issuer-coloured gradient, a pure-CSS gold chip glyph, a diagonal sheen,
 * and the card name embossed lower-left. Display-only; reads nothing from the engine.
 *
 * Sizing uses container-query units (cqw) so the tile scales with its container width — the same
 * component works as a 78px thumbnail in RecommendationCard and as a large tile in the dev gallery.
 */
import React from 'react';

/** Issuer brand colours. Keys are EXACT-match after .toUpperCase() on the card's `bank` field. */
const ISSUER_COLORS_RAW: Record<string, string | { from: string; to: string }> = {
  HDFC: '#004C8F',
  ICICI: '#AE282E',
  HSBC: '#DB0011',
  'AMERICAN EXPRESS': '#016FD0',
  AXIS: '#97144D',
  'IDFC FIRST': '#9C1D26',
  SBI: '#22409A',
  'YES BANK': '#00518F',
  // SCAPIA handled via card-name exception below → { from:'#1A1A1A', to:'#F04E23' }
  // future (uncomment when a card is added):
  // KOTAK: '#003874',
  // 'STANDARD CHARTERED': '#0473EA',
  // RBL: '#A6093D',
};
/** Pre-uppercase the keys once so lookups are deterministic regardless of source casing. */
const ISSUER_COLORS: Record<string, string | { from: string; to: string }> =
  Object.fromEntries(Object.entries(ISSUER_COLORS_RAW).map(([k, v]) => [k.toUpperCase(), v]));

const SCAPIA_GRADIENT = { from: '#1A1A1A', to: '#F04E23' };
const ZINC_FALLBACK = '#27272a';

/** Parse a #rrggbb into [r,g,b]. */
function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
}
const toHex = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');

/** Relative luminance (0–255 scale) for the min-floor check on dark single-hex issuers. */
function luminance([r, g, b]: [number, number, number]): number {
  return 0.299 * r + 0.587 * g + 0.114 * b;
}

/** Blend a colour toward white by `t` (0..1). */
function lighten(hex: string, t: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `#${toHex(r + (255 - r) * t)}${toHex(g + (255 - g) * t)}${toHex(b + (255 - b) * t)}`;
}

export interface ResolvedTileColor {
  from: string;
  to: string;
  isFallback: boolean;
}

/**
 * Resolve the two gradient stops for a card. Exported so the dev gallery can label each tile with
 * its resolved colour (or FALLBACK) — proving no issuer silently drops to zinc.
 */
export function resolveTileColor(cardName: string, issuer: string): ResolvedTileColor {
  // Scapia exception is keyed on CARD NAME, never on bank (so a future Federal Bank card
  // does not inherit Scapia's orange).
  if (cardName.toUpperCase().startsWith('SCAPIA')) {
    return { from: SCAPIA_GRADIENT.from, to: SCAPIA_GRADIENT.to, isFallback: false };
  }
  const entry = ISSUER_COLORS[(issuer ?? '').toUpperCase().trim()];
  if (entry == null) {
    // Unknown issuer → neutral zinc tile. Never crash.
    return { from: lighten(ZINC_FALLBACK, 0.12), to: ZINC_FALLBACK, isFallback: true };
  }
  if (typeof entry === 'object') {
    // {from,to} pair used directly — no luminance floor.
    return { from: entry.from, to: entry.to, isFallback: false };
  }
  // Single hex → component generates the two-stop gradient, applying a min-luminance floor so
  // very dark issuers stay visible on the #09090b page background.
  const MIN_LUM = 70;
  let base = entry;
  if (luminance(hexToRgb(base)) < MIN_LUM) base = lighten(base, 0.18);
  return { from: lighten(base, 0.22), to: base, isFallback: false };
}

interface Props {
  cardName: string;
  issuer: string;
  tier?: string;
}

export const CardTile: React.FC<Props> = ({ cardName, issuer, tier }) => {
  const { from, to } = resolveTileColor(cardName, issuer);
  return (
    <div className="wf-tile" style={{ background: `linear-gradient(160deg, ${from} 0%, ${to} 100%)` }}>
      <style>{css}</style>
      {/* diagonal sheen so the tile catches light */}
      <div className="wf-tile-sheen" />
      {/* gold chip glyph — pure CSS, no network/bank mark */}
      <div className="wf-tile-chip" />
      {tier && <div className="wf-tile-tier">{tier}</div>}
      {/* embossed card name, lower-left */}
      <div className="wf-tile-name">{cardName}</div>
    </div>
  );
};

const css = `
.wf-tile{position:relative;width:100%;aspect-ratio:1.586;border-radius:8px;overflow:hidden;
  container-type:inline-size;box-shadow:0 2px 8px rgba(0,0,0,.35);border:1px solid rgba(255,255,255,.06)}
.wf-tile-sheen{position:absolute;inset:0;pointer-events:none;
  background:linear-gradient(115deg,transparent 38%,rgba(255,255,255,.10) 50%,transparent 62%)}
.wf-tile-chip{position:absolute;top:18%;left:9cqw;width:16cqw;height:11cqw;border-radius:2cqw;
  background:linear-gradient(135deg,#E3C75A 0%,#C9A227 45%,#A07D1A 100%);
  box-shadow:inset 0 0 0 .6cqw rgba(0,0,0,.12)}
.wf-tile-chip::after{content:'';position:absolute;inset:30% 18%;border-radius:1cqw;
  border:.5cqw solid rgba(0,0,0,.18)}
.wf-tile-name{position:absolute;left:9cqw;bottom:9cqw;right:9cqw;
  font-family:'DM Sans',system-ui,sans-serif;font-weight:700;font-size:8.5cqw;line-height:1.15;
  color:#fff;letter-spacing:-.01em;text-shadow:0 1px 2px rgba(0,0,0,.45);
  overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.wf-tile-tier{position:absolute;top:8cqw;right:9cqw;font-family:'DM Sans',system-ui,sans-serif;
  font-size:5.5cqw;font-weight:700;text-transform:uppercase;letter-spacing:.05em;
  color:rgba(255,255,255,.85);background:rgba(0,0,0,.22);border-radius:3cqw;padding:1cqw 3cqw}
`;

export default CardTile;
