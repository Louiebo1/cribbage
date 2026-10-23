// A cribbage table: the game plus who sits where (a person or the computer). The host
// (this device against the computer; one of the two browsers online) applies every move,
// plays the computer and keeps time. Everything here is plain data, so the same table can
// run locally or through Firebase.

import * as G from './game.js';
import { chooseDiscard, choosePlay } from './computer.js';
import { total } from './scoring.js';

/** How long the computer waits before each kind of move (ms), as in the app. */
export const PACE = { discard: 500, play: 900, claim: 1200, runLinger: 3000 };

/** A fresh table: seats are [{ kind: 'person' | 'computer', name }]. */
export function newTableState(seats, countingMode = 'automatic') {
  const game = G.newGame();
  game.countingMode = countingMode;
  return { game, seats, version: 0, paused: null };
}

const people = (state) => state.seats.filter((s) => s.kind === 'person').length;

/** Apply one move (from anyone) to the table. Returns true if it changed anything. */
export function applyMove(state, move, now = Date.now()) {
  const g = state.game;
  try {
    switch (move.type) {
      case 'discard': G.discard(g, move.cards, move.seat); break;
      case 'play': G.play(g, move.card, move.seat); break;
      case 'claim':
        if (move.hand !== g.handNumber || move.step !== g.countStep) return false;
        G.claim(g, move.points, move.seat);
        break;
      case 'continue':
        if (move.hand !== g.handNumber || move.step !== g.countStep || g.phase !== 'counting') return false;
        // Against the computer, Continue moves straight on; two people both tap it (or
        // the first tap starts the other's 30 seconds).
        if (people(state) < 2) G.continueCounting(g); else G.markContinued(g, move.seat, now);
        break;
      case 'timeUp':
        if (g.phase !== 'counting' || g.continueDeadline === null || now < g.continueDeadline) return false;
        G.continueCounting(g);
        break;
      case 'nextGame': {
        // The game's over (or someone started over): the loser deals the next one.
        const next = G.nextGame(g, Boolean(move.newMatch));
        if (move.countingMode) next.countingMode = move.countingMode;
        state.game = next;
        break;
      }
      case 'counting':
        if (!G.COUNTING.includes(move.mode)) return false;
        G.setCountingMode(g, move.mode);
        break;
      default: return false;
    }
  } catch (e) {
    if (!(e instanceof G.IllegalMove)) throw e;
    return false;
  }
  state.version += 1;
  return true;
}

/** The next thing the host does on its own (the computer's move, or the end of the 30
 *  seconds), with how long to wait first — or null when it's waiting on a person. */
export function nextHostStep(state, now = Date.now()) {
  if (state.paused) return null;
  const g = state.game;
  const isComputer = (s) => state.seats[s].kind === 'computer';
  switch (g.phase) {
    case 'discarding': {
      const s = [1, 0].find((x) => isComputer(x) && !G.hasDiscarded(g, x));
      if (s === undefined) return null;
      return { delay: PACE.discard, move: () => ({ type: 'discard', seat: s, cards: chooseDiscard(g.hands[s], g.dealer === s) }) };
    }
    case 'pegging': {
      const s = g.turn;
      if (!isComputer(s)) return null;
      // A run just ended: let it be seen before leading the next one.
      const delay = g.pile.length === 0 && g.plays.length > 0 ? PACE.runLinger : PACE.play;
      return { delay, move: () => ({ type: 'play', seat: s, card: choosePlay(g, s) }) };
    }
    case 'counting': {
      const s = G.countingPlayer(g);
      if (G.awaitingClaim(g) && isComputer(s)) {
        // The computer counts its own hand, always correctly.
        return { delay: PACE.claim, move: () => ({ type: 'claim', seat: s, hand: g.handNumber, step: g.countStep, points: total(G.countingItems(g)) }) };
      }
      if (g.continueDeadline !== null) return { delay: Math.max(0, g.continueDeadline - now), move: () => ({ type: 'timeUp' }) };
      // A table of only computers (testing) moves on by itself.
      if (!people(state)) return { delay: 2500, move: () => ({ type: 'continue', seat: 0, hand: g.handNumber, step: g.countStep }) };
      return null;
    }
    default:
      return null;
  }
}

/** Runs a table on this device (against the computer). `onState` gets every new state. */
export class LocalHost {
  constructor(state, onState) {
    this.state = state;
    this.onState = onState;
    this.timer = null;
    this.publish();
  }

  send(move) {
    if (applyMove(this.state, move)) this.publish();
  }

  publish() {
    this.onState(this.state);
    this.schedule();
  }

  schedule() {
    clearTimeout(this.timer);
    const step = nextHostStep(this.state);
    if (!step) return;
    const version = this.state.version;
    this.timer = setTimeout(() => {
      if (this.state.version === version && applyMove(this.state, step.move())) this.publish();
    }, step.delay);
  }

  stop() { clearTimeout(this.timer); }
}
