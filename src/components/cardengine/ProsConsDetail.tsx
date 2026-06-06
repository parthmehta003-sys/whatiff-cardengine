/**
 * ProsConsDetail.tsx — the "Know more" full list. Renders the VERBATIM Excel pros/cons text for a
 * card, lightly structured into readable lines. This is reference content (not value-reframed) — the
 * card itself shows the impactful top 2-3; this shows everything the issuer terms cover.
 *
 * Pure display. Opens as an overlay from the recommendation card's "See all pros & cons →".
 */
import React, { useState } from 'react';

interface Props {
  cardName: string;
  rawPros: string | null;
  rawCons: string | null;
  onClose: () => void;
}

/** Split the dense Excel text into lines; treat "Header:" lines as subheadings. */
function structure(raw: string | null): { heading?: boolean; text: string }[] {
  if (!raw) return [];
  return raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      // a short line ending in ":" is a section header
      const isHeading = /:\s*$/.test(l) && l.length < 48;
      return { heading: isHeading, text: l.replace(/:\s*$/, isHeading ? '' : ':') };
    });
}

// Section importance for reordering — rewards/redemption/caps/fees lead; welcome/misc trail.
const SECTION_RANK: { re: RegExp; rank: number }[] = [
  { re: /reward value|redemption|transfer value/i, rank: 1 },
  { re: /reward/i, rank: 2 },
  { re: /cap/i, rank: 3 },
  { re: /fee|charge|markup|forex/i, rank: 4 },
  { re: /exclu/i, rank: 5 },
  { re: /lounge|insurance|benefit|privilege|membership/i, rank: 6 },
  { re: /joining|welcome|renewal/i, rank: 8 },
];
function sectionRank(heading: string): number {
  for (const s of SECTION_RANK) if (s.re.test(heading)) return s.rank;
  return 7; // unknown sections sit just before joining/welcome
}

/** Group structured lines under their headings, return ordered groups (heading + items). */
function groupSections(lines: { heading?: boolean; text: string }[]): { heading: string; items: string[] }[] {
  if (lines.length === 0) return [];
  const groups: { heading: string; items: string[] }[] = [];
  let cur: { heading: string; items: string[] } | null = null;
  for (const l of lines) {
    if (l.heading) {
      cur = { heading: l.text, items: [] };
      groups.push(cur);
    } else if (cur) {
      cur.items.push(l.text);
    } else {
      // lines before any heading → a "Highlights" group
      if (!cur) { cur = { heading: 'Highlights', items: [] }; groups.push(cur); }
      cur.items.push(l.text);
    }
  }
  return groups
    .map((g, i) => ({ g, i, rank: sectionRank(g.heading) }))
    .sort((a, b) => (a.rank - b.rank) || (a.i - b.i))
    .map((x) => x.g);
}

export const ProsConsDetail: React.FC<Props> = ({ cardName, rawPros, rawCons, onClose }) => {
  const [tab, setTab] = useState<'pros' | 'cons'>('pros');
  const pros = groupSections(structure(rawPros));
  const cons = groupSections(structure(rawCons));

  return (
    <div className="wf-pcd-overlay" onClick={onClose}>
      <style>{css}</style>
      <div className="wf-pcd" onClick={(e) => e.stopPropagation()}>
        <div className="wf-pcd-head">
          <div>
            <div className="wf-pcd-kicker">Full details</div>
            <div className="wf-pcd-title">{cardName}</div>
          </div>
          <button className="wf-pcd-close" onClick={onClose}>✕</button>
        </div>

        <div className="wf-pcd-tabs">
          <button className={tab === 'pros' ? 'on wf-pcd-tab-pro' : ''} onClick={() => setTab('pros')}>
            Pros{pros.length ? ` (${pros.length})` : ''}
          </button>
          <button className={tab === 'cons' ? 'on wf-pcd-tab-con' : ''} onClick={() => setTab('cons')}>
            Cons &amp; fine print{cons.length ? ` (${cons.length})` : ''}
          </button>
        </div>

        <div className="wf-pcd-body">
          <div className="wf-pcd-body-inner">
          {(tab === 'pros' ? pros : cons).length === 0 ? (
            <div className="wf-pcd-empty">No details listed.</div>
          ) : (
            (tab === 'pros' ? pros : cons).map((g, i) => (
              <details key={i} className="wf-pcd-group" open={i === 0}>
                <summary>{g.heading}<span className="wf-pcd-count">{g.items.length}</span></summary>
                <div className="wf-pcd-lines">
                  {g.items.map((t, j) => (
                    <div key={j} className={'wf-pcd-line ' + (tab === 'pros' ? 'wf-pcd-pline' : 'wf-pcd-cline')}>{t}</div>
                  ))}
                </div>
              </details>
            ))
          )}
          </div>
          <div className="wf-pcd-fade" aria-hidden="true" />
        </div>

        <div className="wf-pcd-foot">
          Sourced from the issuer&rsquo;s published terms. Always confirm current terms on the bank&rsquo;s site before applying.
        </div>
      </div>
    </div>
  );
};

