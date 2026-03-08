/**
 * app.js — Main application controller
 * Wires together ChessGame, Board3D, Analyzer, GrandmasterMatcher, and UI.
 */
class App {
  constructor() {
    this.game     = new ChessGame();
    this.board    = new Board3D(document.getElementById('board-canvas'));
    this.analyzer = new Analyzer();
    this.gmMatch  = new GrandmasterMatcher();
    this.ui       = new UI();

    /* Game mode: 'human' | 'ai-white' | 'ai-black' */
    this.mode          = 'human';
    this.aiSkill       = 10;   // 0-20
    this.aiThinking    = false;

    /* Eval tracking */
    this._evalBefore   = null;   // score before the last move
    this._currentScore = null;

    /* Bind events */
    this._bindBoardEvents();
    this._bindControls();

    /* Initial render */
    this._fullRedraw();
    this._analyzePosition();
  }

  // ------------------------------------------------------------------ //
  //  Board interaction
  // ------------------------------------------------------------------ //

  _bindBoardEvents() {
    this.board.onSelect(sq => this._onSelect(sq));
    this.board.onTarget(sq => this._onTarget(sq));
  }

  _onSelect(sq) {
    if (this.game.isGameOver) return;
    if (this._isAITurn()) return;

    // Navigate back to current move if browsing
    if (this.game.currentMoveIndex < this.game.moveHistory.length - 1) {
      this.game.goToMove(this.game.moveHistory.length - 1);
      this._fullRedraw();
    }

    const piece = this.game.pieceAt(sq);
    if (!piece || piece.color !== this.game.turn) {
      this.board.clearHighlights();
      return;
    }

    Sounds.select();
    this.board.highlightSelected(sq);

    const moves = this.game.movesFrom(sq);
    const moveSqs    = moves.filter(m => !m.captured).map(m => m.to);
    const captureSqs = moves.filter(m =>  m.captured  || m.flags.includes('e')).map(m => m.to);

    this.board.highlightMoves(moveSqs);
    this.board.highlightCaptures(captureSqs);
  }

  async _onTarget(sq) {
    const from = this.board.selectedSquare;
    if (!from) return;

    const moves = this.game.movesFrom(from);
    const legal = moves.filter(m => m.to === sq);
    if (legal.length === 0) {
      // Maybe re-select a friendly piece
      const piece = this.game.pieceAt(sq);
      if (piece && piece.color === this.game.turn) {
        this._onSelect(sq);
      } else {
        this.board.clearHighlights();
        this.board.selectedSquare = null;
      }
      return;
    }

    // Pawn promotion?
    let promotion;
    if (legal.some(m => m.flags.includes('p'))) {
      promotion = await this.ui.showPromotionDialog(this.game.turn);
    }

    this._evalBefore = this._currentScore;

    const moveInput = promotion ? { from, to: sq, promotion } : { from, to: sq };
    const move = this.game.makeMove(moveInput);
    if (!move) { Sounds.error(); return; }

    this.board.clearHighlights();
    await this._animateMove(move);
    this._afterMove(move);
  }

  // ------------------------------------------------------------------ //
  //  Animate + post-move logic
  // ------------------------------------------------------------------ //

  _animateMove(move) {
    return new Promise(resolve => {
      this.board.movePiece(move.from, move.to, () => {
        // Handle special moves
        if (move.flags.includes('k') || move.flags.includes('q')) {
          // Castling — animate rook too
          this.board.handleCastle(move, resolve);
        } else if (move.flags.includes('e')) {
          // En passant — remove captured pawn
          const capRank = move.color === 'w' ? parseInt(move.to[1]) - 1 : parseInt(move.to[1]) + 1;
          const capSq   = move.to[0] + capRank;
          if (this.board.pieceMeshes[capSq]) {
            this.board.scene.remove(this.board.pieceMeshes[capSq]);
            delete this.board.pieceMeshes[capSq];
          }
          resolve();
        } else if (move.flags.includes('p')) {
          // Promotion
          this.board.promotePiece(move.to, move.promotion || 'q', move.color);
          Sounds.promote();
          resolve();
        } else {
          resolve();
        }
      });
    });
  }

  _afterMove(move) {
    // Sound
    if (move.captured || move.flags.includes('e')) Sounds.capture();
    else if (move.flags.includes('k') || move.flags.includes('q')) Sounds.castle();
    else Sounds.move();

    if (this.game.inCheck)     Sounds.check();
    if (this.game.isCheckmate) Sounds.checkmate();

    // Highlight last move
    this.board.clearHighlights();
    this.board.highlightLastMove(move.from, move.to);

    // Update UI
    this._updateUI();
    this._analyzePosition();
    this._checkGMMatches();

    // AI turn?
    if (!this.game.isGameOver && this._isAITurn()) {
      this._doAIMove();
    }
  }

