// Excavators table interface. Renders a Game and answers its questions for the human seat.
const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const img = id => `cards/${id}.webp`;
const cname = c => c.id === 'back-mine' ? 'Hidden card' : (CARD_NAMES[c.id] || [TYPE_NAME[c.t] || c.t])[0];
const kindName = c => c.t === 'R' ? 'Rock' : c.t === 'J' ? 'Junk' : c.t === 'G0' ? 'your red Gem' : c.t === 'G1' ? "Iguanodon's blue Gem, can't be taken" : TYPE_NAME[c.t];
const LEVEL = {
  random: { name: 'Easy', blurb: 'Plays any card it can, half the time, with no plan.' },
  casual: { name: 'Medium', blurb: 'Chases its own Gems and Treasures, but never blocks you.' },
  memory: { name: 'Hard', blurb: 'Blocks your Gems, buries them, and remembers every card that goes back into the mine.' },
};
const PHASES = [['dig', 'Dig'], ['main', 'Main'], ['excavate', 'Excavate'], ['roll', 'Roll'], ['return', 'Return']];
const PHASE_OF = { start: 'dig', dig: 'dig', main: 'main', excavate: 'excavate', roll: 'roll', resolve: 'roll', return: 'return', over: 'return' };

function dieSvg(v, cls = '') {
  const P = { 1: [[2, 2]], 2: [[1, 1], [3, 3]], 3: [[1, 1], [2, 2], [3, 3]], 4: [[1, 1], [3, 1], [1, 3], [3, 3]],
    5: [[1, 1], [3, 1], [2, 2], [1, 3], [3, 3]], 6: [[1, 1], [3, 1], [1, 2], [3, 2], [1, 3], [3, 3]] }[v];
  return `<svg class="die ${cls}" viewBox="0 0 40 40" aria-label="die showing ${v}"><rect x="2" y="2" width="36" height="36" rx="8"/>${P.map(([x, y]) => `<circle cx="${x * 10}" cy="${y * 10}" r="3.6"/>`).join('')}</svg>`;
}
function gemSvg(colour, filled) {
  return `<svg class="gem ${colour} ${filled ? 'on' : ''}" viewBox="0 0 40 40" aria-hidden="true"><path d="M8 14 L14 6 H26 L32 14 L20 35 Z"/><path d="M8 14 H32 M14 6 L18 14 L20 35 L22 14 L26 6" class="facet"/></svg>`;
}
function cardEl(c, opts = {}) {
  const cls = ['card', opts.cls || ''].join(' ');
  const attrs = opts.attrs || '';
  return `<div class="${cls}" data-card="${c.id}" ${attrs}><img src="${img(c.id)}" alt="${esc(cname(c))}" loading="lazy" draggable="false">${opts.badge ? `<span class="badge">${opts.badge}</span>` : ''}${opts.label ? `<span class="label">${opts.label}</span>` : ''}</div>`;
}