const css = `
.wf-pcd-overlay{position:fixed;inset:0;background:rgba(0,0,0,.7);backdrop-filter:blur(3px);
  display:flex;align-items:flex-end;justify-content:center;z-index:100;font-family:'DM Sans',system-ui,sans-serif}
@media(min-width:560px){.wf-pcd-overlay{align-items:center}}
.wf-pcd{background:#0c0c0e;border:1px solid #27272a;border-radius:18px 18px 0 0;width:100%;max-width:600px;
  max-height:88vh;display:flex;flex-direction:column;overflow:hidden}
@media(min-width:560px){.wf-pcd{border-radius:18px}}
.wf-pcd-head{display:flex;align-items:flex-start;justify-content:space-between;padding:18px;border-bottom:1px solid #1f1f23}
.wf-pcd-kicker{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#52525b}
.wf-pcd-title{font-size:18px;font-weight:800;color:#fafafa;margin-top:2px}
.wf-pcd-close{background:#18181b;border:1px solid #27272a;color:#a1a1aa;width:32px;height:32px;border-radius:8px;
  cursor:pointer;font-size:14px;flex:0 0 auto}
.wf-pcd-tabs{display:flex;gap:8px;padding:14px 18px 0}
.wf-pcd-tabs button{flex:1;background:#111113;border:1px solid #27272a;color:#a1a1aa;font-family:inherit;
  font-size:13px;font-weight:700;padding:10px;border-radius:9px;cursor:pointer;transition:.12s}
.wf-pcd-tabs button.on.wf-pcd-tab-pro{background:#0a1410;border-color:#10b981;color:#34d399}
.wf-pcd-tabs button.on.wf-pcd-tab-con{background:#1a1206;border-color:#b45309;color:#fbbf24}
.wf-pcd-body{padding:14px 18px 0;overflow-y:auto;flex:1;min-height:0;display:flex;flex-direction:column;gap:8px}
.wf-pcd-body-inner{display:flex;flex-direction:column;gap:8px;padding-bottom:14px}
.wf-pcd-fade{position:sticky;bottom:0;height:40px;margin-top:-40px;flex-shrink:0;pointer-events:none;
  background:linear-gradient(to bottom,transparent,#0c0c0e)}
.wf-pcd-group{background:#111113;border:1px solid #1f1f23;border-radius:10px;overflow:hidden}
.wf-pcd-group>summary{list-style:none;cursor:pointer;padding:12px 14px;font-size:12.5px;font-weight:700;
  text-transform:uppercase;letter-spacing:.03em;color:#e4e4e7;display:flex;align-items:center;
  justify-content:space-between;user-select:none}
.wf-pcd-group>summary::-webkit-details-marker{display:none}
.wf-pcd-group>summary:after{content:'⌄';font-size:15px;color:#52525b;transition:transform .2s}
.wf-pcd-group[open]>summary:after{transform:rotate(180deg)}
.wf-pcd-count{margin-left:auto;margin-right:10px;font-size:10px;font-weight:700;color:#52525b;
  background:#18181b;border-radius:10px;padding:1px 7px}
.wf-pcd-lines{display:flex;flex-direction:column;gap:6px;padding:0 14px 13px}
.wf-pcd-line{font-size:12.5px;color:#d4d4d8;line-height:1.5;padding-left:14px;position:relative}
.wf-pcd-pline:before{content:'+';position:absolute;left:0;color:#10b981;font-weight:800}
.wf-pcd-cline:before{content:'−';position:absolute;left:0;color:#f59e0b;font-weight:800}
.wf-pcd-empty{font-size:12.5px;color:#52525b}
.wf-pcd-foot{padding:13px 18px;border-top:1px solid #1f1f23;font-size:11px;color:#52525b;line-height:1.5}
`;

export default ProsConsDetail;
