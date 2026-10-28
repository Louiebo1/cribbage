// The web app: the start screen, the table, the show and the dialogs. It draws whatever
// table state it's given and turns taps into moves. "Me" is seat 0 against the computer
// and for whoever started an online game; the friend who joined is seat 1.

import * as G from './game.js';
import { SYMBOL, suitOf, rankLabel, isRed, label, rankOf, card, HEARTS, CLUBS, DIAMONDS, SPADES } from './cards.js';
import { itemLabel, total } from './scoring.js';
import { advice } from './computer.js';
import { newTableState, LocalHost, applyMove, PACE } from './table.js';
import { OnlineTable, onlineAvailable } from './online.js';
import { syncGame, pushName, pushStats, accountPanel, accountLobby, statsNote, account } from './account.js';
import { Board, MY_COLOR, THEIR_COLOR } from './board.js';
import { play as playSound, unlockSound, sound } from './sounds.js';

const app = document.getElementById('app');
// For checking the page: ?name=X, ?play, ?autoplay (the computer plays both seats),
// ?fast, ?counting=check|muggins, ?newgame=CODE (start an online game with that code).
const params = new URLSearchParams(location.search);

// MARK: Remembered on this device

function stored(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}
function store(key, value) {
  try { value === null ? localStorage.removeItem(key) : localStorage.setItem(key, JSON.stringify(value)); } catch {}
}

const settings = Object.assign({ name: '', back: 'red', highFirst: true, largePrint: false, sounds: true, hints: false, counting: 'automatic' },
  stored('crib.settings', {}));
function saveSettings() {
  store('crib.settings', settings);
  pushName(settings.name);
  document.body.classList.toggle('large-print', settings.largePrint);
  sound.on = settings.sounds;
}
saveSettings();

/** Wins and losses on this device, by kind of game. */
const stats = Object.assign({ computer: { won: 0, lost: 0, skunks: 0 }, online: { won: 0, lost: 0, skunks: 0 } }, stored('crib.stats', {}));
const recordText = () => {
  const won = stats.computer.won + stats.online.won, lost = stats.computer.lost + stats.online.lost;
  return won + lost ? `${won} win${won === 1 ? '' : 's'} · ${lost} loss${lost === 1 ? '' : 'es'}` : 'No games yet';
};

// The online game this browser last played, so the start screen can offer to go back.
const lastOnline = { get: () => stored('crib.online', null), set: (c) => store('crib.online', c), clear: () => store('crib.online', null) };
// A game against the computer, saved after every move (and kept while its match goes on).
const savedGame = {
  get: () => { const s = stored('crib.local', null); return s && s.game ? s : null; },
  set: (s) => store('crib.local', s),
};

const myName = () => settings.name || 'Player';

// MARK: Helpers

/** Names come from other people's browsers: never let them be read as HTML. */
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html !== undefined) e.innerHTML = html; return e; };
function button(text, cls, onclick) {
  const b = el('button', cls);
  b.textContent = text;
  b.onclick = onclick;
  return b;
}

function cardEl(c) {
  const e = el('div', 'card' + (isRed(c) ? ' red' : ''));
  e.innerHTML = `<div class="corner"><span class="r">${rankLabel(c)}</span><span class="s">${SYMBOL[suitOf(c)]}</span></div><div class="pip">${SYMBOL[suitOf(c)]}</div>`;
  e.setAttribute('aria-label', label(c));
  return e;
}

function backEl() {
  const e = el('div', 'back');
  const inner = el('div');
  inner.style.backgroundImage = `url(img/back_${settings.back}.jpg)`;
  e.appendChild(inner);
  return e;
}

/** A dialog over the page; Escape or a tap outside calls `dismiss`, when there is one. */
function dialog(title, body, buttons, dismiss) {
  const o = el('div', 'overlay'), p = el('div', 'panel');
  if (title) p.appendChild(el('h2', '', title));
  if (typeof body === 'string') p.appendChild(el('p', '', body));
  else if (body) p.appendChild(body);
  if (buttons && buttons.length) { const row = el('div', 'buttons'); row.append(...buttons); p.appendChild(row); }
  o.appendChild(p);
  if (dismiss) {
    o.dataset.dismiss = '';
    o.dismiss = dismiss;
    o.onclick = (e) => { if (e.target === o) dismiss(); };
  }
  return o;
}

/** A dialog of its own that stays on top while the table redraws under it.
 *  `buttons` are [text, class, action]; each one closes it. */
function popup(title, body, buttons, onDismiss) {
  const o = dialog(title, body, buttons.map(([text, cls, then]) => button(text, cls, () => { o.remove(); then?.(); })),
    () => { o.remove(); onDismiss?.(); });
  o.classList.add('popup');
  app.appendChild(o);
  return o;
}
const message = (html, then) => popup('', html, [['OK', 'primary', then]], then);
const confirmThen = (title, html, yes, onYes) => popup(title, html, [['Cancel', ''], [yes, 'primary', onYes]]);

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') [...document.querySelectorAll('.overlay[data-dismiss]')].pop()?.dismiss();
});
// Browsers only play sound after a tap.
document.addEventListener('pointerdown', unlockSound, { capture: true });

// MARK: State

