const { Game } = require('./engine.js');
(async () => {
  for (const [a, b] of [['memory','casual'],['memory','random'],['casual','random'],['memory','memory']]) {
    let w = 0, n = 2000, turns = 0, first = 0;
    for (let g = 0; g < n; g++) {
      const swap = g % 2, lv = swap ? [b, a] : [a, b], f = (g >> 1) % 2;
      const G = new Game({ levels: lv, first: f });
      const win = await G.play();
      if ((win === 0) !== !!swap) w++;
      if (win === f) first++;
      turns += G.turns / 2;
    }
    console.log(a, 'vs', b, (w / n * 100).toFixed(1) + '%', 'turns/player', (turns / n).toFixed(1), 'first', (first/n*100).toFixed(1));
  }
})();
