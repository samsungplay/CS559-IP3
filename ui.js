// block_picker.js
/* jshint esversion: 11 */

import * as T from "./libs/threeJS/build/three.module.js";
import { atlasTexture, getBlockData } from "./block_factory.js";

// ---- Icon cube helpers: respect per-face UV rects like chunk mesher / held item ----
//this variable has been generated with the help of copilot
const ICON_FACES = [
  {
    key: "PX",
    n: [1, 0, 0],
    v: [
      [1, 0, 0],
      [1, 1, 0],
      [1, 1, 1],
      [1, 0, 1],
    ],
  },
  {
    key: "NX",
    n: [-1, 0, 0],
    v: [
      [0, 0, 1],
      [0, 1, 1],
      [0, 1, 0],
      [0, 0, 0],
    ],
  },
  {
    key: "PY",
    n: [0, 1, 0],
    v: [
      [0, 1, 1],
      [1, 1, 1],
      [1, 1, 0],
      [0, 1, 0],
    ],
  },
  {
    key: "NY",
    n: [0, -1, 0],
    v: [
      [0, 0, 0],
      [1, 0, 0],
      [1, 0, 1],
      [0, 0, 1],
    ],
  },
  {
    key: "PZ",
    n: [0, 0, 1],
    v: [
      [0, 0, 1],
      [1, 0, 1],
      [1, 1, 1],
      [0, 1, 1],
    ],
  },
  {
    key: "NZ",
    n: [0, 0, -1],
    v: [
      [1, 0, 0],
      [0, 0, 0],
      [0, 1, 0],
      [1, 1, 0],
    ],
  },
];
//this variable has been generated with the help of copilot
const ICON_UV_ORDER = {
  PX: (r) => [r.u1, r.v1, r.u1, r.v0, r.u0, r.v0, r.u0, r.v1],
  NX: (r) => [r.u0, r.v1, r.u0, r.v0, r.u1, r.v0, r.u1, r.v1],
  PY: (r) => [r.u0, r.v0, r.u1, r.v0, r.u1, r.v1, r.u0, r.v1],
  NY: (r) => [r.u0, r.v1, r.u1, r.v1, r.u1, r.v0, r.u0, r.v0],
  PZ: (r) => [r.u1, r.v1, r.u0, r.v1, r.u0, r.v0, r.u1, r.v0],
  NZ: (r) => [r.u0, r.v1, r.u1, r.v1, r.u1, r.v0, r.u0, r.v0],
};

//this function has been generated with the help of copilot
function iconRotUV4(uvArr, quarterTurns = 0) {
  let steps = ((quarterTurns % 4) + 4) % 4;
  while (steps--) {
    const u0 = uvArr[0],
      v0 = uvArr[1];
    uvArr[0] = uvArr[2];
    uvArr[1] = uvArr[3];
    uvArr[2] = uvArr[4];
    uvArr[3] = uvArr[5];
    uvArr[4] = uvArr[6];
    uvArr[5] = uvArr[7];
    uvArr[6] = u0;
    uvArr[7] = v0;
  }
  return uvArr;
}
//this function has been generated with the help of copilot
function makeIconCubeGeometry(bd) {
  const positions = [];
  const normals = [];
  const uvs = [];
  const colors = [];
  const indices = [];
  let vertCount = 0;

  for (const f of ICON_FACES) {
    const rect = bd.faces && bd.faces[f.key];
    if (!rect) continue;

    // 1) positions + normals in [0,1] cube
    for (let i = 0; i < 4; i++) {
      const vx = f.v[i][0];
      const vy = f.v[i][1];
      const vz = f.v[i][2];
      positions.push(vx, vy, vz);
      normals.push(f.n[0], f.n[1], f.n[2]);
    }

    // 2) UVs using same atlas rect logic as chunk mesher / held item
    let uv4 = ICON_UV_ORDER[f.key](rect);
    if (bd.rot && bd.rot[f.key]) {
      uv4 = iconRotUV4([...uv4], bd.rot[f.key]);
    }
    uvs.push(...uv4);

    // 3) vertex colors from tint
    let tint = bd.tints?.[f.key] ?? 0xffffff;

    if (window.prototype) {
      // Use the hashed ID color we generated in block_factory
      // Fallback to tint if protoColor is missing
      tint = bd.protoColor ?? tint;
    }
    const c = new T.Color(tint);
    for (let i = 0; i < 4; i++) {
      colors.push(c.r, c.g, c.b);
    }

    // 4) indices
    indices.push(
      vertCount + 0,
      vertCount + 1,
      vertCount + 2,
      vertCount + 0,
      vertCount + 2,
      vertCount + 3
    );
    vertCount += 4;
  }

  const geom = new T.BufferGeometry();
  geom.setAttribute("position", new T.Float32BufferAttribute(positions, 3));
  geom.setAttribute("normal", new T.Float32BufferAttribute(normals, 3));
  geom.setAttribute("uv", new T.Float32BufferAttribute(uvs, 2));
  geom.setAttribute("color", new T.Float32BufferAttribute(colors, 3));
  geom.setIndex(indices);

  // center cube at origin (was 0..1)
  geom.translate(-0.5, -0.5, -0.5);

  return geom;
}