let host = null;      // LocalHost or OnlineTable
let state = null;     // The table state being shown.
const ui = {
  me: 0,
  selected: new Set(),   // Cards picked for the crib.
  hint: null,            // "That would take the count past 31…"
  typed: '',             // The count being typed in the show.
  announcement: null,    // { event, until }: a pegging score floating over the table.
  announcementShown: null, // The event last drawn: it pops in only the first time.
  goShown: new Set(),    // Gos already drawn this hand: they pop in only once.
  lingering: null,       // { plays, until }: a finished run left up for a moment.
  holdShowUntil: 0,      // Pegging just ended: the show waits so the last points can be read.
  guess: null,           // Online guest: my move shown before the host confirms it.
  prev: null,            // The last game drawn (a copy), to see what changed.
  recorded: false,       // This game's result is in the stats.
  animatedPlays: 0,      // Pegged cards already slid onto the table.
  board: null,
};
const later = [];        // Timers that redraw when something on the table expires.

function resetUI() {
  ui.selected.clear(); ui.hint = null; ui.typed = ''; ui.announcement = null; ui.lingering = null;
  ui.announcementShown = null; ui.goShown.clear();
  ui.holdShowUntil = 0; ui.guess = null; ui.prev = null; ui.recorded = false; ui.animatedPlays = 0; ui.board = null; ui.overlayKey = null;
  later.splice(0).forEach(clearTimeout);
}

const isOnline = () => host instanceof OnlineTable;
/** The game as this browser shows it (with the guest's own move, until confirmed). */
const shown = () => (ui.guess && ui.guess.version >= state.version ? ui.guess.game : state.game);
const nameOf = (seat) => esc(seat === ui.me ? 'You' : state.seats[seat].name);
const opponentName = () => esc(state.seats[1 - ui.me].name);

// MARK: Start screen

function leave() {
  host?.stop(); host = null; state = null;
  resetUI();
  showLobby();
}

function showLobby() {
  host?.stop(); host = null; state = null;
  if (location.search) history.replaceState(null, '', location.pathname);
  app.innerHTML = '';
  const lobby = el('div', 'lobby');
  const fan = el('div', 'fan');
  [card(HEARTS, 5), card(CLUBS, 5), card(DIAMONDS, 5), card(SPADES, 11)].forEach((c, i) => {
    const e = cardEl(c);
    e.style.transform = `rotate(${(i - 1) * 7 - 3}deg)`;
    fan.appendChild(e);
  });
  lobby.appendChild(fan);
  lobby.appendChild(el('h1', '', 'Cribbage'));
  lobby.appendChild(el('div', 'tag', 'Fifteen two, fifteen four…'));
  const board = new Board();
  board.update([61, 96], [55, 88], 0, [1, 2]);
  board.el.classList.add('preview');
  lobby.appendChild(board.el);

  const name = el('div', 'name', 'Playing as ');
  name.appendChild(button(settings.name || 'You', 'link', () => askName(showLobby)));
  lobby.appendChild(name);
  lobby.appendChild(el('div', 'note', recordText()));
  lobby.appendChild(accountLobby());          // Sign in with Google (or who's signed in).

  const code = onlineAvailable() && lastOnline.get();
  if (code) lobby.appendChild(button(`Back to Game ${code}`, 'big-button primary', () => joinGame(code)));
  const saved = savedGame.get();
  if (saved) {
    const g = saved.game;
    const b = el('button', 'big-button primary resume');
    b.innerHTML = g.phase === 'gameOver'
      ? `Continue Match<small>vs the Computer · Match ${g.match[0]}–${g.match[1]}</small>`
      : `Continue Game<small>You ${g.scores[0]}, Computer ${g.scores[1]} · Hand ${g.handNumber + 1} · Match ${g.match[0]}–${g.match[1]}</small>`;
    b.onclick = () => playComputer(saved);
    lobby.appendChild(b);
  }
  lobby.appendChild(button(saved ? 'New Game vs the Computer' : 'Play the Computer', 'big-button', () => playComputer()));
  const friends = button('Play with a Friend', 'big-button', showFriends);
  friends.disabled = !onlineAvailable();
  lobby.appendChild(friends);
  const links = el('div', 'links');
  links.append(button('Statistics', 'link', showStats), button('Settings', 'link', () => showSettings(showLobby)));
  lobby.appendChild(links);
  app.appendChild(lobby);
  if (!settings.name) askName(showLobby);
}

function askName(then) {
  const input = el('input', 'text');
  input.maxLength = 16; input.value = settings.name; input.placeholder = 'Your name'; input.autocomplete = 'nickname';
  const save = () => {
    const name = input.value.trim().slice(0, 16);
    if (!name) { input.focus(); return; }
    settings.name = name; saveSettings(); o.remove(); then?.();
  };
  input.onkeydown = (e) => { if (e.key === 'Enter') save(); };
  const o = dialog('Your name?', input, [button('OK', 'primary', save)], settings.name ? () => o.remove() : null);
  o.classList.add('popup');
  app.appendChild(o);
  input.focus();
}

