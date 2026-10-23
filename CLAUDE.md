# Cribbage for the web

Plain JavaScript (ES modules, no build step, no Node) so it runs from any static host.
Started 2026-10-23 for Louie: the iPhone app (`~/code/cribbage`) in a browser — play the
computer, or a friend anywhere with a 4-letter code. Sister project: `~/code/hearts-web`
(same structure, same Firebase project).

## Layout
- `js/cards.js` — cards as ints (suit*100+rank, ace low 1; ♣ ♦ ♠ ♥ display order).
- `js/scoring.js` — the show and pegging, ported from the app's `Scoring`.
- `js/game.js` — the rules, ported from `CribbageGame` (6 dealt, 2 to the crib, his heels,
  pegging with go/last card scored automatically, the show pone → dealer → crib, counting
  modes automatic / check / muggins, skunk < 91, double < 61, best-of-5 match first to 3,
  loser deals next). Plain JSON state; illegal moves throw `IllegalMove`.
- `js/computer.js` — the app's `ComputerPlayer` (discard by average show + crib value) and
  `PeggingSearch` (minimax over the rest of the pegging against 200 sampled hands, ranks
  only; `simplePlay` is its fallback). When the app's computer changes, port it here and
  rerun the parity check.
- `js/table.js` — table state (game + seats + paused), `applyMove`, `nextHostStep` (the
  computer's pacing as in the app: discard 0.5 s, play 0.9 s, 3 s after a run ends, claim
  1.2 s; the 30-second Continue deadline between two people), `LocalHost`.
- `js/online.js` — Firebase (Louie's `hearts-659fc`, shared with Hearts) at
  `/tables/crib-CODE` (the database rules only open `/tables`): meta, seats ×2, state (host
  writes), moves, presence. The game deals when the second person sits down; a drop pauses
  it; the other player takes over hosting if the host drops (epoch guard as in Hearts).
- `js/board.js` — the board: SVG holes/pegs/skunk lines/match holes (the app's
  `BoardView.Layout`, drawn at 400×92 and scaled) over `img/classic_board.jpg`. Kept
  between redraws so the pegs slide.
- `js/sounds.js` — the app's synthesized sounds (snap, deal, peg, fanfare) via Web Audio.
- `js/main.js` — screens: start (Continue Game, Back to Game CODE), friend (start/join),
  waiting room (code + share link), table, the show (claim pad, muggins), game over,
  menu, settings (name, counting, Suggest, sounds, large letters, highest on left, card
  back), statistics (this device). localStorage `crib.settings`, `crib.stats`,
  `crib.local` (the computer game, every move), `crib.online` (last code). Names from the
  other browser always go through `esc()`. The table redraws inside `.screen`; dialogs
  opened on top (menu, settings) are left alone so they don't flicker.
- Not ported (yet): the Hawaiian / Fish / Poop themes, nearby (Bluetooth) play, iCloud stats.

## Test
- Rules: `/System/Library/Frameworks/JavaScriptCore.framework/Versions/Current/Helpers/jsc -m tests/engine.test.js`
- Same as the app: `E=~/code/cribbage/Cribbage/Engine; swiftc -O -module-name Parity
  $E/Card.swift $E/Scoring.swift $E/ComputerPlayer.swift $E/PeggingSearch.swift
  $E/CribbageGame.swift tests/parity/main.swift -o /tmp/crib_parity/parity &&
  /tmp/crib_parity/parity 200 > /tmp/crib_parity/positions.jsonl`, then
  `jsc tests/args.js -m tests/parity/parity.js -- /tmp/crib_parity/positions.jsonl`.
  2026-10-23: 1,775 hands (17,651 discards/plays, every score) and 9,025 look-ahead
  positions identical to the app. Look-ahead ~5 ms a play, slowest ~80 ms.
- Page: serve with `Cache-Control: no-store` (else browsers keep old files), headless
  Chrome with its own `--user-data-dir` (never Louie's). URL options: `?name=X`, `?play`,
  `?autoplay`, `?fast`, `?counting=check|muggins`, `?newgame=CODE`, `?g=CODE`. To click
  through, load the page in a same-origin iframe from a scratch driver page. Online: two
  simulators' Safari (iPhone `?newgame=TZxx`, iPad `?g=TZxx`). Delete TZ* test games
  after (`DELETE /tables/crib-TZxx.json?auth=…`, token from anonymous `accounts:signUp`).
  Verified 2026-10-23: 163 fast games through the page with no errors; online game to a
  match win, drop → pause → rejoin.

## Deploy
GitHub Pages from `main` (repo Louiebo1/cribbage, public) → https://louiebo1.github.io/cribbage/.
`git push`; Pages rebuilds in about a minute. GitHub CLI: `~/bin/gh` (logged in as Louiebo1).
