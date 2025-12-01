import * as T from "../libs/threeJS/build/three.module.js";

const _BLOCK_DATA = new Map();

//this function has been generated with the help of copilot
export function getBlockData(id) {
  return _BLOCK_DATA.get(id) ?? null;
}
//this function has been generated with the help of copilot
export function registerBlock(id, data) {
  _BLOCK_DATA.set(id, data);
}

// Atlas setup
const ATLAS_SIZE = 256,
  TILE = 16,
  S = TILE / ATLAS_SIZE,
  HALF = 0.5 / ATLAS_SIZE;
export let atlasTexture = null;

//this function has been generated with the help of copilot
export function initAtlas(texture) {
  // ⭐ PATCH: Safety check
  if (!texture) return;

  atlasTexture = texture;
  texture.magFilter = T.NearestFilter;
  texture.minFilter = T.NearestFilter;
}

//this function has been generated with the help of copilot
function tileRect(col, row) {
  const u0 = col * S + HALF,
    v0 = 1 - (row + 1) * S + HALF,
    u1 = (col + 1) * S - HALF,
    v1 = 1 - row * S - HALF;
  return { u0, v0, u1, v1 };
}

//this function has been generated with the help of copilot
// ⭐ PATCH: Helper to generate distinct colors for prototype mode
function getProtoColor(id, overrideTint) {
  if (overrideTint && overrideTint !== 0xffffff) return overrideTint;
  // Hash the ID to get a consistent color so Dirt != Stone
  const r = (id * 153) % 255;
  const g = (id * 211) % 255;
  const b = (id * 79) % 255;
  return (r << 16) | (g << 8) | b;
}

//this function has been generated with the help of copilot
export function registerSolid(id, coords, opts = {}) {
  // ⭐ PATCH: Material switching
  let mat;
  if (window.prototype) {
    mat = new T.MeshBasicMaterial({ vertexColors: true, side: T.FrontSide });
  } else {
    mat = new T.MeshLambertMaterial({
      map: atlasTexture,
      transparent: true,
      side: T.FrontSide,
      vertexColors: true,
    });
  }

  // ... (keep faces/rects logic mostly same, though rects unused in prototype)
  const faces = {
    PX: coords.east ?? coords,
    NX: coords.west ?? coords,
    PY: coords.top ?? coords,
    NY: coords.bottom ?? coords,
    PZ: coords.south ?? coords,
    NZ: coords.north ?? coords,
  };
  const rects = {};
  for (const [dir, c] of Object.entries(faces))
    rects[dir] = tileRect(c.col, c.row);

  const rotations = {
    /* ... keep existing rotation logic ... */ PX: opts.rotations?.east ?? 0,
    NX: opts.rotations?.west ?? 0,
    PY: opts.rotations?.top ?? 0,
    NY: opts.rotations?.bottom ?? 0,
    PZ: opts.rotations?.south ?? 0,
    NZ: opts.rotations?.north ?? 0,
  };

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
    // ⭐ PATCH: Store a prototype color
    protoColor: getProtoColor(id, opts.tintColors?.top ?? opts.tintColors),
  });
}
//this function has been generated with the help of copilot
export function registerCross(id, coord, opts = {}, size = 1) {
  const { u0, v0, u1, v1 } = tileRect(coord.col, coord.row);
  const geo = new T.PlaneGeometry(size, size);

  // Keep UV logic valid (even if unused in prototype)
  const uAttr = geo.getAttribute("uv");
  for (let i = 0; i < uAttr.count; i++) {
    const u = uAttr.getX(i),
      v = uAttr.getY(i);
    uAttr.setXY(i, u0 + (u1 - u0) * u, v0 + (v1 - v0) * v);
  }
  uAttr.needsUpdate = true;

  geo.translate(0, size * 0.5, 0);

  // ⭐ PATCH: Explicit Material for Prototype Mode
  let mat;
  if (window.prototype) {
    // Use a Basic Material with NO MAP.
    mat = new T.MeshBasicMaterial({
      color: getProtoColor(id, opts.tintColors?.top ?? opts.tintColors),
      side: T.DoubleSide,
    });
  } else {
    mat = new T.MeshLambertMaterial({
      map: atlasTexture,
      color: opts.tintColors ?? "white",
      alphaTest: 0.5,
      side: T.DoubleSide,
      depthWrite: true,
    });
  }

  registerBlock(id, {
    ...opts,
    kind: "cross",
    geometry: geo,
    material: mat,
    size,
    occludesFaces: opts.occludesFaces ?? false,
    protoColor: getProtoColor(id, opts.tintColors?.top ?? opts.tintColors),
  });
}
