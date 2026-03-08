/**
 * board3d.js — Three.js 3D chess board renderer
 * Handles board geometry, piece meshes, selection, move highlights,
 * OrbitControls, animations, and last-move arrows.
 */
class Board3D {
  constructor(canvasEl) {
    this.canvas = canvasEl;
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.controls = null;

    this.squareMeshes = {};     // square -> THREE.Mesh
    this.pieceMeshes  = {};     // square -> THREE.Group
    this.highlightMeshes = [];  // temp highlight overlays
    this.arrowMesh = null;

    this.selectedSquare = null;
    this.flipped = false;

    this._animQueue = [];
    this._animating = false;

    this._onSelectCb  = null;   // callback(square)
    this._onTargetCb  = null;   // callback(square)

    this._init();
  }

  // ------------------------------------------------------------------ //
  //  Initialization
  // ------------------------------------------------------------------ //

  _init() {
    const W = this.canvas.clientWidth  || 600;
    const H = this.canvas.clientHeight || 600;

    /* Scene */
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x1a1a2e);

    /* Camera */
    this.camera = new THREE.PerspectiveCamera(45, W / H, 0.1, 200);
    this.camera.position.set(0, 12, 14);
    this.camera.lookAt(0, 0, 0);

    /* Renderer */
    this.renderer = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      alpha: false
    });
    this.renderer.setSize(W, H);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    /* Lights */
    const ambient = new THREE.AmbientLight(0xffffff, 0.5);
    this.scene.add(ambient);

    const dirLight = new THREE.DirectionalLight(0xffffff, 0.9);
    dirLight.position.set(8, 16, 8);
    dirLight.castShadow = true;
    dirLight.shadow.mapSize.width  = 2048;
    dirLight.shadow.mapSize.height = 2048;
    dirLight.shadow.camera.near = 0.5;
    dirLight.shadow.camera.far  = 80;
    dirLight.shadow.camera.left = dirLight.shadow.camera.bottom = -10;
    dirLight.shadow.camera.right = dirLight.shadow.camera.top  =  10;
    this.scene.add(dirLight);

    const fillLight = new THREE.DirectionalLight(0x8899ff, 0.3);
    fillLight.position.set(-5, 8, -5);
    this.scene.add(fillLight);

    /* Board surround */
    this._buildBoard();

    /* OrbitControls */
    if (typeof THREE.OrbitControls !== 'undefined') {
      this.controls = new THREE.OrbitControls(this.camera, this.renderer.domElement);
      this.controls.enableDamping = true;
      this.controls.dampingFactor = 0.08;
      this.controls.minDistance = 5;
      this.controls.maxDistance = 35;
      this.controls.maxPolarAngle = Math.PI / 2.1;
      this.controls.target.set(0, 0, 0);
    }

    /* Click handling */
    this.renderer.domElement.addEventListener('click', e => this._onClick(e));

    /* Resize */
    const ro = new ResizeObserver(() => this._onResize());
    ro.observe(this.canvas.parentElement);

    /* Render loop */
    this._animate();
  }

  _buildBoard() {
    const LIGHT = 0xf0d9b5;
    const DARK  = 0xb58863;
    const BORDER= 0x5c3a1e;
    const COORD = 0x8a6a4a;

    /* Board surround */
    const frameGeo = new THREE.BoxGeometry(9.6, 0.3, 9.6);
    const frameMat = new THREE.MeshStandardMaterial({ color: BORDER, roughness: 0.8 });
    const frame = new THREE.Mesh(frameGeo, frameMat);
    frame.position.y = -0.16;
    frame.receiveShadow = true;
    this.scene.add(frame);

    /* 64 squares */
    for (let rank = 0; rank < 8; rank++) {
      for (let file = 0; file < 8; file++) {
        const isLight = (rank + file) % 2 === 0;
        const geo = new THREE.BoxGeometry(1, 0.15, 1);
        const mat = new THREE.MeshStandardMaterial({
          color: isLight ? LIGHT : DARK,
          roughness: 0.7,
          metalness: 0.05
        });
        const mesh = new THREE.Mesh(geo, mat);
        const { x, z } = this._squareToXZ(file, rank);
        mesh.position.set(x, 0, z);
        mesh.receiveShadow = true;
        this.scene.add(mesh);

        const sq = this._fileRankToSquare(file, rank);
        this.squareMeshes[sq] = mesh;
        mesh.userData.square = sq;
        mesh.userData.baseColor = isLight ? LIGHT : DARK;
      }
    }

    /* Coordinate labels (simple meshes) — skip for performance, use canvas text instead */
  }

  // ------------------------------------------------------------------ //
  //  Coordinate helpers
  // ------------------------------------------------------------------ //

  _squareToXZ(file, rank) {
    // file 0=a … 7=h, rank 0=8 … 7=1 (from white's perspective)
    const x = file - 3.5;
    const z = rank - 3.5;
    return this.flipped ? { x: -x, z: -z } : { x, z };
  }

  _squareToWorld(squareName) {
    const file = squareName.charCodeAt(0) - 97;         // a=0 … h=7
    const rank = 8 - parseInt(squareName[1]);            // 1 → rank=7, 8 → rank=0
    return this._squareToXZ(file, rank);
  }

  _fileRankToSquare(file, rank) {
    const fileChar = String.fromCharCode(97 + file);
    const rankNum  = 8 - rank;
    return `${fileChar}${rankNum}`;
  }

  _hitSquare(event) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    const mouse = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width)  * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1
    );
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(mouse, this.camera);

    const squareMeshList = Object.values(this.squareMeshes);
    const hits = raycaster.intersectObjects(squareMeshList);
    if (hits.length > 0) return hits[0].object.userData.square;

    // Also check piece meshes (click on piece = click on its square)
    const allPieceObjs = [];
    Object.values(this.pieceMeshes).forEach(g => g.traverse(o => { if (o.isMesh) allPieceObjs.push(o); }));
    const pieceHits = raycaster.intersectObjects(allPieceObjs);
    if (pieceHits.length > 0) {
      // Walk up to find group with userData.square
      let obj = pieceHits[0].object;
      while (obj && !obj.userData.square) obj = obj.parent;
      if (obj) return obj.userData.square;
    }
    return null;
  }

  _onClick(event) {
    const sq = this._hitSquare(event);
    if (!sq) return;

    if (this.selectedSquare === null) {
      if (this._onSelectCb) this._onSelectCb(sq);
    } else {
      if (sq === this.selectedSquare) {
        this.clearHighlights();
        this.selectedSquare = null;
      } else {
        if (this._onTargetCb) this._onTargetCb(sq);
      }
    }
  }

  // ------------------------------------------------------------------ //
  //  Highlights
  // ------------------------------------------------------------------ //

  clearHighlights() {
    this.highlightMeshes.forEach(m => this.scene.remove(m));
    this.highlightMeshes = [];
    // Restore square base colors
    for (const [sq, mesh] of Object.entries(this.squareMeshes)) {
      mesh.material.color.setHex(mesh.userData.baseColor);
      mesh.material.emissive.setHex(0x000000);
    }
  }

  highlightSelected(square) {
    this.clearHighlights();
    this.selectedSquare = square;
    const mesh = this.squareMeshes[square];
    if (mesh) {
      mesh.material.emissive.setHex(0x1482ff);
      mesh.material.emissiveIntensity = 0.4;
    }
  }

  highlightMoves(squares) {
    squares.forEach(sq => {
      const mesh = this.squareMeshes[sq];
      if (!mesh) return;
      mesh.material.emissive.setHex(0x14c850);
      mesh.material.emissiveIntensity = 0.45;
    });
  }

  highlightCaptures(squares) {
    squares.forEach(sq => {
      const mesh = this.squareMeshes[sq];
      if (!mesh) return;
      mesh.material.emissive.setHex(0xe63232);
      mesh.material.emissiveIntensity = 0.5;
    });
  }

  highlightLastMove(from, to) {
    [from, to].forEach(sq => {
      const mesh = this.squareMeshes[sq];
      if (mesh && !mesh.material.emissiveIntensity) {
        mesh.material.emissive.setHex(0xffdc00);
        mesh.material.emissiveIntensity = 0.2;
      }
    });
  }

  // ------------------------------------------------------------------ //
  //  Arrow overlay
  // ------------------------------------------------------------------ //

  showBestMoveArrow(from, to) {
    if (this.arrowMesh) { this.scene.remove(this.arrowMesh); this.arrowMesh = null; }
    if (!from || !to) return;

    const p1 = this._squareToWorld(from);
    const p2 = this._squareToWorld(to);
    const start = new THREE.Vector3(p1.x, 0.2, p1.z);
    const end   = new THREE.Vector3(p2.x, 0.2, p2.z);

    const dir = new THREE.Vector3().subVectors(end, start);
    const len = dir.length();
    dir.normalize();

    const geo = new THREE.CylinderGeometry(0.08, 0.08, len, 8);
    const mat = new THREE.MeshBasicMaterial({ color: 0x00b4d8, transparent: true, opacity: 0.75 });
    const shaft = new THREE.Mesh(geo, mat);

    const mid = new THREE.Vector3().addVectors(start, end).multiplyScalar(0.5);
    shaft.position.copy(mid);
    shaft.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);

    const headGeo = new THREE.ConeGeometry(0.2, 0.5, 8);
    const head = new THREE.Mesh(headGeo, mat);
    head.position.copy(end);
    head.position.y = 0.25;
    head.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir);

    const group = new THREE.Group();
    group.add(shaft);
    group.add(head);
    this.arrowMesh = group;
    this.scene.add(group);
  }

  // ------------------------------------------------------------------ //
  //  Piece management
  // ------------------------------------------------------------------ //

  clearPieces() {
    for (const group of Object.values(this.pieceMeshes)) {
      this.scene.remove(group);
    }
    this.pieceMeshes = {};
  }

  /**
   * Place all pieces from game board state.
   * @param {Array} boardState  [{square, type, color}, ...]
   */
  setBoardState(boardState) {
    this.clearPieces();
    for (const { square, type, color } of boardState) {
      this._placePiece(square, type, color);
    }
  }

  _placePiece(square, type, color) {
    const group = this._buildPieceMesh(type, color);
    const { x, z } = this._squareToWorld(square);
    group.position.set(x, 0, z);
    group.userData.square = square;
    this.scene.add(group);
    this.pieceMeshes[square] = group;
  }

  /** Animate moving a piece from one square to another */
  movePiece(fromSq, toSq, onComplete) {
    const group = this.pieceMeshes[fromSq];
    if (!group) { if (onComplete) onComplete(); return; }

    // Remove captured piece if any
    if (this.pieceMeshes[toSq]) {
      this.scene.remove(this.pieceMeshes[toSq]);
      delete this.pieceMeshes[toSq];
    }

    const { x: tx, z: tz } = this._squareToWorld(toSq);
    const startX = group.position.x;
    const startZ = group.position.z;
    const FRAMES = 18;
    let frame = 0;

    delete this.pieceMeshes[fromSq];
    this.pieceMeshes[toSq] = group;
    group.userData.square = toSq;

    const step = () => {
      frame++;
      const t = frame / FRAMES;
      const ease = t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t;
      group.position.x = startX + (tx - startX) * ease;
      group.position.z = startZ + (tz - startZ) * ease;
      // Arc upwards
      group.position.y = Math.sin(t * Math.PI) * 1.2;

      if (frame < FRAMES) {
        requestAnimationFrame(step);
      } else {
        group.position.set(tx, 0, tz);
        if (onComplete) onComplete();
      }
    };
    requestAnimationFrame(step);
  }

  /** Handle castling — move the rook as well */
  handleCastle(move, onComplete) {
    const rookMoves = {
      'g1': { from: 'h1', to: 'f1' },
      'c1': { from: 'a1', to: 'd1' },
      'g8': { from: 'h8', to: 'f8' },
      'c8': { from: 'a8', to: 'd8' }
    };
    const rm = rookMoves[move.to];
    if (rm) {
      // Move rook after king move completes
      this.movePiece(rm.from, rm.to, onComplete);
    } else {
      if (onComplete) onComplete();
    }
  }

  /** Update a square to show a promoted piece */
  promotePiece(square, type, color) {
    if (this.pieceMeshes[square]) {
      this.scene.remove(this.pieceMeshes[square]);
    }
    this._placePiece(square, type, color);
  }

  // ------------------------------------------------------------------ //
  //  Piece geometry builders
  // ------------------------------------------------------------------ //

  _buildPieceMesh(type, color) {
    const isWhite = color === 'w';
    const mainColor   = isWhite ? 0xf0e6d3 : 0x2c2c3e;
    const accentColor = isWhite ? 0xd4c4a8 : 0x1a1a2a;
    const mainMat   = new THREE.MeshStandardMaterial({ color: mainColor,   roughness: 0.55, metalness: 0.1 });
    const accentMat = new THREE.MeshStandardMaterial({ color: accentColor, roughness: 0.7,  metalness: 0.05 });

    const group = new THREE.Group();

    switch (type) {
      case 'p': this._buildPawn  (group, mainMat, accentMat); break;
      case 'r': this._buildRook  (group, mainMat, accentMat); break;
      case 'n': this._buildKnight(group, mainMat, accentMat); break;
      case 'b': this._buildBishop(group, mainMat, accentMat); break;
      case 'q': this._buildQueen (group, mainMat, accentMat); break;
      case 'k': this._buildKing  (group, mainMat, accentMat); break;
    }

    group.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    return group;
  }

  _buildPawn(g, mat, acc) {
    // Base
    g.add(this._mesh(new THREE.CylinderGeometry(0.3, 0.35, 0.1, 12), acc));
    // Shaft
    const shaft = this._mesh(new THREE.CylinderGeometry(0.14, 0.28, 0.5, 12), mat);
    shaft.position.y = 0.35;
    g.add(shaft);
    // Head
    const head = this._mesh(new THREE.SphereGeometry(0.22, 12, 8), mat);
    head.position.y = 0.78;
    g.add(head);
  }

  _buildRook(g, mat, acc) {
    g.add(this._mesh(new THREE.CylinderGeometry(0.33, 0.38, 0.1, 12), acc));
    const body = this._mesh(new THREE.CylinderGeometry(0.28, 0.33, 0.65, 12), mat);
    body.position.y = 0.42;
    g.add(body);
    const top = this._mesh(new THREE.CylinderGeometry(0.33, 0.28, 0.18, 12), mat);
    top.position.y = 0.84;
    g.add(top);
    // Battlements
    for (let i = 0; i < 4; i++) {
      const b = this._mesh(new THREE.BoxGeometry(0.14, 0.22, 0.14), mat);
      const angle = (i / 4) * Math.PI * 2;
      b.position.set(Math.cos(angle) * 0.22, 1.04, Math.sin(angle) * 0.22);
      g.add(b);
    }
  }

  _buildKnight(g, mat, acc) {
    g.add(this._mesh(new THREE.CylinderGeometry(0.3, 0.35, 0.1, 12), acc));
    const neck = this._mesh(new THREE.CylinderGeometry(0.2, 0.3, 0.5, 12), mat);
    neck.position.y = 0.35;
    g.add(neck);
    // Head (distinctive box + snout)
    const head = this._mesh(new THREE.BoxGeometry(0.28, 0.4, 0.45), mat);
    head.position.set(0.06, 0.8, 0);
    head.rotation.x = -0.3;
    g.add(head);
    const snout = this._mesh(new THREE.BoxGeometry(0.18, 0.18, 0.28), mat);
    snout.position.set(0.1, 0.68, 0.22);
    g.add(snout);
    // Ear
    const ear = this._mesh(new THREE.BoxGeometry(0.08, 0.2, 0.08), mat);
    ear.position.set(-0.06, 1.03, -0.1);
    g.add(ear);
  }

  _buildBishop(g, mat, acc) {
    g.add(this._mesh(new THREE.CylinderGeometry(0.3, 0.35, 0.1, 12), acc));
    const body = this._mesh(new THREE.CylinderGeometry(0.16, 0.28, 0.8, 12), mat);
    body.position.y = 0.5;
    g.add(body);
    const ball = this._mesh(new THREE.SphereGeometry(0.2, 12, 8), mat);
    ball.position.y = 1.0;
    g.add(ball);
    // Tip
    const tip = this._mesh(new THREE.ConeGeometry(0.07, 0.25, 8), mat);
    tip.position.y = 1.28;
    g.add(tip);
    // Collar ring
    const ring = this._mesh(new THREE.TorusGeometry(0.17, 0.04, 8, 16), acc);
    ring.rotation.x = Math.PI / 2;
    ring.position.y = 0.9;
    g.add(ring);
  }

  _buildQueen(g, mat, acc) {
    g.add(this._mesh(new THREE.CylinderGeometry(0.35, 0.40, 0.1, 16), acc));
    const body = this._mesh(new THREE.CylinderGeometry(0.22, 0.34, 0.85, 16), mat);
    body.position.y = 0.52;
    g.add(body);
    const globe = this._mesh(new THREE.SphereGeometry(0.26, 14, 10), mat);
    globe.position.y = 1.04;
    g.add(globe);
    // Crown points
    for (let i = 0; i < 5; i++) {
      const pt = this._mesh(new THREE.ConeGeometry(0.07, 0.28, 6), mat);
      const angle = (i / 5) * Math.PI * 2;
      pt.position.set(Math.cos(angle) * 0.22, 1.42, Math.sin(angle) * 0.22);
      g.add(pt);
    }
    const top = this._mesh(new THREE.SphereGeometry(0.09, 8, 8), acc);
    top.position.y = 1.56;
    g.add(top);
  }

  _buildKing(g, mat, acc) {
    g.add(this._mesh(new THREE.CylinderGeometry(0.36, 0.42, 0.1, 16), acc));
    const body = this._mesh(new THREE.CylinderGeometry(0.24, 0.35, 0.9, 16), mat);
    body.position.y = 0.55;
    g.add(body);
    const globe = this._mesh(new THREE.SphereGeometry(0.27, 14, 10), mat);
    globe.position.y = 1.08;
    g.add(globe);
    // Cross vertical
    const cv = this._mesh(new THREE.BoxGeometry(0.1, 0.45, 0.1), acc);
    cv.position.y = 1.5;
    g.add(cv);
    // Cross horizontal
    const ch = this._mesh(new THREE.BoxGeometry(0.35, 0.1, 0.1), acc);
    ch.position.y = 1.62;
    g.add(ch);
  }

  _mesh(geo, mat) {
    return new THREE.Mesh(geo, mat);
  }

  // ------------------------------------------------------------------ //
  //  Flip board
  // ------------------------------------------------------------------ //

  flip() {
    this.flipped = !this.flipped;
    // Reposition all squares and pieces
    for (const [sq, mesh] of Object.entries(this.squareMeshes)) {
      const file = sq.charCodeAt(0) - 97;
      const rank = 8 - parseInt(sq[1]);
      const { x, z } = this._squareToXZ(file, rank);
      mesh.position.set(x, 0, z);
    }
    for (const [sq, group] of Object.entries(this.pieceMeshes)) {
      const { x, z } = this._squareToWorld(sq);
      group.position.set(x, group.position.y, z);
    }
  }

  // ------------------------------------------------------------------ //
  //  Callbacks
  // ------------------------------------------------------------------ //

  onSelect(cb)  { this._onSelectCb  = cb; }
  onTarget(cb)  { this._onTargetCb  = cb; }

  // ------------------------------------------------------------------ //
  //  Render loop
  // ------------------------------------------------------------------ //

  _animate() {
    requestAnimationFrame(() => this._animate());
    if (this.controls) this.controls.update();
    this.renderer.render(this.scene, this.camera);
  }

  _onResize() {
    const el = this.canvas.parentElement;
    if (!el) return;
    const W = el.clientWidth;
    const H = el.clientHeight;
    this.camera.aspect = W / H;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(W, H);
  }
}