function playComputer(saved = null) {
  const autoplay = params.has('autoplay');
  const s = saved || newTableState([{ kind: autoplay ? 'computer' : 'person', name: settings.name || 'You' }, { kind: 'computer', name: 'Computer' }], settings.counting);
  ui.me = 0;
  resetUI();
  // A finished game was already counted when it ended.
  ui.recorded = s.game.phase === 'gameOver';
  host = new LocalHost(s, (next) => {
    state = next;
    if (!autoplay) savedGame.set(next.game.phase === 'gameOver' && G.matchWinner(next.game) !== null ? null : next);
    update();
  });
  // A saved game uses today's counting setting.
  if (saved && saved.game.countingMode !== settings.counting) host.send({ type: 'counting', mode: settings.counting });
}

// MARK: Playing a friend

function showFriends() {
  app.innerHTML = '';
  const lobby = el('div', 'lobby');
  lobby.appendChild(el('h1', '', 'Cribbage'));
  lobby.appendChild(el('div', 'tag', 'Play with a friend'));
  lobby.appendChild(button('Start a Game', 'big-button primary', () => withTable(OnlineTable.create(myName(), onTableUpdate, settings.counting))));
  lobby.appendChild(el('div', 'note', 'or join with your friend’s code'));
  const row = el('div', 'row');
  const input = el('input', 'code');
  input.maxLength = 4; input.placeholder = 'CODE'; input.autocapitalize = 'characters'; input.autocomplete = 'off'; input.spellcheck = false;
  const join = button('Join', 'primary', () => { if (input.value.trim().length === 4) joinGame(input.value.trim()); else input.focus(); });
  input.onkeydown = (e) => { if (e.key === 'Enter') join.onclick(); };
  row.append(input, join);
  lobby.appendChild(row);
  lobby.appendChild(el('div', 'note', 'Start a game, then send your friend the link (or the 4-letter code). If either of you drops, the game waits — reopen the link, or tap Back to Game on the start screen.'));
  lobby.appendChild(button('Back', '', showLobby));
  app.appendChild(lobby);
}

const joinGame = (code) => withTable(OnlineTable.join(code, myName(), onTableUpdate, settings.counting));

async function withTable(promise) {
  app.innerHTML = '<div class="lobby"><div class="tag">Connecting…</div></div>';
  resetUI();
  try {
    host = await promise;
    lastOnline.set(host.code);
    history.replaceState(null, '', `${location.pathname}?g=${host.code}`);
    onTableUpdate();
  } catch (e) {
    const text = (e && e.message) || String(e);
    if (/no game|two players/i.test(text)) lastOnline.clear();
    showFriends();
    message(esc(text));
  }
}

function onTableUpdate() {
  if (!isOnline()) return;
  ui.me = Math.max(0, host.mySeat);
  if (host.started && host.state) {
    state = host.state;
    if (ui.guess && state.version > ui.guess.base) ui.guess = null;
    update();
  } else waitingRoom();
}

function waitingRoom() {
  const t = host;
  state = null;
  app.innerHTML = '';
  const lobby = el('div', 'lobby');
  lobby.appendChild(el('div', 'tag', 'Your game code'));
  lobby.appendChild(el('h1', 'game-code', t.code));
  const link = `${location.origin}${location.pathname}?g=${t.code}`;
  const share = button('Send the Link', 'big-button primary', async () => {
    if (navigator.share) { try { await navigator.share({ title: 'Cribbage', text: `Play cribbage with me — game ${t.code}`, url: link }); } catch {} return; }
    try { await navigator.clipboard.writeText(link); share.textContent = 'Link Copied'; } catch { share.textContent = link; }
  });
  lobby.appendChild(share);
  lobby.appendChild(el('div', 'waiting', '<span class="dots"><i></i><i></i><i></i></span> Waiting for your friend to join…'));
  lobby.appendChild(el('div', 'note', 'The cards are dealt the moment they open the link or type the code.'));
  lobby.appendChild(button('Leave', '', () => { lastOnline.clear(); leave(); }));
  app.appendChild(lobby);
}

// MARK: Moves

function send(move) {
  if (isOnline() && !host.isHost) {
    // Show my own discard or play at once; the host's state replaces it.
    const copy = JSON.parse(JSON.stringify(state));
    if (applyMove(copy, move)) ui.guess = { game: copy.game, version: copy.version, base: state.version };
    host.send(move);
    update();
    return;
  }
  host.send(move);
}

function toggle(c) {
  const g = shown();
  if (g.phase !== 'discarding' || G.hasDiscarded(g, ui.me)) return;
  ui.hint = null;
  if (ui.selected.has(c)) ui.selected.delete(c);
  else if (ui.selected.size < 2) ui.selected.add(c);
  else ui.hint = 'That’s 2 already — tap a picked card to put it back first.';
  render();
}

function discardSelected() {
  const g = shown();
  if (g.phase !== 'discarding' || G.hasDiscarded(g, ui.me) || ui.selected.size !== 2) return;
  const cards = [...ui.selected];
  ui.selected.clear(); ui.hint = null;
  send({ type: 'discard', seat: ui.me, cards });
}

function playCard(c) {
  const g = shown();
  if (!G.canPlay(g, c, ui.me)) {
    // Say why the card can't be played.
    if (g.phase === 'pegging' && g.turn === ui.me && g.count + Math.min(rankOf(c), 10) > 31) ui.hint = `That would take the count past 31 (it’s at ${g.count}).`;
    else if (g.phase === 'pegging' && g.turn !== ui.me) ui.hint = 'Wait for your turn.';
    render();
    return;
  }
  ui.hint = null;
  ui.lingering = null;
  send({ type: 'play', seat: ui.me, card: c });
}

