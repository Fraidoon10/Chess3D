/**
 * analyzer.js — Stockfish WASM integration
 * Provides position evaluation, best move suggestion, and move classification.
 */
class Analyzer {
  constructor() {
    this.engine = null;
    this.ready  = false;
    this.busy   = false;
    this._msgHandlers = [];
    this._evalCb  = null;
    this._bestMoveCb = null;
    this._depth = 18;
    this._initEngine();
  }

  // ------------------------------------------------------------------ //
  //  Engine setup
  // ------------------------------------------------------------------ //

  _initEngine() {
    const CDNs = [
      'https://cdn.jsdelivr.net/npm/stockfish.js@10.0.2/stockfish.js',
      'https://cdnjs.cloudflare.com/ajax/libs/stockfish.js/10.0.2/stockfish.js'
    ];

    const tryLoad = (idx) => {
      if (idx >= CDNs.length) {
        console.warn('Stockfish unavailable — analysis disabled');
        return;
      }
      try {
        this.engine = new Worker(CDNs[idx]);
        this.engine.onmessage = e => this._handleMsg(e.data);
        this.engine.onerror   = () => { this.engine = null; tryLoad(idx + 1); };
        this.engine.postMessage('uci');
      } catch (err) {
        tryLoad(idx + 1);
      }
    };
    tryLoad(0);
  }

  _handleMsg(msg) {
    if (typeof msg !== 'string') return;

    if (msg === 'uciok') {
      this.engine.postMessage('isready');
      return;
    }
    if (msg === 'readyok') {
      this.ready = true;
      return;
    }

    // info depth … score cp / mate … pv …
    if (msg.startsWith('info')) {
      const depthMatch = msg.match(/depth (\d+)/);
      const cpMatch    = msg.match(/score cp (-?\d+)/);
      const mateMatch  = msg.match(/score mate (-?\d+)/);
      const pvMatch    = msg.match(/ pv ([a-h][1-8][a-h][1-8]\w?)/);

      if (this._evalCb && (cpMatch || mateMatch)) {
        const depth = depthMatch ? parseInt(depthMatch[1]) : 0;
        let score;
        if (mateMatch)   score = { type: 'mate', value: parseInt(mateMatch[1]) };
        else if (cpMatch) score = { type: 'cp',   value: parseInt(cpMatch[1]) };
        const bestMove = pvMatch ? pvMatch[1] : null;
        this._evalCb({ score, bestMove, depth });
      }
    }

    // bestmove e2e4 ponder …
    if (msg.startsWith('bestmove')) {
      const parts = msg.split(' ');
      const bm = parts[1];
      this.busy = false;
      if (this._bestMoveCb && bm && bm !== '(none)') {
        this._bestMoveCb(bm);
        this._bestMoveCb = null;
      }
    }
  }

  // ------------------------------------------------------------------ //
  //  Public API
  // ------------------------------------------------------------------ //

  /**
   * Evaluate the given FEN position.
   * @param {string} fen
   * @param {function} onInfo  called repeatedly with { score, bestMove, depth }
   * @param {function} onDone  called with best move string when search completes
   * @param {number}   depth   search depth (default 18)
   */
  evaluate(fen, onInfo, onDone, depth) {
    if (!this.engine || !this.ready) {
      if (onDone) onDone(null);
      return;
    }
    if (this.busy) this.engine.postMessage('stop');

    this.busy = true;
    this._evalCb     = onInfo;
    this._bestMoveCb = onDone;

    this.engine.postMessage('ucinewgame');
    this.engine.postMessage(`position fen ${fen}`);
    this.engine.postMessage(`go depth ${depth || this._depth}`);
  }

  /**
   * Get a single best move quickly (low depth).
   * @param {string} fen
   * @param {number} skillLevel  0-20 (Stockfish Skill Level option)
   * @param {function} cb  called with best move string
   */
  getBestMove(fen, skillLevel, cb) {
    if (!this.engine || !this.ready) { cb && cb(null); return; }
    if (this.busy) this.engine.postMessage('stop');

    this.busy = true;
    this._evalCb = null;
    this._bestMoveCb = cb;

    const sl = Math.max(0, Math.min(20, skillLevel || 20));
    this.engine.postMessage(`setoption name Skill Level value ${sl}`);
    this.engine.postMessage('ucinewgame');
    this.engine.postMessage(`position fen ${fen}`);
    const searchDepth = sl <= 5 ? 4 : sl <= 10 ? 8 : sl <= 15 ? 12 : 16;
    this.engine.postMessage(`go depth ${searchDepth}`);
  }

  stop() {
    if (this.engine) this.engine.postMessage('stop');
    this.busy = false;
  }

  get isAvailable() { return this.engine !== null && this.ready; }

  // ------------------------------------------------------------------ //
  //  Move classification
  // ------------------------------------------------------------------ //

  /**
   * Classify a move based on the evaluation delta.
   * @param {number} cpBefore  centipawn eval before move (from mover's perspective, positive = good)
   * @param {number} cpAfter   centipawn eval after move (from mover's perspective, positive = good)
   * @returns {{ label: string, symbol: string, cssClass: string }}
   */
  static classifyMove(cpBefore, cpAfter) {
    // cpAfter is from the perspective of the side that just moved.
    // After the move, the evaluation flips to the other side, so we negate.
    const delta = cpBefore - (-cpAfter); // improvement / loss from mover's perspective

    if (delta >= 150)  return { label: 'Brilliant', symbol: '!!', cssClass: 'brilliant' };
    if (delta >= 50)   return { label: 'Great',     symbol: '!',  cssClass: 'great'     };
    if (delta >= -25)  return { label: 'Good',      symbol: '',   cssClass: 'good'      };
    if (delta >= -100) return { label: 'Inaccuracy',symbol: '?!', cssClass: 'inaccuracy'};
    if (delta >= -250) return { label: 'Mistake',   symbol: '?',  cssClass: 'mistake'   };
    return              { label: 'Blunder',    symbol: '??', cssClass: 'blunder'   };
  }

  /**
   * Convert raw score to centipawns from White's perspective.
   * @param {{type:'cp'|'mate', value:number}} score
   * @param {'w'|'b'} turn  side that just moved
   */
  static toCpWhite(score, turn) {
    if (!score) return 0;
    let cp;
    if (score.type === 'mate') {
      cp = score.value > 0 ? 10000 : -10000;
    } else {
      cp = score.value;
    }
    return turn === 'b' ? -cp : cp;
  }

  /**
   * Format evaluation for display.
   * @param {{type:'cp'|'mate', value:number}} score  from White's perspective
   */
  static formatScore(score, turnBeforeMove) {
    if (!score) return '0.00';
    const cpWhite = Analyzer.toCpWhite(score, turnBeforeMove);
    if (score.type === 'mate') {
      const mv = Math.abs(score.value);
      return cpWhite > 0 ? `M${mv}` : `-M${mv}`;
    }
    const pawns = cpWhite / 100;
    return (pawns >= 0 ? '+' : '') + pawns.toFixed(2);
  }

  /**
   * Eval bar fill percentage (0% = Black winning, 50% = equal, 100% = White winning).
   * @param {{type:'cp'|'mate', value:number}} score  from White's perspective
   */
  static evalBarPercent(score, turnBeforeMove) {
    if (!score) return 50;
    const cp = Analyzer.toCpWhite(score, turnBeforeMove);
    if (score.type === 'mate') return cp > 0 ? 95 : 5;
    // Sigmoid: 50 + 50 * tanh(cp / 400)
    return 50 + 50 * Math.tanh(cp / 400);
  }
}
