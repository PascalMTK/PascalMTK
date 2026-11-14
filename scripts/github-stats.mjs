// Generates assets/github-stats.svg — self-hosted GitHub stats + top languages card.
// Replaces the third-party github-readme-stats deployment (which went offline).
// Data: GitHub GraphQL (when GITHUB_TOKEN is set), falling back to the public REST API.
// Usage: node scripts/github-stats.mjs [username] [output]
import { writeFileSync } from 'node:fs';

const USER = process.argv[2] || 'PascalMTK';
const OUT = process.argv[3] || 'assets/github-stats.svg';
const TOKEN = process.env.GITHUB_TOKEN;
const HEADERS = { 'User-Agent': 'profile-stats', Accept: 'application/vnd.github+json', ...(TOKEN && { Authorization: `bearer ${TOKEN}` }) };

const FALLBACK_COLORS = {
  JavaScript: '#f1e05a', TypeScript: '#3178c6', Python: '#3572A5', Java: '#b07219', PHP: '#4F5D95',
  HTML: '#e34c26', CSS: '#663399', SCSS: '#c6538c', Shell: '#89e051', 'C#': '#178600', 'C++': '#f34b7d',
  C: '#555555', Go: '#00ADD8', Kotlin: '#A97BFF', Dart: '#00B4AB', Hack: '#878787', Blade: '#f7523f',
};

async function fromGraphQL() {
  const query = `query($login:String!){user(login:$login){
    followers{totalCount}
    pullRequests{totalCount}
    issues{totalCount}
    contributionsCollection{totalCommitContributions restrictedContributionsCount}
    repositories(ownerAffiliations:OWNER,isFork:false,first:100){totalCount nodes{
      stargazerCount
      languages(first:10,orderBy:{field:SIZE,direction:DESC}){edges{size node{name color}}}
    }}}}`;
  const res = await fetch('https://api.github.com/graphql', {
    method: 'POST', headers: { ...HEADERS, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables: { login: USER } }),
  });
  const json = await res.json();
  const u = json?.data?.user;
  if (!u) throw new Error('GraphQL: ' + JSON.stringify(json.errors || json).slice(0, 200));
  const langs = {};
  for (const r of u.repositories.nodes)
    for (const e of r.languages.edges) {
      langs[e.node.name] ??= { size: 0, color: e.node.color };
      langs[e.node.name].size += e.size;
    }
  const cc = u.contributionsCollection;
  return {
    stars: u.repositories.nodes.reduce((s, r) => s + r.stargazerCount, 0),
    commits: cc.totalCommitContributions + cc.restrictedContributionsCount,
    prs: u.pullRequests.totalCount,
    issues: u.issues.totalCount,
    repos: u.repositories.totalCount,
    followers: u.followers.totalCount,
    langs,
  };
}

async function get(url) {
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`REST ${url}: HTTP ${res.status}`);
  return res.json();
}

async function fromRest() {
  const user = await get(`https://api.github.com/users/${USER}`);
  const repos = (await get(`https://api.github.com/users/${USER}/repos?per_page=100&type=owner`)).filter((r) => !r.fork);
  const langs = {};
  for (const r of repos) {
    const l = await get(r.languages_url);
    for (const [name, size] of Object.entries(l)) {
      langs[name] ??= { size: 0, color: FALLBACK_COLORS[name] };
      langs[name].size += size;
    }
  }
  const count = async (q) => (await get(`https://api.github.com/search/issues?q=${encodeURIComponent(q)}&per_page=1`)).total_count;
  const year = new Date(Date.now() - 365 * 864e5).toISOString().slice(0, 10);
  const commits = (await get(`https://api.github.com/search/commits?q=${encodeURIComponent(`author:${USER} committer-date:>=${year}`)}&per_page=1`)).total_count;
  return {
    stars: repos.reduce((s, r) => s + r.stargazers_count, 0),
    commits,
    prs: await count(`author:${USER} type:pr`),
    issues: await count(`author:${USER} type:issue`),
    repos: repos.length,
    followers: user.followers,
    langs,
  };
}

let data;
try {
  data = TOKEN ? await fromGraphQL() : await fromRest();
} catch (e) {
  console.warn(e.message, '— trying REST API');
  data = await fromRest();
}

// ---- top languages ------------------------------------------------------------------
const totalSize = Object.values(data.langs).reduce((s, l) => s + l.size, 0) || 1;
let top = Object.entries(data.langs).sort((a, b) => b[1].size - a[1].size)
  .map(([name, l]) => ({ name, color: l.color || '#94A3B8', pct: (l.size / totalSize) * 100 }));
if (top.length > 6) {
  const rest = top.slice(5).reduce((s, l) => s + l.pct, 0);
  top = [...top.slice(0, 5), { name: 'Other', color: '#475569', pct: rest }];
}

// ---- geometry -----------------------------------------------------------------------
const W = 1200, H = 290;
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const fmt = (n) => (n >= 1000 ? (n / 1000).toFixed(1).replace(/\.0$/, '') + 'k' : String(n));

