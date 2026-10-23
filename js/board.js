// The cribbage board, drawn as SVG over Louie's walnut painting (img/classic_board.jpg),
// with the app's layout: two tracks of 120 holes in groups of five (out along the top
// rows, back along the bottom), a front and back peg per player, the skunk lines at 90
// and 60, the match holes on the strip, and a glow on the holes the last score jumped.
// The opponent's track is the upper row of each pair, yours the lower.

export const MY_COLOR = '#f2593a';
export const THEIR_COLOR = '#408cf2';
const BRASS = ['#fde699', '#d6a847', '#996f24', '#e6c266'];
const SKUNK_RED = '#c71a14';
const MAPLE = '#e6c287';
const NS = 'http://www.w3.org/2000/svg';

// Drawn at phone size (as the app) and scaled up: 400 × 92.
const W = 400, H = 92;
const spacing = (W - 24) / (59 + 11 * 0.7 + 4.4);
const firstX = 12 + spacing * 2.2;
const rowHeight = (H - 12) / 5;
const holeRadius = Math.max(1.2, Math.min(spacing * 0.28, rowHeight * 0.17));
const pegSize = Math.max(6, Math.min(spacing * 1.2, rowHeight * 0.72));
const holeX = (hole) => firstX + (hole - 1) * spacing + Math.floor((hole - 1) / 5) * spacing * 0.7;
const lastX = holeX(60);
/** Rows: both out lanes (1–60, left to right), the strip, both back lanes (61–120). */
const rowY = (player, lane) => 6 + rowHeight * ((lane === 0 ? (player === 0 ? 0 : 1) : (player === 0 ? 3 : 4)) + 0.5);
const stripH = rowHeight * 0.78;
const strip = { x: 12 + spacing * 0.3, y: 6 + rowHeight * 2.5 - stripH / 2, w: W - 24 - spacing * 0.6, h: stripH };
const stripMid = strip.y + strip.h / 2;
const skunkX = (holeX(30) + holeX(31)) / 2;
const doubleSkunkX = holeX(60) + spacing * 1.1;
const finish = { x: firstX - spacing * 1.6, y: stripMid };

function position(score, player) {
  if (score <= 0) return { x: firstX - spacing * 1.6, y: rowY(player, 0) };
  if (score <= 60) return { x: holeX(score), y: rowY(player, 0) };
  if (score <= 120) return { x: holeX(121 - score), y: rowY(player, 1) };
  return finish;
}

function matchHole(player, games) {
  const x = holeX(8) + Math.min(games, 3) * spacing * 2 + (games > 0 ? spacing : 0);
  return { x, y: stripMid + (player === 0 ? -1 : 1) * strip.h * 0.23 };
}

const f = (n) => Math.round(n * 100) / 100;
const hole = (x, y, r = holeRadius) =>
  `<circle cx="${f(x)}" cy="${f(y + 0.4)}" r="${f(r)}" fill="#f2c78c" opacity=".35"/><circle cx="${f(x)}" cy="${f(y)}" r="${f(r)}" fill="url(#hole)" stroke="${BRASS[1]}" stroke-opacity=".8" stroke-width=".5"/>`;
const text = (x, y, s, size, anchor = 'middle', fill = '#faE6b3', weight = 900) =>
  `<text x="${f(x)}" y="${f(y)}" font-size="${f(size)}" font-weight="${weight}" text-anchor="${anchor}" dominant-baseline="central" fill="${fill}" font-family="Georgia, serif">${s}</text>`;