function suggest() {
  const g = shown();
  if (g.phase !== 'discarding' || G.hasDiscarded(g, ui.me)) return;
  const a = advice(g.hands[ui.me], g.dealer === ui.me);
  ui.selected = new Set(a.cards);
  ui.hint = `The computer would throw these. The four left average ${a.averageShow.toFixed(1)} points.`;
  render();
}

function claim(points) {
  const g = shown();
  ui.typed = '';
  send({ type: 'claim', seat: ui.me, hand: g.handNumber, step: g.countStep, points });
}

function continueShow() {
  const g = shown();
  send({ type: 'continue', seat: ui.me, hand: g.handNumber, step: g.countStep });
}

// MARK: What changed: sounds, the announcement, the lingering run, the stats

function update() {
  const g = shown(), old = ui.prev, now = Date.now();
  const newGame = !old || g.eventCounter < old.eventCounter || (old.phase === 'gameOver' && g.phase !== 'gameOver');
  const sameHand = old && !newGame && old.handNumber === g.handNumber;
  if (!sameHand) { ui.selected.clear(); ui.typed = ''; ui.goShown.clear(); }
  if (newGame) ui.announcementShown = null;
  if (old && !sameHand && g.handNumber !== old.handNumber) ui.hint = null;

  if (sameHand && g.plays.length === old.plays.length + 1) {
    if (g.pile.length !== old.pile.length + 1) {
      // The count went back to 0: keep the finished run up for a moment.
      ui.lingering = { plays: g.plays.slice(-(old.pile.length + 1)), until: now + PACE.runLinger };
      redrawAt(ui.lingering.until);
    } else ui.lingering = null;
  } else if (!sameHand) ui.lingering = null;
  if (old && old.phase === 'pegging' && g.phase === 'counting') {
    ui.holdShowUntil = params.has('fast') ? 0 : now + 4000;
    redrawAt(ui.holdShowUntil);
  }

  if (old && (!sameHand || newGame)) playSound('deal');
  else if (old && g.plays.length > old.plays.length) playSound('snap');
  if (old) {
    const lastSeen = newGame ? 0 : old.eventCounter;
    const fresh = g.events.filter((e) => e.id > lastSeen && G.eventPoints(e) > 0);
    if (fresh.length) playSound('peg', 180);
    // The show lists its own scores; announce the pegging ones.
    const event = [...fresh].reverse().find((e) => !e.isShow);
    if (event) {
      ui.announcement = { event, until: now + (explanation(event) ? 4500 : 3000) };
      redrawAt(ui.announcement.until);
    }
  }
  if (g.phase !== 'gameOver') ui.recorded = false;
  else if (!ui.recorded && old) {
    ui.recorded = true;
    const won = g.winner === ui.me, kind = stats[isOnline() ? 'online' : 'computer'];
    if (!params.has('autoplay')) {
      kind[won ? 'won' : 'lost'] += 1;
      if (won && G.isSkunk(g)) kind.skunks += 1;
      store('crib.stats', stats);
      pushStats();
    }
    if (won) playSound('fanfare', 300);
    if (G.matchWinner(g) === ui.me) playSound('fanfare', 1900);
  }
  ui.prev = JSON.parse(JSON.stringify(g));
  render();
}

function redrawAt(time) {
  later.push(setTimeout(() => { if (state) render(); }, Math.max(0, time - Date.now()) + 20));
}

/** Why a go or last card scored: "Pat couldn't play without going over 31". */
function explanation(event) {
  const kinds = event.items.map((i) => i.kind);
  if (kinds.includes('go')) return `${nameOf(1 - event.player)} couldn’t play without going over 31`;
  if (kinds.includes('lastCard')) return `${nameOf(event.player)} played the last card`;
  return null;
}

// MARK: The table

function sizes() {
  const w = document.documentElement.clientWidth, h = document.documentElement.clientHeight;
  const sideways = w > h && h < 500;
  const col = sideways ? (w - 36) / 2 : Math.min(w, 900) - 24;
  return {
    sideways,
    hand: Math.floor(Math.min(col / 6.4, 96, h / (sideways ? 4.4 : 7))),
    table: Math.floor(Math.min(col / 7, h / (sideways ? 7.5 : 11), 80)),
    cut: Math.floor(Math.min(col / 6.4, 96, h / (sideways ? 6 : 8))),
    board: Math.floor(Math.min(sideways ? col : col, 640, (sideways ? h * 0.45 : h * 0.19) / 0.23)),
  };
}

