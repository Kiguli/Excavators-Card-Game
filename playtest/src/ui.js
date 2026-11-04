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
// every card object gets a number, so the table can follow a card from one place to another and animate it
const UIDS = new WeakMap(), BY_UID = new Map(); let nextUid = 0;
function uidOf(c) { if (!UIDS.has(c)) { UIDS.set(c, ++nextUid); BY_UID.set(nextUid, c); } return UIDS.get(c); }
const backSrc = (c, q) => img(!isTool(c.t) ? 'back-mine' : q === 0 || (q == null && /^red-/.test(c.id)) ? 'back-tools_red' : 'back-tools_blue');
// a hand stays on one line: when it is wider than its space, the cards overlap like a fan
function fitHand(el) {
  const cards = [...el.children].filter(c => c.classList.contains('card'));
  cards.forEach(c => { c.style.marginRight = ''; });
  if (cards.length < 2) return;
  const gap = parseFloat(getComputedStyle(el).columnGap) || 0;
  const total = cards.reduce((t, c) => t + c.offsetWidth, 0) + gap * (cards.length - 1);
  const over = total - el.clientWidth;
  if (over > 0) { const m = over / (cards.length - 1); cards.slice(0, -1).forEach(c => { c.style.marginRight = `-${m}px`; }); }
}
addEventListener('resize', () => { fitHand($('#me-hand')); fitHand($('#opp-hand')); });
function cardEl(c, opts = {}) {
  const cls = ['card', opts.cls || ''].join(' ');
  const attrs = (opts.attrs || '') + (opts.uids ? ` data-uids="${opts.uids.map(uidOf).join(',')}"` : opts.track === false ? '' : ` data-uid="${uidOf(c)}"`);
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
    const before = g.ui ? this.snap() : null;
    this.draw(g); fitHand($('#me-hand')); fitHand($('#opp-hand'));
    if (before) this.animate(before, g);
  },

  // ------------------------------------------------------------ card animations
  // Before each redraw the table notes where every card is; after it, cards that moved slide from their old
  // place, new cards fly in from the mine or a tool pile (a card you dig is shown big first), and cards that
  // left the table fly to the discard pile or back under the mine.
  snap() {
    const m = new Map();
    for (const el of document.querySelectorAll('#table [data-uid], #table [data-uids]')) {
      const r = el.getBoundingClientRect(); if (!r.width) continue;
      const ids = el.dataset.uids ? el.dataset.uids.split(',') : [el.dataset.uid];
      const face = el.querySelector('img') ? el.querySelector('img').getAttribute('src') : '';
      for (const u of ids) m.set(+u, { r, el, face, stack: !!el.dataset.uids, back: !!el.dataset.back, zone: (el.closest('[data-zone]') || {}).dataset?.zone });
    }
    return m;
  },
  animate(before, g) {
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const after = this.snap(), sp = Math.max(0.45, this.speed);
    const rectOf = s => { const e = $(s); return e ? e.getBoundingClientRect() : null; };
    const mineR = rectOf('#table .minepile .deck'), discR = rectOf('#discard');
    const toolR = q => rectOf(q === 0 ? '#me-tools .deck' : '#opp-tools .deck');
    const now = performance.now(); this.flying = this.flying || new Map();
    let k = 0;
    for (const [u, a] of after) {
      const b = before.get(u), c = BY_UID.get(u);
      if (this.flying.get(u) > now && !a.stack) a.el.style.opacity = '0';
      if (b) {
        const dx = b.r.left - a.r.left, dy = b.r.top - a.r.top;
        if (Math.abs(dx) < 2 && Math.abs(dy) < 2 || a.stack) continue;
        if (b.back !== a.back || b.zone !== a.zone) { this.fly(u, b.r, a.r, b.back ? backSrc(c, 1) : b.face, a.face, { sp, el: a.stack ? null : a.el, flip: b.back !== a.back }); continue; }
        a.el.animate([{ transform: `translate(${dx}px, ${dy}px) scale(${b.r.width / a.r.width})` }, { transform: 'none' }], { duration: 420 * sp, easing: 'cubic-bezier(.3,.7,.3,1)' });
        continue;
      }
      // a card that was not on the table before
      const zone = a.zone; if (!c || !zone) continue;
      const fromTools = isTool(c.t) && (zone === 'me-hand' || zone === 'opp-hand');
      const src = fromTools ? toolR(zone === 'me-hand' ? 0 : 1) : mineR; if (!src) continue;
      const big = zone === 'me-hand' && !fromTools && !a.stack ? true : zone === 'me-hand' && a.stack;
      this.fly(u, src, a.r, backSrc(c, fromTools ? (zone === 'me-hand' ? 0 : 1) : null), a.face, { sp, el: a.stack ? null : a.el, flip: !a.back, big, delay: zone === 'row' ? 110 * (k++) * sp : 0 });
    }
    // cards that left the table: to the discard pile or under the mine
    for (const [u, b] of before) {
      if (after.has(u)) continue;
      const c = BY_UID.get(u); if (!c) continue;
      if (discR && g.discards.includes(c)) this.fly(u, b.r, discR, b.back ? backSrc(c, 1) : b.face, img(c.id), { sp, flip: b.back, delay: 70 * (k++) * sp, fade: true });
      else if (mineR && g.mine.includes(c)) this.fly(u, b.r, mineR, b.face, img('back-mine'), { sp, flip: !b.back, delay: 90 * (k++) * sp, fade: true });
    }
    // the mine is shuffled
    const n = g.logs.length;
    if (this.seenLogs !== undefined && g.logs.slice(this.seenLogs).some(e => /shuffle/i.test(e.text))) {
      const d = $('#table .minepile .deck'); d.classList.remove('shuffle'); void d.offsetWidth; d.classList.add('shuffle');
    }
    this.seenLogs = n;
  },
  // a floating copy of a card, from one place to another; it can turn over on the way and pause big in the middle
  fly(u, from, to, src1, src2, o) {
    const gh = document.createElement('div'); gh.className = 'ghost';
    gh.style.width = to.width + 'px'; gh.style.height = to.height + 'px';
    gh.innerHTML = `<div class="gi"><img class="f" src="${o.flip ? src2 : src1}" alt=""><img class="b" src="${src1}" alt=""></div>`;
    document.body.appendChild(gh);
    const T = (r, s) => `translate(${r.left}px, ${r.top}px) scale(${s})`;
    const s0 = from.width / to.width, dur = (o.big ? 1500 : 520) * o.sp;
    let frames;
    if (o.big) {
      const t = $('#table').getBoundingClientRect(), S = Math.min(2.2, 190 / to.width);
      const mid = { left: t.left + t.width / 2 - to.width * S / 2, top: Math.max(8, Math.min(innerHeight - to.height * S - 8, t.top + t.height * .42 - to.height * S / 2)) };
      frames = [{ transform: T(from, s0), offset: 0 }, { transform: T(mid, S), offset: .3 }, { transform: T(mid, S), offset: .72 }, { transform: T(to, 1), offset: 1 }];
    } else frames = [{ transform: T(from, s0) }, { transform: T(to, 1), opacity: o.fade ? .2 : 1 }];
    const opt = { duration: dur, delay: o.delay || 0, easing: 'cubic-bezier(.3,.7,.3,1)', fill: 'both' };
    const an = gh.animate(frames, opt);
    if (o.flip) gh.firstElementChild.animate([{ transform: 'rotateY(180deg)' }, { transform: 'rotateY(180deg)', offset: .05 }, { transform: 'rotateY(0deg)', offset: o.big ? .3 : .6 }, { transform: 'rotateY(0deg)' }], opt);
    const end = performance.now() + dur + (o.delay || 0);
    if (o.el) { o.el.style.opacity = '0'; this.flying.set(u, end); }
    an.onfinish = () => {
      gh.remove();
      if (this.flying.get(u) <= performance.now() + 20) this.flying.delete(u);
      const live = document.querySelector(`#table [data-uid="${u}"]`); if (live) live.style.opacity = '';
    };
  },

  draw(g) {
    const me = 0, ai = 1;
    // opponent
    const aiHand = g.hands[ai];
    const reveal = g.knows[me] || g.phase === 'over';
    $('#opp-name').textContent = g.names[ai];
    $('#rules-now').textContent = g.ui ? this.rulesText(g.rules) : '';
    $('#opp-chest').innerHTML = this.chestHtml(g.chest[ai]);
    $('#opp-meta').innerHTML = `<span>${LEVEL[g.levels[ai]].name} AI</span><span>${aiHand.length} card${aiHand.length === 1 ? '' : 's'} in hand</span>${g.skip[ai] ? '<span class="warn">Skips next Dig</span>' : ''}`;
    // the rival's cards lie face down, one by one, so their number is easy to see
    $('#opp-hand').innerHTML = reveal ? aiHand.map(c => cardEl(c)).join('') :
      aiHand.map(c => `<div class="card back" data-uid="${uidOf(c)}" data-back="1"><img src="${img(isTool(c.t) ? 'back-tools_blue' : 'back-mine')}" alt="Hidden card"></div>`).join('');
    $('#opp-tools').innerHTML = this.toolPile(g.tdeck[ai].length, 'blue');
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
    $('#me-chest').innerHTML = this.chestHtml(g.chest[me]);
    $('#me-meta').innerHTML = `<span>Rock value ${g.rockValue(me)}</span>${g.rules.junkTrade ? `<span>Junk ${g.count(me, 'J')} of ${g.rules.junkTrade}</span>` : ''}${g.skip[me] ? '<span class="warn">Skips next Dig</span>' : ''}`;
    $('#me-tools').innerHTML = this.toolPile(g.tdeck[me].length, 'red');
    const top = g.discards[g.discards.length - 1];
    $('#discard').innerHTML = top ? cardEl(top) + `<span class="count">${g.discards.length}</span>` : '<div class="slot"></div>';
    $('#me-hand').innerHTML = this.handHtml(g.hands[me], true) || '<p class="empty">Your hand is empty. Dig to get cards.</p>';
    // log
    const L = g.logs.slice(-80);
    $('#log').innerHTML = L.map(e => `<li class="${e.q === 0 ? 'you' : e.q === 1 ? 'ai' : ''} ${/turn$/.test(e.text) ? 'turn' : ''}" ${e.card ? `data-card="${e.card}"` : ''}>${esc(e.text)}</li>`).join('');
    const lg = $('#log'); lg.scrollTop = lg.scrollHeight;
    const lastLog = g.logs[g.logs.length - 1]; $('#log-last').textContent = lastLog ? lastLog.text : '';
    if (!this.pending) this.renderPrompt();
    if (g.phase === 'over') this.showEnd(g);
  },

  // the Warchest: 3 card slots that fill with the Gems won
  chestHtml(gems) { return [0, 1, 2].map(i => gems[i] ? cardEl(gems[i]) : `<div class="gslot">${i + 1}</div>`).join(''); },
  toolPile(n, colour) {
    return `<div class="deck ${n ? '' : 'empty'}" data-card="back-tools_${colour}"><img src="${img('back-tools_' + colour)}" alt="${colour} tools"><span class="count">${n}</span></div><span class="plbl">Tools left</span>`;
  },

  handHtml(hand, mine) {
    const act = this.pending && this.pending.kind === 'main' ? this.pending.data.actions : [];
    const rocks = hand.filter(c => c.t === 'R'), junk = hand.filter(c => c.t === 'J');
    const order = ['NUGGET', 'CART', 'COIN', 'PICK', 'DYN', 'CANARY', 'M1', 'M2', 'M3', 'M4', 'M5', 'M6', 'CJ', 'SHIFT', 'SURVEY', 'HEADLAMP', 'SONAR', 'DRILL', 'SHOVEL', 'DEMAG', 'FLOOD', 'COLLAPSE'];
    const rest = hand.filter(c => c.t !== 'R' && c.t !== 'J').sort((a, b) => order.indexOf(a.t) - order.indexOf(b.t));
    let h = '';
    if (rocks.length) h += cardEl(rocks[rocks.length - 1], { cls: 'stack', badge: `×${rocks.length}`, label: 'Rocks', uids: rocks });
    if (junk.length) h += cardEl(junk[junk.length - 1], { cls: 'stack', badge: `×${junk.length}`, label: 'Junk', uids: junk });
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
        h = guide('Dig', g.rules.topGems ? 'Take the top card of the mine. A red Gem goes into your Warchest and you dig again. A blue Gem belongs to the Iguanodon, so it goes to the bottom of the mine and you dig again.' : 'Take the top card of the mine. Any Gem you dig here goes to the bottom of the mine and you dig again. Win Gems from the row, a 9-Rock trade or a Drill.') +
          `<div class="acts">${btn('Dig the top card', true, 'primary')}</div>`; break;
      case 'main': {
        const A = d.actions, lab = { SHIFT: 'Play Second Shift (draw 2 tools)', SURVEY: `Play Survey (see ${ai}'s hand)`, HEADLAMP: 'Play Headlamp (order the top 3)',
          SONAR: 'Play Sonar (bury 1 of the top 6)', DRILL: 'Play Drill (dig the top card)', TOOL_TRADE: 'Trade 3 Rocks for a tool', TOOL_TRADE2: 'Trade 5 Rocks for 2 tools', TOOL_TRADE3: 'Trade 7 Rocks for 3 tools',
          JUNK_TRADE: `Trade ${g.rules.junkTrade} Junk for a tool`, GEM_TRADE: 'Trade 9 Rocks for a Gem' };
        h = guide('Main phase', A.length ? 'Play tools and make Rock trades in any order. Glowing cards in your hand can be played now. When you are done, excavate the row.'
          : 'You have nothing to play right now. Excavate the row to lay out the next 6 cards.') +
          `<div class="acts">${A.map(a => btn(lab[a], a, a === 'GEM_TRADE' ? 'gold' : '')).join('')}${btn('Done: excavate the row', 'EXCAVATE', 'primary')}</div>`; break;
      }
      case 'roll':
        h = guide('Roll', d.dice > 1 ? 'Roll the dice, then choose one. You dig the card at that position in the row.' : 'Roll the die. You dig the card at that position in the row.') +
          `<div class="acts">${d.pick ? btn(`Use Pickaxe: roll ${d.dice + 1} dice`, true) : ''}${btn(d.dice > 1 ? `Roll ${d.dice} dice` : 'Roll the die', false, 'primary')}</div>`; break;
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
          : d.rolls && d.rolls.length ? `${ai} rolled ${d.rolls.map(v => v + 1).join(' and ')}. Play Claim Jump to take these dice and the dig yourself, then skip your next Dig.`
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
        const text = isRet ? `The left card comes back up first, so put ${ai}'s Gems on the right.`
          : `The top ${ord.length} cards of the mine. The left card is dug next. Use the arrows to reorder.`;
        h = guide(t, text) + `<div class="thumbs order">${ord.map((c, i) => `<div class="ordslot"><div class="thumb" data-card="${c.id}"><img src="${img(c.id)}" alt="${esc(cname(c))}"><span>${i + 1}</span></div><button class="arrow" data-mv="${i},-1" ${i ? '' : 'disabled'} aria-label="Move left">◀</button><button class="arrow" data-mv="${i},1" ${i < ord.length - 1 ? '' : 'disabled'} aria-label="Move right">▶</button></div>`).join('')}` +
          `<div class="acts">${isRet ? btn(`Bury ${ai}'s Gems deepest`, 'BURY') : ''}${btn(isRet ? 'Done: return to the mine' : 'Done: put them back', 'OK', 'primary')}</div></div>`; break;
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
    const g = new Game({ levels: ['human', this.level], first, ui: this, names: ['You', 'Iguanodon'], rules: this.readRules() });
    this.game = g;
    if (rollNote) g.logs.push({ q: null, text: rollNote, card: null });
    this.render(g);
    g.play().catch(e => { if (e.message !== 'stale') console.error(e); });
  },
  readRules() {
    const v = id => { const e = document.querySelector(`input[name="${id}"]:checked`); return e ? e.value : null; };
    return { junk: +v('r-junk'), junkTrade: +v('r-jtrade'), ladder: v('r-ladder') === '1', start: +v('r-start'), dice: +v('r-dice'), cjAfter: v('r-cj') === '1', topGems: v('r-topgems') !== '0', drill: +v('r-drill') };
  },
  rulesText(r) {
    if (r.junk === 5 && !r.junkTrade && r.ladder && r.start === 3 && r.dice === 2 && r.cjAfter && !r.topGems && r.drill === 2) return 'default rules: 5 Junk, Rock ladder, 3 starting tools, Claim Jump after the roll, Gems not kept from the Dig, 2 Drills each';
    const out = [];
    if (r.junk !== 20) out.push(`${r.junk} Junk, ${52 - r.junk} Rocks`);
    if (r.junkTrade) out.push(`${r.junkTrade} Junk buy a tool`);
    if (r.ladder) out.push('Rock ladder 3/5/7/9');
    if (r.start !== 1) out.push(`start with ${r.start} tools`);
    if (r.dice !== 2) out.push('1 die');
    if (r.cjAfter) out.push('Claim Jump after the roll');
    if (!r.topGems) out.push('no Gems from the Dig');
    if (r.drill) out.push(`${r.drill} Drills each`);
    return out.length ? out.join(', ') : 'standard v1 rules';
  },
  showEnd(g) {
    if (g._endShown || g !== this.game) return; g._endShown = true;
    const gen = this.gen;
    const won = g.winner === 0;
    $('#end-title').textContent = won ? 'You win!' : g.winner === 1 ? 'The Iguanodon wins' : 'Game over';
    $('#end-text').textContent = `${won ? 'Three red Gems in your Warchest' : 'Three blue Gems in its Warchest'} after ${Math.ceil(g.turns / 2)} turns each, against the ${LEVEL[g.levels[1]].name} AI (${this.rulesText(g.rules)}). Gems: you ${g.chest[0].length}, Iguanodon ${g.chest[1].length}.`;
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
  const setRules = vals => { for (const [k, v] of Object.entries(vals)) { const e = document.getElementById(`r-${k}-${v}`); if (e) e.checked = true; } };
  $('#r-recommended').addEventListener('click', () => setRules({ junk: 5, jtrade: 0, ladder: 1, start: 3, dice: 2, cj: 1, topgems: 0, drill: 2 }));
  $('#r-drills').addEventListener('click', () => setRules({ junk: 5, jtrade: 0, ladder: 1, start: 3, dice: 2, cj: 1, topgems: 1, drill: 0 }));
  $('#r-reset').addEventListener('click', () => setRules({ junk: 20, jtrade: 0, ladder: 0, start: 1, dice: 2, cj: 0, topgems: 1, drill: 0 }));
  $('#new').addEventListener('click', () => { $('#setup').hidden = false; });
  $('#again').addEventListener('click', () => { $('#end').hidden = true; $('#setup').hidden = false; });
  $('#rules-btn').addEventListener('click', () => { $('#rules').hidden = false; });
  // the animated tutorial opens over the table; "Play a game" at its end goes to the setup screen
  let tut = null;
  const howto = () => {
    document.querySelectorAll('.overlay').forEach(o => { o.hidden = true; });
    $('#howto').hidden = false; document.body.style.overflow = 'hidden';
    if (!tut) tut = Tutorial.mount($('#howto-body'), { onPlay: () => { $('#howto').hidden = true; $('#setup').hidden = false; }, onClose: () => { $('#howto').hidden = true; $('#home').hidden = false; } });
    tut.start(0);
  };
  $('#howto-btn').addEventListener('click', howto);
  $('#setup-howto').addEventListener('click', howto);
  // the start screen: the tutorial or a game against the AI
  $('#home-tutorial').addEventListener('click', howto);
  $('#home-play').addEventListener('click', () => { $('#home').hidden = true; $('#setup').hidden = false; });
  $('#home-link').addEventListener('click', e => { e.preventDefault(); document.querySelectorAll('.overlay').forEach(o => { o.hidden = true; }); $('#home').hidden = false; });
  $('#rules-howto').addEventListener('click', howto);
  new MutationObserver(() => { document.body.style.overflow = $('#howto').hidden ? '' : 'hidden'; if ($('#howto').hidden && tut) tut.stop(); }).observe($('#howto'), { attributes: true, attributeFilter: ['hidden'] });
  if (location.hash === '#how-to-play' || location.hash === '#tutorial') howto();
  else if (location.hash === '#play') { $('#home').hidden = true; $('#setup').hidden = false; }
  document.querySelectorAll('[data-close]').forEach(b => b.addEventListener('click', () => { b.closest('.overlay').hidden = true; }));
  $('#zoom').addEventListener('click', () => { $('#zoom').hidden = true; });
  // "What happened" pops up from the bottom right on hover, or on a tap
  $('#log-btn').addEventListener('click', () => { $('#logpop').classList.toggle('open'); const lg = $('#log'); lg.scrollTop = lg.scrollHeight; });
  $('#logpop').addEventListener('mouseenter', () => { const lg = $('#log'); lg.scrollTop = lg.scrollHeight; });
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
