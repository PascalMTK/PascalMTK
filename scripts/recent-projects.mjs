// Generates assets/recent-projects.svg — the most recently pushed public repositories.
// Data: GitHub REST API (GITHUB_TOKEN optional, raises the rate limit).
// Usage: node scripts/recent-projects.mjs [username] [output] [count]
import { writeFileSync } from 'node:fs';

const USER = process.argv[2] || 'PascalMTK';
const OUT = process.argv[3] || 'assets/recent-projects.svg';
const COUNT = Number(process.argv[4] || 4);
const TOKEN = process.env.GITHUB_TOKEN;
const HEADERS = { 'User-Agent': 'profile-stats', Accept: 'application/vnd.github+json', ...(TOKEN && { Authorization: `bearer ${TOKEN}` }) };

const LANG_COLORS = {
  JavaScript: '#f1e05a', TypeScript: '#3178c6', Python: '#3572A5', Java: '#b07219', PHP: '#4F5D95',
  HTML: '#e34c26', CSS: '#663399', SCSS: '#c6538c', Shell: '#89e051', 'C#': '#178600', 'C++': '#f34b7d',
  C: '#555555', Go: '#00ADD8', Kotlin: '#A97BFF', Dart: '#00B4AB', Hack: '#878787', Blade: '#f7523f',
  Vue: '#41b883', Swift: '#F05138', Rust: '#dea584', Ruby: '#701516', 'Jupyter Notebook': '#DA5B0B',
};

const res = await fetch(`https://api.github.com/users/${USER}/repos?sort=pushed&per_page=100&type=owner`, { headers: HEADERS });
if (!res.ok) throw new Error(`REST repos: HTTP ${res.status}`);
const repos = (await res.json())
  .filter((r) => !r.fork && !r.archived && !r.private && r.name.toLowerCase() !== USER.toLowerCase())
  .sort((a, b) => new Date(b.pushed_at) - new Date(a.pushed_at))
  .slice(0, COUNT);

// ---- helpers ------------------------------------------------------------------------
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const clip = (s, n) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s);
function wrap(text, width, lines) {
  const words = text.split(/\s+/).filter(Boolean);
  const out = [''];
  for (const w of words) {
    const cur = out[out.length - 1];
    if (!cur) out[out.length - 1] = w;
    else if ((cur + ' ' + w).length <= width) out[out.length - 1] = cur + ' ' + w;
    else out.push(w);
  }
  if (out.length > lines) {
    out.length = lines;
    out[lines - 1] = clip(out[lines - 1] + ' …', width).replace(/\s…$/, '…');
  }
  return out;
}
function ago(date) {
  const d = (Date.now() - new Date(date)) / 864e5;
  if (d < 1) return 'today';
  if (d < 2) return 'yesterday';
  if (d < 30) return `${Math.floor(d)} days ago`;
  if (d < 365) { const m = Math.floor(d / 30); return `${m} month${m > 1 ? 's' : ''} ago`; }
  const y = Math.floor(d / 365); return `${y} year${y > 1 ? 's' : ''} ago`;
}

// ---- geometry -----------------------------------------------------------------------
const W = 1200, PAD = 40, GAP = 20, CW = (W - PAD * 2 - GAP) / 2, CH = 150, TOP = 80;
const rows = Math.max(1, Math.ceil(repos.length / 2));
const H = TOP + rows * CH + (rows - 1) * GAP + PAD;

const cards = repos.map((r, i) => {
  const x = PAD + (i % 2) * (CW + GAP), y = TOP + Math.floor(i / 2) * (CH + GAP);
  const created = new Date(r.created_at).toLocaleDateString('en-US', { month: 'short', year: 'numeric' });
  const fallback = r.topics?.length ? r.topics.map((t) => '#' + t).join('  ') : `Public repository · started ${created}`;
  const desc = wrap(r.description || fallback, 66, 2);
  const lang = r.language || '—';
  const color = LANG_COLORS[r.language] || '#94A3B8';
  return `
  <g class="in" style="animation-delay:${(0.1 + i * 0.12).toFixed(2)}s">
    <rect x="${x}" y="${y}" width="${CW}" height="${CH}" rx="14" fill="#FFFFFF" fill-opacity=".03" stroke="#FFFFFF" stroke-opacity=".08"/>
    <text x="${x + 24}" y="${y + 40}" class="sans" font-size="20" font-weight="700" fill="#F8FAFC">${esc(clip(r.name, 40))}</text>
    <text x="${x + CW - 24}" y="${y + 40}" class="mono" font-size="12" fill="#64748B" text-anchor="end">${esc(ago(r.pushed_at))}</text>
    ${desc.map((l, j) => `<text x="${x + 24}" y="${y + 70 + j * 22}" class="sans" font-size="14" fill="#94A3B8">${esc(l)}</text>`).join('\n    ')}
    <circle cx="${x + 30}" cy="${y + CH - 26}" r="6" fill="${color}"/>
    <text x="${x + 44}" y="${y + CH - 21}" class="mono" font-size="13" fill="#E2E8F0">${esc(lang)}</text>
    <text x="${x + CW - 24}" y="${y + CH - 21}" class="mono" font-size="13" fill="#FB923C" text-anchor="end">★ ${r.stargazers_count}${r.forks_count ? `   <tspan fill="#22D3EE">⑂ ${r.forks_count}</tspan>` : ''}</text>
  </g>`;
}).join('');

const empty = repos.length ? '' : `<text x="${W / 2}" y="${TOP + 80}" class="sans" font-size="16" fill="#64748B" text-anchor="middle">No public repositories yet.</text>`;
const aria = `Recently active projects by ${USER}: ${repos.map((r) => `${r.name} (${r.language || 'no language'}, updated ${ago(r.pushed_at)})`).join('; ')}.`;

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(aria)}">
  <style>
    .sans { font-family: 'Segoe UI', Inter, -apple-system, 'Helvetica Neue', Arial, sans-serif; }
    .mono { font-family: 'JetBrains Mono', 'Fira Code', 'Cascadia Code', Consolas, 'SFMono-Regular', Menlo, monospace; }
    .in { opacity: 0; animation: in .8s cubic-bezier(.2,.7,.2,1) forwards; }
    @keyframes in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
  </style>
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0B1020"/><stop offset="1" stop-color="#0E1328"/></linearGradient>
    <clipPath id="frame"><rect width="${W}" height="${H}" rx="18"/></clipPath>
  </defs>

  <g clip-path="url(#frame)"><rect width="${W}" height="${H}" fill="url(#bg)"/></g>
  <rect x=".5" y=".5" width="${W - 1}" height="${H - 1}" rx="18" fill="none" stroke="#FFFFFF" stroke-opacity=".08"/>

  <text x="${PAD}" y="52" class="mono" font-size="12" fill="#22D3EE" letter-spacing="2">RECENTLY ACTIVE PROJECTS</text>
  <text x="${W - PAD}" y="52" class="mono" font-size="12" fill="#475569" letter-spacing="2" text-anchor="end">BY LAST PUSH</text>
  ${cards}${empty}
</svg>
`;
writeFileSync(OUT, svg);
console.log(`Wrote ${OUT}: ${repos.map((r) => r.name).join(', ')}`);