function render() {
  if (!state) return;
  const g = shown(), me = ui.me, opp = 1 - me, now = Date.now();
  const size = sizes();
  // The table and its overlays are redrawn in one piece; dialogs opened on top of them
  // (the menu, settings) are left alone.
  const screen = el('div', 'screen');
  const table = el('div', 'table' + (size.sideways ? ' sideways' : ''));
  table.style.setProperty('--hand-w', size.hand + 'px');
  table.style.setProperty('--table-w', size.table + 'px');
  table.style.setProperty('--cut-w', size.cut + 'px');
  table.style.setProperty('--board-w', size.board + 'px');
  if (isOnline() && !host.connected) table.appendChild(el('div', 'banner', 'Connection lost — reconnecting…'));

  // Top bar: my score, the hand and match, the menu.
  const top = el('div', 'topbar');
  top.appendChild(scoreChip(me, g));
  top.appendChild(el('div', 'center', `<b>Hand ${g.handNumber + 1}</b><small>Match ${g.match[me]}–${g.match[opp]} · first to 3</small>`));
  const menu = button('•••', 'menu', showMenu);
  menu.setAttribute('aria-label', 'Game menu');
  top.appendChild(menu);

  // The opponent: score, cards, a go, thinking.
  const them = el('div', 'opponent');
  them.appendChild(scoreChip(opp, g));
  const fan = el('div', 'fan-backs');
  g.hands[opp].forEach((_, i) => { const b = backEl(); b.style.left = `calc(var(--table-w) * 0.75 * 0.32 * ${i})`; fan.appendChild(b); });
  them.appendChild(fan);
  if (g.saidGo.includes(opp)) them.appendChild(goEl(g, opp));
  them.appendChild(el('div', 'spacer'));
  if ((g.phase === 'pegging' && g.turn === opp) || (g.phase === 'discarding' && !G.hasDiscarded(g, opp))) {
    them.appendChild(el('div', 'dots', '<i></i><i></i><i></i>'));
  }

  // The board (kept between redraws so the pegs slide).
  if (!ui.board) ui.board = new Board();
  const boardWrap = el('div', 'board-wrap');
  boardWrap.appendChild(ui.board.el);

  // The middle: the cut, the crib, the pegging.
  const middle = el('div', 'middle');
  const cut = el('div', 'pile cut');
  const deck = el('div', 'stack');
  deck.appendChild(backEl());
  if (g.starter !== null) {
    const s = cardEl(g.starter);
    // Turned up just now: it pops in (once).
    if (ui.starterShown !== g.starter) s.classList.add('turned');
    ui.starterShown = g.starter;
    deck.appendChild(s);
  } else deck.appendChild(backEl());
  cut.append(deck, el('div', 'caption', 'Cut'));
  const crib = el('div', 'pile crib');
  const cribStack = el('div', 'stack');
  if (!g.crib.length) cribStack.appendChild(el('div', 'slot'));
  g.crib.forEach((_, i) => { const b = backEl(); b.style.transform = `translate(${i * 2}px, ${-i * 2}px)`; cribStack.appendChild(b); });
  crib.append(cribStack, el('div', 'caption', g.dealer === me ? 'Your crib' : `${opponentName()}’s crib`));
  middle.append(cut, crib, peggingPile(g, now));
  if (ui.announcement && now < ui.announcement.until) middle.appendChild(announcementEl(ui.announcement.event));

  // My status and buttons, then my hand.
  const status = statusArea(g);
  const hand = handEl(g);

  if (size.sideways) {
    const left = el('div', 'side left'), right = el('div', 'side right');
    left.append(top, boardWrap);
    right.append(them, middle, status, hand);
    table.append(left, right);
  } else {
    table.append(top, them, boardWrap, middle, status, hand);
  }
  screen.appendChild(table);

  // Overlays. The same one as last time doesn't fade in again.
  let overlay = null, key = null;
  if (state.paused && state.paused.seat !== me) { overlay = pausedPanel(); key = 'paused'; }
  else if (g.phase === 'counting' && now >= ui.holdShowUntil) { overlay = showPanel(g); key = `show:${g.handNumber}:${g.countStep}`; }
  else if (g.phase === 'gameOver') { overlay = gameOverPanel(g); key = 'over'; }
  if (overlay) {
    if (key === ui.overlayKey) overlay.classList.add('still');
    screen.appendChild(overlay);
  }
  ui.overlayKey = key;
  const old = app.querySelector(':scope > .screen');
  if (old) old.replaceWith(screen);
  else { app.innerHTML = ''; app.appendChild(screen); }
  ui.board.update(g.scores, g.backPegs, me, g.match);
}

function scoreChip(seat, g) {
  const chip = el('div', 'chip');
  chip.innerHTML = `<span class="peg-dot" style="background:${seat === ui.me ? MY_COLOR : THEIR_COLOR}"></span>
    <span class="who"><b>${esc(state.seats[seat].name)}</b>${g.dealer === seat ? '<small>Dealer</small>' : ''}</span>
    <span class="score">${g.scores[seat]}</span>`;
  return chip;
}

/** The cards played since the count was last 0 (or a run that just ended), with the count. */
function peggingPile(g, now) {
  const run = ui.lingering && now < ui.lingering.until && g.phase === 'pegging' && g.pile.length === 0 ? ui.lingering.plays : null;
  const recent = run || g.plays.slice(g.plays.length - g.pile.length);
  const count = run ? run.reduce((n, p) => n + Math.min(rankOf(p.card), 10), 0) : g.count;
  const pile = el('div', 'pegging');
  const cards = el('div', 'played');
  if (!recent.length) cards.appendChild(el('div', 'slot'));
  // The card just played slides in (once).
  const enter = !run && g.plays.length > ui.animatedPlays ? g.plays[g.plays.length - 1] : null;
  ui.animatedPlays = g.plays.length;
  recent.forEach((p, i) => {
    const c = cardEl(p.card);
    c.classList.add(p.player === ui.me ? 'mine' : 'theirs');
    c.style.left = `calc(var(--table-w) * 0.36 * ${i})`;
    c.appendChild(el('div', 'bar'));
    if (p === enter) c.classList.add('enter', p.player === ui.me ? 'from-below' : 'from-above');
    cards.appendChild(c);
  });
  pile.appendChild(cards);
  if (g.phase === 'pegging' || count > 0) pile.appendChild(el('div', 'count', `Count ${count}`));
  return pile;
}