  // ------------------------------------------------------------------ //
  //  AI move
  // ------------------------------------------------------------------ //

  _isAITurn() {
    return (this.mode === 'ai-black' && this.game.turn === 'b') ||
           (this.mode === 'ai-white' && this.game.turn === 'w');
  }

  _doAIMove() {
    if (this.aiThinking) return;
    this.aiThinking = true;
    this.ui.showThinking(true);

    const fen = this.game.fen;
    this.analyzer.getBestMove(fen, this.aiSkill, async (bestMoveUCI) => {
      this.aiThinking = false;
      this.ui.showThinking(false);

      if (!bestMoveUCI || this.game.isGameOver) return;

      const from  = bestMoveUCI.slice(0, 2);
      const to    = bestMoveUCI.slice(2, 4);
      const promo = bestMoveUCI.length === 5 ? bestMoveUCI[4] : undefined;

      this._evalBefore = this._currentScore;
      const moveInput  = promo ? { from, to, promotion: promo } : { from, to };
      const move       = this.game.makeMove(moveInput);
      if (!move) return;

      this.board.clearHighlights();
      await this._animateMove(move);
      this._afterMove(move);
    });
  }

  // ------------------------------------------------------------------ //
  //  Analysis
  // ------------------------------------------------------------------ //

  _analyzePosition() {
    if (!this.analyzer.isAvailable) return;
    const fen  = this.game.fen;
    const turn = this.game.turn; // turn AFTER move (for score orientation)

    this.analyzer.evaluate(fen, (info) => {
      this._currentScore = info.score;
      this.ui.updateEval(info.score, turn === 'w' ? 'b' : 'w');

      // Classify the last move once we have a decent depth score
      if (info.depth >= 10 && this._evalBefore !== null && this.game.moveHistory.length > 0) {
        const lastMove = this.game.moveHistory[this.game.currentMoveIndex];
        if (lastMove && !lastMove.annotation) {
          const moverTurn  = lastMove.color;
          const cpBefore   = Analyzer.toCpWhite(this._evalBefore, moverTurn);
          const cpAfter    = Analyzer.toCpWhite(info.score, moverTurn);
          const quality    = Analyzer.classifyMove(cpBefore, cpAfter);
          lastMove.annotation = quality;
          this.ui.showMoveQuality(quality);
          this.ui.updateMoveList(this.game.moveHistory, this.game.currentMoveIndex);
        }
        this._evalBefore = null;
      }

      // Show best move
      if (info.bestMove) {
        const bestSAN = this._uciToSan(info.bestMove);
        this.ui.showBestMove(bestSAN || info.bestMove);
        this.board.showBestMoveArrow(info.bestMove.slice(0,2), info.bestMove.slice(2,4));
      }
    }, null, 16);
  }

  _uciToSan(uci) {
    if (!uci) return null;
    try {
      const tmp = new Chess(this.game.fen);
      const from = uci.slice(0,2);
      const to   = uci.slice(2,4);
      const promo = uci.length === 5 ? uci[4] : undefined;
      const m = tmp.move(promo ? { from, to, promotion: promo } : { from, to });
      return m ? m.san : null;
    } catch (e) { return null; }
  }

  // ------------------------------------------------------------------ //
  //  Grandmaster matching
  // ------------------------------------------------------------------ //

  _checkGMMatches() {
    const moves   = this.game.moveSanList;
    const matches = this.gmMatch.findMatches(moves);
    this.ui.updateGMPanel(matches, moves.length);
  }

  // ------------------------------------------------------------------ //
  //  Full UI refresh
  // ------------------------------------------------------------------ //

  _updateUI() {
    // Status
    const txt  = this.game.statusText;
    const type = this.game.isCheckmate ? 'checkmate'
               : this.game.isDraw || this.game.isStalemate ? 'draw'
               : this.game.inCheck ? 'check' : '';
    this.ui.updateStatus(txt, type);
    this.ui.setActivePlayer(this.game.turn);

    // Captured & material
    this.ui.updateCaptured(
      this.game.capturedByWhite,
      this.game.capturedByBlack,
      this.game.materialDiff
    );

    // Move list
    this.ui.updateMoveList(this.game.moveHistory, this.game.currentMoveIndex);

    // Opening
    this._updateOpening();
  }

  _updateOpening() {
    // Simple prefix lookup against ECO_CODES
    const moves = this.game.moveSanList;
    if (typeof ECO_CODES !== 'undefined' && moves.length > 0) {
      // Try ECO lookup by matching GM game openings
      const gmMatches = this.gmMatch.findMatches(moves);
      if (gmMatches.length > 0) {
        const g = gmMatches[0].game;
        this.ui.updateOpening(g.eco, g.opening_name);
        return;
      }
    }
    this.ui.updateOpening('', 'Starting Position');
  }

