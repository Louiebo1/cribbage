// A two-player game of cribbage to 121, ported from the app's `CribbageGame`. The game is
// a plain object (JSON-safe, so it can be stored in Firebase) changed by these functions;
// an illegal move throws and changes nothing. Seats are 0 and 1.

import { FULL_DECK, shuffled, sorted, valueOf, isJack } from './cards.js';
import { scoreHand, scorePegging, total } from './scoring.js';

export const TARGET = 121;
export const PLAYERS = 2;
/** Two people: once one taps Continue on a count, the other has this long (ms). */
export const CONTINUE_WAIT = 30000;
/** Best of 5: first to 3 games wins the match. */
export const MATCH_TARGET = 3;
/** Who counts the show: the game, the players (checked), or the players with muggins. */
export const COUNTING = ['automatic', 'check', 'muggins'];

export class IllegalMove extends Error {}
const check = (ok) => { if (!ok) throw new IllegalMove('illegal'); };

export function newGame(dealer = Math.floor(Math.random() * 2), deck = shuffled()) {
  const game = {
    scores: [0, 0],
    backPegs: [0, 0],          // Where each back peg sits: the score before the last points.
    dealer,
    handNumber: 0,
    phase: 'discarding',       // discarding → pegging → counting (→ gameOver)
    countingMode: 'automatic',
    match: [0, 0],             // Games won toward the match (a skunk counts 2, a double 3).
    winner: null,
    eventCounter: 0,
  };
  deal(game, deck);
  return game;
}

export const pone = (game) => 1 - game.dealer;

function deal(game, deck) {
  check(deck.length === 52 && new Set(deck).size === 52);
  game.deck = deck.slice();
  game.hands = [[], []];
  game.kept = [[], []];        // The four cards each player kept, for the show.
  game.crib = [];
  game.thrownBy = {};          // Card → who threw it into the crib.
  game.starter = null;
  game.plays = [];             // Every card pegged this hand: { player, card }.
  game.pile = [];              // Cards since the count last went back to 0.
  game.count = 0;
  game.saidGo = [];
  game.lastPlayer = null;
  game.turn = 0;
  game.countStep = 'pone';     // pone → dealer → crib
  game.continued = null;
  game.continueDeadline = null;
  game.claimed = null;
  game.events = [];            // Every score this hand: { player, items, id, isShow, credited }.
  for (let i = 0; i < 12; i++) game.hands[(pone(game) + i) % 2].push(game.deck.shift());
  game.hands = game.hands.map(sorted);
  game.phase = 'discarding';
}

// MARK: Dealing and the crib

export const hasDiscarded = (game, player) => game.kept[player].length > 0;

export function discard(game, cards, player) {
  check(game.phase === 'discarding' && !hasDiscarded(game, player) && cards.length === 2 &&
    new Set(cards).size === 2 && cards.every((c) => game.hands[player].includes(c)));
  game.hands[player] = game.hands[player].filter((c) => !cards.includes(c));
  game.kept[player] = game.hands[player].slice();
  game.crib.push(...cards);
  for (const c of cards) game.thrownBy[c] = player;
  if (!(hasDiscarded(game, 0) && hasDiscarded(game, 1))) return;

  // The cut. A jack turned up is "his heels": 2 for the dealer.
  game.starter = game.deck.shift();
  game.phase = 'pegging';
  game.turn = pone(game);
  if (isJack(game.starter)) score(game, game.dealer, [{ kind: 'heels', points: 2, cards: [game.starter] }]);
}

// MARK: Pegging

export const canPlay = (game, c, player) =>
  game.phase === 'pegging' && game.turn === player && game.hands[player].includes(c) && game.count + valueOf(c) <= 31;

export const playable = (game, player) => game.hands[player].filter((c) => game.count + valueOf(c) <= 31);

export function play(game, c, player) {
  check(canPlay(game, c, player));
  game.hands[player] = game.hands[player].filter((x) => x !== c);
  game.pile.push(c);
  game.plays.push({ player, card: c });
  game.count += valueOf(c);
  game.lastPlayer = player;
  const items = scorePegging(game.pile);
  if (items.length) score(game, player, items);
  if (game.phase !== 'pegging') return;
  if (game.count === 31) resetCount(game);
  advance(game);
}

/** Whose turn is next; "go" and the last card are scored automatically. */
function advance(game) {
  const last = game.lastPlayer;
  if (last === null) return;
  const other = 1 - last;
  if (!game.hands[0].length && !game.hands[1].length) {
    if (game.count > 0) {
      score(game, last, [{ kind: 'lastCard', points: 1, cards: [] }]);
      resetCount(game);
    }
    if (game.phase === 'pegging') startCounting(game);
    return;
  }
  if (playable(game, other).length) {
    game.turn = other;
  } else if (playable(game, last).length) {
    if (game.hands[other].length && !game.saidGo.includes(other)) game.saidGo.push(other);
    game.turn = last;
  } else {
    // Neither can play: a go for the last card.
    if (game.count > 0) score(game, last, [{ kind: 'go', points: 1, cards: [] }]);
    if (game.phase !== 'pegging') return;
    resetCount(game);
    game.turn = game.hands[other].length ? other : last;
  }
}

function resetCount(game) {
  game.count = 0;
  game.pile = [];
  game.saidGo = [];
}