// A go for this run of the count: it pops in once, not on every redraw.
function goEl(g, seat) {
  const key = `${g.handNumber}:${g.plays.length - g.pile.length}:${seat}`;
  const go = el('div', 'go' + (ui.goShown.has(key) ? '' : ' fresh'), 'Go');
  ui.goShown.add(key);
  return go;
}

function announcementEl(event) {
  const why = explanation(event);
  // Pops in the first time it's drawn only; later redraws leave it still.
  const a = el('div', 'announcement ' + (event.player === ui.me ? 'mine' : 'theirs') + (ui.announcementShown === event.id ? '' : ' fresh'));
  ui.announcementShown = event.id;
  a.innerHTML = `<b>${event.items.map(itemLabel).join(' + ')} for ${G.eventPoints(event)}</b><small>${nameOf(event.player)}</small>${why ? `<span>${why}</span>` : ''}`;
  return a;
}

function statusText(g) {
  const me = ui.me;
  switch (g.phase) {
    case 'discarding': {
      if (G.hasDiscarded(g, me)) return `Waiting for ${opponentName()}…`;
      const whose = g.dealer === me ? 'your' : `${opponentName()}’s`;
      return ui.selected.size === 2 ? `Send them to ${whose} crib` : `Choose 2 cards for ${whose} crib`;
    }
    case 'pegging':
      if (g.turn === me) return 'Your play';
      return isOnline() ? `${opponentName()}’s play` : `${opponentName()} is playing…`;
    default: return '';
  }
}

function statusArea(g) {
  const area = el('div', 'status');
  const row = el('div', 'row');
  const discarding = g.phase === 'discarding' && !G.hasDiscarded(g, ui.me);
  if (g.saidGo.includes(ui.me)) row.appendChild(goEl(g, ui.me));
  row.appendChild(el('div', 'text', statusText(g)));
  if (discarding && settings.hints) row.appendChild(button('Suggest', 'ghost', suggest));
  if (discarding) {
    const b = button('Send to Crib', 'primary', discardSelected);
    b.disabled = ui.selected.size !== 2;
    row.appendChild(b);
  }
  area.appendChild(row);
  if (ui.hint && (discarding || g.phase === 'pegging')) area.appendChild(el('div', 'hint', esc(ui.hint)));
  return area;
}

function handEl(g) {
  const row = el('div', 'hand');
  const me = ui.me;
  const sign = settings.highFirst ? -1 : 1;
  const hand = g.hands[me].slice().sort((a, b) => (rankOf(a) !== rankOf(b) ? sign * (rankOf(a) - rankOf(b)) : suitOf(a) - suitOf(b)));
  const discarding = g.phase === 'discarding' && !G.hasDiscarded(g, me);
  const myTurn = g.phase === 'pegging' && g.turn === me;
  for (const c of hand) {
    const e = cardEl(c);
    if (ui.selected.has(c) && discarding) e.classList.add('picked');
    else if (G.canPlay(g, c, me)) e.classList.add('playable');
    else if (myTurn) e.classList.add('dim');
    if (discarding || myTurn) e.classList.add('tappable');
    e.onclick = () => (discarding ? toggle(c) : playCard(c));
    row.appendChild(e);
  }
  return row;
}

// MARK: The show

function showPanel(g) {
  const me = ui.me, player = G.countingPlayer(g), mine = player === me;
  const whose = mine ? 'Your' : `${esc(state.seats[player].name)}’s`;
  const body = el('div', 'show');
  const cards = el('div', 'show-cards');
  for (const c of G.countingCards(g)) {
    const e = cardEl(c);
    const thrower = g.thrownBy[c];
    if (g.countStep === 'crib' && thrower !== undefined) e.appendChild(el('div', 'bar ' + (thrower === me ? 'mine' : 'theirs')));
    cards.appendChild(e);
  }
  if (g.starter !== null) { const s = cardEl(g.starter); s.classList.add('starter'); s.appendChild(el('div', 'cut-tag', 'CUT')); cards.appendChild(s); }
  body.appendChild(cards);
  if (g.countStep === 'crib') {
    body.appendChild(el('div', 'key', `<span><i class="mine"></i>You threw</span><span><i class="theirs"></i>${opponentName()} threw</span>`));
  }
  if (G.awaitingClaim(g)) {
    if (mine) body.appendChild(claimPad());
    else body.appendChild(el('div', 'counting', `${esc(state.seats[player].name)} is counting <span class="dots"><i></i><i></i><i></i></span>`));
  } else {
    const items = G.countingItems(g), actual = total(items);
    const scored = g.claimed !== null && g.countingMode === 'muggins' ? Math.min(g.claimed, actual) : actual;
    if (g.claimed !== null) body.appendChild(claimResult(g.claimed, actual, player, g.countingMode === 'muggins'));
    const list = el('div', 'items');
    if (!items.length) list.appendChild(el('div', 'none', 'Nineteen — no points'));
    let running = 0;
    for (const item of items) {
      running += item.points;
      list.appendChild(el('div', 'item', `<b>${itemLabel(item)}</b><span>${item.cards.map(label).join(' ')}</span><em>${running}</em>`));
    }
    body.appendChild(list);
    body.appendChild(el('div', 'points ' + (mine ? 'mine' : 'theirs'), `${scored} point${scored === 1 ? '' : 's'}`));
    body.appendChild(continueArea(g));
  }
  return dialog(`${whose} ${g.countStep === 'crib' ? 'crib' : 'hand'}`, body, []);
}

