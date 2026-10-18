// Excavators v1 rules engine with AI players.
// Player 0 is red (T-rex), player 1 is blue (Iguanodon). Either seat can be a person or a bot.
// Every decision goes through game.ask(q, kind, data): bots answer at once, a person answers
// through the interface (the promise resolves when they click).

const TREASURES = ['LANTERN', 'CART', 'NUGGET', 'MAP', 'COIN', 'PICK', 'DYN', 'CANARY'];
const TOOLS = ['SURVEY', 'SHOVEL', 'DEMAG', 'FLOOD', 'SHIFT', 'SONAR', 'COLLAPSE', 'HEADLAMP'];
const KEEP = new Set(['CART', 'NUGGET', 'COIN', 'PICK', 'DYN', 'CANARY']);
const TOOL_SLUG = { SURVEY: 'survey', SHOVEL: 'shovel', DEMAG: 'demagnetiser', FLOOD: 'flooded-shaft', SHIFT: 'second-shift',
  SONAR: 'sonar', COLLAPSE: 'collapse', HEADLAMP: 'headlamp', CJ: 'claim-jump' };
const TREASURE_NO = { LANTERN: 1, CART: 2, NUGGET: 3, MAP: 4, COIN: 5, PICK: 6, DYN: 7, CANARY: 8 };
const TYPE_NAME = { G0: 'red Gem', G1: 'blue Gem', R: 'Rock', J: 'Junk', CAVE: 'Cave-in', LANTERN: 'Lantern', CART: 'Mine Cart',
  NUGGET: 'Gold Nugget', MAP: 'Old Map', COIN: 'Lucky Coin', PICK: 'Pickaxe', DYN: 'Dynamite', CANARY: 'Canary',
  SURVEY: 'Survey', SHOVEL: 'Shovel', DEMAG: 'Demagnetiser', FLOOD: 'Flooded Shaft', SHIFT: 'Second Shift', SONAR: 'Sonar',
  COLLAPSE: 'Collapse', HEADLAMP: 'Headlamp', CJ: 'Claim Jump', NUDGE: 'Nudge', M1: 'Magnet 1', M2: 'Magnet 2', M3: 'Magnet 3', M4: 'Magnet 4',
  M5: 'Magnet 5', M6: 'Magnet 6' };
const COLOUR = ['red', 'blue'];
const GEM_COST = 9, TOOL_COST = 3, LADDER = { 1: 3, 2: 5, 3: 7 };
const CAVE_ORDER = ['SURVEY', 'HEADLAMP', 'SONAR', 'COLLAPSE', 'CJ', 'NUDGE', 'SHIFT', 'DEMAG', 'FLOOD', 'SHOVEL'];

class GameOver extends Error {}

function isTool(t) { return t[0] === 'M' && t.length === 2 || t === 'CJ' || t === 'NUDGE' || TOOLS.includes(t); }

class Game {
  // levels: 'human' | 'random' (Easy) | 'casual' (Medium) | 'memory' (Hard)
  // rules: junk = Junk cards in the mine (the rest of the 20 become Rocks); junkTrade = Junk that buys a
  // tool (0 = off); ladder = 3 Rocks buy 1 tool, 5 buy 2, 7 buy 3 (9 still buy a Gem).
  // policy (bots, per seat, ladder only): 'greedy' buys the biggest step it can, 'single' buys 1 tool at a time,
  // 'save' keeps Rocks for a Gem while one of its Gems is still in the mine.
  constructor({ levels, first = 0, rng = Math.random, ui = null, names = ['Red', 'Blue'], rules = {}, policy = ['greedy', 'greedy'] }) {
    this.levels = levels; this.rng = rng; this.ui = ui; this.names = names; this.policy = policy;
    // dice = dice rolled (Pickaxe adds one); nudge = Nudge tools added to each tool deck (move the die 1 up or down)
    // cjAfter = Claim Jump is played after the roll, so the jumper sees the dice and takes them
    this.rules = Object.assign({ junk: 20, junkTrade: 0, ladder: false, start: 1, dice: 2, nudge: 0, cjAfter: false }, rules);
    this.mine = [];
    const add = (t, id) => this.mine.push({ t, id });
    for (let k = 1; k <= 3; k++) { add('G0', `gem-red-${k}`); add('G1', `gem-blue-${k}`); }
    const rocks = 32 + 20 - this.rules.junk;
    for (let k = 1; k <= rocks; k++) add('R', `rock-${(k - 1) % 32 + 1}`);
    for (let k = 1; k <= this.rules.junk; k++) add('J', `junk-${k}`);
    for (let k = 1; k <= 6; k++) add('CAVE', `cave-${k}`);
    for (const t of TREASURES) for (let c = 1; c <= 2; c++) add(t, `treasure-${TREASURE_NO[t]}-${c}`);
    this.shuffle(this.mine);
    this.U = this.mine.length;          // top U cards unseen since the last shuffle (for the card-counting bot)
    this.tdeck = [0, 1].map(q => {
      const c = COLOUR[q];
      const d = [1, 2, 3, 4, 5, 6].map(n => ({ t: `M${n}`, id: `${c}-magnet-${n}` }));
      d.push({ t: 'CJ', id: `${c}-claim-jump` });
      for (const t of TOOLS) d.push({ t, id: `${c}-${TOOL_SLUG[t]}` });
      for (let k = 1; k <= this.rules.nudge; k++) d.push({ t: 'NUDGE', id: `${c}-nudge` });
      return this.shuffle(d);
    });
    this.hands = [[], []]; this.chest = [[], []]; this.skip = [false, false]; this.knows = [false, false];
    this.p = first; this.turns = 0; this.row = []; this.rolls = []; this.chosen = -1; this.winner = null;
    this.phase = 'setup'; this.roller = null; this.discards = []; this.logs = []; this.lastDug = null; this.lastNote = ''; this.event = null;
    this.stats = { tools: [0, 0], trades: [0, 0], buys: [0, 0], junk: [0, 0], played: [0, 0], gemFrom: { mine: 0, row: 0, trade: 0 }, counters: 0, byType: {} };
  }