//this class has been generated with the help of copilot
export class BlockPicker {
  /**
   * @param {T.WebGLRenderer} renderer
   * @param {number[]} blockIds
   * @param {(blockId:number)=>void} onSelect
   * @param {object} [opts]
   *   - domElement: HTMLCanvasElement to use for pointer lock (defaults to renderer.domElement)
   *   - iconsPerRow, rowsVisible
   *   - toggleKey (default "KeyB")
   *   - nextKey (default "BracketRight")
   *   - prevKey (default "BracketLeft")
   */
  constructor(renderer, blockIds, onSelect, opts = {}) {
    this.renderer = renderer;
    this.blockIds = blockIds || [];
    this.onSelect = onSelect || (() => {});
    this.visible = false;

    // DOM / key config
    this.domElement = opts.domElement || renderer.domElement;
    this.toggleKey = opts.toggleKey || "KeyB";
    this.nextKey = opts.nextKey || "BracketRight";
    this.prevKey = opts.prevKey || "BracketLeft";

    // layout options
    this.iconsPerRow = opts.iconsPerRow ?? 8;
    this.rowsVisible = opts.rowsVisible ?? 3;
    this.page = 0;

    // three.js UI scene
    this.uiScene = new T.Scene();

    const size = new T.Vector2();
    this.renderer.getSize(size);
    const aspect = size.x / size.y;
    const viewHeight = 2;
    const viewWidth = viewHeight * aspect;

    this.uiCamera = new T.OrthographicCamera(
      -viewWidth / 2,
      viewWidth / 2,
      viewHeight / 2,
      -viewHeight / 2,
      0.1,
      10
    );
    this.uiCamera.position.set(0, 0, 5);
    this.uiCamera.lookAt(0, 0, 0);

    this.iconGroup = new T.Group();
    this.uiScene.add(this.iconGroup);

    /** @type {Array<{blockId:number, group:T.Group, cell:T.Mesh, icon:T.Object3D}>} */
    this.items = [];

    this.raycaster = new T.Raycaster();
    this.mouse = new T.Vector2();
    this._hoverItem = null;

    this._cellGeom = new T.PlaneGeometry(1, 1);

    this._buildIcons();
    this._layoutIcons();

    // input wiring (mouse + keyboard)
    this._attachMouse(this.domElement);
    this._attachKeyboard();
  }

  // ---------------- public API ----------------

  /**
   * Call from outside when renderer size changes
   */
  handleResize(width, height) {
    const aspect = width / height;
    const viewHeight = 2;
    const viewWidth = viewHeight * aspect;

    this.uiCamera.left = -viewWidth / 2;
    this.uiCamera.right = viewWidth / 2;
    this.uiCamera.top = viewHeight / 2;
    this.uiCamera.bottom = -viewHeight / 2;
    this.uiCamera.updateProjectionMatrix();

    this._layoutIcons();
  }

  /**
   * Draw the picker overlay
   * (call after main world render + clearDepth)
   */
  render() {
    if (!this.visible) return;
    this.renderer.render(this.uiScene, this.uiCamera);
  }

  toggleVisible() {
    this.visible = !this.visible;
    this._applyPointerLockState();
    // when opening, reset hover so we don't have stale highlighting
    if (this.visible) this._clearHover();
  }

  nextPage() {
    const perPage = this._perPage();
    const maxPage = Math.max(0, Math.ceil(this.items.length / perPage) - 1);
    if (this.page < maxPage) {
      this.page++;
      this._layoutIcons();
    }
  }

  prevPage() {
    if (this.page > 0) {
      this.page--;
      this._layoutIcons();
    }
  }

