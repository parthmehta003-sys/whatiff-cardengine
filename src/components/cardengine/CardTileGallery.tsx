/**
 * CardTileGallery.tsx — DEV-ONLY verification view for CardTile.
 *
 * Gated behind location.hash === '#tiles'. Renders every card in the DB as a tile and prints the
 * RESOLVED gradient colour (or the word FALLBACK) next to each name — so a tile that's grey because
 * zinc is intended is distinguishable from one that's grey because the issuer lookup missed.
 * Remove this view (and its label) once the tiles are verified.
 */
import React from 'react';
import type { CardMeta } from '../../lib/cardEngine/rankCards';
import CardTile, { resolveTileColor } from './CardTile';

export const CardTileGallery: React.FC<{ cards: CardMeta[] }> = ({ cards }) => {
  const fallbackCount = cards.filter((c) => resolveTileColor(c.name, c.bank).isFallback).length;
  return (
    <div className="wf-gal">
      <style>{css}</style>
      <h2>CardTile gallery — {cards.length} tiles · {fallbackCount} fallback</h2>
      <div className="wf-gal-grid">
        {cards.map((c) => {
          const r = resolveTileColor(c.name, c.bank);
          return (
            <div key={c.cardId} className="wf-gal-cell">
              <CardTile cardName={c.name} issuer={c.bank} />
              <div className="wf-gal-meta">
                <div className="wf-gal-name">{c.name}</div>
                <div className="wf-gal-issuer">{c.bank}</div>
                <div className={'wf-gal-color' + (r.isFallback ? ' fb' : '')}>
                  {r.isFallback ? 'FALLBACK' : `${r.from} → ${r.to}`}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

const css = `
.wf-gal{font-family:'DM Sans',system-ui,sans-serif;color:#e4e4e7;max-width:1100px;margin:0 auto;padding:24px}
.wf-gal h2{font-size:18px;font-weight:800;color:#fafafa;margin:0 0 18px}
.wf-gal-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:18px}
.wf-gal-cell{display:flex;flex-direction:column;gap:8px}
.wf-gal-meta{font-size:12px;line-height:1.4}
.wf-gal-name{font-weight:700;color:#fafafa}
.wf-gal-issuer{color:#a1a1aa;font-size:11px}
.wf-gal-color{font-family:ui-monospace,monospace;font-size:10.5px;color:#34d399}
.wf-gal-color.fb{color:#f59e0b;font-weight:700}
`;

export default CardTileGallery;