const stats = [
  ['COMMITS · 12 MO', data.commits, '#F8FAFC'],
  ['PULL REQUESTS', data.prs, '#22D3EE'],
  ['REPOSITORIES', data.repos, '#F8FAFC'],
  ['ISSUES', data.issues, '#F8FAFC'],
  ['STARS EARNED', data.stars, '#FB923C'],
  ['FOLLOWERS', data.followers, '#C084FC'],
];
const statCells = stats.map(([label, value, color], i) => {
  const x = 40 + (i % 3) * 170, y = 120 + Math.floor(i / 3) * 96;
  return `
  <g class="in" style="animation-delay:${(0.1 + i * 0.1).toFixed(1)}s">
    <text x="${x}" y="${y}" class="sans" font-size="34" font-weight="800" fill="${color}">${fmt(value)}</text>
    <text x="${x}" y="${y + 24}" class="mono" font-size="11" fill="#64748B" letter-spacing="2">${label}</text>
  </g>`;
}).join('');

// stacked bar + legend on the right
const BX0 = 640, BX1 = 1160, BY = 92;
let acc = BX0;
const segs = top.map((l, i) => {
  const w = ((BX1 - BX0) * l.pct) / 100;
  const s = `<rect x="${acc.toFixed(1)}" y="${BY}" width="${Math.max(0, w - 2).toFixed(1)}" height="12" fill="${l.color}" class="grow" style="animation-delay:${(0.4 + i * 0.08).toFixed(2)}s"/>`;
  acc += w;
  return s;
}).join('\n    ');
const legend = top.map((l, i) => {
  const x = BX0 + (i % 2) * 270, y = 150 + Math.floor(i / 2) * 50;
  return `
  <g class="in" style="animation-delay:${(0.6 + i * 0.1).toFixed(1)}s">
    <circle cx="${x + 6}" cy="${y - 5}" r="6" fill="${l.color}"/>
    <text x="${x + 22}" y="${y}" class="sans" font-size="16" font-weight="600" fill="#E2E8F0">${esc(l.name)}</text>
    <text x="${x + 240}" y="${y}" class="mono" font-size="13" fill="#94A3B8" text-anchor="end">${l.pct.toFixed(1)}%</text>
  </g>`;
}).join('');

const aria = `${USER}: ${data.commits} commits in the last year, ${data.prs} pull requests, ${data.repos} repositories, ${data.stars} stars, ${data.followers} followers. Top languages: ${top.map((l) => `${l.name} ${l.pct.toFixed(0)}%`).join(', ')}.`;

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(aria)}">
  <style>
    .sans { font-family: 'Segoe UI', Inter, -apple-system, 'Helvetica Neue', Arial, sans-serif; }
    .mono { font-family: 'JetBrains Mono', 'Fira Code', 'Cascadia Code', Consolas, 'SFMono-Regular', Menlo, monospace; }
    .in { opacity: 0; animation: in .8s cubic-bezier(.2,.7,.2,1) forwards; }
    @keyframes in { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: none; } }
    .grow { transform-box: fill-box; transform-origin: left; transform: scaleX(0); animation: grow .9s cubic-bezier(.2,.7,.2,1) forwards; }
    @keyframes grow { to { transform: scaleX(1); } }
  </style>
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#0B1020"/><stop offset="1" stop-color="#0E1328"/></linearGradient>
    <clipPath id="frame"><rect width="${W}" height="${H}" rx="18"/></clipPath>
    <clipPath id="bar"><rect x="${BX0}" y="${BY}" width="${BX1 - BX0}" height="12" rx="6"/></clipPath>
  </defs>

  <g clip-path="url(#frame)"><rect width="${W}" height="${H}" fill="url(#bg)"/></g>
  <rect x=".5" y=".5" width="${W - 1}" height="${H - 1}" rx="18" fill="none" stroke="#FFFFFF" stroke-opacity=".08"/>
  <line x1="600" y1="40" x2="600" y2="${H - 40}" stroke="#FFFFFF" stroke-opacity=".08"/>

  <text x="40" y="52" class="mono" font-size="12" fill="#22D3EE" letter-spacing="2">GITHUB STATS</text>
  <text x="${BX0}" y="52" class="mono" font-size="12" fill="#22D3EE" letter-spacing="2">TOP LANGUAGES</text>
  <text x="${BX1}" y="52" class="mono" font-size="12" fill="#475569" letter-spacing="2" text-anchor="end">BY CODE SIZE</text>
  ${statCells}

  <rect x="${BX0}" y="${BY}" width="${BX1 - BX0}" height="12" rx="6" fill="#FFFFFF" fill-opacity=".05"/>
  <g clip-path="url(#bar)">
    ${segs}
  </g>
  ${legend}
</svg>
`;
writeFileSync(OUT, svg);
console.log(`Wrote ${OUT}: ${JSON.stringify({ ...data, langs: top.map((l) => l.name) })}`);
