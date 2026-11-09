// Generates assets/contribution-graph.svg — a self-hosted, on-brand contribution chart.
// Data: GitHub GraphQL (when GITHUB_TOKEN is set), falling back to a public contributions API.
// Usage: node scripts/contribution-graph.mjs [username] [output]
import { writeFileSync } from 'node:fs';

const USER = process.argv[2] || 'PascalMTK';
const OUT = process.argv[3] || 'assets/contribution-graph.svg';

async function fromGraphQL(token) {
  const query = `query($login:String!){user(login:$login){contributionsCollection{contributionCalendar{
    weeks{contributionDays{date contributionCount}}}}}}`;
  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST',
    headers: { Authorization: `bearer ${token}`, 'Content-Type': 'application/json', 'User-Agent': 'profile-graph' },
    body: JSON.stringify({ query, variables: { login: USER } }),
  });
  const json = await res.json();
  const weeks = json?.data?.user?.contributionsCollection?.contributionCalendar?.weeks;
  if (!weeks) throw new Error('GraphQL: ' + JSON.stringify(json.errors || json).slice(0, 200));
  return weeks.flatMap((w) => w.contributionDays.map((d) => ({ date: d.date, count: d.contributionCount })));
}

async function fromPublicApi() {
  const res = await fetch(`https://github-contributions-api.jogruber.de/v4/${USER}?y=last`);
  if (!res.ok) throw new Error('Public API: HTTP ' + res.status);
  const json = await res.json();
  return json.contributions.map((d) => ({ date: d.date, count: d.count }));
}

let days;
try {
  days = process.env.GITHUB_TOKEN ? await fromGraphQL(process.env.GITHUB_TOKEN) : await fromPublicApi();
} catch (e) {
  console.warn(e.message, '— trying public API');
  days = await fromPublicApi();
}
const today = new Date().toISOString().slice(0, 10);
days = days.filter((d) => d.date <= today).sort((a, b) => a.date.localeCompare(b.date)).slice(-364);
if (days.length < 30) throw new Error('Not enough data');

// ---- aggregate into 52 weekly buckets ------------------------------------------------
const weeks = [];
for (let i = 0; i < days.length; i += 7) {
  const chunk = days.slice(i, i + 7);
  weeks.push({ start: chunk[0].date, total: chunk.reduce((s, d) => s + d.count, 0) });
}
const total = days.reduce((s, d) => s + d.count, 0);
const activeDays = days.filter((d) => d.count > 0).length;
const best = days.reduce((m, d) => (d.count > m.count ? d : m), days[0]);
const last30 = days.slice(-30).reduce((s, d) => s + d.count, 0);
const bestWeekIdx = weeks.reduce((m, w, i) => (w.total > weeks[m].total ? i : m), 0);

// ---- geometry -----------------------------------------------------------------------
const W = 1200, H = 400;
const X0 = 72, X1 = 1160, Y0 = 150, Y1 = 340; // plot area
const maxV = Math.max(4, ...weeks.map((w) => w.total));
const niceMax = (() => {
  const step = Math.pow(10, Math.floor(Math.log10(maxV)));
  for (const m of [1, 2, 2.5, 5, 10]) if (m * step >= maxV) return m * step;
  return 10 * step;
})();
const px = (i) => X0 + (i * (X1 - X0)) / (weeks.length - 1);
const py = (v) => Y1 - (v / niceMax) * (Y1 - Y0);
const pts = weeks.map((w, i) => [px(i), py(w.total)]);

