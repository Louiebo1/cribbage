// Plays games with the app's own engine and computer (compiled from ~/code/cribbage) and
// writes what happened as JSON lines, for tests/parity/parity.js to replay on the web
// version. Both seats discard with `ComputerPlayer.discard` and peg with `simplePlay`
// (deterministic); the look-ahead (`PeggingSearch.State`) is checked separately on
// positions from these games with fixed guesses at the opponent's hand.
import Foundation

struct SplitMix64: RandomNumberGenerator {
    var state: UInt64
    mutating func next() -> UInt64 {
        state &+= 0x9E3779B97F4A7C15
        var z = state
        z = (z ^ (z >> 30)) &* 0xBF58476D1CE4E5B9
        z = (z ^ (z >> 27)) &* 0x94D049BB133111EB
        return z ^ (z >> 31)
    }
}

let games = Int(CommandLine.arguments.dropFirst().first ?? "50") ?? 50
var rng = SplitMix64(state: 2026)
func id(_ c: Card) -> Int { c.suit.rawValue * 100 + c.rank }
func emit(_ object: [String: Any]) {
    let data = try! JSONSerialization.data(withJSONObject: object, options: [.sortedKeys])
    print(String(data: data, encoding: .utf8)!)
}

for _ in 0..<games {
    var game = CribbageGame(dealer: Int.random(in: 0...1, using: &rng), deck: Card.fullDeck.shuffled(using: &rng))
    while game.phase != .gameOver {
        let dealt = game.hands.map { $0.map(id) }
        let before = game.scores
        var moves: [[String: Any]] = []
        for seat in [0, 1] {
            let cards = ComputerPlayer.discard(game.hands[seat], isDealer: game.dealer == seat)
            moves.append(["seat": seat, "discard": cards.map(id)])
            try! game.discard(cards, by: seat)
        }
        while game.phase == .pegging {
            let seat = game.turn
            // A look-ahead check on this position: fixed guesses, every rank's total.
            let options = game.playable(for: seat)
            let ranks = Array(Set(options.map(\.rank))).sorted()
            if ranks.count > 1 {
                let opponent = 1 - seat
                var seen = Set(game.hands[seat] + game.plays.map(\.card))
                if let s = game.starter { seen.insert(s) }
                for (c, t) in game.thrownBy ?? [:] where t == seat { seen.insert(c) }
                let unseen = Card.fullDeck.filter { !seen.contains($0) }.map(\.rank)
                let need = [CribbageGame.target - game.scores[0], CribbageGame.target - game.scores[1]]
                var guesses: [[Int]] = []
                var totals = [Int](repeating: 0, count: ranks.count)
                for _ in 0..<8 {
                    let guess = Array(unseen.shuffled(using: &rng).prefix(game.hands[opponent].count))
                    guesses.append(guess)
                    var start = PeggingSearch.State(hands: [[], []], pile: game.pile.map(\.rank), count: game.count,
                                                   scored: [0, 0], need: need)
                    start.hands[seat] = game.hands[seat].map(\.rank)
                    start.hands[opponent] = guess
                    for (i, r) in ranks.enumerated() {
                        var next = start
                        totals[i] += next.play(r, by: seat, deciding: seat)
                    }
                }
                emit(["kind": "search", "me": seat, "hand": game.hands[seat].map(\.rank), "pile": game.pile.map(\.rank),
                      "count": game.count, "need": need, "guesses": guesses, "ranks": ranks, "totals": totals])
            }
            let card = ComputerPlayer.simplePlay(game, as: seat)!
            moves.append(["seat": seat, "play": id(card)])
            try! game.play(card, by: seat)
        }
        var shows = 0
        while game.phase == .counting && shows < 2 {
            try! game.continueCounting()
            shows += 1
        }
        emit(["kind": "hand", "dealer": game.dealer, "dealt": dealt, "starter": id(game.starter!), "before": before,
              "moves": moves, "after": game.scores, "phase": game.phase.rawValue,
              "events": game.events.map { ["player": $0.player, "points": $0.points, "show": $0.isShow,
                                           "kinds": $0.items.map(\.kind.rawValue)] as [String: Any] }])
        if game.phase == .counting { try! game.continueCounting() }
    }
}