/** The number pad for counting your own hand. */
function claimPad() {
  const pad = el('div', 'claim');
  pad.appendChild(el('div', 'ask', 'What’s it worth?'));
  pad.appendChild(el('div', 'typed', ui.typed || '?'));
  const keys = el('div', 'keys');
  const type = (d) => { const next = ui.typed === '0' ? String(d) : ui.typed + d; if (Number(next) <= 29) ui.typed = next; render(); };
  for (const k of ['1', '2', '3', '4', '5', '6', '7', '8', '9', '⌫', '0', 'C']) {
    keys.appendChild(button(k, 'key', () => {
      if (k === '⌫') { ui.typed = ui.typed.slice(0, -1); render(); } else if (k === 'C') { ui.typed = ''; render(); } else type(k);
    }));
  }
  pad.appendChild(keys);
  const done = button('That’s My Count', 'primary big', () => { if (ui.typed !== '') claim(Number(ui.typed)); });
  done.disabled = ui.typed === '';
  pad.appendChild(done);
  return pad;
}

/** How a player's count compared with the game's: right, short (and muggins), or over. */
function claimResult(said, actual, player, muggins) {
  const who = nameOf(player), other = nameOf(1 - player);
  const s = (n) => `${n} point${n === 1 ? '' : 's'}`;
  let lines, ok = false;
  if (said === actual) { lines = [`${who} said ${said}. That’s right!`]; ok = true; }
  else if (said < actual) {
    lines = [`${who} said ${said}, but it’s ${actual}: ${s(actual - said)} missed. Check the count below.`,
      muggins ? `Muggins! ${other} take${other === 'You' ? '' : 's'} the ${s(actual - said)}.` : `${who} still score${who === 'You' ? '' : 's'} ${actual}.`];
  } else lines = [`${who} said ${said}, but it’s only ${actual}. The count below shows where the points come from.`, `Scored ${actual}.`];
  return el('div', 'result ' + (ok ? 'ok' : 'off'), `<span class="icon">${ok ? '✓' : '!'}</span><div>${lines.map((l) => `<p>${l}</p>`).join('')}</div>`);
}

/** Against a person, Continue waits for both players (or 30 seconds after the first). */
function continueArea(g) {
  const area = el('div', 'continue');
  const me = ui.me;
  if ((g.continued || []).includes(me)) {
    const left = Math.max(0, Math.ceil(((g.continueDeadline ?? Date.now()) - Date.now()) / 1000));
    area.appendChild(el('div', 'pill', `Waiting for ${opponentName()}… ${left}`));
    redrawAt(Date.now() + 1000);
  } else {
    area.appendChild(button(g.countStep === 'crib' ? 'Next Hand' : 'Continue', 'primary big', continueShow));
    if ((g.continued || []).includes(1 - me)) area.appendChild(el('div', 'ready', `✓ ${opponentName()} is ready`));
  }
  return area;
}

function gameOverPanel(g) {
  const me = ui.me, won = g.winner === me;
  const body = el('div', 'game-over');
  if (G.isDoubleSkunk(g)) body.appendChild(el('div', 'skunk', won ? 'And a double skunk! 🦨🦨' : 'Double skunked! 🦨🦨'));
  else if (G.isSkunk(g)) body.appendChild(el('div', 'skunk', won ? 'And a skunk! 🦨' : 'Skunked! 🦨'));
  body.appendChild(el('div', 'final', `${g.scores[me]} – ${g.scores[1 - me]}`));
  const worth = G.matchGamesWon(g), mw = G.matchWinner(g);
  if (mw !== null) body.appendChild(el('div', 'match-won', mw === me ? 'You win the match! 🏆' : `${opponentName()} wins the match`));
  body.appendChild(el('div', 'match', `Match: You ${Math.min(g.match[me], 3)} – ${Math.min(g.match[1 - me], 3)} ${opponentName()}` +
    (worth > 1 ? ` <small>(${worth === 3 ? 'double skunk' : 'skunk'} counts ${worth})</small>` : '')));
  body.appendChild(el('div', 'note', recordText()));
  return dialog(won ? 'You win!' : `${opponentName()} wins`, body, [
    button(mw === null ? 'Next Game' : 'New Match', 'primary', () => send({ type: 'nextGame' })),
    button('Leave', '', leaveGame),
  ]);
}

function pausedPanel() {
  const away = state.paused;
  return dialog('Paused', `Waiting for <b>${esc(away.name)}</b> to come back… They reopen the link, or tap Back to Game on the start screen.`,
    [button('Leave for Now', '', leave)]);
}

// MARK: Menu, settings, statistics

function leaveGame() {
  // Online, keep the code so Back to Game works — unless the match is over.
  if (isOnline() && state && state.game.phase === 'gameOver' && G.matchWinner(state.game) !== null) lastOnline.clear();
  leave();
}