// Catmull-Rom → cubic Bézier, clamped so the curve never dips under the baseline.
function smooth(points) {
  let d = `M${points[0][0].toFixed(1)} ${points[0][1].toFixed(1)}`;
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] || points[i], p1 = points[i], p2 = points[i + 1], p3 = points[i + 2] || p2;
    const t = 0.18;
    const c1 = [p1[0] + (p2[0] - p0[0]) * t, Math.min(Y1, p1[1] + (p2[1] - p0[1]) * t)];
    const c2 = [p2[0] - (p3[0] - p1[0]) * t, Math.min(Y1, p2[1] - (p3[1] - p1[1]) * t)];
    d += ` C${c1[0].toFixed(1)} ${c1[1].toFixed(1)} ${c2[0].toFixed(1)} ${c2[1].toFixed(1)} ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`;
  }
  return d;
}
const line = smooth(pts);
const area = `${line} L${X1} ${Y1} L${X0} ${Y1} Z`;

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const monthLabels = [];
let lastMonth = -1;
weeks.forEach((w, i) => {
  const m = new Date(w.start + 'T00:00:00Z').getUTCMonth();
  if (m !== lastMonth && i > 0 && i < weeks.length - 1) monthLabels.push([px(i), MONTHS[m]]);
  lastMonth = m;
});
const fmtDate = (s) => { const d = new Date(s + 'T00:00:00Z'); return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`; };

const grid = [0.25, 0.5, 0.75, 1].map((f) => {
  const y = py(niceMax * f);
  return `<line x1="${X0}" y1="${y.toFixed(1)}" x2="${X1}" y2="${y.toFixed(1)}" stroke="#FFFFFF" stroke-opacity=".06" stroke-dasharray="3 5"/>
    <text x="${X0 - 14}" y="${(y + 4).toFixed(1)}" text-anchor="end" class="mono axis">${+(niceMax * f).toFixed(1)}</text>`;
}).join('\n    ');

const [bx, by] = pts[bestWeekIdx];
const [ex, ey] = pts[pts.length - 1];
const bestLabelAnchor = bx > X1 - 120 ? 'end' : bx < X0 + 120 ? 'start' : 'middle';

const stat = (x, value, label, color, delay) => `
  <g class="in" style="animation-delay:${delay}s">
    <text x="${x}" y="78" class="sans" font-size="30" font-weight="800" fill="${color}">${value}</text>
    <text x="${x}" y="102" class="mono" font-size="11" fill="#64748B" letter-spacing="2">${label}</text>
  </g>`;

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${USER}: ${total} contributions in the last year, ${activeDays} active days, best day ${best.count} on ${fmtDate(best.date)}.">
  <style>
    .sans { font-family: 'Segoe UI', Inter, -apple-system, 'Helvetica Neue', Arial, sans-serif; }
    .mono { font-family: 'JetBrains Mono', 'Fira Code', 'Cascadia Code', Consolas, 'SFMono-Regular', Menlo, monospace; }
    .axis { font-size: 11px; fill: #475569; }
    .in { opacity: 0; animation: in .8s cubic-bezier(.2,.7,.2,1) forwards; }
    @keyframes in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
    .draw { stroke-dasharray: 1; stroke-dashoffset: 1; animation: draw 2.4s cubic-bezier(.45,.05,.2,1) forwards .4s; }
    @keyframes draw { to { stroke-dashoffset: 0; } }
    .area { opacity: 0; animation: fade 1.4s ease-out forwards 1.6s; }
    @keyframes fade { to { opacity: 1; } }
    .late { opacity: 0; animation: fade .6s ease-out forwards 2.7s; }
  </style>
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0B1020"/><stop offset="1" stop-color="#0E1328"/></linearGradient>
    <linearGradient id="stroke" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#22D3EE"/><stop offset=".7" stop-color="#22D3EE"/><stop offset="1" stop-color="#FB923C"/></linearGradient>
    <linearGradient id="fill" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#22D3EE" stop-opacity=".28"/><stop offset="1" stop-color="#22D3EE" stop-opacity="0"/></linearGradient>
    <filter id="soft" x="-5%" y="-30%" width="110%" height="160%"><feGaussianBlur stdDeviation="6"/></filter>
    <clipPath id="frame"><rect width="${W}" height="${H}" rx="18"/></clipPath>
  </defs>

  <g clip-path="url(#frame)">
    <rect width="${W}" height="${H}" fill="url(#bg)"/>
  </g>
  <rect x=".5" y=".5" width="${W - 1}" height="${H - 1}" rx="18" fill="none" stroke="#FFFFFF" stroke-opacity=".08"/>

  <text x="${X0 - 40}" y="40" class="mono" font-size="12" fill="#22D3EE" letter-spacing="2">CONTRIBUTION ACTIVITY</text>
  <text x="${W - 40}" y="40" class="mono" font-size="12" fill="#475569" letter-spacing="2" text-anchor="end">LAST 12 MONTHS · WEEKLY</text>
  ${stat(X0 - 40, total, 'CONTRIBUTIONS', '#F8FAFC', 0.1)}
  ${stat(X0 + 200, activeDays, 'ACTIVE DAYS', '#F8FAFC', 0.25)}
  ${stat(X0 + 400, last30, 'LAST 30 DAYS', '#22D3EE', 0.4)}
  ${stat(X0 + 600, best.count, `BEST DAY · ${fmtDate(best.date).toUpperCase()}`, '#FB923C', 0.55)}

  <g>
    ${grid}
    <line x1="${X0}" y1="${Y1}" x2="${X1}" y2="${Y1}" stroke="#FFFFFF" stroke-opacity=".12"/>
  </g>
  <g class="mono axis" text-anchor="middle">
    ${monthLabels.map(([x, m]) => `<text x="${x.toFixed(1)}" y="${Y1 + 24}">${m}</text>`).join('')}
  </g>

  <path class="area" d="${area}" fill="url(#fill)"/>
  <path class="draw" d="${line}" pathLength="1" fill="none" stroke="#22D3EE" stroke-width="6" stroke-opacity=".35" filter="url(#soft)"/>
  <path class="draw" d="${line}" pathLength="1" fill="none" stroke="url(#stroke)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>

  <g class="late">
    <line x1="${bx.toFixed(1)}" y1="${(by + 8).toFixed(1)}" x2="${bx.toFixed(1)}" y2="${Y1}" stroke="#FB923C" stroke-opacity=".35" stroke-dasharray="2 4"/>
    <circle cx="${bx.toFixed(1)}" cy="${by.toFixed(1)}" r="5" fill="#0B1020" stroke="#FB923C" stroke-width="2"/>
    <text x="${bx.toFixed(1)}" y="${(by - 14).toFixed(1)}" class="mono" font-size="11" fill="#FB923C" text-anchor="${bestLabelAnchor}">peak week · ${weeks[bestWeekIdx].total}</text>
  </g>
  <g class="late">
    <circle cx="${ex.toFixed(1)}" cy="${ey.toFixed(1)}" r="4" fill="#FB923C"/>
    <circle cx="${ex.toFixed(1)}" cy="${ey.toFixed(1)}" r="4" fill="none" stroke="#FB923C">
      <animate attributeName="r" values="4;14" dur="1.8s" repeatCount="indefinite"/>
      <animate attributeName="opacity" values=".9;0" dur="1.8s" repeatCount="indefinite"/>
    </circle>
  </g>
</svg>
`;
writeFileSync(OUT, svg);
console.log(`Wrote ${OUT}: ${total} contributions, ${activeDays} active days, best ${best.count} on ${best.date}`);
