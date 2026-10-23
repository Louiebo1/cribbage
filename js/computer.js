// The computer opponent, ported from the app's `ComputerPlayer` and `PeggingSearch`. It
// sees only its own cards and what's been played.

import { FULL_DECK, rankOf, valueOf, shuffled } from './cards.js';
import { scoreHand, scorePegging, total } from './scoring.js';
import { TARGET, playable } from './game.js';

/** The two cards for the crib: keep the four with the best average show over every
 *  starter that could turn up, plus what the two discards are worth to the crib (mine
 *  if I deal, the opponent's if not). */
export const chooseDiscard = (hand, isDealer) => advice(hand, isDealer).cards;

/** The discard, with the average show of the four cards kept (for the Suggest hint). */
export function advice(hand, isDealer) {
  const unseen = FULL_DECK.filter((c) => !hand.includes(c));
  let best = null;
  for (let i = 0; i < hand.length; i++) {
    for (let j = i + 1; j < hand.length; j++) {
      const toss = [hand[i], hand[j]];
      const keep = hand.filter((c) => !toss.includes(c));
      let sum = 0;
      for (const starter of unseen) sum += total(scoreHand(keep, starter, false));
      const show = sum / unseen.length;
      const crib = cribValue(toss);
      const value = show + (isDealer ? crib : -crib);
      if (best === null || value > best.value) best = { cards: toss, value, show };
    }
  }
  return { cards: best.cards, averageShow: best.show };
}

/** Rough points two cards bring to a crib: pairs, fifteens, fives, near-runs. */
export function cribValue([a, b]) {
  let value = 0;
  if (rankOf(a) === rankOf(b)) value += 2;
  if (valueOf(a) + valueOf(b) === 15) value += 2;
  value += [a, b].filter((c) => rankOf(c) === 5).length * 1.5;
  const gap = Math.abs(rankOf(a) - rankOf(b));
  if (gap === 1) value += 1; else if (gap === 2) value += 0.5;
  return value;
}

/** The old one-card-deep pegging rules (the look-ahead's fallback): take points now,
 *  don't hand the opponent an easy 15 or 31, and save low cards for later. */
export function simplePlay(game, player) {
  const options = playable(game, player);
  if (!options.length) return null;
  const opponentPlayed = game.plays.filter((p) => p.player !== player).map((p) => p.card);
  const rating = (c) => {
    const pile = [...game.pile, c];
    const count = game.count + valueOf(c);
    let value = total(scorePegging(pile));
    if (count === 5 || count === 21) value -= 1.2;              // A ten-card makes 15 or 31.
    if (count < 15 && 15 - count <= 10) value -= 0.4;           // Some card makes 15.
    if (count < 31 && 31 - count <= 10 && count !== 21) value -= 0.2;
    if (!opponentPlayed.some((x) => rankOf(x) === rankOf(c))) value -= 0.3;   // They may pair it.
    if (game.count === 0) {
      if (valueOf(c) < 5) value += 0.6;                         // A low lead can't be made 15.
      if (rankOf(c) === 5) value -= 1;
    }
    value += valueOf(c) * 0.03;                                 // Keep the low cards for later.
    return value;
  };
  let best = options[0], bestValue = rating(best);
  for (const c of options.slice(1)) { const v = rating(c); if (v > bestValue) { best = c; bestValue = v; } }
  return best;
}

// MARK: The pegging look-ahead

/** For each card it could play, play out the rest of the pegging against a few hundred
 *  guesses at the opponent's hand, built only from cards it hasn't seen. Both sides play
 *  their best from there (minimax); the best average of my points minus theirs wins.
 *  Near the end of the game, pegging out to 121 outweighs everything. Ranks only. */
