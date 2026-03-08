/**
 * game.js — Chess rules engine wrapper around chess.js
 * Manages game state, move history, captured pieces, and position analysis.
 */
class ChessGame {
  constructor() {
    this.chess = new Chess();
    this.moveHistory = [];       // array of { san, from, to, piece, captured, flags, fen, annotation }
    this.currentMoveIndex = -1;  // index into moveHistory we're viewing
    this.capturedByWhite = [];   // pieces white captured
    this.capturedByBlack = [];   // pieces black captured
    this.positionCounts = {};    // for threefold repetition detection
    this._recordPosition(this.chess.fen());
  }

  // ------------------------------------------------------------------ //
  //  Core moves
  // ------------------------------------------------------------------ //

  /**
   * Try to make a move. Returns move object or null if illegal.
   * @param {string|object} moveInput  e.g. 'e4' | { from:'e2', to:'e4' } | { from, to, promotion }
   */
  makeMove(moveInput) {
    const move = this.chess.move(moveInput);
    if (!move) return null;

    // Truncate forward history if we were browsing back
    if (this.currentMoveIndex < this.moveHistory.length - 1) {
      this.moveHistory = this.moveHistory.slice(0, this.currentMoveIndex + 1);
    }

    // Track captured pieces
    if (move.captured) {
      const symbol = this._pieceSymbol(move.captured, move.color === 'w' ? 'b' : 'w');
      if (move.color === 'w') this.capturedByWhite.push(symbol);
      else this.capturedByBlack.push(symbol);
    }
    // En passant capture
    if (move.flags.includes('e')) {
      const symbol = this._pieceSymbol('p', move.color === 'w' ? 'b' : 'w');
      if (move.color === 'w') this.capturedByWhite.push(symbol);
      else this.capturedByBlack.push(symbol);
    }

    const fen = this.chess.fen();
    this._recordPosition(fen);

    const entry = {
      san: move.san,
      from: move.from,
      to: move.to,
      piece: move.piece,
      captured: move.captured || null,
      flags: move.flags,
      color: move.color,
      fen,
      annotation: ''
    };
    this.moveHistory.push(entry);
    this.currentMoveIndex = this.moveHistory.length - 1;

    return move;
  }

  /** Undo the last move (if at current position) */
  undoMove() {
    if (this.moveHistory.length === 0) return false;
    if (this.currentMoveIndex < this.moveHistory.length - 1) {
      // Just browsing — go to actual last move first
      this.currentMoveIndex = this.moveHistory.length - 1;
      this._restorePosition(this.currentMoveIndex);
      return false;
    }
    const last = this.moveHistory[this.currentMoveIndex];
    this.chess.undo();
    // Remove from captured lists
    if (last.captured) {
      const symbol = this._pieceSymbol(last.captured, last.color === 'w' ? 'b' : 'w');
      if (last.color === 'w') this._removeLast(this.capturedByWhite, symbol);
      else this._removeLast(this.capturedByBlack, symbol);
    }
    if (last.flags && last.flags.includes('e')) {
      const symbol = this._pieceSymbol('p', last.color === 'w' ? 'b' : 'w');
      if (last.color === 'w') this._removeLast(this.capturedByWhite, symbol);
      else this._removeLast(this.capturedByBlack, symbol);
    }
    this.moveHistory.pop();
    this.currentMoveIndex = this.moveHistory.length - 1;
    return true;
  }

  /** Navigate to a specific move index (-1 = start position) */
  goToMove(index) {
    if (index < -1 || index >= this.moveHistory.length) return;
    this.currentMoveIndex = index;
    if (index === -1) {
      this.chess.reset();
    } else {
      this._restorePosition(index);
    }
  }

  _restorePosition(index) {
    this.chess.load(this.moveHistory[index].fen);
  }

  // ------------------------------------------------------------------ //
  //  State queries
  // ------------------------------------------------------------------ //

  /** FEN of the current displayed position */
  get fen() { return this.chess.fen(); }

  /** Side to move in the current position ('w' or 'b') */
  get turn() { return this.chess.turn(); }

  get inCheck()     { return this.chess.in_check(); }
  get isCheckmate() { return this.chess.in_checkmate(); }
  get isStalemate() { return this.chess.in_stalemate(); }
  get isDraw()      { return this.chess.in_draw(); }
  get isThreefold() { return this.chess.in_threefold_repetition(); }
  get isInsufficientMaterial() { return this.chess.insufficient_material(); }
  get isGameOver()  { return this.chess.game_over(); }

