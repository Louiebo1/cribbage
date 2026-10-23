// Replays the app's games (from tests/parity/main.swift) on the web version: every
// discard, pegging play, score and look-ahead total must match.
//   jsc tests/args.js -m tests/parity/parity.js -- /tmp/crib_parity/positions.jsonl
import * as G from '../../js/game.js';
import { chooseDiscard, simplePlay, playOut } from '../../js/computer.js';

const file = (globalThis.scriptArgs || [])[0] || '/tmp/crib_parity/positions.jsonl';
const lines = readFile(file).split('\n').filter(Boolean).map((l) => JSON.parse(l));
let hands = 0, searches = 0, decisions = 0, bad = 0;
const fail = (what, a, b) => { if (bad++ < 10) print(`DIFF ${what}: app ${JSON.stringify(a)} web ${JSON.stringify(b)}`); };
const sameSet = (a, b) => a.length === b.length && a.every((x) => b.includes(x));

for (const r of lines) {
  if (r.kind === 'search') {
    searches++;
    const totals = r.ranks.map(() => 0);
    for (const guess of r.guesses) {
      r.ranks.forEach((rank, i) => {
        const hands = []; hands[r.me] = r.hand.slice(); hands[1 - r.me] = guess.slice();
        totals[i] += playOut(rank, r.me, r.me, { hands, pile: r.pile.slice(), count: r.count, scored: [0, 0], need: r.need });
      });
    }
    if (totals.join() !== r.totals.join()) fail('look-ahead', r.totals, totals);
    continue;
  }
  hands++;
  const g = G.gameFromDeal(r.dealer, r.dealt, r.starter);
  g.scores = r.before.slice();
  for (const m of r.moves) {
    decisions++;
    if (m.discard) {
      const mine = chooseDiscard(g.hands[m.seat], g.dealer === m.seat);
      if (!sameSet(mine, m.discard)) fail('discard', m.discard, mine);
      G.discard(g, m.discard, m.seat);
    } else {
      const mine = simplePlay(g, m.seat);
      if (mine !== m.play) fail('play', m.play, mine);
      G.play(g, m.play, m.seat);
    }
  }
  for (let i = 0; i < 2 && g.phase === 'counting'; i++) G.continueCounting(g);
  const events = g.events.map((e) => ({ kinds: e.items.map((x) => x.kind), player: e.player, points: G.eventPoints(e), show: e.isShow }));
  if (JSON.stringify(events) !== JSON.stringify(r.events)) fail('events', r.events, events);
  if (g.scores.join() !== r.after.join() || g.phase !== r.phase) fail('scores', [r.after, r.phase], [g.scores, g.phase]);
}
print(`${hands} hands (${decisions} decisions), ${searches} look-ahead positions: ${bad ? bad + ' differences' : 'all identical'}`);