  dispose() {
    // mouse
    if (this.domElement) {
      if (this._onMouseMove)
        this.domElement.removeEventListener("mousemove", this._onMouseMove);
      if (this._onClick)
        this.domElement.removeEventListener("click", this._onClick);
    }
    // keyboard
    if (this._onKeyDown) {
      window.removeEventListener("keydown", this._onKeyDown);
    }

    this.iconGroup.traverse((o) => {
      if (o.isMesh) {
        if (o.geometry) o.geometry.dispose();
        if (o.material) o.material.dispose();
      }
    });
    this._cellGeom.dispose();
  }

  // ---------------- internal: input wiring ----------------

  _attachMouse(canvas) {
    this._onMouseMove = (e) => {
      if (!this.visible) return;
      const rect = canvas.getBoundingClientRect();
      const x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      const y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      this.mouse.set(x, y);
      this._updateHover();
    };

    this._onClick = (e) => {
      if (!this.visible) return;
      this._handleClick();
    };

    canvas.addEventListener("mousemove", this._onMouseMove);
    canvas.addEventListener("click", this._onClick);
  }

  _attachKeyboard() {
    this._onKeyDown = (e) => {
      // toggle picker
      if (e.code === this.toggleKey) {
        this.toggleVisible();
        return;
      }

      // paging only when open
      if (!this.visible) return;

      if (e.code === this.nextKey) {
        this.nextPage();
      } else if (e.code === this.prevKey) {
        this.prevPage();
      }
    };

    window.addEventListener("keydown", this._onKeyDown);
  }

  _applyPointerLockState() {
    const canvas = this.domElement;
    if (!canvas) return;

    if (this.visible) {
      // release pointer lock & show cursor
      if (document.pointerLockElement === canvas) {
        document.exitPointerLock();
      }
      canvas.style.cursor = "default";
    } else {
      // re-capture pointer lock if you want that behavior
      if (document.pointerLockElement !== canvas) {
        canvas.requestPointerLock?.();
      }
      canvas.style.cursor = "none";
    }
  }

  // ---------------- internal: build & layout ----------------

  _perPage() {
    return this.iconsPerRow * this.rowsVisible;
  }

  _buildIcons() {
    // Clear any previous icons
    this.items.length = 0;
    this.iconGroup.clear();

    for (const blockId of this.blockIds) {
      // ✅ FAKE AIR SLOT
      if (blockId === null) {
        const group = new T.Group();

        // background cell
        const cellMat = new T.MeshBasicMaterial({
          color: 0xffffff,
          transparent: true,
          opacity: 0.18,
          toneMapped: false,
        });
        const cell = new T.Mesh(this._cellGeom, cellMat);
        group.add(cell);

        // simple visual: slashed circle (empty icon)
        const geo = new T.RingGeometry(0.25, 0.35, 24);
        const mat = new T.MeshBasicMaterial({ color: 0xff4444 });
        const ring = new T.Mesh(geo, mat);

        const slashGeo = new T.PlaneGeometry(0.5, 0.06);
        const slashMat = new T.MeshBasicMaterial({ color: 0xff4444 });
        const slash = new T.Mesh(slashGeo, slashMat);
        slash.rotation.z = Math.PI / 4;

        const icon = new T.Group();
        icon.add(ring, slash);

        group.add(icon);

        const item = { blockId: null, group, cell, icon };
        cell.userData.pickerItem = item;
        icon.userData.pickerItem = item;

        this.iconGroup.add(group);
        this.items.push(item);
        continue;
      }
      const bd = getBlockData(blockId);
      if (!bd) continue;

      const group = new T.Group();

      // --- background cell ---
      const cellMat = new T.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.18,
        toneMapped: false,
      });
      const cell = new T.Mesh(this._cellGeom, cellMat);
      group.add(cell);

      // --- icon object ---
      let icon;

      // 🌿 CROSS KIND (flowers, torches, etc.)
      if (bd.kind === "cross") {
        let baseMap = (bd.material && bd.material.map) || atlasTexture;

        // ---- Figure out tint color ----
        let tintHex = 0xffffff;

        if (window.prototype) {
          baseMap = null; // No Texture
          // Use the prototype color stored in registry, or default Green
          tintHex = bd.protoColor ?? 0x228b22;
        } else {
          // ... (Keep existing tint logic for Normal Mode) ...
          if (bd.tintColors !== undefined) {
            if (Array.isArray(bd.tintColors)) tintHex = bd.tintColors[0];
            else tintHex = bd.tintColors;
          } else if (bd.tintColor !== undefined) {
            tintHex = bd.tintColor;
          } else if (bd.material && bd.material.color) {
            tintHex = bd.material.color.getHex();
          }
        }

        const matA = new T.MeshBasicMaterial({
          map: baseMap,
          alphaTest: bd.material?.alphaTest ?? 0.5,
          transparent: true,
          toneMapped: false, // don't let tonemapping darken icons
          color: tintHex,
        });
        const matB = matA.clone();

        const a = new T.Mesh(bd.geometry, matA);
        const b = new T.Mesh(bd.geometry, matB);
        b.rotation.y = Math.PI / 2;

        icon = new T.Group();
        icon.add(a, b);

        // (optional) tiny tilt so it isn't perfectly flat to camera
        // icon.rotation.y = Math.PI / 8;
      }

