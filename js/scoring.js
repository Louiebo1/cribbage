// Counting hands and pegging, ported from the app's `Scoring`. A score item is
// { kind, points, cards }: "Fifteen" for 2 with the cards that make it.

import { rankOf, suitOf, valueOf, isJack, sorted } from './cards.js';

export function itemLabel(item) {
  switch (item.kind) {
    case 'fifteen': return 'Fifteen';
    case 'pair': return item.points === 12 ? 'Four of a kind' : item.points === 6 ? 'Three of a kind' : 'Pair';
    case 'run': return `Run of ${item.cards.length}`;
    case 'flush': return 'Flush';
    case 'nobs': return 'His nobs';
    case 'heels': return 'His heels';
    case 'thirtyOne': return 'Thirty-one';
    case 'go': return 'Go';
    case 'lastCard': return 'Last card';
    case 'muggins': return 'Muggins';
    default: return item.kind;
  }
}

const item = (kind, points, cards) => ({ kind, points, cards });
const pick = (all, mask) => all.filter((_, i) => mask & (1 << i));
const bits = (mask) => { let n = 0; for (; mask; mask &= mask - 1) n++; return n; };

/** The show: a 4-card hand (or the crib) with the starter. */
export function scoreHand(hand, starter, isCrib) {
  const all = sorted([...hand, starter]);
  const items = [];

  // Fifteens: every combination adding to 15.
  for (let mask = 1; mask < 1 << all.length; mask++) {
    const cards = pick(all, mask);
    if (cards.length >= 2 && cards.reduce((n, c) => n + valueOf(c), 0) === 15) items.push(item('fifteen', 2, cards));
  }

  // Pairs, grouped: three of a kind is 6, four is 12.
  const byRank = new Map();
  for (const c of all) byRank.set(rankOf(c), [...(byRank.get(rankOf(c)) || []), c]);
  for (const r of [...byRank.keys()].sort((a, b) => a - b)) {
    const cards = byRank.get(r);
    if (cards.length >= 2) items.push(item('pair', cards.length * (cards.length - 1), cards));
  }

  // Runs: the longest length that has any, every distinct way of making it.
  for (let length = all.length; length >= 3; length--) {
    const found = [];
    for (let mask = 1; mask < 1 << all.length; mask++) {
      if (bits(mask) !== length) continue;
      const cards = pick(all, mask);
      if (isRun(cards)) found.push(cards);
    }
    if (found.length) { for (const cards of found) items.push(item('run', length, cards)); break; }
  }

  // Flush: four in the hand (five with the starter); the crib needs all five.
  if (hand.length && hand.every((c) => suitOf(c) === suitOf(hand[0]))) {
    if (suitOf(starter) === suitOf(hand[0])) items.push(item('flush', 5, [...hand, starter]));
    else if (!isCrib) items.push(item('flush', 4, hand.slice()));
  }

  // His nobs: the jack of the starter's suit.
  const jack = hand.find((c) => isJack(c) && suitOf(c) === suitOf(starter));
  if (jack !== undefined) items.push(item('nobs', 1, [jack]));
  return items;
}

/** Points for the card just played in pegging. `pile` is the cards played since the
 *  count last went back to zero, the new card last. */
export function scorePegging(pile) {
  if (!pile.length) return [];
  const last = pile[pile.length - 1];
  const items = [];
  const count = pile.reduce((n, c) => n + valueOf(c), 0);
  if (count === 15) items.push(item('fifteen', 2, pile.slice()));
  if (count === 31) items.push(item('thirtyOne', 2, pile.slice()));

  let same = 0;
  while (same < pile.length && rankOf(pile[pile.length - 1 - same]) === rankOf(last)) same++;
  if (same >= 2) items.push(item('pair', same * (same - 1), pile.slice(pile.length - same)));

  // The longest run made by the last n cards, in any order.
  for (let length = pile.length; length >= 3; length--) {
    const tail = pile.slice(pile.length - length);
    if (isRun(tail)) { items.push(item('run', length, tail)); break; }
  }
  return items;
}

export function isRun(cards) {
  const ranks = cards.map(rankOf).sort((a, b) => a - b);
  if (!ranks.length || new Set(ranks).size !== ranks.length) return false;
  return ranks[ranks.length - 1] - ranks[0] === ranks.length - 1;
}

export const total = (items) => items.reduce((n, i) => n + i.points, 0);
