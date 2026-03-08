/**
 * grandmaster.js — GM position matching engine
 * Compares the current move sequence against the embedded GM games database
 * and surfaces matches in the Grandmaster Insights panel.
 */
class GrandmasterMatcher {
  constructor() {
    this.games = typeof GM_GAMES !== 'undefined' ? GM_GAMES : [];
  }

  /**
   * Find all GM games whose opening move sequence starts with (or equals) the
   * provided moves array.  Returns an array of match objects sorted by depth.
   *
   * @param {string[]} moveSans  Current game moves in SAN notation
   * @returns {Array<{game, depth, nextMove}>}
   */
  findMatches(moveSans) {
    if (!moveSans || moveSans.length === 0) return [];

    const results = [];

    for (const game of this.games) {
      if (!game.moves || game.moves.length === 0) continue;

      // Find longest common prefix
      const minLen = Math.min(moveSans.length, game.moves.length);
      let depth = 0;
      for (let i = 0; i < minLen; i++) {
        if (this._sanEqual(moveSans[i], game.moves[i])) {
          depth++;
        } else {
          break;
        }
      }

      // Require at least 4 matching moves (2 full moves) to surface a match
      if (depth >= 4) {
        const nextMove = depth < game.moves.length ? game.moves[depth] : null;
        results.push({ game, depth, nextMove });
      }
    }

    // Sort by match depth descending, then by year descending
    results.sort((a, b) => b.depth - a.depth || b.game.year - a.game.year);

    // Return top 5
    return results.slice(0, 5);
  }

  /**
   * Compare two SAN strings, ignoring check/checkmate symbols.
   */
  _sanEqual(a, b) {
    if (!a || !b) return false;
    return a.replace(/[+#!?]/g, '') === b.replace(/[+#!?]/g, '');
  }

  /**
   * Return the move number label for a given half-move index.
   * e.g. index 0 → "1. e4", index 1 → "1. ...e5"
   */
  static moveLabel(index, san) {
    const moveNum = Math.floor(index / 2) + 1;
    const isBlack = index % 2 === 1;
    return isBlack ? `${moveNum}…${san}` : `${moveNum}. ${san}`;
  }

  /**
   * Format the next-move line showing what the GM played.
   * @param {object} match  { game, depth, nextMove }
   * @returns {string}
   */
  static nextMoveLine(match) {
    if (!match.nextMove) return '(End of recorded game)';
    return GrandmasterMatcher.moveLabel(match.depth, match.nextMove);
  }
}