      // 🧱 SOLID KIND (full cubes) – use atlas UVs per face
      else {
        const geom = makeIconCubeGeometry(bd);
        const mat = new T.MeshBasicMaterial({
          map: window.prototype ? null : atlasTexture, // No texture in proto mode
          vertexColors: true, // This allows the Geom colors to show through
          transparent: true,
          alphaTest: 0.5,
          toneMapped: false,
        });

        icon = new T.Mesh(geom, mat);

        // Nice Minecraft-ish 3D angle
        icon.rotation.y = Math.PI / 4;
        icon.rotation.x = Math.PI / 5;
      }

      icon.position.set(0, 0, 0.05);
      group.add(icon);

      const item = { blockId, group, cell, icon };
      cell.userData.pickerItem = item;
      icon.userData.pickerItem = item;

      this.iconGroup.add(group);
      this.items.push(item);
    }
  }

  _layoutIcons() {
    const perPage = this._perPage();
    const total = this.items.length;
    const startIndex = this.page * perPage;
    const endIndex = Math.min(startIndex + perPage, total);
    const numOnPage = Math.max(0, endIndex - startIndex);

    const viewWidth = this.uiCamera.right - this.uiCamera.left;
    const viewHeight = this.uiCamera.top - this.uiCamera.bottom;

    const cols = this.iconsPerRow;
    const rows = this.rowsVisible;

    const cellW = viewWidth / (cols + 1);
    const cellH = viewHeight / (rows + 3);

    const usedRows = Math.ceil(numOnPage / cols) || 1;

    const startX = -((cols - 1) * cellW) / 2;
    const startY = ((usedRows - 1) * cellH) / 2;

    this.items.forEach((it) => {
      it.group.visible = false;
    });

    for (let i = 0; i < numOnPage; i++) {
      const item = this.items[startIndex + i];
      const row = Math.floor(i / cols);
      const col = i % cols;

      const x = startX + col * cellW;
      const y = startY - row * cellH;

      item.group.visible = true;
      item.group.position.set(x, y, 0);

      const cellScaleX = cellW * 0.9;
      const cellScaleY = cellH * 0.9;
      item.cell.scale.set(cellScaleX, cellScaleY, 1);

      const iconScale = Math.min(cellW, cellH) * 0.55;
      item.icon.scale.set(iconScale, iconScale, iconScale);
    }

    this._clearHover();
  }

  // ---------------- internal: hover + click ----------------

  _updateHover() {
    const cells = [];
    for (const item of this.items) {
      if (item.group.visible) cells.push(item.cell);
    }
    if (!cells.length) {
      this._clearHover();
      return;
    }

    this.raycaster.setFromCamera(this.mouse, this.uiCamera);
    const intersects = this.raycaster.intersectObjects(cells, false);

    let newHover = null;
    if (intersects.length > 0) {
      const obj = intersects[0].object;
      newHover = obj.userData.pickerItem || null;
    }

    if (newHover === this._hoverItem) return;

    if (this._hoverItem) {
      const mat = this._hoverItem.cell.material;
      mat.color.setHex(0xffffff);
      mat.opacity = 0.18;
    }

    this._hoverItem = newHover;

    if (this._hoverItem) {
      const mat = this._hoverItem.cell.material;
      mat.color.setHex(0x000000);
      mat.opacity = 0.35;
    }
  }

  _clearHover() {
    if (!this._hoverItem) return;
    const mat = this._hoverItem.cell.material;
    mat.color.setHex(0xffffff);
    mat.opacity = 0.18;
    this._hoverItem = null;
  }

  _handleClick() {
    if (!this._hoverItem) return;
    const id = this._hoverItem.blockId;
    this.onSelect(id);
    this.visible = false;
  }
}
