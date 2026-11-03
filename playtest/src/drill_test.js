const { Game } = require('./engine.js');
const N = +process.env.N || 4000;
async function series(lv, rules, n, policy = ['greedy', 'greedy']) {
  let w = 0, first = 0; const T = []; let tools = 0, gems = 0, junk = 0, buys = 0, played = 0, counters = 0; const gf = { mine: 0, row: 0, trade: 0 }; let cj = 0, cjWin = 0;
  for (let g = 0; g < n; g++) {
    const sw = g % 2, f = (g >> 1) % 2;
    const G = new Game({ levels: sw ? [lv[1], lv[0]] : lv, first: f, rules, policy: sw ? [policy[1], policy[0]] : policy });
    const win = await G.play();
    if ((win === 0) !== !!sw) w++;
    if (win === f) first++;
    T.push(G.turns / 2);
    tools += G.stats.tools[0] + G.stats.tools[1]; gems += G.stats.trades[0] + G.stats.trades[1];
    junk += G.stats.junk[0] + G.stats.junk[1]; buys += G.stats.buys[0] + G.stats.buys[1];
    played += G.stats.played[0] + G.stats.played[1]; counters += G.stats.counters; for (const k in gf) gf[k] += G.stats.gemFrom[k]; cj += G.stats.byType.CJ || 0;
  }
  const m = T.reduce((a, b) => a + b) / n, sd = Math.sqrt(T.reduce((a, b) => a + (b - m) ** 2, 0) / n);
  return { win: w / n, first: first / n, m, sd, far: T.filter(t => Math.abs(t - m) > 5).length / n,
    tools: tools / n / 2, gems: gems / n / 2, junk: junk / n / 2, buys: buys / n / 2, played: played / n / 2, counters: counters / n, cj: cj / n,
    luck: gf.mine / (gf.mine + gf.row + gf.trade), fromRow: gf.row / (gf.mine + gf.row + gf.trade), fromTrade: gf.trade / (gf.mine + gf.row + gf.trade) };
}
const pct = x => (100 * x).toFixed(1) + '%';
(async () => {
  const configs = [
    ['Current rules', {}],
    ['Current, no Gems from top digs', { topGems: false }],
    ['Current, no top Gems, 2 Drills', { topGems: false, drill: 2 }],
    ['Recommended', { junk: 5, ladder: true, start: 3, cjAfter: true }],
    ['Rec, no Gems from top digs', { junk: 5, ladder: true, start: 3, cjAfter: true, topGems: false }],
    ['Rec, no top Gems, 2 Drills', { junk: 5, ladder: true, start: 3, cjAfter: true, topGems: false, drill: 2 }],
    ['Rec, no top Gems, 4 Drills', { junk: 5, ladder: true, start: 3, cjAfter: true, topGems: false, drill: 4 }],
    ['Rec, no Dig at all', { junk: 5, ladder: true, start: 3, cjAfter: true, dig: false }],
    ['Rec, no Dig, 2 Drills', { junk: 5, ladder: true, start: 3, cjAfter: true, dig: false, drill: 2 }],
  ];
  const only = process.env.ONLY ? new RegExp(process.env.ONLY) : null;
  const rows = [];
  for (const [name, rules] of configs) {
    if (only && !only.test(name)) continue;
    const hh = await series(['memory', 'memory'], rules, N);
    const hm = await series(['memory', 'casual'], rules, N);
    const he = await series(['memory', 'random'], rules, N);
    const r = { name, rules, hh, hm, he };
    rows.push(r);
    console.log([name, hh.m.toFixed(1) + '±' + hh.sd.toFixed(1), pct(hh.far), pct(hh.first), pct(hm.win), pct(he.win), hh.tools.toFixed(1), hh.played.toFixed(1), hh.counters.toFixed(1), pct(hh.luck), pct(hh.fromRow), pct(hh.fromTrade), he.m.toFixed(1), hh.cj.toFixed(2)].join(' | '));
  }
  return;
  // saving versus spending under the ladder
  const pol = [];
  for (const rules of [{ ladder: true }, { ladder: true, junk: 5 }]) {
    for (const [a, b] of [['greedy', 'single'], ['save', 'greedy'], ['save', 'single']]) {
      const r = await series(['memory', 'memory'], rules, N, [a, b]);
      pol.push({ rules, a, b, win: r.win, m: r.m });
      console.log('policy', JSON.stringify(rules), a, 'vs', b, pct(r.win), r.m.toFixed(1));
    }
  }
  require('fs').writeFileSync(__dirname + '/drill.json', JSON.stringify({ N, rows, pol }, null, 1));
})();