/** The board's fixed parts: lanes, holes, strip, skunk lines, plate, match holes. */
function staticSVG() {
  let s = `<defs>
    <radialGradient id="hole" cx="50%" cy="65%" r="60%"><stop offset="0" stop-color="#000" stop-opacity=".95"/><stop offset="1" stop-color="#000" stop-opacity=".7"/></radialGradient>
    <linearGradient id="brass" x1="0" y1="0" x2="1" y2="1">${BRASS.map((c, i) => `<stop offset="${i / 3}" stop-color="${c}"/>`).join('')}</linearGradient>
    <radialGradient id="glow-0"><stop offset="0" stop-color="${THEIR_COLOR}" stop-opacity=".55"/><stop offset="1" stop-color="${THEIR_COLOR}" stop-opacity="0"/></radialGradient>
    <radialGradient id="glow-1"><stop offset="0" stop-color="${MY_COLOR}" stop-opacity=".55"/><stop offset="1" stop-color="${MY_COLOR}" stop-opacity="0"/></radialGradient>
    ${[0, 1].map((p) => `<radialGradient id="peg-${p}" cx="35%" cy="30%" r="65%"><stop offset="0" stop-color="#fff"/><stop offset=".3" stop-color="${p ? '#f6826a' : '#79acf5'}"/><stop offset=".7" stop-color="${p ? MY_COLOR : THEIR_COLOR}"/><stop offset="1" stop-color="${p ? '#9d3a26' : '#295b9d'}"/></radialGradient>`).join('')}
  </defs>`;
  // The players' lanes, tinted.
  for (const player of [0, 1]) {
    for (const lane of [0, 1]) {
      const y = rowY(player, lane);
      s += `<rect x="${f(firstX - spacing)}" y="${f(y - rowHeight * 0.4)}" width="${f(lastX - firstX + spacing * 2)}" height="${f(rowHeight * 0.8)}" rx="${f(rowHeight * 0.4)}" fill="${player ? MY_COLOR : THEIR_COLOR}" opacity=".13"/>`;
    }
  }
  // Lines between each group of five holes.
  for (const lane of [0, 1]) {
    const top = rowY(0, lane) - rowHeight * 0.42, bottom = rowY(1, lane) + rowHeight * 0.42;
    for (let group = 1; group < 12; group++) {
      const x = (holeX(group * 5) + holeX(group * 5 + 1)) / 2;
      if (Math.abs(x - skunkX) > 1) s += `<line x1="${f(x)}" y1="${f(top)}" x2="${f(x)}" y2="${f(bottom)}" stroke="${MAPLE}" stroke-opacity=".28" stroke-width=".7"/>`;
    }
  }
  // The smoked strip down the middle, edged in brass.
  s += `<rect x="${f(strip.x)}" y="${f(strip.y)}" width="${f(strip.w)}" height="${f(strip.h)}" rx="${f(strip.h * 0.3)}" fill="#000" opacity=".32"/>`;
  for (const y of [strip.y, strip.y + strip.h]) s += `<line x1="${f(strip.x + strip.h * 0.3)}" y1="${f(y)}" x2="${f(strip.x + strip.w - strip.h * 0.3)}" y2="${f(y)}" stroke="${BRASS[1]}" stroke-opacity=".85" stroke-width="1"/>`;
  const fontSize = Math.max(6, strip.h * 0.5), r = strip.h * 0.5;
  // The skunk line at 90 (and 30 on the way out) with an "S"; the double skunk at 60 with "SS".
  for (const [x, wide, label, left, right] of [[skunkX, 1, 'S', '30', '90'], [doubleSkunkX, 1.15, 'SS', '60', null]]) {
    const top = rowY(0, 0) - rowHeight * 0.45, bottom = rowY(1, 1) + rowHeight * 0.45;
    s += `<line x1="${f(x)}" y1="${f(top)}" x2="${f(x)}" y2="${f(bottom)}" stroke="${MAPLE}" stroke-opacity=".7" stroke-width="${f(Math.max(3, spacing * 0.45))}"/>`;
    s += `<line x1="${f(x)}" y1="${f(top)}" x2="${f(x)}" y2="${f(bottom)}" stroke="${SKUNK_RED}" stroke-width="${f(Math.max(2, spacing * 0.3))}"/>`;
    s += `<rect x="${f(x - r * wide)}" y="${f(stripMid - r)}" width="${f(r * 2 * wide)}" height="${f(r * 2)}" rx="${f(r)}" fill="${SKUNK_RED}" stroke="${BRASS[1]}" stroke-width=".8"/>`;
    s += text(x, stripMid, label, fontSize * (label === 'S' ? 0.95 : 0.75), 'middle', MAPLE);
    s += text(x - r * wide - 2, stripMid, left, fontSize, 'end');
    if (right) s += text(x + r * wide + 2, stripMid, right, fontSize, 'start');
  }
  for (const h of [15, 45]) s += text(holeX(h), stripMid, '·', fontSize);
  // The match holes: "MATCH", then a start hole and 3 game holes per player.
  s += text(holeX(5), stripMid, 'MATCH', fontSize * 0.8);
  for (const player of [0, 1]) for (let games = 0; games <= 3; games++) {
    const p = matchHole(player, games);
    s += hole(p.x, p.y, strip.h * (games === 0 ? 0.08 : 0.11));
  }
  // The brass name plate between 37 and 54.
  const plateH = strip.h * 0.82, px = holeX(37), pw = holeX(54) - px;
  s += `<rect x="${f(px)}" y="${f(stripMid - plateH / 2)}" width="${f(pw)}" height="${f(plateH)}" rx="${f(plateH * 0.25)}" fill="url(#brass)" stroke="#000" stroke-opacity=".45" stroke-width=".7"/>`;
  s += text(px + pw / 2, stripMid + 0.3, 'CRIBBAGE', plateH * 0.62, 'middle', '#402914', 700).replace('<text', `<text letter-spacing="${f(plateH * 0.18)}"`);
  // The finish hole: bigger, ringed in brass, with a star.
  const fr = holeRadius * 1.7;
  s += `<circle cx="${f(finish.x)}" cy="${f(finish.y)}" r="${f(fr * 1.6)}" fill="url(#brass)" stroke="#000" stroke-opacity=".4" stroke-width=".6"/>`;
  s += hole(finish.x, finish.y, fr);
  s += text(finish.x + fr * 1.6 + fontSize * 0.6, stripMid, '★', fontSize * 0.9, 'middle', BRASS[2]);
  // Every hole.
  for (const player of [0, 1]) {
    for (const lane of [0, 1]) for (let h = 1; h <= 60; h++) s += hole(holeX(h), rowY(player, lane));
    const start = position(0, player);
    s += hole(start.x, start.y);
  }
  return s;
}