// MARK: The show

function startCounting(game) {
  game.phase = 'counting';
  game.countStep = 'pone';
  scoreCountStep(game);
}

/** The cards being counted right now, starter not included. */
export function countingCards(game) {
  switch (game.countStep) {
    case 'pone': return game.kept[pone(game)];
    case 'dealer': return game.kept[game.dealer];
    default: return sorted(game.crib);
  }
}

export const countingPlayer = (game) => (game.countStep === 'pone' ? pone(game) : game.dealer);

export const countingItems = (game) =>
  (game.starter === null ? [] : scoreHand(countingCards(game), game.starter, game.countStep === 'crib'));

/** The counting player still has to say what their hand is worth. */
export const awaitingClaim = (game) => game.phase === 'counting' && game.countingMode !== 'automatic' && game.claimed === null;

function scoreCountStep(game) {
  game.claimed = null;
  if (game.countingMode !== 'automatic') return;      // Wait for the player's count.
  score(game, countingPlayer(game), countingItems(game));
}

export function setCountingMode(game, mode) {
  const waiting = awaitingClaim(game);
  game.countingMode = mode;
  // Switched to automatic while a count was waiting: score it now.
  if (waiting && mode === 'automatic') score(game, countingPlayer(game), countingItems(game));
}

/** The counting player says what their hand (or crib) is worth. They score the right
 *  amount, except under muggins, where they score only what they said and the other
 *  player takes the points they missed. */
export function claim(game, points, player) {
  check(awaitingClaim(game) && player === countingPlayer(game) && Number.isInteger(points) && points >= 0 && points <= 29);
  game.claimed = points;
  const items = countingItems(game);
  const actual = total(items);
  if (game.countingMode === 'muggins' && points < actual) {
    score(game, player, items, points);
    if (game.phase === 'counting') score(game, 1 - player, [{ kind: 'muggins', points: actual - points, cards: [] }]);
  } else {
    score(game, player, items);
  }
}

/** Two people: the count moves on once both have tapped Continue. The first tap starts
 *  the other player's 30 seconds (`continueDeadline`, ms since 1970). */
export function markContinued(game, player, now = Date.now()) {
  check(game.phase === 'counting' && !awaitingClaim(game));
  const ready = new Set(game.continued || []);
  ready.add(player);
  if (ready.size === PLAYERS) return continueCounting(game);
  game.continued = [...ready];
  if (game.continueDeadline === null) game.continueDeadline = now + CONTINUE_WAIT;
}

/** Moves the show on: the dealer's hand, the crib, then the next deal. */
export function continueCounting(game, deck = shuffled()) {
  check(game.phase === 'counting' && !awaitingClaim(game));
  game.continued = null;
  game.continueDeadline = null;
  switch (game.countStep) {
    case 'pone': game.countStep = 'dealer'; scoreCountStep(game); break;
    case 'dealer': game.countStep = 'crib'; scoreCountStep(game); break;
    default:
      game.dealer = pone(game);
      game.handNumber += 1;
      deal(game, deck);
  }
}

// MARK: Scoring

export const eventPoints = (e) => (e.credited ?? total(e.items));
export const lastEvent = (game) => game.events[game.events.length - 1] || null;

/** Records the score as the latest event (a zero hand in the show too) and moves the pegs. */
function score(game, player, items, credited = null) {
  const points = credited ?? total(items);
  game.eventCounter += 1;
  game.events.push({ player, items, id: game.eventCounter, isShow: game.phase === 'counting', credited });
  if (points <= 0) return;
  game.backPegs[player] = game.scores[player];
  game.scores[player] = Math.min(game.scores[player] + points, TARGET);
  if (game.scores[player] >= TARGET) {
    game.winner = player;
    game.phase = 'gameOver';
    game.match[player] += matchGamesWon(game);
  }
}

/** The loser didn't reach 91: a skunk (counts as two games). */
export const isSkunk = (game) => game.winner !== null && game.scores[1 - game.winner] < 91;
/** The loser didn't reach 61: a double skunk (three). */
export const isDoubleSkunk = (game) => game.winner !== null && game.scores[1 - game.winner] < 61;
export const matchGamesWon = (game) => (isDoubleSkunk(game) ? 3 : isSkunk(game) ? 2 : 1);
export const matchWinner = (game) => { const i = game.match.findIndex((n) => n >= MATCH_TARGET); return i < 0 ? null : i; };

/** The next game: the loser of the last one deals, and the match carries on (a fresh
 *  one if it was won, or if `newMatch`). An unfinished game counts for nothing. */
export function nextGame(previous, newMatch = false) {
  const loser = previous && previous.winner !== null ? 1 - previous.winner : undefined;
  const game = newGame(loser);
  if (previous) game.countingMode = previous.countingMode;
  game.match = !newMatch && previous && matchWinner(previous) === null ? previous.match.slice() : [0, 0];
  return game;
}

/** A game whose deal is these hands and starter (for tests: the app's deal, rebuilt). */
export function gameFromDeal(dealer, hands, starter) {
  const p = 1 - dealer, deck = [];
  for (let i = 0; i < 12; i++) deck.push(hands[(p + i) % 2][i >> 1]);
  deck.push(starter);
  for (const c of FULL_DECK) if (!deck.includes(c)) deck.push(c);
  return newGame(dealer, deck);
}