function showMenu() {
  const online = isOnline();
  popup('Menu', online ? `Online game <b>${host.code}</b>` : null, [
    ['New Game', '', () => confirmThen('New Game?', online ? 'This starts the game over for you both. The match score stays.' : 'This game’s score will be lost. The match score stays.', 'New Game', () => send({ type: 'nextGame' }))],
    ['New Match', '', () => confirmThen('New Match?', 'Start over with a fresh best-of-5 match.', 'New Match', () => send({ type: 'nextGame', newMatch: true }))],
    ['Statistics', '', showStats],
    ['Settings', '', () => showSettings(render)],
    [online ? 'Leave for Now' : 'Leave Game', '', leaveGame],
    ['Close', 'primary'],
  ]);
}

function showSettings(after) {
  const guest = isOnline() && !host.isHost;
  const form = el('div', 'settings');
  form.innerHTML = `
    ${state ? '' : '<label>Your name <input class="text" id="name" maxlength="16" autocomplete="nickname"></label>'}
    <label>Counting ${guest ? `<span class="fixed">${countingTitle(state.game.countingMode)} (the host’s)</span>` : `<select id="counting">${G.COUNTING.map((m) => `<option value="${m}" ${settings.counting === m ? 'selected' : ''}>${countingTitle(m)}</option>`).join('')}</select>`}</label>
    <div class="note">${countingNote()}</div>
    <label>Show the Suggest button <input type="checkbox" id="hints" ${settings.hints ? 'checked' : ''}></label>
    <label>Sounds <input type="checkbox" id="sounds" ${settings.sounds ? 'checked' : ''}></label>
    <label>Large card letters <input type="checkbox" id="large" ${settings.largePrint ? 'checked' : ''}></label>
    <label>Highest card on the left <input type="checkbox" id="high" ${settings.highFirst ? 'checked' : ''}></label>
    <label>Card back <select id="back">${['red', 'green', 'blue', 'black'].map((c) => `<option value="${c}" ${settings.back === c ? 'selected' : ''}>${c[0].toUpperCase() + c.slice(1)}</option>`).join('')}</select></label>`;
  const name = form.querySelector('#name');
  if (name) name.value = settings.name;
  const done = () => {
    if (name && name.value.trim()) settings.name = name.value.trim().slice(0, 16);
    const counting = form.querySelector('#counting');
    if (counting && counting.value !== settings.counting) {
      settings.counting = counting.value;
      if (state && host) send({ type: 'counting', mode: settings.counting });     // The host's setting applies to both.
    }
    settings.hints = form.querySelector('#hints').checked;
    settings.sounds = form.querySelector('#sounds').checked;
    settings.largePrint = form.querySelector('#large').checked;
    settings.highFirst = form.querySelector('#high').checked;
    settings.back = form.querySelector('#back').value;
    saveSettings();
    after?.();
  };
  if (!state) form.appendChild(accountPanel(button));     // Not at a table: it could change who holds the seat.
  popup('Settings', form, [['Done', 'primary', done]], done);     // Closing any way keeps the changes.
}

const countingTitle = (m) => ({ automatic: 'Automatic', check: 'You Count', muggins: 'You Count + Muggins' }[m]);
const countingNote = () => 'Automatic: the game counts every hand. You Count: you say what your hand is worth, and the game checks it. Muggins: points you miss go to the other player.';

function showStats() {
  const row = (title, s) => `<tr><td>${title}</td><td>${s.won}</td><td>${s.lost}</td><td>${s.skunks}</td></tr>`;
  const body = el('div', '', `<table class="stats"><tr><th></th><th>Won</th><th>Lost</th><th>Skunks</th></tr>${row('vs the Computer', stats.computer)}${row('vs Friends', stats.online)}</table><div class="note">${statsNote()}</div>`);
  popup('Statistics', body, [['Done', 'primary']]);
}

// MARK: Start

let resizeFrame = 0;
window.addEventListener('resize', () => { cancelAnimationFrame(resizeFrame); resizeFrame = requestAnimationFrame(render); });

// Signed in with Google (any of the family games): the name and statistics follow the account.
syncGame({
  id: 'cribbage',
  name: () => settings.name,
  setName: (n) => {
    settings.name = n; saveSettings();
    for (const b of document.querySelectorAll('.lobby .name button')) b.textContent = n;
  },
  stats: () => stats,
  setStats: (s) => { for (const kind of ['computer', 'online']) stats[kind] = Object.assign({ won: 0, lost: 0, skunks: 0 }, s[kind]); store('crib.stats', stats); },
});
if (params.get('name')) { settings.name = params.get('name').slice(0, 16); saveSettings(); }
if (G.COUNTING.includes(params.get('counting'))) { settings.counting = params.get('counting'); saveSettings(); }
if (params.has('fast')) Object.assign(PACE, { discard: 30, play: 40, claim: 40, runLinger: 60 });
const code = params.get('g') || params.get('newgame');
if (code && onlineAvailable()) {
  const go = () => (params.get('newgame') ? withTable(OnlineTable.create(myName(), onTableUpdate, settings.counting, code)) : joinGame(code));
  // Someone opening a shared link for the first time: their name before their seat.
  if (settings.name) go(); else askName(go);
} else if (params.has('play') || params.has('autoplay')) playComputer();
else showLobby();