export function choosePlay(game, me, samples = 200, random = Math.random) {
  const options = playable(game, me);
  if (options.length <= 1) return options[0] ?? null;
  const ranks = [...new Set(options.map(rankOf))];
  if (ranks.length <= 1) return options[0];
  const opponent = 1 - me;

  // What the opponent could be holding.
  const seen = new Set([...game.hands[me], ...game.plays.map((p) => p.card)]);
  if (game.starter !== null) seen.add(game.starter);
  for (const [c, thrower] of Object.entries(game.thrownBy || {})) if (thrower === me) seen.add(Number(c));
  const unseen = FULL_DECK.filter((c) => !seen.has(c)).map(rankOf);
  const theirCount = game.hands[opponent].length;
  // If they've said go on this count, every card they hold is too big for it.
  const goFloor = game.saidGo.includes(opponent) ? 31 - game.count : 0;
  // Points each side needs to win: pegging out ends the game.
  const need = [TARGET - game.scores[0], TARGET - game.scores[1]];
  const myRanks = game.hands[me].map(rankOf), pile = game.pile.map(rankOf);

  const totals = new Map(ranks.map((r) => [r, 0]));
  let tried = 0, pool = unseen;
  for (let n = 0; n < samples * 4 && tried < samples; n++) {
    pool = shuffled(pool, random);
    const guess = pool.slice(0, theirCount);
    if (!guess.every((r) => Math.min(r, 10) > goFloor)) continue;
    tried++;
    const hands = [];
    hands[me] = myRanks; hands[opponent] = guess;
    for (const r of ranks) {
      totals.set(r, totals.get(r) + playOut(r, me, me, { hands: hands.map((h) => h.slice()), pile: pile.slice(), count: game.count, scored: [0, 0], need }));
    }
  }
  if (!tried) return simplePlay(game, me);
  // The best total; on a tie, the lower rank.
  let best = ranks[0];
  for (const r of ranks) if (totals.get(r) > totals.get(best) || (totals.get(r) === totals.get(best) && r < best)) best = r;
  return options.find((c) => rankOf(c) === best);
}

const WIN = 1000;

/** Plays `rank` for `player`, then the rest of the pegging with both sides playing their
 *  best. Returns `me`'s points minus the other's from here on. Changes `s`. */
export function playOut(rank, player, me, s) {
  const before = s.scored.slice();
  s.hands[player].splice(s.hands[player].indexOf(rank), 1);
  s.pile.push(rank);
  s.count += Math.min(rank, 10);
  let ended = add(s, pilePoints(s.pile, s.count), player, me);
  if (ended !== null) return ended;
  if (s.count === 31) { s.count = 0; s.pile = []; }

  const other = 1 - player;
  const canPlay = (p) => s.hands[p].some((r) => s.count + Math.min(r, 10) <= 31);
  let turn;
  if (!s.hands[0].length && !s.hands[1].length) {
    if (s.count > 0 && (ended = add(s, 1, player, me)) !== null) return ended;     // Last card.
    return diff(s, before, me);
  } else if (canPlay(other)) {
    turn = other;
  } else if (canPlay(player)) {
    turn = player;
  } else {
    if (s.count > 0 && (ended = add(s, 1, player, me)) !== null) return ended;     // Go.
    s.count = 0; s.pile = [];
    turn = s.hands[other].length ? other : player;
  }

  // The player to move tries each rank they hold and takes their best.
  let best = null;
  for (const next of new Set(s.hands[turn])) {
    if (s.count + Math.min(next, 10) > 31) continue;
    const copy = { hands: s.hands.map((h) => h.slice()), pile: s.pile.slice(), count: s.count, scored: s.scored.slice(), need: s.need };
    const value = playOut(next, turn, me, copy);
    if (best === null || (turn === me ? value > best : value < best)) best = value;
  }
  return diff(s, before, me) + (best ?? 0);
}

const diff = (s, before, me) => (s.scored[me] - before[me]) - (s.scored[1 - me] - before[1 - me]);

/** Adds points; if they peg the player out, returns the game's end as the value. */
function add(s, points, player, me) {
  if (points <= 0) return null;
  s.scored[player] += points;
  if (s.scored[player] < s.need[player]) return null;
  return player === me ? WIN : -WIN;
}

/** Pegging points for the last card on the pile (as `scorePegging`). */
export function pilePoints(pile, count) {
  let points = 0;
  if (count === 15 || count === 31) points += 2;
  const last = pile[pile.length - 1];
  let same = 1;
  while (same < pile.length && pile[pile.length - 1 - same] === last) same++;
  if (same >= 2) points += same * (same - 1);
  for (let length = pile.length; length >= 3; length--) {
    const tail = pile.slice(pile.length - length);
    if (Math.max(...tail) - Math.min(...tail) === length - 1 && new Set(tail).size === length) { points += length; break; }
  }
  return points;
}