const STATIC = staticSVG();

/** A board element. Keep it between redraws and call `update` so the pegs slide. */
export class Board {
  constructor() {
    this.el = document.createElement('div');
    this.el.className = 'board';
    this.el.innerHTML = `<svg viewBox="0 0 ${W} ${H}" role="img">${STATIC}<g class="glow"></g><g class="pegs"></g></svg>`;
    this.glow = this.el.querySelector('.glow');
    const pegs = this.el.querySelector('.pegs');
    // Per track (0 top, 1 bottom): a match peg, a back peg, a front peg.
    const peg = (track, size, cls) => {
      const g = document.createElementNS(NS, 'g');
      g.setAttribute('class', 'peg ' + cls);
      g.innerHTML = `<g class="pin"><circle r="${f(size / 2)}" fill="url(#peg-${track})" stroke="#000" stroke-opacity=".4" stroke-width=".6"/><circle cx="${f(-size * 0.16)}" cy="${f(-size * 0.18)}" r="${f(size * 0.11)}" fill="#fff" opacity=".85"/></g>`;
      pegs.appendChild(g);
      return g;
    };
    this.pegs = [0, 1].map((t) => ({ match: peg(t, strip.h * 0.4, 'match'), back: peg(t, pegSize * 0.92, 'back'), front: peg(t, pegSize, 'front') }));
    this.last = null;
  }

  /** Scores, back pegs and match games by seat; `me` is drawn on the bottom track. */
  update(scores, backPegs, me, match = [0, 0]) {
    const seats = [1 - me, me];
    void this.el.getBoundingClientRect();      // Just put back on the page: let the pegs slide from where they were.
    let glow = '';
    seats.forEach((seat, track) => {
      const p = this.pegs[track];
      const at = (g, pt) => { g.style.transform = `translate(${f(pt.x)}px, ${f(pt.y)}px)`; };
      // The holes the last score jumped.
      for (let s = Math.max(backPegs[seat], 0) + 1; s <= Math.min(scores[seat], 121); s++) {
        const pt = position(s, track);
        glow += `<circle cx="${f(pt.x)}" cy="${f(pt.y)}" r="${f(holeRadius * 2.4)}" fill="url(#glow-${track})"/>`;
      }
      const moved = this.last && this.last[track] !== scores[seat];
      at(p.match, matchHole(track, match[seat]));
      at(p.back, position(backPegs[seat], track));
      at(p.front, position(scores[seat], track));
      if (moved) {
        p.front.classList.remove('hop'); void p.front.getBBox(); p.front.classList.add('hop');
        clearTimeout(p.hopTimer); p.hopTimer = setTimeout(() => p.front.classList.remove('hop'), 800);
      }
    });
    this.glow.innerHTML = glow;
    this.last = seats.map((s) => scores[s]);
    this.el.setAttribute('aria-label', `Board: ${scores[me]} to ${scores[1 - me]}`);
  }
}
