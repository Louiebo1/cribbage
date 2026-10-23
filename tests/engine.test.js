// Run with: jsc -m tests/engine.test.js   (from the project folder)
import * as G from '../js/game.js';
import { scoreHand, scorePegging, total } from '../js/scoring.js';
import { card, CLUBS, DIAMONDS, SPADES, HEARTS } from '../js/cards.js';
import { chooseDiscard, choosePlay } from '../js/computer.js';

let failures = 0, checks = 0;
function expect(ok, what) { checks++; if (!ok) { failures++; print('FAIL: ' + what); } }
const C = (r) => card(CLUBS, r), D = (r) => card(DIAMONDS, r), S = (r) => card(SPADES, r), H = (r) => card(HEARTS, r);

// The show.
expect(total(scoreHand([H(5), C(5), D(5), S(11)], S(5), false)) === 29, 'the perfect 29');
expect(total(scoreHand([H(2), H(4), H(6), H(8)], C(13), false)) === 4, 'four-card flush in a hand');
expect(total(scoreHand([H(2), H(4), H(6), H(8)], C(13), true)) === 0, 'no four-card flush in the crib');
expect(total(scoreHand([C(3), D(3), S(4), H(5)], C(6), false)) === 2 + 2 + 2 + 8, 'double run of four');
expect(total(scoreHand([C(1), D(3), S(7), H(9)], C(13), false)) === 0, 'nineteen');

// Pegging.
expect(total(scorePegging([C(5), D(10)])) === 2, 'fifteen');
expect(total(scorePegging([C(7), D(7), S(7)])) === 6, 'three of a kind');
expect(total(scorePegging([C(4), D(6), S(5)])) === 2 + 3, 'fifteen and a run of three in any order');

// Whole games of the computer against itself, under each counting setting.
for (const mode of G.COUNTING) {
  const g = G.newGame();
  g.countingMode = mode;
  let steps = 0;
  while (g.phase !== 'gameOver' && ++steps < 3000) {
    if (g.phase === 'discarding') { for (const s of [0, 1]) if (!G.hasDiscarded(g, s)) G.discard(g, chooseDiscard(g.hands[s], g.dealer === s), s); }
    else if (g.phase === 'pegging') G.play(g, choosePlay(g, g.turn, 40), g.turn);
    else if (G.awaitingClaim(g)) {
      // Seat 0 always says 1 short (when it can): muggins gives that point away.
      const actual = total(G.countingItems(g)), p = G.countingPlayer(g);
      const before = g.scores.slice();
      G.claim(g, p === 0 ? Math.max(0, actual - 1) : actual, p);
      if (g.phase === 'counting' && p === 0 && actual > 0) {
        if (mode === 'muggins') expect(g.scores[0] - before[0] === actual - 1 && g.scores[1] - before[1] === 1, 'muggins takes the missed point');
        else expect(g.scores[0] - before[0] === actual, 'a short count still scores right without muggins');
      }
    } else G.continueCounting(g);
  }
  expect(g.phase === 'gameOver' && g.scores.includes(121), 'a game ends at 121 (' + mode + ')');
  expect(g.match[g.winner] === G.matchGamesWon(g), 'the win counts toward the match');
}

// Continue in the show waits for both players, or the deadline.
{
  const g = G.newGame(0);
  for (const s of [0, 1]) G.discard(g, g.hands[s].slice(0, 2), s);
  while (g.phase === 'pegging') G.play(g, G.playable(g, g.turn)[0], g.turn);
  if (g.phase === 'counting') {
    G.markContinued(g, 0, 1000);
    expect(g.countStep === 'pone' && g.continueDeadline === 1000 + G.CONTINUE_WAIT, 'one tap waits');
    G.markContinued(g, 1, 2000);
    expect(g.countStep === 'dealer' && g.continued === null, 'both taps move on');
  }
}

// The next game: the loser deals; a won match starts fresh.
{
  const g = G.newGame(0);
  g.winner = 1; g.match = [1, 2];
  const next = G.nextGame(g);
  expect(next.dealer === 0 && next.match.join() === '1,2', 'loser deals, match carries on');
  g.match = [1, 3];
  expect(G.nextGame(g).match.join() === '0,0', 'a won match starts over');
}
print(`${checks} checks, ${failures} failures`);
