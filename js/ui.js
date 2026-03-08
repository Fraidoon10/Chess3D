/**
 * ui.js — UI controller
 * Manages all DOM panels: move list, analysis tab, grandmaster tab,
 * evaluation bar, promotion dialog, toast notifications, and timers.
 */
class UI {
  constructor() {
    /* Panel elements */
    this.movesGrid        = document.getElementById('moves-grid');
    this.statusEl         = document.getElementById('game-status');
    this.capturedWhiteEl  = document.getElementById('captured-white');
    this.capturedBlackEl  = document.getElementById('captured-black');
    this.materialDiffEl   = document.getElementById('material-diff');
    this.evalFillEl       = document.getElementById('eval-bar-fill');
    this.evalScoreEl      = document.getElementById('eval-score');
    this.thinkingEl       = document.getElementById('thinking-indicator');
    this.openingNameEl    = document.getElementById('opening-name');
    this.openingEcoEl     = document.getElementById('opening-eco');
    this.evalBigEl        = document.getElementById('eval-big');
    this.bestMoveBadgeEl  = document.getElementById('best-move-badge');
    this.lastQualityEl    = document.getElementById('last-move-quality');
    this.gmPanelEl        = document.getElementById('gm-panel');
    this.promotionDialog  = document.getElementById('promotion-dialog');

    this._moveClickCb     = null;
    this._promoResolveCb  = null;
    this._currentMoveIdx  = -1;
    this._toastTimer      = null;

    this._bindTabs();
    this._bindPromotion();
  }

  // ------------------------------------------------------------------ //
  //  Tabs
  // ------------------------------------------------------------------ //