const UI = {
  speed: 1, game: null, pending: null, sub: null, level: 'memory', firstPick: 'roll', gen: 0,
  sleep(ms) { const gen = this.gen; return new Promise((res, rej) => setTimeout(() => gen === this.gen ? res() : rej(new Error('stale')), ms * this.speed)); },

  // ------------------------------------------------------------ questions for the person
  ask(q, kind, data, g) {
    return new Promise((res, rej) => {
      const gen = this.gen;
      this.pending = { kind, data, res: v => { if (gen !== this.gen) return; this.pending = null; this.sub = null; res(v); this.renderPrompt(); } };
      this.sub = kind === 'arrange' || kind === 'returnOrder' ? { order: (kind === 'arrange' ? data.cards : data.row).slice() } : null;
      this.renderPrompt(); this.render(g);
    });
  },

  // ------------------------------------------------------------ table
  render(g) {
    if (!g) return;
    const me = 0, ai = 1;
    // opponent
    const aiHand = g.hands[ai];
    const reveal = g.knows[me] || g.phase === 'over';
    $('#opp-name').textContent = `${g.names[ai]} · ${LEVEL[g.levels[ai]].name} AI`;
    $('#opp-chest').innerHTML = [0, 1, 2].map(i => gemSvg('blue', i < g.chest[ai].length)).join('');
    $('#opp-meta').innerHTML = `<span>${aiHand.length} in hand</span><span>${g.tdeck[ai].length} tools left</span>${g.skip[ai] ? '<span class="warn">Skips next Dig</span>' : ''}`;
    $('#opp-hand').innerHTML = reveal ? this.handHtml(aiHand, false) :
      aiHand.map((c, i) => `<div class="card back sm" style="--i:${i}"><img src="${img(['R', 'J', 'NUGGET', 'CART', 'COIN', 'PICK', 'DYN', 'CANARY'].includes(c.t) ? 'back-mine' : 'back-tools_blue')}" alt="Hidden card"></div>`).join('');
    $('#opp-hand').classList.toggle('revealed', reveal);
    // mine and row
    $('#mine-count').textContent = g.mine.length;
    $('#last-dug').innerHTML = (g.lastDug ? cardEl(g.lastDug, { cls: 'sm' }) : '<div class="slot sm"></div>') + `<span class="note">${esc(g.lastNote || '')}</span>`;
    // a banner for Gem events, so it is always clear whose Gem went where
    const ev = g.event, bn = $('#banner');
    if (ev && ev.n !== this.shownEvent) {
      this.shownEvent = ev.n;
      bn.innerHTML = `${ev.card ? `<img src="${img(ev.card)}" alt="">` : ''}<p>${esc(ev.text)}</p>`;
      bn.className = ev.card && /gem-red/.test(ev.card) ? 'red' : 'blue'; bn.hidden = false;
      clearTimeout(this.bannerTimer); this.bannerTimer = setTimeout(() => { bn.hidden = true; }, 3200);
    }
    const die = g.die, rolls = g.rolls;
    let row = '';
    for (let i = 0; i < 6; i++) {
      const c = g.row[i];
      const target = rolls.length && rolls.some(d => d === i);
      const chosen = die === i;
      const cls = `${chosen ? 'chosen' : target ? 'rolled' : ''} ${c && c.t === 'G0' ? 'gem-red' : c && c.t === 'G1' ? 'gem-blue' : ''}`;
      row += `<div class="pos ${cls}"><span class="num">${i + 1}</span>${c ? cardEl(c) : '<div class="slot"></div>'}</div>`;
    }
    $('#row').innerHTML = row;
    $('#dice').innerHTML = rolls.length ? `<span class="who">${g.roller === me ? 'Your' : g.names[ai] + "'s"} dice</span>` + rolls.map((d, i) => dieSvg(d + 1, i === g.chosen ? 'picked' : '')).join('') : '';
    // phase tracker
    const cur = PHASE_OF[g.phase] || 'dig';
    $('#phases').innerHTML = `<span class="turn-of ${g.p === me ? 'mine' : 'theirs'}">${g.p === me ? 'Your turn' : g.names[ai] + "'s turn"} · ${Math.ceil(g.turns / 2) || 1}</span>` +
      PHASES.map(([k, n]) => `<span class="ph ${k === cur ? 'on' : ''}">${n}</span>`).join('<span class="sep">›</span>');
    // you
    $('#me-chest').innerHTML = [0, 1, 2].map(i => gemSvg('red', i < g.chest[me].length)).join('');
    $('#me-meta').innerHTML = `<span>Rock value ${g.rockValue(me)}</span><span>${g.tdeck[me].length} tools left</span>${g.skip[me] ? '<span class="warn">Skips next Dig</span>' : ''}`;
    $('#me-hand').innerHTML = this.handHtml(g.hands[me], true) || '<p class="empty">Your hand is empty. Dig to get cards.</p>';
    // log
    const L = g.logs.slice(-80);
    $('#log').innerHTML = L.map(e => `<li class="${e.q === 0 ? 'you' : e.q === 1 ? 'ai' : ''} ${/turn$/.test(e.text) ? 'turn' : ''}" ${e.card ? `data-card="${e.card}"` : ''}>${esc(e.text)}</li>`).join('');
    const lg = $('#log'); lg.scrollTop = lg.scrollHeight;
    if (!this.pending) this.renderPrompt();
    if (g.phase === 'over') this.showEnd(g);
  },

  handHtml(hand, mine) {
    const act = this.pending && this.pending.kind === 'main' ? this.pending.data.actions : [];
    const rocks = hand.filter(c => c.t === 'R'), junk = hand.filter(c => c.t === 'J');
    const order = ['NUGGET', 'CART', 'COIN', 'PICK', 'DYN', 'CANARY', 'M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'CJ', 'SHIFT', 'SURVEY', 'HEADLAMP', 'SONAR', 'SHOVEL', 'DEMAG', 'FLOOD', 'COLLAPSE'];
    const rest = hand.filter(c => c.t !== 'R' && c.t !== 'J').sort((a, b) => order.indexOf(a.t) - order.indexOf(b.t));
    let h = '';
    if (rocks.length) h += cardEl(rocks[rocks.length - 1], { cls: 'stack', badge: `×${rocks.length}`, label: 'Rocks' });
    if (junk.length) h += cardEl(junk[junk.length - 1], { cls: 'stack', badge: `×${junk.length}`, label: 'Junk' });
    for (const c of rest) {
      const playable = mine && act.includes(c.t);
      h += cardEl(c, { cls: playable ? 'playable' : '', attrs: playable ? `data-act="${c.t}" role="button" tabindex="0" title="Play ${esc(TYPE_NAME[c.t])}"` : '' });
    }
    return h;
  },

  // ------------------------------------------------------------ the guidance bar
  renderPrompt() {
    const g = this.game, el = $('#prompt');
    if (!g) return;
    const P = this.pending;
    if (!P) {
      let t = '';
      if (!g.ui) { el.innerHTML = `<div class="guide"><h2>Ready to dig</h2><p>Choose an opponent and start a game.</p></div>`; el.classList.remove('yours'); return; }
      if (g.phase === 'over') t = g.winner === 0 ? 'You won! Start a new game from the top bar.' : `${g.names[1]} won this time. Start a new game from the top bar.`;
      else if (g.p === 1 || (g.roller === 1)) t = `${g.names[1]} is playing…`;
      else t = 'Resolving…';
      el.innerHTML = `<div class="guide"><h2>${g.phase === 'over' ? 'Game over' : 'Please wait'}</h2><p>${esc(t)}</p></div>`;
      el.classList.remove('yours'); return;
    }
    el.classList.add('yours');
    const d = P.data, row = g.row, ai = g.names[1];
    const btn = (label, v, cls = '') => `<button class="btn ${cls}" data-v='${JSON.stringify(v).replace(/'/g, '&#39;')}'>${label}</button>`;
    const thumbs = (cards, sel = [], pickable = true, labels = []) => `<div class="thumbs">${cards.map((c, i) =>
      `<button class="thumb ${sel.includes(i) ? 'sel' : ''}" data-pick="${i}" ${pickable ? '' : 'disabled'} data-card="${c.id}" aria-label="${esc(cname(c))}"><img src="${img(c.id)}" alt="">${labels[i] ? `<span>${labels[i]}</span>` : ''}</button>`).join('')}</div>`;
    let h = '';
    const guide = (title, text) => `<div class="guide"><h2>${title}</h2><p>${text}</p></div>`;
    switch (P.kind) {
      case 'step':
        h = guide('Dig', 'Take the top card of the mine. A red Gem goes into your Warchest and you dig again. A blue Gem belongs to the Iguanodon, so it goes to the bottom of the mine and you dig again.') +
          `<div class="acts">${btn('Dig the top card', true, 'primary')}</div>`; break;
      case 'main': {
        const A = d.actions, lab = { SHIFT: 'Play Second Shift (draw 2 tools)', SURVEY: `Play Survey (see ${ai}'s hand)`, HEADLAMP: 'Play Headlamp (order the top 3)',
          SONAR: 'Play Sonar (bury 1 of the top 6)', TOOL_TRADE: 'Trade 3 Rocks for a tool', GEM_TRADE: 'Trade 9 Rocks for a Gem' };
        h = guide('Main phase', A.length ? 'Play tools and make Rock trades in any order. Glowing cards in your hand can be played now. When you are done, excavate the row.'
          : 'You have nothing to play right now. Excavate the row to lay out the next 6 cards.') +
          `<div class="acts">${A.map(a => btn(lab[a], a, a === 'GEM_TRADE' ? 'gold' : '')).join('')}${btn('Done: excavate the row', 'EXCAVATE', 'primary')}</div>`; break;
      }
      case 'roll':
        h = guide('Roll', 'Roll the dice, then choose one. You dig the card at that position in the row.') +
          `<div class="acts">${d.pick ? btn('Use Pickaxe: roll 3 dice', true) : ''}${btn('Roll 2 dice', false, 'primary')}</div>`; break;
      case 'dynamite':
        h = guide('Dynamite?', 'Send this whole row to the bottom of the mine and excavate 6 new cards.') +
          `<div class="acts">${btn('Use Dynamite', true)}${btn('Keep this row', false, 'primary')}</div>`; break;
      case 'chooseDie': {
        const opts = d.rolls.map((v, i) => {
          const c = row[v]; return btn(`${dieSvg(v + 1)} <span>Take ${v + 1}: ${c ? esc(cname(c)) + ` <em>${esc(kindName(c))}</em>` : 'empty'}</span>`, { die: i }, 'die-btn');
        }).join('');
        const coin = d.coin ? `<div class="sub">Lucky Coin: ${d.rolls.map((v, i) => btn(`Reroll the ${v + 1}`, { coin: i }, 'small')).join('')}</div>` : '';
        h = guide('Choose a die', `You dig the card at that position. ${ai} may then answer with a Magnet.`) + `<div class="acts">${opts}</div>${coin}`; break;
      }
      case 'contest': {
        const mine = d.roller === 0, c = row[d.die];
        const what = c ? `${esc(cname(c))} (${esc(kindName(c))})` : 'an empty position';
        const lead = mine ? `The die is on ${d.die + 1}: ${what}. ${d.lastMag ? `${ai} just moved it with a Magnet. ` : ''}You may answer.`
          : `${ai} chose ${d.die + 1}: ${what}. You may change it before they dig.`;
        if (this.sub && this.sub.shovel) {
          const s = this.sub.shovel;
          h = guide('Shovel', 'Pick two cards in the row to swap.') + thumbs(row, s, true, row.map((_, i) => String(i + 1))) +
            `<div class="acts">${btn('Swap them', 'SWAP', s.length === 2 ? 'primary' : 'disabled')}${btn('Back', 'BACK')}</div>`;
          break;
        }
        const o = d.opts.map(x => x.type === 'M' ? btn(`Magnet ${x.k}: set the die to ${x.k}${row[x.k - 1] ? ' (' + esc(cname(row[x.k - 1])) + ')' : ''}`, x)
          : x.type === 'DEMAG' ? btn(`Demagnetiser: cancel that Magnet`, x) : x.type === 'SHOVEL' ? btn('Shovel: swap two cards', 'SHOVEL') : btn('Lucky Coin: reroll the die', x)).join('');
        h = guide(mine ? 'Answer the Magnet' : `${ai}'s dig`, lead) + `<div class="acts">${o}${btn(mine ? 'Done: dig it' : 'Let it stand', { type: 'pass' }, 'primary')}</div>`; break;
      }
      case 'claimJump':
        h = guide(d.counter ? `${ai} jumped your claim` : 'Claim Jump?', d.counter ? 'Play your own Claim Jump to take the roll back. Nobody can answer this one, and you skip your next Dig.'
          : `${ai} excavated this row. Play Claim Jump to take the roll and the dig yourself, then skip your next Dig.`) +
          `<div class="acts">${btn('Play Claim Jump', true)}${btn('No', false, 'primary')}</div>`; break;
      case 'flood':
        h = guide('Flooded Shaft?', `${ai} is digging their Gem from the row. Flood the shaft and the Gem stays in the row.`) +
          `<div class="acts">${btn('Play Flooded Shaft', true, 'primary')}${btn('Let them have it', false)}</div>`; break;
      case 'collapse':
        h = guide('Collapse?', `${ai} is about to return the row. Collapse makes them shuffle it first, so they can't bury your Gems.`) +
          `<div class="acts">${btn('Play Collapse', true, d.row.some(c => c.t === 'G0') ? 'primary' : '')}${btn('No', false, d.row.some(c => c.t === 'G0') ? '' : 'primary')}</div>`; break;
      case 'canary':
        h = guide('Cave-in!', 'Discard your Canary to ignore it, or lose one of your tools.') +
          `<div class="acts">${btn('Use the Canary', true, 'primary')}${btn('Lose a tool instead', false)}</div>`; break;
      case 'caveDiscard':
        h = guide('Cave-in!', 'Choose a tool to lose.') + thumbs(d.tools); break;
      case 'sonar':
        h = guide('Sonar', 'These are the top 6 cards of the mine. The left card comes up first. Pick one to put on the bottom.') + thumbs(d.cards, [], true, d.cards.map((_, i) => String(i + 1))); break;
      case 'cart':
        h = guide('Mine Cart', 'Take any one non-Gem card from the row into your hand, or keep the Cart for later.') +
          thumbs(row, [], true, row.map((c, i) => d.cand.includes(i) ? 'Take' : '')).replace(/data-pick="(\d+)" /g, (m, i) => d.cand.includes(+i) ? m : `${m}disabled `) +
          `<div class="acts">${btn('Keep the Cart', null, 'primary')}</div>`; break;
      case 'arrange': case 'returnOrder': {
        const ord = this.sub.order, isRet = P.kind === 'returnOrder';
        const t = isRet ? 'Return the row' : d.source;
        const text = isRet ? `These go to the bottom of the mine. The left card comes back up first, so put ${ai}'s Gems on the right to bury them deepest. Use the arrows to reorder.`
          : `These are the top ${ord.length} cards. The left card is the next one dug. ${g.p === 0 ? 'Your next dig is the first card, and the next row is the 6 after it.' : ''} Use the arrows to reorder.`;
        h = guide(t, text) + `<div class="thumbs order">${ord.map((c, i) => `<div class="ordslot"><button class="arrow" data-mv="${i},-1" ${i ? '' : 'disabled'} aria-label="Move left">◀</button><div class="thumb" data-card="${c.id}"><img src="${img(c.id)}" alt="${esc(cname(c))}"><span>${i + 1}</span></div><button class="arrow" data-mv="${i},1" ${i < ord.length - 1 ? '' : 'disabled'} aria-label="Move right">▶</button></div>`).join('')}</div>` +
          `<div class="acts">${isRet ? btn(`Bury ${ai}'s Gems deepest`, 'BURY') : ''}${btn(isRet ? 'Done: return to the mine' : 'Done: put them back', 'OK', 'primary')}</div>`; break;
      }
      default: h = guide(P.kind, '') + `<div class="acts">${btn('OK', true)}</div>`;
    }
    el.innerHTML = h;
    const first = el.querySelector('.btn.primary'); if (first && !this.noFocus) first.focus({ preventScroll: true });
  },

  onPromptClick(e) {
    const P = this.pending; if (!P) return;
    const b = e.target.closest('[data-v],[data-pick],[data-mv]'); if (!b || b.disabled || b.classList.contains('disabled')) return;
    const k = P.kind, d = P.data;
    if (b.dataset.mv) {
      const [i, dir] = b.dataset.mv.split(',').map(Number), o = this.sub.order; [o[i], o[i + dir]] = [o[i + dir], o[i]];
      return this.renderPrompt();
    }
    if (b.dataset.pick !== undefined) {
      const i = +b.dataset.pick;
      if (k === 'caveDiscard') return P.res(d.tools[i].t);
      if (k === 'sonar') return P.res(i);
      if (k === 'cart') return P.res(i);
      if (k === 'contest' && this.sub && this.sub.shovel) {
        const s = this.sub.shovel; const j = s.indexOf(i); if (j >= 0) s.splice(j, 1); else if (s.length < 2) s.push(i);
        return this.renderPrompt();
      }
      return;
    }
    const v = JSON.parse(b.dataset.v);
    if (k === 'main') return P.res(v === 'EXCAVATE' ? null : v);
    if (k === 'contest') {
      if (v === 'SHOVEL') { this.sub = { shovel: [] }; return this.renderPrompt(); }
      if (v === 'BACK') { this.sub = null; return this.renderPrompt(); }
      if (v === 'SWAP') { if (this.sub.shovel.length === 2) P.res({ type: 'SHOVEL', swap: this.sub.shovel.slice() }); return; }
      return P.res(v);
    }
    if (k === 'arrange' || k === 'returnOrder') {
      if (v === 'BURY') { const key = c => c.t === 'G1' ? 2 : c.t === 'G0' ? 0 : 1; this.sub.order.sort((a, b) => key(a) - key(b)); return this.renderPrompt(); }
      return P.res(this.sub.order.slice());
    }
    P.res(v);
  },

  // ------------------------------------------------------------ card preview
  preview(id) {
    if (!id) return;
    const c = { id }, nm = CARD_NAMES[id];
    $('#preview').innerHTML = `<img src="${img(id)}" alt="${esc(nm ? nm[0] : 'Card')}"><p class="cap">${nm ? `<b>${esc(nm[0])}</b> ${esc(nm[1])}` : id === 'back-mine' ? 'A card from the mine, hidden from you.' : 'A tool, hidden from you.'}</p>`;
  },
  zoom(id) {
    const nm = CARD_NAMES[id];
    $('#zoom-img').src = img(id); $('#zoom-img').alt = nm ? nm[0] : 'Card';
    $('#zoom').hidden = false;
  },

  // ------------------------------------------------------------ games
  start() {
    this.gen++; this.pending = null; this.sub = null; $('#banner').hidden = true;
    $('#end').hidden = true; $('#setup').hidden = true;
    let first = this.firstPick === 'me' ? 0 : this.firstPick === 'ai' ? 1 : -1, rollNote = '';
    if (first < 0) {
      let a, b; do { a = 1 + Math.floor(Math.random() * 6); b = 1 + Math.floor(Math.random() * 6); } while (a === b);
      first = a > b ? 0 : 1; rollNote = `You rolled ${a}, the Iguanodon rolled ${b}.`;
    }
    const g = new Game({ levels: ['human', this.level], first, ui: this, names: ['You', 'Iguanodon'] });
    this.game = g;
    if (rollNote) g.logs.push({ q: null, text: rollNote, card: null });
    this.render(g);
    g.play().catch(e => { if (e.message !== 'stale') console.error(e); });
  },
  showEnd(g) {
    if (g._endShown || g !== this.game) return; g._endShown = true;
    const gen = this.gen;
    const won = g.winner === 0;
    $('#end-title').textContent = won ? 'You win!' : g.winner === 1 ? 'The Iguanodon wins' : 'Game over';
    $('#end-text').textContent = `${won ? 'Three red Gems in your Warchest' : 'Three blue Gems in its Warchest'} after ${Math.ceil(g.turns / 2)} turns each, against the ${LEVEL[g.levels[1]].name} AI. Gems: you ${g.chest[0].length}, Iguanodon ${g.chest[1].length}.`;
    setTimeout(() => { if (gen === this.gen) $('#end').hidden = false; }, 900);
  },
};

function boot() {
  // setup choices
  $('#levels').innerHTML = Object.entries(LEVEL).map(([k, v]) => `<label class="lvl"><input type="radio" name="lvl" id="lvl-${k}" value="${k}" ${k === UI.level ? 'checked' : ''}><span><b>${v.name}</b><em>${v.blurb}</em></span></label>`).join('');
  document.addEventListener('change', e => {
    if (e.target.name === 'lvl') UI.level = e.target.value;
    if (e.target.name === 'first') UI.firstPick = e.target.value;
    if (e.target.name === 'speed') UI.speed = +e.target.value;
  });
  $('#start').addEventListener('click', () => UI.start());
  $('#new').addEventListener('click', () => { $('#setup').hidden = false; });
  $('#again').addEventListener('click', () => { $('#end').hidden = true; $('#setup').hidden = false; });
  $('#rules-btn').addEventListener('click', () => { $('#rules').hidden = false; });
  document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => { b.closest('.overlay').hidden = true; }));
  $('#zoom').addEventListener('click', () => { $('#zoom').hidden = true; });
  $('#prompt').addEventListener('click', e => UI.onPromptClick(e));
  // play a glowing card straight from the hand
  $('#me-hand').addEventListener('click', e => {
    const c = e.target.closest('[data-act]');
    if (c && UI.pending && UI.pending.kind === 'main') { UI.pending.res(c.dataset.act); return; }
    const k = e.target.closest('[data-card]'); if (k && matchMedia('(hover: none)').matches) UI.zoom(k.dataset.card);
  });
  // hover shows the whole card; on touch screens a tap opens it
  // when the side panel is off screen (narrow windows), a floating copy of the card follows the pointer
  const fl = $('#float');
  document.addEventListener('mouseover', e => {
    const k = e.target.closest('[data-card]');
    if (!k) { fl.hidden = true; return; }
    UI.preview(k.dataset.card);
    if (innerWidth <= 1000 && matchMedia('(hover: hover)').matches && !k.closest('#preview')) { fl.querySelector('img').src = img(k.dataset.card); fl.hidden = false; }
  });
  document.addEventListener('mousemove', e => {
    if (fl.hidden) return;
    const w = fl.offsetWidth, h = fl.offsetHeight;
    let x = e.clientX + 18, y = e.clientY - h / 2;
    if (x + w > innerWidth - 8) x = e.clientX - w - 18;
    y = Math.max(8, Math.min(innerHeight - h - 8, y));
    fl.style.transform = `translate(${x}px, ${y}px)`;
  });
  document.addEventListener('click', e => {
    const k = e.target.closest('#table [data-card], #log [data-card]');
    if (!k || e.target.closest('#me-hand') || e.target.closest('button')) return;
    UI.preview(k.dataset.card);
    if (matchMedia('(hover: none)').matches) UI.zoom(k.dataset.card);
  });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') document.querySelectorAll('.overlay').forEach(o => o.hidden = true); });
  // a sample table behind the setup screen
  const g = new Game({ levels: ['human', UI.level], ui: null, names: ['You', 'Iguanodon'] });
  g.drawTool(0, 1); g.drawTool(1, 1);
  for (let i = 0; i < 3; i++) { const c = g.mine.shift(); if (c.t[0] === 'G') g.mine.push(c); else g.hands[0].push(c); }
  g.row = g.mine.splice(0, 6); g.phase = 'excavate'; g.turns = 1;
  UI.game = g; UI.render(g); UI.preview('back-mine');
  $('#preview').innerHTML += '';
  UI.preview(g.row[0].id);
}
boot();