  /** All legal moves from a square (or all legal moves) */
  movesFrom(square) {
    return this.chess.moves({ square, verbose: true });
  }

  /** All legal moves in the current position (verbose) */
  get legalMoves() {
    return this.chess.moves({ verbose: true });
  }

  /** Piece at a square */
  pieceAt(square) {
    return this.chess.get(square);
  }

  /** Full board state: array of { square, type, color } */
  get board() {
    const result = [];
    const b = this.chess.board();
    for (let r = 0; r < 8; r++) {
      for (let f = 0; f < 8; f++) {
        const piece = b[r][f];
        if (piece) {
          const file = String.fromCharCode(97 + f);
          const rank = 8 - r;
          result.push({ square: `${file}${rank}`, type: piece.type, color: piece.color });
        }
      }
    }
    return result;
  }

  /** Generate PGN for entire game */
  pgn() {
    // Rebuild from move list using a fresh chess instance
    const tmp = new Chess();
    for (const m of this.moveHistory) {
      tmp.move(m.san);
    }
    return tmp.pgn();
  }

  /** Material difference from white's perspective (positive = white ahead) */
  get materialDiff() {
    const values = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
    let score = 0;
    for (const { type, color } of this.board) {
      score += (color === 'w' ? 1 : -1) * (values[type] || 0);
    }
    return score;
  }

  /** Get game status string */
  get statusText() {
    if (this.isCheckmate) {
      return this.turn === 'w' ? 'Black wins by checkmate!' : 'White wins by checkmate!';
    }
    if (this.isStalemate)  return 'Draw — Stalemate';
    if (this.isThreefold)  return 'Draw — Threefold Repetition';
    if (this.isInsufficientMaterial) return 'Draw — Insufficient Material';
    if (this.isDraw)       return 'Draw';
    if (this.inCheck)      return `${this.turn === 'w' ? 'White' : 'Black'} is in Check!`;
    return this.turn === 'w' ? "White's turn" : "Black's turn";
  }

  /** Returns the moves up to currentMoveIndex as an array of SAN strings */
  get moveSanList() {
    return this.moveHistory.slice(0, this.currentMoveIndex + 1).map(m => m.san);
  }

  /** Detect opening from ECO codes using move sequence prefix */
  detectOpening() {
    if (typeof ECO_CODES === 'undefined') return null;
    const moves = this.moveSanList;
    // Try to match from longest sequence down to 1
    for (let len = Math.min(moves.length, 10); len >= 1; len--) {
      const prefix = moves.slice(0, len).join(' ');
      for (const [eco, name] of Object.entries(ECO_CODES)) {
        if (typeof name === 'object' && name.moves) {
          const gameMoves = name.moves.slice(0, len).join(' ');
          if (gameMoves === prefix) return { eco, name: name.name };
        }
      }
    }
    return null;
  }

  // ------------------------------------------------------------------ //
  //  Helpers
  // ------------------------------------------------------------------ //

  _pieceSymbol(type, color) {
    const symbols = {
      w: { k: '♔', q: '♕', r: '♖', b: '♗', n: '♘', p: '♙' },
      b: { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' }
    };
    return symbols[color]?.[type] || '?';
  }

  _removeLast(arr, val) {
    const idx = arr.lastIndexOf(val);
    if (idx !== -1) arr.splice(idx, 1);
  }

  _recordPosition(fen) {
    // Use first 4 parts of FEN (ignore halfmove/fullmove)
    const key = fen.split(' ').slice(0, 4).join(' ');
    this.positionCounts[key] = (this.positionCounts[key] || 0) + 1;
  }

  /** New game — reset everything */
  reset() {
    this.chess.reset();
    this.moveHistory = [];
    this.currentMoveIndex = -1;
    this.capturedByWhite = [];
    this.capturedByBlack = [];
    this.positionCounts = {};
    this._recordPosition(this.chess.fen());
  }

  /** Load a game from array of SAN moves */
  loadMoves(sanArray) {
    this.reset();
    for (const san of sanArray) {
      const m = this.chess.move(san);
      if (!m) break;
      const fen = this.chess.fen();
      this._recordPosition(fen);
      this.moveHistory.push({
        san: m.san, from: m.from, to: m.to, piece: m.piece,
        captured: m.captured || null, flags: m.flags, color: m.color,
        fen, annotation: ''
      });
      this.currentMoveIndex = this.moveHistory.length - 1;
    }
  }
}
