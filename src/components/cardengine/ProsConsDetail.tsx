/**
 * ProsConsDetail.tsx — "Know more" full list. Renders verbatim issuer pros/cons text,
 * grouped into sections with calm all-expanded layout. Single scrolling body — no accordions.
 */
import React, { useState } from 'react';

interface Props {
  cardName: string;
  rawPros: string | null;
  rawCons: string | null;
  onClose: () => void;
}

function structure(raw: string | null): { heading?: boolean; text: string }[] {
  if (!raw) return [];
  return raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const isHeading = /:\s*$/.test(l) && l.length < 48;
      return { heading: isHeading, text: l.replace(/:\s*$/, isHeading ? '' : ':') };
    });
}

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
  return 7;
}

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
      if (!cur) { cur = { heading: 'Highlights', items: [] }; groups.push(cur); }
      cur.items.push(l.text);
    }
  }
  return groups
    .map((g, i) => ({ g, i, rank: sectionRank(g.heading) }))
    .sort((a, b) => (a.rank - b.rank) || (a.i - b.i))
    .map((x) => x.g);
}

const totalItems = (groups: { items: string[] }[]) =>
  groups.reduce((s, g) => s + g.items.length, 0);

export const ProsConsDetail: React.FC<Props> = ({ cardName, rawPros, rawCons, onClose }) => {
  const [tab, setTab] = useState<'pros' | 'cons'>('pros');
  const pros = groupSections(structure(rawPros));
  const cons = groupSections(structure(rawCons));

  const groups = tab === 'pros' ? pros : cons;
  const isPros = tab === 'pros';

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
          <button
            className={tab === 'pros' ? 'on wf-pcd-tab-pro' : ''}
            onClick={() => setTab('pros')}
          >
            Pros{pros.length ? ` (${totalItems(pros)})` : ''}
          </button>
          <button
            className={tab === 'cons' ? 'on wf-pcd-tab-con' : ''}
            onClick={() => setTab('cons')}
          >
            Cons &amp; fine print{cons.length ? ` (${totalItems(cons)})` : ''}
          </button>
        </div>

        <div className="wf-pcd-body">
          {groups.length === 0 ? (
            <div className="wf-pcd-empty">No details listed.</div>
          ) : (
            groups.map((g, i) => (
              <div key={i} className={'wf-pcd-section' + (i === 0 ? ' first' : '')}>
                <div className="wf-pcd-sh">{g.heading}</div>
                <div className="wf-pcd-items">
                  {g.items.map((t, j) => (
                    <div key={j} className={'wf-pcd-item' + (isPros ? ' pro' : ' con')}>
                      {t}
                    </div>
                  ))}
                </div>
              </div>
            ))
          )}
        </div>

        <div className="wf-pcd-foot">
          Sourced from the issuer&rsquo;s published terms. Always confirm current terms on the bank&rsquo;s site before applying.
        </div>

      </div>
    </div>
  );
};

const css = `
.wf-pcd-overlay{
  position:fixed;inset:0;background:rgba(0,0,0,.72);backdrop-filter:blur(3px);
  display:flex;align-items:flex-end;justify-content:center;z-index:100;
  font-family:'DM Sans',system-ui,sans-serif}
@media(min-width:560px){.wf-pcd-overlay{align-items:center}}

.wf-pcd{
  background:#0c0c0e;border:1px solid #27272a;border-radius:18px 18px 0 0;
  width:100%;max-width:600px;max-height:88vh;
  display:flex;flex-direction:column;overflow:hidden}
@media(min-width:560px){.wf-pcd{border-radius:18px}}

/* Fixed header */
.wf-pcd-head{
  display:flex;align-items:flex-start;justify-content:space-between;
  padding:18px 20px;border-bottom:1px solid #1f1f23;flex-shrink:0}
.wf-pcd-kicker{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.08em;color:#52525b}
.wf-pcd-title{font-size:18px;font-weight:800;color:#fafafa;margin-top:2px}
.wf-pcd-close{
  background:#18181b;border:1px solid #27272a;color:#a1a1aa;
  width:32px;height:32px;border-radius:8px;cursor:pointer;font-size:14px;flex-shrink:0}

/* Fixed tabs */
.wf-pcd-tabs{display:flex;gap:8px;padding:14px 20px 0;flex-shrink:0}
.wf-pcd-tabs button{
  flex:1;background:#111113;border:1px solid #27272a;color:#a1a1aa;font-family:inherit;
  font-size:13px;font-weight:700;padding:10px;border-radius:9px;cursor:pointer;transition:.12s}
.wf-pcd-tabs button.on.wf-pcd-tab-pro{background:#0a1410;border-color:#10b981;color:#34d399}
.wf-pcd-tabs button.on.wf-pcd-tab-con{background:#1a1206;border-color:#b45309;color:#fbbf24}

/* Scrolling body — plain div, no flex children that confuse scroll height */
.wf-pcd-body{
  flex:1;min-height:0;overflow-y:auto;
  padding:20px 20px 0;
  display:flex;flex-direction:column;
  /* scroll shadow: self-hides when content fits without scrolling */
  background:
    linear-gradient(to bottom,transparent,#0c0c0e) 0 100%/100% 52px no-repeat local,
    linear-gradient(to bottom,transparent,#0c0c0e) 0 100%/100% 52px no-repeat scroll}

/* Section */
.wf-pcd-section{padding-bottom:20px}
.wf-pcd-section:not(.first){border-top:1px solid #1a1a1e;padding-top:18px}

/* Section heading */
.wf-pcd-sh{
  font-size:10px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;
  color:#52525b;margin-bottom:10px}

/* Item rows */
.wf-pcd-items{display:flex;flex-direction:column;gap:8px}
.wf-pcd-item{
  font-size:13px;color:#d4d4d8;line-height:1.6;
  padding-left:18px;position:relative}
.wf-pcd-item.pro:before{content:'+';position:absolute;left:0;color:#10b981;font-weight:800;line-height:1.6}
.wf-pcd-item.con:before{content:'−';position:absolute;left:0;color:#f59e0b;font-weight:800;line-height:1.6}

.wf-pcd-empty{font-size:13px;color:#52525b;padding-bottom:20px}

/* Fixed footer */
.wf-pcd-foot{
  padding:13px 20px;border-top:1px solid #1f1f23;
  font-size:11px;color:#3f3f46;line-height:1.5;flex-shrink:0}
`;

export default ProsConsDetail;
