const { Game, BOT } = require('./engine.js');
const R = n => Math.floor(Math.random() * n);
const ui = {
  render() {}, sleep: () => Promise.resolve(),
  ask(q, kind, d, g) {
    g._asks = (g._asks || 0) + 1;
    if (g._asks > 20000) throw new Error('too many asks ' + kind);
    switch (kind) {
      case 'step': return true;
      case 'main': return Math.random() < 0.5 || !d.actions.length ? null : d.actions[R(d.actions.length)];
      case 'roll': case 'dynamite': case 'claimJump': case 'flood': case 'collapse': case 'canary': return Math.random() < 0.5;
      case 'chooseDie': return d.coin && Math.random() < 0.3 ? { coin: R(d.rolls.length) } : { die: R(d.rolls.length) };
      case 'contest': { if (Math.random() < 0.5) return { type: 'pass' }; const o = d.opts[R(d.opts.length)]; return o.type === 'SHOVEL' ? { type: 'SHOVEL', swap: [0, 1] } : o; }
      case 'caveDiscard': return d.tools[R(d.tools.length)].t;
      case 'sonar': return R(d.cards.length);
      case 'cart': return Math.random() < 0.5 ? null : d.cand[R(d.cand.length)];
      case 'arrange': return d.cards.slice().reverse();
      case 'returnOrder': return d.row.slice();
    }
    throw new Error('unknown ' + kind);
  }
};
(async () => {
  for (let i = 0; i < 3000; i++) {
    const lv = ['random', 'casual', 'memory'][i % 3];
    const g = new Game({ levels: ['human', lv], first: i % 2, ui, names: ['You', 'Iguanodon'] });
    const t0 = Date.now();
    const w = await g.play(); for (const q of [0, 1]) for (const c of g.chest[q]) if (c.t !== 'G' + q) throw new Error('game ' + i + ': ' + c.id + ' in the wrong Warchest');
    if (w === null || Date.now() - t0 > 2000) console.log('odd', i, lv, w, g.turns, Date.now() - t0);
  }
  console.log('done');
})().catch(e => console.log('ERR', e.stack));