  _fullRedraw() {
    this.board.setBoardState(this.game.board);
    this._updateUI();
    // Restore last-move highlights
    const h = this.game.moveHistory;
    if (h.length > 0 && this.game.currentMoveIndex >= 0) {
      const last = h[this.game.currentMoveIndex];
      this.board.highlightLastMove(last.from, last.to);
    }
  }

  // ------------------------------------------------------------------ //
  //  Control bindings
  // ------------------------------------------------------------------ //

  _bindControls() {
    // New Game
    const newGameBtn = document.getElementById('btn-new-game');
    if (newGameBtn) newGameBtn.addEventListener('click', () => this.newGame());

    // Undo
    const undoBtn = document.getElementById('btn-undo');
    if (undoBtn) undoBtn.addEventListener('click', () => this.undo());

    // Flip board
    const flipBtn = document.getElementById('btn-flip');
    if (flipBtn) flipBtn.addEventListener('click', () => this.board.flip());

    // Export PGN
    const pgnBtn = document.getElementById('btn-pgn');
    if (pgnBtn) pgnBtn.addEventListener('click', () => this.exportPGN());

    // Analyze button
    const analyzeBtn = document.getElementById('analyze-btn');
    if (analyzeBtn) analyzeBtn.addEventListener('click', () => this._analyzePosition());

    // Game mode selector
    const modeSelect = document.getElementById('game-mode');
    if (modeSelect) modeSelect.addEventListener('change', e => {
      this.mode = e.target.value;
      this.newGame();
    });

    // Difficulty slider
    const diffSlider = document.getElementById('ai-difficulty');
    const diffLabel  = document.getElementById('difficulty-label');
    if (diffSlider) diffSlider.addEventListener('input', e => {
      this.aiSkill = parseInt(e.target.value);
      if (diffLabel) diffLabel.textContent = this._difficultyLabel(this.aiSkill);
    });

    // Move navigation keyboard
    document.addEventListener('keydown', e => {
      if (e.key === 'ArrowLeft')  this.navigateMove(-1);
      if (e.key === 'ArrowRight') this.navigateMove(+1);
    });

    // Move list click
    this.ui.onMoveClick(idx => {
      this.game.goToMove(idx);
      this._fullRedraw();
    });
  }

  _difficultyLabel(skill) {
    if (skill <= 3)  return 'Beginner';
    if (skill <= 7)  return 'Easy';
    if (skill <= 12) return 'Medium';
    if (skill <= 17) return 'Hard';
    return 'Master';
  }

  // ------------------------------------------------------------------ //
  //  Public actions
  // ------------------------------------------------------------------ //

  newGame() {
    this.analyzer.stop();
    this.aiThinking  = false;
    this._evalBefore = null;
    this._currentScore = null;
    this.game.reset();
    this.board.clearHighlights();
    this.board.selectedSquare = null;
    if (this.board.arrowMesh) {
      this.board.scene.remove(this.board.arrowMesh);
      this.board.arrowMesh = null;
    }
    this._fullRedraw();
    this.ui.updateGMPanel([], 0);
    this.ui.showMoveQuality(null);
    if (this.lastQualityEl) this.lastQualityEl.style.display = 'none';
    this._analyzePosition();

    if (!this.game.isGameOver && this._isAITurn()) {
      setTimeout(() => this._doAIMove(), 500);
    }
  }

  undo() {
    if (this._isAITurn()) return;
    // Undo twice if playing against AI (undo AI move + player move)
    const undid = this.game.undoMove();
    if (undid && this.mode !== 'human') this.game.undoMove();
    this.analyzer.stop();
    this._fullRedraw();
    this._analyzePosition();
    this._checkGMMatches();
  }

  navigateMove(delta) {
    const newIdx = this.game.currentMoveIndex + delta;
    if (newIdx < -1 || newIdx >= this.game.moveHistory.length) return;
    this.game.goToMove(newIdx);
    this._fullRedraw();
  }

  exportPGN() {
    const pgn = this.game.pgn();
    if (!pgn) { this.ui.toast('No moves to export.'); return; }
    // Copy to clipboard
    navigator.clipboard.writeText(pgn).then(() => {
      this.ui.toast('PGN copied to clipboard!');
    }).catch(() => {
      // Fallback: open in new window
      const w = window.open();
      w.document.write('<pre>' + pgn + '</pre>');
      this.ui.toast('PGN opened in new window.');
    });
  }
}

// ------------------------------------------------------------------ //
//  Bootstrap
// ------------------------------------------------------------------ //

window.addEventListener('DOMContentLoaded', () => {
  window.chessApp = new App();
});
