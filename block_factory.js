import * as T from "../libs/threeJS/build/three.module.js";

// block data goes here (maps id => block data)
const _BLOCK_DATA = new Map();

//this function has been generated with the help of copilot
/** Query block data by enum ID */
export function getBlockData(id) {
  return _BLOCK_DATA.get(id) ?? null;
}

//this function has been generated with the help of copilot
/** Register block data (solid/cross) */
export function registerBlock(id, data) {
  _BLOCK_DATA.set(id, data);
}

/* ============================================================
   Atlas / Material setup (this section of code has been generated with the help of copilot)
   ============================================================ */
const ATLAS_SIZE = 256,
  TILE = 16,
  S = TILE / ATLAS_SIZE,
  HALF = 0.5 / ATLAS_SIZE;
export let atlasTexture = null;

export function initAtlas(texture) {
  atlasTexture = texture;
  texture.magFilter = T.NearestFilter;
  texture.minFilter = T.NearestFilter;
}

/* ============================================================
   Helpers (this section of code has been generated with the help of copilot)
   ============================================================ */
function tileRect(col, row) {
  const u0 = col * S + HALF,
    v0 = 1 - (row + 1) * S + HALF,
    u1 = (col + 1) * S - HALF,
    v1 = 1 - row * S - HALF;
  return { u0, v0, u1, v1 };
}

/* ============================================================
   Registration Helpers (this section of code has been generated with the help of copilot)
   ============================================================ */

/**
 * Registers a solid cube block (precomputes per-face data).
 * @param {number} id - Enum from BLOCK
 * @param {Object} coords - {top,bottom,north,south,east,west} or {col,row}
 * @param {Object} opts - misc options for this block
 */
export function registerSolid(id, coords, opts = {}) {
  const mat = new T.MeshLambertMaterial({
    map: atlasTexture,
    transparent: true,
    side: T.FrontSide,
    vertexColors: true, // enable tinting support
  });

  const faces = {
    PX: coords.east ?? coords,
    NX: coords.west ?? coords,
    PY: coords.top ?? coords,
    NY: coords.bottom ?? coords,
    PZ: coords.south ?? coords,
    NZ: coords.north ?? coords,
  };

  const rects = {};
  for (const [dir, c] of Object.entries(faces)) {
    rects[dir] = tileRect(c.col, c.row);
  }

  // Optional texture rotation per face
  const rotations = {
    PX: opts.rotations?.east ?? 0,
    NX: opts.rotations?.west ?? 0,
    PY: opts.rotations?.top ?? 0,
    NY: opts.rotations?.bottom ?? 0,
    PZ: opts.rotations?.south ?? 0,
    NZ: opts.rotations?.north ?? 0,
  };

  // Optional per-face tints (default: white = no tint)
  const tintColors = {
    PX: opts.tintColors?.east ?? opts.tintColors ?? 0xffffff,
    NX: opts.tintColors?.west ?? opts.tintColors ?? 0xffffff,
    PY: opts.tintColors?.top ?? opts.tintColors ?? 0xffffff,
    NY: opts.tintColors?.bottom ?? opts.tintColors ?? 0xffffff,
    PZ: opts.tintColors?.south ?? opts.tintColors ?? 0xffffff,
    NZ: opts.tintColors?.north ?? opts.tintColors ?? 0xffffff,
  };

  registerBlock(id, {
    ...opts,
    kind: "solid",
    faces: rects,
    tints: tintColors,
    rot: rotations,
    material: mat,
    occludesFaces: opts.occludesFaces ?? true,
  });
}

/**
 * Registers a cross-plane (X-shaped) decorative block.
 * @param {number} id - Enum from BLOCK
 * @param {{col:number,row:number}} coord - atlas tile
 * @param {number} [size=1]
 * @param {Object} opts - misc options for this block
 */
export function registerCross(id, coord, opts = {}, size = 1) {
  const { u0, v0, u1, v1 } = tileRect(coord.col, coord.row);
  const geo = new T.PlaneGeometry(size, size);

  const uAttr = geo.getAttribute("uv");
  for (let i = 0; i < uAttr.count; i++) {
    const u = uAttr.getX(i),
      v = uAttr.getY(i);
    uAttr.setXY(i, u0 + (u1 - u0) * u, v0 + (v1 - v0) * v);
  }
  uAttr.needsUpdate = true;

  // ⭐️ Move plane so its bottom edge is at y=0 (pivot at bottom-center)
  geo.translate(0, size * 0.5, 0);

  const mat = new T.MeshLambertMaterial({
    map: atlasTexture,
    color: opts.tintColors ?? "white",
    alphaTest: 0.5, // helps with cutout sprites
    side: T.DoubleSide,
    depthWrite: true, // or false if you see sorting issues with many sprites
  });

  registerBlock(id, {
    ...opts,
    kind: "cross",
    geometry: geo,
    material: mat,
    size,
    occludesFaces: opts.occludesFaces ?? false,
  });
}