  // ---------- helpers ----------
  shuffle(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(this.rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
  rand(n) { return Math.floor(this.rng() * n); }
  lvl(q) { return this.levels[q]; }
  human(q) { return this.levels[q] === 'human'; }
  smart(q) { return this.levels[q] === 'memory'; }
  chance(q, smartChoice) { return this.lvl(q) === 'random' ? this.rng() < 0.5 : smartChoice; }
  defends(q, smartChoice) { return this.lvl(q) === 'casual' ? false : this.chance(q, smartChoice); }
  has(q, t) { return this.hands[q].some(c => c.t === t); }
  count(q, t) { return this.hands[q].filter(c => c.t === t).length; }
  take(q, t) { const i = this.hands[q].findIndex(c => c.t === t); const [c] = this.hands[q].splice(i, 1); this.discards.push(c); return c; }
  use(q, t, verb) { const c = this.take(q, t); this.stats.played[q]++; this.stats.byType[t] = (this.stats.byType[t] || 0) + 1; this.log(q, `${this.who(q)} ${verb || 'played'} ${TYPE_NAME[t]}.`, c); return c; }
  rockValue(q) { return this.count(q, 'R') + 3 * this.count(q, 'NUGGET'); }
  who(q) { return this.names[q]; }
  whose(q) { return this.human(q) ? 'Your' : this.names[q] + "'s"; }
  vs(q, verb) { return this.human(q) ? verb : verb.replace(/y$/, 'ie') + 's'; }
  gemOf(q) { return 'G' + q; }
  seen(q, i, t) { return this.lvl(q) === 'memory' && i >= this.U && i < this.mine.length && this.mine[i].t === t; }
  knownIn(q, t, lo, hi) { for (let i = lo; i < Math.min(hi, this.mine.length); i++) if (this.seen(q, i, t)) return true; return false; }
  log(q, text, card) { const e = { q, text, card: card ? card.id : null, turn: this.turns }; this.logs.push(e); this.emit(); }
  emit() { if (this.ui) this.ui.render(this); }
  async beat(ms = 600) { this.emit(); if (this.ui) await this.ui.sleep(ms); }
  async ask(q, kind, data = {}) {
    if (this.human(q)) { this.emit(); return this.ui.ask(q, kind, data, this); }
    return BOT[kind](this, q, data);
  }

  drawTool(q, n = 1) {
    for (let k = 0; k < n; k++) {
      if (!this.tdeck[q].length) { this.log(q, `${this.whose(q)} tool deck is empty.`); return; }
      const c = this.tdeck[q].pop(); this.hands[q].push(c); this.stats.tools[q]++;
      this.log(q, this.human(q) ? `You drew ${TYPE_NAME[c.t]}.` : `${this.who(q)} drew a tool.`, this.human(q) ? c : null);
    }
  }
  spendRocks(q, n) {
    while (n > 0) {
      if (n >= 3 && this.has(q, 'NUGGET')) { this.take(q, 'NUGGET'); n -= 3; }
      else if (this.has(q, 'R')) { this.take(q, 'R'); n -= 1; }
      else { this.take(q, 'NUGGET'); n -= 3; }
    }
  }

  async play() {
    try {
      this.phase = 'start'; this.log(null, `${this.who(this.p)} ${this.human(this.p) ? 'go' : 'goes'} first.`);
      for (const q of [0, 1]) this.drawTool(q, this.rules.start);
      while (this.winner === null) { await this.turn(); if (this.turns > 600) break; }
    } catch (e) { if (!(e instanceof GameOver)) throw e; }
    this.phase = 'over'; this.emit();
    return this.winner;
  }

  gemName(t) { const o = Number(t[1]); return `${this.human(o) ? 'your' : 'the ' + this.names[o] + "'s"} ${COLOUR[o]} Gem`; }
  announce(text, q, card) { this.event = { text, q, card: card ? card.id : null, n: (this.event ? this.event.n : 0) + 1 }; this.emit(); }
  addGem(q, c) {
    this.chest[q].push(c); this.lastNote = `To ${this.human(q) ? 'your' : this.names[q] + "'s"} Warchest`;
    const msg = `${this.who(q)} dug ${this.human(q) ? 'your' : 'its'} ${COLOUR[q]} Gem. It goes into ${this.human(q) ? 'your' : 'their'} Warchest (${this.chest[q].length} of 3).`;
    this.log(q, msg, c); this.announce(msg, q, c);
    if (this.chest[q].length >= 3) { this.winner = q; this.log(q, `${this.who(q)} ${this.human(q) ? 'win' : 'wins'}!`); throw new GameOver(); }
  }

  // ---------- digging ----------
  async digTop(q) {
    for (let k = this.mine.length; k > 0; k--) {
      const c = this.mine.shift(); this.U = Math.max(0, this.U - 1); this.lastDug = c;
      if (c.t[0] === 'G' && c.t !== this.gemOf(q)) {
        this.mine.push(c); this.lastNote = 'Back to the bottom';
        const msg = `${this.who(q)} dug ${this.gemName(c.t)}. Only its owner can keep it, so it goes to the bottom of the mine and ${this.human(q) ? 'you dig' : 'they dig'} again.`;
        this.log(q, msg, c); this.announce(msg, q, c);
        await this.beat(1400); continue;
      }
      await this.gain(q, c, 'mine'); return;
    }
  }

  async gain(q, c, from) {
    this.lastDug = c; this.lastNote = from === 'row' ? `From the row, by ${this.human(q) ? 'you' : this.names[q]}` : `Dug by ${this.human(q) ? 'you' : this.names[q]}`;
    const src = from === 'row' ? 'from the row' : 'from the mine';
    if (c.t === this.gemOf(q)) {
      this.stats.gemFrom[from]++;
      await this.beat(300); this.addGem(q, c); await this.beat(1400);
      await this.digTop(q);
    } else if (c.t === 'CAVE') {
      this.discards.push(c); this.log(q, `${this.who(q)} dug a Cave-in ${src}!`, c); await this.beat(700);
      await this.caveIn(q);
    } else if (c.t === 'LANTERN') {
      this.discards.push(c); this.log(q, `${this.who(q)} dug a Lantern ${src} and ${this.vs(q, 'draw')} 2 tools.`, c); await this.beat(500);
      this.drawTool(q, 2);
    } else if (c.t === 'MAP') {
      this.discards.push(c); this.log(q, `${this.who(q)} dug an Old Map ${src} and ${this.vs(q, 'look')} at the top 6 cards.`, c); await this.beat(500);
      await this.arrange(q, 6, 'Old Map');
    } else {
      this.hands[q].push(c);
      // a card dug from the mine is private: a person only sees the rival's card when it comes from the row
      const open = from === 'row' || this.human(q) || !this.human(1 - q);
      const label = c.t === 'R' ? 'a Rock' : c.t === 'J' ? 'Junk' : TYPE_NAME[c.t];
      this.lastDug = open ? c : { t: '?', id: 'back-mine' };
      this.log(q, `${this.who(q)} dug ${open ? label : 'a card'} ${src}.`, open ? c : null);
      await this.beat(500);
    }
  }

  async caveIn(q) {
    if (this.has(q, 'CANARY') && await this.ask(q, 'canary')) { this.use(q, 'CANARY', 'used'); this.log(q, 'The Canary sang. The Cave-in is ignored.'); return; }
    const tools = this.hands[q].filter(c => isTool(c.t));
    if (!tools.length) { this.log(q, `${this.who(q)} had no tool to lose.`); return; }
    const t = await this.ask(q, 'caveDiscard', { tools });
    const c = this.take(q, t); this.log(q, `${this.who(q)} lost ${TYPE_NAME[t]} in the Cave-in.`, c); await this.beat(600);
  }

  async arrange(q, k, source) {
    const top = this.mine.slice(0, k);
    if (!top.length) return;
    const order = await this.ask(q, 'arrange', { cards: top, source });
    if (order) this.mine.splice(0, top.length, ...order);
    this.log(q, `${this.who(q)} put the top ${top.length} back${this.lvl(q) === 'random' ? '' : ' in a chosen order'}.`);
  }

  // ---------- the turn ----------
  async turn() {
    const p = this.p; this.turns++; this.knows = [false, false]; this.roller = null;
    this.row = []; this.rolls = []; this.chosen = -1;
    this.phase = 'dig'; this.log(p, `${this.whose(p)} turn`); await this.beat(500);
    if (this.skip[p]) { this.skip[p] = false; this.log(p, `${this.who(p)} ${this.vs(p, 'skip')} the Dig after a Claim Jump.`); }
    else { if (this.human(p)) await this.ask(p, 'step', { step: 'dig' }); await this.digTop(p); }
    this.phase = 'main'; this.emit();
    if (this.human(p)) await this.humanMain(p); else await this.botMain(p);
    this.phase = 'excavate'; await this.excavateAndRoll(p);
    this.p = 1 - p;
  }

  async shift(p) { this.use(p, 'SHIFT'); this.drawTool(p, 2); await this.beat(500); }
  async survey(p) { this.use(p, 'SURVEY'); this.knows[p] = true; this.log(p, `${this.who(1 - p)} showed ${this.human(p) ? 'you' : this.who(p)} ${this.human(1 - p) ? 'your' : 'their'} hand.`); await this.beat(700); }
  async gemTrade(p, fromEnd) {
    const me = this.gemOf(p);
    this.spendRocks(p, GEM_COST); this.stats.trades[p]++;
    let i = -1;
    for (let k = 0; k < this.mine.length; k++) if (this.mine[k].t === me) { i = k; if (!fromEnd) break; }
    const [g] = this.mine.splice(i, 1);
    this.log(p, `${this.who(p)} traded ${GEM_COST} Rocks to search the mine for a Gem, then shuffled the mine.`);
    this.shuffle(this.mine); this.U = this.mine.length;
    this.stats.gemFrom.trade++; await this.beat(500); this.addGem(p, g); await this.beat(700);
  }
  async toolTrade(p, n = 1) {
    const cost = LADDER[n]; this.spendRocks(p, cost); this.stats.buys[p]++;
    this.log(p, `${this.who(p)} traded ${cost} Rocks for ${n === 1 ? 'a tool' : n + ' tools'}.`); this.drawTool(p, n); await this.beat(500);
  }
  async junkTrade(p) {
    for (let k = 0; k < this.rules.junkTrade; k++) this.take(p, 'J');
    this.stats.junk[p]++;
    this.log(p, `${this.who(p)} traded ${this.rules.junkTrade} Junk for a tool.`); this.drawTool(p, 1); await this.beat(500);
  }
  // the tool trades this player can afford now: [tools, cost] pairs
  buys(p) {
    const v = this.rockValue(p), d = this.tdeck[p].length, out = [];
    for (const n of this.rules.ladder ? [1, 2, 3] : [1]) if (v >= LADDER[n] && d >= n) out.push(n);
    return out;
  }
  canJunk(p) { return this.rules.junkTrade > 0 && this.count(p, 'J') >= this.rules.junkTrade && this.tdeck[p].length > 0; }
  async headlamp(p) { this.use(p, 'HEADLAMP'); await this.arrange(p, 3, 'Headlamp'); await this.beat(400); }
  async sonar(p, pick) {
    this.use(p, 'SONAR');
    const top = this.mine.slice(0, 6); if (!top.length) return;
    const i = pick !== undefined ? pick : await this.ask(p, 'sonar', { cards: top });
    this.mine.push(this.mine.splice(i, 1)[0]); if (i < this.U) this.U--;
    this.log(p, `${this.who(p)} put one of the top 6 cards on the bottom of the mine.`); await this.beat(500);
  }

  mainActions(p) {
    const a = [];
    if (this.has(p, 'SHIFT')) a.push('SHIFT');
    if (this.has(p, 'SURVEY')) a.push('SURVEY');
    if (this.has(p, 'HEADLAMP') && this.mine.length) a.push('HEADLAMP');
    if (this.has(p, 'SONAR') && this.mine.length) a.push('SONAR');
    for (const n of this.buys(p)) a.push('TOOL_TRADE' + (n > 1 ? n : ''));
    if (this.canJunk(p)) a.push('JUNK_TRADE');
    if (this.rockValue(p) >= GEM_COST && this.mine.some(c => c.t === this.gemOf(p))) a.push('GEM_TRADE');
    return a;
  }

  async humanMain(p) {
    for (;;) {
      const act = await this.ask(p, 'main', { actions: this.mainActions(p) });
      if (act === 'SHIFT') await this.shift(p);
      else if (act === 'SURVEY') await this.survey(p);
      else if (act === 'HEADLAMP') await this.headlamp(p);
      else if (act === 'SONAR') await this.sonar(p);
      else if (act === 'TOOL_TRADE') await this.toolTrade(p, 1);
      else if (act === 'TOOL_TRADE2') await this.toolTrade(p, 2);
      else if (act === 'TOOL_TRADE3') await this.toolTrade(p, 3);
      else if (act === 'JUNK_TRADE') await this.junkTrade(p);
      else if (act === 'GEM_TRADE') await this.gemTrade(p, false);
      else return;
    }
  }

  async botMain(p) {
    const me = this.gemOf(p), rv = this.gemOf(1 - p);
    await this.beat(400);
    if (this.has(p, 'SHIFT') && this.chance(p, true)) await this.shift(p);
    if (this.has(p, 'SURVEY') && this.chance(p, this.smart(p))) await this.survey(p);
    // Card counting: hold a Gem trade (and its shuffle) while my own Gem is known to be in my coming
    // row or the one after, unless the rival's Gem is known to be in their next dig or row.
    const hold = this.lvl(p) === 'memory' && (this.knownIn(p, me, 0, 6) || this.knownIn(p, me, 13, 20)) && !this.knownIn(p, rv, 6, 13);
    while (!hold && this.rockValue(p) >= GEM_COST && this.mine.some(c => c.t === me) && this.chance(p, true))
      await this.gemTrade(p, this.lvl(p) === 'memory');
    while (this.canJunk(p) && this.chance(p, true)) await this.junkTrade(p);
    for (;;) {
      const opts = this.buys(p); if (!opts.length || !this.chance(p, true)) break;
      let n;
      if (this.lvl(p) === 'random') n = opts[this.rand(opts.length)];
      else {
        const pol = this.rules.ladder ? this.policy[p] : 'single';
        if (pol === 'save' && this.mine.some(c => c.t === me)) break;
        n = pol === 'greedy' ? opts[opts.length - 1] : 1;
      }
      if (hold && this.rockValue(p) - LADDER[n] < GEM_COST) break;
      await this.toolTrade(p, n);
      if (this.has(p, 'SHIFT') && this.chance(p, true)) await this.shift(p);
    }
    if (this.has(p, 'HEADLAMP') && this.mine.length && this.chance(p, true)) await this.headlamp(p);
    // Card counting: a Gem known to sit 7th from the top falls to the rival's dig. Sonar a card out of
    // my row to pull it up into my row instead.
    if (this.has(p, 'SONAR') && this.mine.length > 6 && this.mine[6].t[0] === 'G' && this.seen(p, 6, this.mine[6].t)
        && !this.mine.slice(0, 6).some(c => c.t === this.mine[6].t)) {
      const i = Math.max(0, this.mine.slice(0, 6).findIndex(c => c.t === 'J'));
      await this.sonar(p, i);
    }
    if (this.has(p, 'SONAR') && this.mine.length && this.chance(p, true)) await this.sonar(p);
  }

  score(r, c) {
    if (!c) return -1;
    const mg = this.gemOf(r);
    return c.t === mg ? 10 : TREASURES.includes(c.t) ? 6 : c.t === 'R' ? 2 : c.t === 'CAVE' ? -3 : 0;
  }
  dieOn(r) { const c = this.row[this.die]; return !!c && c.t === this.gemOf(r); }

  async excavateAndRoll(p) {
    const o = 1 - p;
    this.row = this.mine.splice(0, 6); this.U = Math.max(0, this.U - 6);
    this.log(p, `${this.who(p)} excavated ${this.row.length} cards into the row.`); this.phase = 'excavate'; await this.beat(900);
    let r = p;
    const claim = async () => {
      if (this.has(o, 'CJ') && await this.ask(o, 'claimJump', { row: this.row, rolls: this.rolls, counter: false })) {
        this.use(o, 'CJ'); r = o; this.skip[o] = true; this.roller = r; await this.beat(700);
        if (this.has(p, 'CJ') && await this.ask(p, 'claimJump', { row: this.row, rolls: this.rolls, counter: true })) {
          this.use(p, 'CJ'); r = p; this.skip[p] = true; this.roller = r; this.log(p, `${this.who(p)} jumped the claim back.`); await this.beat(700);
        }
      }
    };
    if (!this.rules.cjAfter) await claim();
    this.roller = r; let rv = 1 - r; let mg = this.gemOf(r);
    this.phase = 'roll'; this.emit();
    if (this.has(r, 'DYN') && this.mine.length >= 6 && await this.ask(r, 'dynamite', { row: this.row })) {
      this.use(r, 'DYN'); this.mine.push(...this.row); this.row = this.mine.splice(0, 6); this.U = Math.max(0, this.U - 6);
      this.log(r, 'BOOM! The row went to the bottom and 6 new cards were excavated.'); await this.beat(1000);
    }
    let n = this.rules.dice;
    if (this.human(r)) { if (await this.ask(r, 'roll', { row: this.row, pick: this.has(r, 'PICK'), dice: n })) { this.use(r, 'PICK'); n++; } }
    else if (this.has(r, 'PICK') && await this.ask(r, 'pickaxe', { row: this.row })) { this.use(r, 'PICK'); n++; }
    this.rolls = Array.from({ length: n }, () => this.rand(6)); this.chosen = -1;
    this.log(r, `${this.who(r)} rolled ${this.rolls.map(d => d + 1).join(', ')}.`); await this.beat(800);
    if (this.rules.cjAfter) { await claim(); rv = 1 - r; mg = this.gemOf(r); this.emit(); }
    // choose a die (a Lucky Coin can reroll one first)
    for (;;) {
      const ch = await this.ask(r, 'chooseDie', { rolls: this.rolls, row: this.row, coin: this.has(r, 'COIN') });
      if (ch.coin !== undefined) {
        this.use(r, 'COIN'); this.rolls[ch.coin] = this.rand(6);
        this.log(r, `The die was rerolled: ${this.rolls[ch.coin] + 1}.`); await this.beat(700); continue;
      }
      this.chosen = ch.die; break;
    }
    this.log(r, `${this.who(r)} chose ${this.die + 1}.`); await this.beat(600);

    // Magnet contest: the rival plays first, then the roller may answer; it ends when both pass.
    let actor = rv, passes = 0; this.lastMag = null;
    for (let step = 0; step < 20 && passes < 2; step++) {
      const acted = await this.contestTurn(actor, r);
      passes = acted ? 0 : passes + 1; actor = 1 - actor;
    }
    this.phase = 'resolve'; this.emit();

    if (this.die < this.row.length) {
      const c = this.row[this.die];
      if (c.t === mg && this.has(rv, 'FLOOD') && await this.ask(rv, 'flood', { card: c })) {
        this.use(rv, 'FLOOD'); this.log(rv, 'The shaft flooded. The Gem stays in the row.'); await this.beat(900);
      } else if (c.t[0] !== 'G' || c.t === mg) {
        this.row.splice(this.die, 1); this.chosen = -1; await this.gain(r, c, 'row');
      } else {
        const msg = `Position ${this.die + 1} is ${this.gemName(c.t)}, so ${this.human(r) ? 'you' : this.who(r)} can't take it. It stays in the row.`;
        this.log(r, msg, c); this.announce(msg, r, c); await this.beat(1200);
      }
    }
    this.chosen = -1;
    if (this.has(r, 'CART')) {
      const cand = this.row.map((c, i) => i).filter(i => this.row[i].t[0] !== 'G' && this.row[i].t !== 'CAVE');
      if (cand.length) {
        const pick = await this.ask(r, 'cart', { row: this.row, cand });
        if (pick !== null && pick !== undefined) {
          this.use(r, 'CART'); const [c] = this.row.splice(pick, 1); await this.gain(r, c, 'row');
        }
      }
    }
    // Return
    this.phase = 'return'; this.emit();
    if (this.row.length) {
      if (this.has(o, 'COLLAPSE') && await this.ask(o, 'collapse', { row: this.row })) {
        this.use(o, 'COLLAPSE'); this.shuffle(this.row); this.log(o, `${this.who(p)} must shuffle the row before returning it.`);
      } else {
        const order = await this.ask(p, 'returnOrder', { row: this.row });
        this.row = order;
        this.log(p, `${this.who(p)} returned the row to the bottom of the mine.`);
      }
      await this.beat(500);
      this.mine.push(...this.row); this.row = [];
    }
    this.roller = null; this.rolls = []; this.emit();
  }

  get die() { return this.chosen >= 0 ? this.rolls[this.chosen] : -1; }
  set die(v) { this.rolls[this.chosen] = v; }

  contestOptions(a) {
    const opts = [];
    for (let k = 1; k <= 6; k++) if (this.has(a, 'M' + k) && this.die !== k - 1) opts.push({ type: 'M', k });
    if (this.has(a, 'DEMAG') && this.lastMag && this.lastMag.by !== a) opts.push({ type: 'DEMAG' });
    if (this.has(a, 'SHOVEL') && this.row.length >= 2) opts.push({ type: 'SHOVEL' });
    if (this.has(a, 'COIN')) opts.push({ type: 'COIN' });
    if (this.has(a, 'NUDGE')) { if (this.die > 0) opts.push({ type: 'NUDGE', d: -1 }); if (this.die < 5) opts.push({ type: 'NUDGE', d: 1 }); }
    return opts;
  }

  async contestTurn(a, r) {
    const opts = this.contestOptions(a);
    if (!opts.length) return false;
    const mv = await this.ask(a, 'contest', { opts, roller: r, row: this.row, die: this.die, lastMag: this.lastMag });
    if (!mv || mv.type === 'pass') return false;
    if (mv.type === 'M') {
      const prev = this.die; this.use(a, 'M' + mv.k); this.die = mv.k - 1; this.lastMag = { by: a, prev };
      this.log(a, `The die is now ${mv.k}.`);
    } else if (mv.type === 'DEMAG') {
      this.use(a, 'DEMAG'); this.die = this.lastMag.prev; this.lastMag = null;
      this.log(a, `The Magnet was cancelled. The die is back to ${this.die + 1}.`);
    } else if (mv.type === 'SHOVEL') {
      this.use(a, 'SHOVEL'); const [i, j] = mv.swap; [this.row[i], this.row[j]] = [this.row[j], this.row[i]]; this.lastMag = null;
      this.log(a, `Positions ${i + 1} and ${j + 1} were swapped.`);
    } else if (mv.type === 'COIN') {
      this.use(a, 'COIN'); this.die = this.rand(6); this.lastMag = null;
      this.log(a, `The die was rerolled: ${this.die + 1}.`);
    } else if (mv.type === 'NUDGE') {
      this.use(a, 'NUDGE'); this.die = this.die + mv.d; this.lastMag = null;
      this.log(a, `The die was nudged to ${this.die + 1}.`);
    }
    this.stats.counters++;
    await this.beat(900);
    return true;
  }
}

// ---------------------------------------------------------------- the bots
// Easy = 'random' (takes each legal option half the time), Medium = 'casual' (takes its own chances
// but never defends or buries Gems), Hard = 'memory' (plays every card well, defends, buries your Gems
// and remembers every card returned to the mine since the last shuffle).
const BOT = {
  canary: (g, q) => g.chance(q, true),
  caveDiscard: (g, q, { tools }) => {
    if (g.lvl(q) === 'random') return tools[g.rand(tools.length)].t;
    const rank = t => t[0] === 'M' && t.length === 2 ? 5 + 0.1 * Number(t[1]) : CAVE_ORDER.indexOf(t);
    return tools.slice().sort((a, b) => rank(a.t) - rank(b.t))[0].t;
  },
  arrange: (g, q, { cards }) => {
    if (g.lvl(q) === 'random') return null;
    const me = g.gemOf(q), rv = g.gemOf(1 - q), k = cards.length;
    const mine = cards.filter(c => c.t === me), others = cards.filter(c => c.t !== me);
    // my next dig is position 0; then 6 cards to my row. Rival gems go where the rival digs (the 7th card)
    // only if nothing else fits, so push them toward my row where they are harmless.
    others.sort((a, b) => (a.t === rv ? 1 : 0) - (b.t === rv ? 1 : 0) || (a.t === 'CAVE' ? 1 : 0) - (b.t === 'CAVE' ? 1 : 0));
    const out = new Array(k).fill(null);
    const slots = [0];
    for (let i = 1; i < k; i++) if (g.has(q, 'M' + i)) slots.push(i);
    for (let i = 0; i < k; i++) slots.push(i);
    for (const gm of mine) for (const s of slots) if (out[s] === null) { out[s] = gm; break; }
    // dig position 0 is next for me, so a Treasure is better there than a Cave-in
    const rest = others.slice().sort((a, b) => g.score(q, b) - g.score(q, a));
    let it = 0; for (let i = 0; i < k; i++) if (out[i] === null) out[i] = rest[it++];
    return out;
  },
  claimJump: (g, q, { row, rolls }) => {
    const me = g.gemOf(q);
    if (!g.rules.cjAfter || !rolls.length) return g.chance(q, row.some(c => c.t === me));
    // after the roll: jump when a die lands on my Gem, or I hold the Magnet that reaches it
    const hit = rolls.some(d => row[d] && row[d].t === me);
    const reach = row.some((c, i) => c.t === me && g.has(q, 'M' + (i + 1)));
    return g.chance(q, hit || reach);
  },
  dynamite: (g, q, { row }) => {
    const mg = g.gemOf(q), rv = g.gemOf(1 - q);
    const dud = (g.lvl(q) === 'memory' && g.U === 0 && !g.mine.slice(0, 6).some(c => c.t === mg))
      || (g.knownIn(q, rv, 0, 6) && !g.knownIn(q, mg, 0, 6));
    return g.chance(q, !row.some(c => c.t === mg) && !dud);
  },
  pickaxe: (g, q, { row }) => g.chance(q, row.some(c => c.t === g.gemOf(q))),
  chooseDie: (g, q, { rolls, row, coin }) => {
    if (g.lvl(q) === 'random') return { die: g.rand(rolls.length) };
    const sc = d => g.score(q, row[d]);
    let best = 0; for (let i = 1; i < rolls.length; i++) if (sc(rolls[i]) > sc(rolls[best])) best = i;
    if (coin && row.some(c => c.t === g.gemOf(q)) && sc(rolls[best]) < 10) {
      let worst = 0; for (let i = 1; i < rolls.length; i++) if (sc(rolls[i]) < sc(rolls[worst])) worst = i;
      if (!g._coinUsedThisRoll) { g._coinUsedThisRoll = true; return { coin: worst }; }
    }
    g._coinUsedThisRoll = false;
    return { die: best };
  },
  contest: (g, a, { opts, roller, row, die, lastMag }) => {
    const has = t => opts.some(o => o.type === t || (o.type === 'M' && 'M' + o.k === t));
    const r = roller, mg = g.gemOf(r), on = die < row.length && row[die].t === mg;
    if (a !== r) {      // the rival pushes the die off the roller's Gem
      if (!on || !g.defends(a, true)) return { type: 'pass' };
      if (lastMag && lastMag.by === r && has('DEMAG')) return { type: 'DEMAG' };
      const safe = row.map((c, i) => i).filter(i => row[i].t !== mg).sort((i, j) => g.score(r, row[i]) - g.score(r, row[j]));
      for (const i of safe) if (has('M' + (i + 1))) return { type: 'M', k: i + 1 };
      if (has('SHOVEL') && safe.length) return { type: 'SHOVEL', swap: [safe[0], die] };
      for (const d of [-1, 1]) if (opts.some(o => o.type === 'NUDGE' && o.d === d) && row[die + d] && row[die + d].t !== mg) return { type: 'NUDGE', d };
      if (has('COIN')) return { type: 'COIN' };
      return { type: 'pass' };
    }
    // the roller pulls the die back onto its own Gem
    if (g.lvl(r) === 'random' && g.rng() < 0.5) return { type: 'pass' };
    if (on || !row.some(c => c.t === mg)) return { type: 'pass' };
    if (g.knows[r] && g.has(1 - r, 'FLOOD') && g.smart(r)) return { type: 'pass' };
    const targets = row.map((c, i) => i).filter(i => row[i].t === mg);
    if (lastMag && lastMag.by !== r && has('DEMAG')) return { type: 'DEMAG' };
    for (const i of targets) if (has('M' + (i + 1))) return { type: 'M', k: i + 1 };
    for (const d of [-1, 1]) if (opts.some(o => o.type === 'NUDGE' && o.d === d) && targets.includes(die + d)) return { type: 'NUDGE', d };
    if (has('SHOVEL') && die < row.length) return { type: 'SHOVEL', swap: [targets[0], die] };
    return { type: 'pass' };
  },
  flood: (g, q) => g.defends(q, true),
  cart: (g, q, { row, cand }) => {
    const pick = cand.slice().sort((i, j) => g.score(q, row[j]) - g.score(q, row[i]))[0];
    return g.chance(q, row[pick].t !== 'J') ? pick : null;
  },
  collapse: (g, q, { row }) => g.defends(q, row.some(c => c.t === g.gemOf(q))),
  returnOrder: (g, p, { row }) => {
    const out = g.shuffle(row.slice());
    if (!g.smart(p)) return out;
    const o = 1 - p, key = c => c.t === g.gemOf(o) ? 2 : c.t === g.gemOf(p) ? 0 : 1;
    return out.sort((a, b) => key(a) - key(b));
  },
  sonar: (g, q, { cards }) => {
    if (g.lvl(q) === 'random') return g.rand(cards.length);
    const me = g.gemOf(q), rv = g.gemOf(1 - q);
    let i = cards.findIndex(c => c.t === rv); if (i >= 0) return i;
    i = cards.findIndex(c => c.t === 'CAVE'); if (i >= 0) return i;
    let best = -1; for (let k = 0; k < cards.length; k++) if (cards[k].t !== me && (best < 0 || g.score(q, cards[k]) < g.score(q, cards[best]))) best = k;
    return best < 0 ? cards.length - 1 : best;
  },
};

if (typeof module !== 'undefined') module.exports = { Game, BOT, TYPE_NAME, isTool, GameOver };