  _bindTabs() {
    document.querySelectorAll('.tab-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const target = btn.dataset.tab;
        document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b === btn));
        document.querySelectorAll('.tab-content').forEach(c => {
          c.classList.toggle('active', c.id === target);
        });
      });
    });
  }

  // ------------------------------------------------------------------ //
  //  Move list
  // ------------------------------------------------------------------ //

  onMoveClick(cb) { this._moveClickCb = cb; }

  /**
   * Rebuild the moves grid from the full history.
   * @param {Array}  history       moveHistory array from ChessGame
   * @param {number} currentIndex  highlighted move index
   */
  updateMoveList(history, currentIndex) {
    this._currentMoveIdx = currentIndex;
    const grid = this.movesGrid;
    grid.innerHTML = '';

    for (let i = 0; i < history.length; i += 2) {
      const moveNum = i / 2 + 1;
      const whiteMove = history[i];
      const blackMove = history[i + 1];

      // Move number
      const numEl = document.createElement('div');
      numEl.className = 'move-num';
      numEl.textContent = moveNum + '.';
      grid.appendChild(numEl);

      // White move
      grid.appendChild(this._moveCell(whiteMove, i, currentIndex));

      // Black move (or placeholder)
      if (blackMove) {
        grid.appendChild(this._moveCell(blackMove, i + 1, currentIndex));
      } else {
        const empty = document.createElement('div');
        grid.appendChild(empty);
      }
    }

    // Scroll to show current move
    const currentCell = grid.querySelector('.move-cell.current');
    if (currentCell) currentCell.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  _moveCell(entry, index, currentIndex) {
    const cell = document.createElement('div');
    cell.className = 'move-cell' + (index === currentIndex ? ' current' : '');
    cell.dataset.index = index;

    // Piece symbol prefix
    const pieceSymbols = { k:'♔',q:'♕',r:'♖',b:'♗',n:'♘', K:'♚',Q:'♛',R:'♜',B:'♝',N:'♞' };
    cell.textContent = entry.san;

    // Annotation badge
    if (entry.annotation) {
      const badge = document.createElement('span');
      badge.className = `move-ann ${entry.annotation.cssClass || ''}`;
      badge.textContent = entry.annotation.symbol || '';
      cell.appendChild(badge);
    }

    cell.addEventListener('click', () => {
      if (this._moveClickCb) this._moveClickCb(index);
    });
    return cell;
  }

  // ------------------------------------------------------------------ //
  //  Game status & captured pieces
  // ------------------------------------------------------------------ //

  updateStatus(text, type /* 'check'|'checkmate'|'draw'|'' */) {
    this.statusEl.textContent = text;
    this.statusEl.className = type ? `${type}` : '';
  }

  updateCaptured(capturedByWhite, capturedByBlack, materialDiff) {
    if (this.capturedWhiteEl) this.capturedWhiteEl.textContent = capturedByWhite.join('');
    if (this.capturedBlackEl) this.capturedBlackEl.textContent = capturedByBlack.join('');
    if (this.materialDiffEl) {
      const d = materialDiff;
      this.materialDiffEl.textContent = d > 0 ? `+${d}` : d < 0 ? `${d}` : '';
    }
  }

  // ------------------------------------------------------------------ //
  //  Evaluation bar
  // ------------------------------------------------------------------ //

  updateEval(score, turnBeforeMove) {
    const pct   = Analyzer.evalBarPercent(score, turnBeforeMove);
    const label = Analyzer.formatScore(score, turnBeforeMove);

    if (this.evalFillEl)  this.evalFillEl.style.width = `${pct}%`;
    if (this.evalScoreEl) this.evalScoreEl.textContent = label;
    if (this.evalBigEl)   this.evalBigEl.textContent   = label;
  }

  // ------------------------------------------------------------------ //
  //  Opening display
  // ------------------------------------------------------------------ //

  updateOpening(eco, name) {
    if (this.openingNameEl) this.openingNameEl.textContent = name || 'Unknown Opening';
    if (this.openingEcoEl)  this.openingEcoEl.textContent  = eco  || '';
  }

  // ------------------------------------------------------------------ //
  //  Best move & quality
  // ------------------------------------------------------------------ //

  showBestMove(moveSan) {
    if (this.bestMoveBadgeEl) {
      this.bestMoveBadgeEl.textContent = moveSan || '—';
    }
  }

  /**
   * Update the eval bar and score for a game-over state.
   * @param {boolean|null} winnerIsWhite  true=white wins, false=black wins, null=draw
   */
  showGameOver(winnerIsWhite) {
    const pct  = winnerIsWhite === null ? 50 : winnerIsWhite ? 95 : 5;
    const text = winnerIsWhite === null ? 'Draw' : winnerIsWhite ? '+M' : '-M';
    if (this.evalFillEl)      this.evalFillEl.style.width      = `${pct}%`;
    if (this.evalScoreEl)     this.evalScoreEl.textContent     = text;
    if (this.evalBigEl)       this.evalBigEl.textContent       = text;
    if (this.bestMoveBadgeEl) this.bestMoveBadgeEl.textContent = '—';
  }

  showMoveQuality(quality) {
    if (!quality || !this.lastQualityEl) return;
    this.lastQualityEl.textContent  = quality.label + (quality.symbol ? ' ' + quality.symbol : '');
    this.lastQualityEl.className    = `move-quality-indicator quality-${quality.cssClass}`;
    this.lastQualityEl.style.display = 'inline-block';
  }

  // ------------------------------------------------------------------ //
  //  Thinking indicator
  // ------------------------------------------------------------------ //

  showThinking(visible) {
    if (this.thinkingEl) {
      this.thinkingEl.classList.toggle('visible', visible);
    }
  }

  // ------------------------------------------------------------------ //
  //  Grandmaster panel
  // ------------------------------------------------------------------ //

  updateGMPanel(matches, currentDepth) {
    const panel = this.gmPanelEl;
    if (!panel) return;
    panel.innerHTML = '';

    if (!matches || matches.length === 0) {
      panel.innerHTML = `
        <div class="gm-empty">
          <div class="icon">♟</div>
          <p>Play some moves to see if your game matches a historical grandmaster game.</p>
        </div>`;
      return;
    }

    for (const match of matches) {
      const { game, depth, nextMove } = match;
      const nextLine = GrandmasterMatcher.nextMoveLine(match);

      const card = document.createElement('div');
      card.className = 'gm-card';
      card.innerHTML = `
        <div class="gm-card-title">
          ${game.white} vs ${game.black}
        </div>
        <div class="gm-card-meta">
          ${game.year} · ${game.event} · <strong>${game.result}</strong>
          · ${game.opening_name}
        </div>
        <div class="gm-card-desc">${game.description}</div>
        ${nextMove ? `<div class="gm-next-move">
          🏆 GM played: <strong>${nextLine}</strong>
          <span style="color:var(--text-dim);font-size:11px;margin-left:6px">(after ${depth} matching moves)</span>
        </div>` : `<div class="gm-next-move" style="color:var(--text-dim)">You've matched all ${depth} recorded moves of this game!</div>`}
        <a class="gm-link" href="${game.reference_url}" target="_blank" rel="noopener">
          View full game ↗
        </a>`;
      panel.appendChild(card);
    }
  }

  // ------------------------------------------------------------------ //
  //  Promotion dialog
  // ------------------------------------------------------------------ //

  _bindPromotion() {
    document.querySelectorAll('.promo-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const piece = btn.dataset.piece;
        if (this._promoResolveCb) {
          this._promoResolveCb(piece);
          this._promoResolveCb = null;
        }
        this.promotionDialog.style.display = 'none';
      });
    });
  }

  /**
   * Show promotion dialog and return a Promise that resolves with the chosen piece.
   * @param {'w'|'b'} color  color of the promoting side
   */
  showPromotionDialog(color) {
    // Update piece symbols for the correct color
    const symbols = color === 'w'
      ? { q: '♕', r: '♖', b: '♗', n: '♘' }
      : { q: '♛', r: '♜', b: '♝', n: '♞' };
    document.querySelectorAll('.promo-btn').forEach(btn => {
      btn.textContent = symbols[btn.dataset.piece] || btn.dataset.piece;
    });
    this.promotionDialog.style.display = 'block';
    return new Promise(resolve => { this._promoResolveCb = resolve; });
  }

  // ------------------------------------------------------------------ //
  //  Toast notifications
  // ------------------------------------------------------------------ //

  toast(message, duration = 2500) {
    const el = document.getElementById('toast');
    if (!el) return;
    el.textContent = message;
    el.classList.add('show');
    clearTimeout(this._toastTimer);
    this._toastTimer = setTimeout(() => el.classList.remove('show'), duration);
  }

  // ------------------------------------------------------------------ //
  //  Player / mode helpers
  // ------------------------------------------------------------------ //

  setActivePlayer(color) {
    document.querySelectorAll('.player-timer').forEach(el => el.classList.remove('active'));
    const id = color === 'w' ? 'timer-white' : 'timer-black';
    const el = document.getElementById(id);
    if (el) el.classList.add('active');
  }
}
