// structures.js
import { BLOCK } from "./block_registry.js";
import { CHUNK_SIZE, Y_MIN, Y_MAX } from "./voxel_engine.js";

/* ========================= Pending Block System ========================= */
//this class has been generated with the help of copilot
export class PendingBlocks {
  constructor() {
    this.map = new Map(); // key `${cx},${cz}` -> {blocks:[{lx,y,lz,id}], metas:[{lx,y,lz,val}]}
  }
  clear() {
    this.map.clear();
  }
  _key(cx, cz) {
    return `${cx},${cz}`;
  }
  _bucket(cx, cz) {
    const k = this._key(cx, cz);
    let b = this.map.get(k);
    if (!b) {
      b = { blocks: [], metas: [] };
      this.map.set(k, b);
    }
    return b;
  }
  addBlock(cx, cz, lx, y, lz, id) {
    this._bucket(cx, cz).blocks.push({ lx, y, lz, id });
  }
  addMeta(cx, cz, lx, y, lz, val) {
    this._bucket(cx, cz).metas.push({ lx, y, lz, val });
  }
  flushForChunk(chunk) {
    // inside flushForChunk

    const k = this._key(chunk.chunkX, chunk.chunkZ);
    const b = this.map.get(k);
    if (!b) return;
    for (const w of b.blocks) {
      if (w.y < Y_MIN || w.y > Y_MAX) continue;
      chunk.setBlock(w.lx, w.y, w.lz, w.id);
    }
    if (chunk.setMeta) {
      for (const m of b.metas) {
        if (m.y < Y_MIN || m.y > Y_MAX) continue;
        chunk.setMeta(m.lx, m.y, m.lz, m.val);
      }
    }
    this.map.delete(k);
  }
}

//this function has been generated with the help of copilot
export function makeBlockWriter(chunk, pending, voxelWorld = null) {
  const baseCx = chunk.chunkX,
    baseCz = chunk.chunkZ;

  function worldToLocal(wx, wz) {
    const cx = Math.floor(wx / CHUNK_SIZE);
    const cz = Math.floor(wz / CHUNK_SIZE);
    const lx = wx - cx * CHUNK_SIZE;
    const lz = wz - cz * CHUNK_SIZE;
    return { cx, cz, lx, lz };
  }

  function setBlock(wx, wy, wz, id) {
    if (wy < Y_MIN || wy > Y_MAX) return;
    const { cx, cz, lx, lz } = worldToLocal(wx, wz);

    // 1) Inside this chunk → direct write
    if (
      cx === baseCx &&
      cz === baseCz &&
      lx >= 0 &&
      lx < CHUNK_SIZE &&
      lz >= 0 &&
      lz < CHUNK_SIZE
    ) {
      chunk.setBlock(lx, wy, lz, id);
      return;
    }

    // 2) Neighbor chunk exists → direct write to neighbor
    if (voxelWorld) {
      const neighbor = voxelWorld.getChunk(cx, cz);
      if (
        neighbor &&
        lx >= 0 &&
        lx < CHUNK_SIZE &&
        lz >= 0 &&
        lz < CHUNK_SIZE
      ) {
        neighbor.setBlock(lx, wy, lz, id);
        return;
      }
    }

    // 3) Neighbor not generated yet → queue in pending
    pending.addBlock(cx, cz, lx, wy, lz, id);
  }

  function setMeta(wx, wy, wz, val) {
    if (wy < Y_MIN || wy > Y_MAX) return;
    const { cx, cz, lx, lz } = worldToLocal(wx, wz);

    if (
      cx === baseCx &&
      cz === baseCz &&
      chunk.setMeta &&
      lx >= 0 &&
      lx < CHUNK_SIZE &&
      lz >= 0 &&
      lz < CHUNK_SIZE
    ) {
      chunk.setMeta(lx, wy, lz, val);
      return;
    }

    if (voxelWorld) {
      const neighbor = voxelWorld.getChunk(cx, cz);
      if (
        neighbor &&
        neighbor.setMeta &&
        lx >= 0 &&
        lx < CHUNK_SIZE &&
        lz >= 0 &&
        lz < CHUNK_SIZE
      ) {
        neighbor.setMeta(lx, wy, lz, val);
        return;
      }
    }

    pending.addMeta(cx, cz, lx, wy, lz, val);
  }

  return { chunk, pending, setBlock, setMeta, chunkX: baseCx, chunkZ: baseCz };
}

//this function has been generated with the help of copilot
export function flushPendingForChunk(pending, chunk) {
  pending.flushForChunk(chunk);
}

/* ========================= Local helpers (world-coords) ========================= */
//this function has been generated with the help of copilot
function rot2d(lx, lz, rot) {
  const r = rot & 3;
  if (r === 0) return [lx, lz];
  if (r === 1) return [-lz, lx];
  if (r === 2) return [-lx, -lz];
  return [lz, -lx];
}
//this function has been generated with the help of copilot
function worldAt(wx, wy, wz, lx, ly, lz, rot) {
  const [dx, dz] = rot2d(lx, lz, rot);
  return [wx + dx, wy + ly, wz + dz];
}
//this function has been generated with the help of copilot
function setIf(writer, x, y, z, id) {
  writer.setBlock(x, y, z, id);
}
//this function has been generated with the help of copilot
function fillLocal(writer, wx, wy, wz, rot, lx0, ly0, lz0, lx1, ly1, lz1, id) {
  const ax = Math.min(lx0, lx1),
    bx = Math.max(lx0, lx1);
  const ay = Math.min(ly0, ly1),
    by = Math.max(ly0, ly1);
  const az = Math.min(lz0, lz1),
    bz = Math.max(lz0, lz1);
  for (let ly = ay; ly <= by; ly++)
    for (let lz = az; lz <= bz; lz++)
      for (let lx = ax; lx <= bx; lx++) {
        const [x2, y2, z2] = worldAt(wx, wy, wz, lx, ly, lz, rot);
        setIf(writer, x2, y2, z2, id);
      }
}
//this function has been generated with the help of copilot
function boxHollow(writer, wx, wy, wz, rot, w, h, d, wall, airInside = true) {
  // foundation cap, roof cap
  fillLocal(writer, wx, wy, wz, rot, 0, 0, 0, w - 1, 0, d - 1, wall);
  fillLocal(writer, wx, wy, wz, rot, 0, h - 1, 0, w - 1, h - 1, d - 1, wall);
  // walls + corner thickening
  for (let ly = 1; ly <= h - 2; ly++) {
    fillLocal(writer, wx, wy, wz, rot, 0, ly, 0, w - 1, ly, 0, wall);
    fillLocal(writer, wx, wy, wz, rot, 0, ly, d - 1, w - 1, ly, d - 1, wall);
    fillLocal(writer, wx, wy, wz, rot, 0, ly, 0, 0, ly, d - 1, wall);
    fillLocal(writer, wx, wy, wz, rot, w - 1, ly, 0, w - 1, ly, d - 1, wall);
  }
  if (airInside)
    fillLocal(writer, wx, wy, wz, rot, 1, 1, 1, w - 2, h - 2, d - 2, BLOCK.AIR);
}

//this function has been generated with the help of copilot
function slopeRoofGable(writer, wx, wy, wz, rot, w, d, baseY, layers, mat) {
  const maxLayers = Math.min(layers, Math.ceil((w + 1) / 2));
  for (let i = 0; i < maxLayers; i++) {
    const y = baseY + i;
    const x0 = -1 + i; // left overhang shrinks as we go up
    const x1 = w - i; // right overhang (symmetric)  ✅
    fillLocal(writer, wx, wy, wz, rot, x0, y, -1, x1, y, d, mat);
  }

  // ridge cap (same as before)
  const ridgeY = baseY + maxLayers;
  const rx = Math.floor((w - 1) / 2);
  if (w % 2) {
    fillLocal(writer, wx, wy, wz, rot, rx, ridgeY, -1, rx, ridgeY, d, mat);
  } else {
    fillLocal(writer, wx, wy, wz, rot, rx, ridgeY, -1, rx, ridgeY, d, mat);
    fillLocal(
      writer,
      wx,
      wy,
      wz,
      rot,
      rx + 1,
      ridgeY,
      -1,
      rx + 1,
      ridgeY,
      d,
      mat
    );
  }
}
//this function has been generated with the help of copilot
function carveDoor(writer, wx, wy, wz, rot, lx, lz, height = 2) {
  for (let i = 0; i < height; i++) {
    const [dx, dy, dz] = worldAt(wx, wy, wz, lx, 1 + i, lz, rot);
    setIf(writer, dx, dy, dz, BLOCK.AIR);
  }
}
//this function has been generated with the help of copilot
function placeWindow(writer, wx, wy, wz, rot, lx, lz, h = 2) {
  for (let i = 0; i < h; i++) {
    const [dx, dy, dz] = worldAt(wx, wy, wz, lx, 2 + i, lz, rot);
    setIf(writer, dx, dy, dz, BLOCK.GLASS);
  }
}
//this function has been generated with the help of copilot
function placeTorchFloor(writer, wx, wy, wz, rot, lx, lz) {
  const [dx, dy, dz] = worldAt(wx, wy, wz, lx, 1, lz, rot);
  setIf(writer, dx, dy, dz, BLOCK.TORCH);
  if (writer.setMeta) writer.setMeta(dx, dy, dz, 0);
}
//this function has been generated with the help of copilot
function bboxFromLocal(wx, wy, wz, rot, w, h, d) {
  const corners = [
    [0, 0, 0],
    [w - 1, 0, 0],
    [0, 0, d - 1],
    [w - 1, 0, d - 1],
    [0, h - 1, 0],
    [w - 1, h - 1, 0],
    [0, h - 1, d - 1],
    [w - 1, h - 1, d - 1],
  ];
  let x0 = Infinity,
    x1 = -Infinity,
    y0 = Infinity,
    y1 = -Infinity,
    z0 = Infinity,
    z1 = -Infinity;
  for (const [lx, ly, lz] of corners) {
    const [x2, y2, z2] = worldAt(wx, wy, wz, lx, ly, lz, rot);
    x0 = Math.min(x0, x2);
    x1 = Math.max(x1, x2);
    y0 = Math.min(y0, y2);
    y1 = Math.max(y1, y2);
    z0 = Math.min(z0, z2);
    z1 = Math.max(z1, z2);
  }
  return { x0, x1, y0, y1, z0, z1 };
}

/* ========================= Building Templates ========================= */
/* ---- 1) Small House (5×7, cozier proportions, porch & chimney) ---- */
//this function has been generated with the help of copilot
export function placeSmallHouse(writer, wx, wy, wz, rot = 0) {
  const W = 5,
    D = 7,
    H = 5;
  fillLocal(writer, wx, wy, wz, rot, -2, 0, -2, W + 1, H + 5, D + 2, BLOCK.AIR);

  // cobble foundation + plank walls, log corners
  fillLocal(
    writer,
    wx,
    wy,
    wz,
    rot,
    0,
    0,
    0,
    W - 1,
    0,
    D - 1,
    BLOCK.COBBLESTONE
  );
  boxHollow(writer, wx, wy, wz, rot, W, H, D, BLOCK.PLANKS);
  for (const [cx, cz] of [
    [0, 0],
    [W - 1, 0],
    [0, D - 1],
    [W - 1, D - 1],
  ]) {
    fillLocal(writer, wx, wy, wz, rot, cx, 1, cz, cx, H - 1, cz, BLOCK.WOOD);
  }

  // door & porch step
  carveDoor(writer, wx, wy, wz, rot, 2, 0, 2);
  fillLocal(writer, wx, wy, wz, rot, 2, 0, -1, 2, 0, -2, BLOCK.GRAVEL);

  // windows
  placeWindow(writer, wx, wy, wz, rot, 0, 3);
  placeWindow(writer, wx, wy, wz, rot, W - 1, 3);
  placeWindow(writer, wx, wy, wz, rot, 2, D - 1);

  // roof + ridge
  slopeRoofGable(writer, wx, wy, wz, rot, W, D, H - 1, 2, BLOCK.PLANKS);

  // interior floor & lighting, tiny bed
  fillLocal(writer, wx, wy, wz, rot, 1, 0, 1, W - 2, 0, D - 2, BLOCK.PLANKS);
  placeTorchFloor(writer, wx, wy, wz, rot, 1, 1);
  fillLocal(
    writer,
    wx,
    wy,
    wz,
    rot,
    1,
    1,
    D - 3,
    2,
    1,
    D - 3,
    BLOCK.WHITE_WOOL
  );

  // chimney (cobble) back-right corner
  const [chx, chy, chz] = worldAt(wx, wy, wz, W - 2, 1, D - 2, rot);
  for (let i = 0; i < 5; i++)
    setIf(writer, chx, chy + i, chz, BLOCK.COBBLESTONE);
  setIf(writer, chx, chy + 5, chz, BLOCK.GLOWSTONE);

  const entrance = worldAt(wx, wy, wz, 2, 1, -1, rot);
  return {
    type: "small_house",
    entrance: { x: entrance[0], y: entrance[1], z: entrance[2] },
    bbox: bboxFromLocal(wx, wy, wz, rot, W, H + 4, D),
  };
}

/* ---- 2) Large House (7×11, two rooms, deeper roof, porch) ---- */
//this function has been generated with the help of copilot
export function placeLargeHouse(writer, wx, wy, wz, rot = 0) {
  const W = 7,
    D = 11,
    H = 6;
  fillLocal(writer, wx, wy, wz, rot, -2, 0, -3, W + 2, H + 6, D + 3, BLOCK.AIR);

  fillLocal(
    writer,
    wx,
    wy,
    wz,
    rot,
    0,
    0,
    0,
    W - 1,
    0,
    D - 1,
    BLOCK.COBBLESTONE
  );
  boxHollow(writer, wx, wy, wz, rot, W, H, D, BLOCK.PLANKS);
  for (const [cx, cz] of [
    [0, 0],
    [W - 1, 0],
    [0, D - 1],
    [W - 1, D - 1],
  ]) {
    fillLocal(writer, wx, wy, wz, rot, cx, 1, cz, cx, H - 1, cz, BLOCK.WOOD);
  }

  // double door + porch
  const midW = Math.floor(W / 2);
  carveDoor(writer, wx, wy, wz, rot, midW - 1, 0, 2);
  carveDoor(writer, wx, wy, wz, rot, midW, 0, 2);
  fillLocal(
    writer,
    wx,
    wy,
    wz,
    rot,
    midW - 1,
    0,
    -1,
    midW,
    0,
    -3,
    BLOCK.GRAVEL
  );

  // interior: floor + partition
  fillLocal(writer, wx, wy, wz, rot, 1, 0, 1, W - 2, 0, D - 2, BLOCK.PLANKS);
  const midD = Math.floor(D / 2);
  for (let lx = 1; lx <= W - 2; lx++)
    for (let ly = 1; ly <= 3; ly++) {
      const [dx, dy, dz] = worldAt(wx, wy, wz, lx, ly, midD, rot);
      setIf(writer, dx, dy, dz, BLOCK.PLANKS);
    }
  carveDoor(writer, wx, wy, wz, rot, midW, midD, 2);

  // windows
  for (const zz of [2, D - 3]) {
    placeWindow(writer, wx, wy, wz, rot, 0, zz);
    placeWindow(writer, wx, wy, wz, rot, W - 1, zz);
  }
  placeWindow(writer, wx, wy, wz, rot, midW, D - 1);

  // taller roof
  slopeRoofGable(writer, wx, wy, wz, rot, W, D, H - 1, 3, BLOCK.PLANKS);
  placeTorchFloor(writer, wx, wy, wz, rot, 1, 1);
  placeTorchFloor(writer, wx, wy, wz, rot, W - 2, D - 2);

  // chimney
  const [cx, cy, cz] = worldAt(wx, wy, wz, 1, 1, D - 2, rot);
  for (let i = 0; i < H + 3; i++)
    setIf(writer, cx, cy + i, cz, BLOCK.COBBLESTONE);
  setIf(writer, cx, cy + H + 3, cz, BLOCK.GLOWSTONE);

  const entrance = worldAt(wx, wy, wz, midW, 1, -1, rot);
  return {
    type: "large_house",
    entrance: { x: entrance[0], y: entrance[1], z: entrance[2] },
    bbox: bboxFromLocal(wx, wy, wz, rot, W, H + 5, D),
  };
}

/* ---- 3) Farm Plot (9×9, cross irrigation, border & scarecrow) ---- */
//this function has been generated with the help of copilot
export function placeFarmPlot(writer, wx, wy, wz, rot = 0) {
  const S = 9;
  // flatten & clear
  fillLocal(writer, wx, wy, wz, rot, 0, 0, 0, S - 1, 0, S - 1, BLOCK.DIRT);
  fillLocal(writer, wx, wy, wz, rot, -1, 1, -1, S, 3, S, BLOCK.AIR);

  // border rim
  fillLocal(writer, wx, wy, wz, rot, 0, 1, 0, S - 1, 1, 0, BLOCK.PLANKS);
  fillLocal(
    writer,
    wx,
    wy,
    wz,
    rot,
    0,
    1,
    S - 1,
    S - 1,
    1,
    S - 1,
    BLOCK.PLANKS
  );
  fillLocal(writer, wx, wy, wz, rot, 0, 1, 0, 0, 1, S - 1, BLOCK.PLANKS);
  fillLocal(
    writer,
    wx,
    wy,
    wz,
    rot,
    S - 1,
    1,
    0,
    S - 1,
    1,
    S - 1,
    BLOCK.PLANKS
  );
  for (const [cx, cz] of [
    [0, 0],
    [S - 1, 0],
    [0, S - 1],
    [S - 1, S - 1],
  ]) {
    fillLocal(writer, wx, wy, wz, rot, cx, 1, cz, cx, 3, cz, BLOCK.WOOD);
  }

  // cross irrigation
  const mid = Math.floor(S / 2);
  fillLocal(writer, wx, wy, wz, rot, mid, 0, 1, mid, 0, S - 2, BLOCK.WATER);
  fillLocal(writer, wx, wy, wz, rot, 1, 0, mid, S - 2, 0, mid, BLOCK.WATER);

  // "crops"
  for (let lz = 1; lz <= S - 2; lz++)
    for (const lx of [2, 3, 5, 6]) {
      if (lx === mid || lz === mid) continue;
      const [dx, dy, dz] = worldAt(wx, wy, wz, lx, 1, lz, rot);
      const id = (lx + lz) & 1 ? BLOCK.ROSE : BLOCK.DANDELION;
      setIf(writer, dx, dy, dz, id);
    }

  // scarecrow
  const [sx, sy, sz] = worldAt(wx, wy, wz, 1, 1, mid, rot);
  setIf(writer, sx, sy, sz, BLOCK.WOOD);
  setIf(writer, sx, sy + 1, sz, BLOCK.WOOD);
  setIf(writer, sx, sy + 2, sz, BLOCK.WHITE_WOOL);

  const entrance = worldAt(wx, wy, wz, mid, 0, -1, rot);
  return {
    type: "farm",
    entrance: { x: entrance[0], y: wy, z: entrance[2] },
    bbox: bboxFromLocal(wx, wy, wz, rot, S, 4, S),
  };
}

/* ---- 4) Village Well (5×5, thicker lip, lantern) ---- */
//this function has been generated with the help of copilot
export function placeWell(writer, wx, wy, wz, rot = 0) {
  const S = 5,
    H = 5;
  fillLocal(writer, wx, wy, wz, rot, -1, 0, -1, S + 1, H + 2, S + 1, BLOCK.AIR);

  // base + lip
  fillLocal(
    writer,
    wx,
    wy,
    wz,
    rot,
    0,
    0,
    0,
    S - 1,
    0,
    S - 1,
    BLOCK.COBBLESTONE
  );
  fillLocal(writer, wx, wy, wz, rot, 0, 1, 0, S - 1, 1, 0, BLOCK.COBBLESTONE);
  fillLocal(
    writer,
    wx,
    wy,
    wz,
    rot,
    0,
    1,
    S - 1,
    S - 1,
    1,
    S - 1,
    BLOCK.COBBLESTONE
  );
  fillLocal(writer, wx, wy, wz, rot, 0, 1, 0, 0, 1, S - 1, BLOCK.COBBLESTONE);
  fillLocal(
    writer,
    wx,
    wy,
    wz,
    rot,
    S - 1,
    1,
    0,
    S - 1,
    1,
    S - 1,
    BLOCK.COBBLESTONE
  );

  // water
  fillLocal(writer, wx, wy, wz, rot, 1, 0, 1, S - 2, 0, S - 2, BLOCK.WATER);

  // posts + roof + glow
  for (const [px, pz] of [
    [1, 1],
    [S - 2, 1],
    [1, S - 2],
    [S - 2, S - 2],
  ]) {
    fillLocal(writer, wx, wy, wz, rot, px, 1, pz, px, H - 1, pz, BLOCK.WOOD);
  }
  fillLocal(writer, wx, wy, wz, rot, 0, H, 0, S - 1, H, S - 1, BLOCK.PLANKS);
  const [gx, gy, gz] = worldAt(
    wx,
    wy,
    wz,
    Math.floor(S / 2),
    H - 1,
    Math.floor(S / 2),
    rot
  );
  setIf(writer, gx, gy, gz, BLOCK.GLOWSTONE);

  // apron
  fillLocal(
    writer,
    wx,
    wy,
    wz,
    rot,
    Math.floor(S / 2),
    0,
    -1,
    Math.floor(S / 2),
    0,
    -2,
    BLOCK.GRAVEL
  );

  const ent = worldAt(wx, wy, wz, Math.floor(S / 2), 0, -1, rot);
  return {
    type: "well",
    entrance: { x: ent[0], y: wy, z: ent[2] },
    bbox: bboxFromLocal(wx, wy, wz, rot, S, H + 1, S),
  };
}

/* ---- 5) Blacksmith (7×7, cleaner forge & canopy) ---- */
//this function has been generated with the help of copilot
export function placeBlacksmith(writer, wx, wy, wz, rot = 0) {
  const W = 7,
    D = 7,
    H = 5;
  fillLocal(writer, wx, wy, wz, rot, -2, 0, -2, W + 2, H + 4, D + 2, BLOCK.AIR);

  // yard
  fillLocal(
    writer,
    wx,
    wy,
    wz,
    rot,
    0,
    0,
    0,
    W - 1,
    0,
    D - 1,
    BLOCK.COBBLESTONE
  );

  // posts + half roof
  for (const [px, pz] of [
    [0, 0],
    [W - 1, 0],
    [0, Math.floor(D / 2)],
    [W - 1, Math.floor(D / 2)],
  ]) {
    fillLocal(writer, wx, wy, wz, rot, px, 1, pz, px, H, pz, BLOCK.WOOD);
  }
  fillLocal(
    writer,
    wx,
    wy,
    wz,
    rot,
    0,
    H + 1,
    0,
    W - 1,
    H + 1,
    Math.floor(D / 2),
    BLOCK.PLANKS
  );

  // forge trench + rim
  const fz = Math.floor(D / 2) + 1;
  fillLocal(writer, wx, wy, wz, rot, 2, 0, fz, 3, 0, fz, BLOCK.LAVA);
  fillLocal(
    writer,
    wx,
    wy,
    wz,
    rot,
    1,
    1,
    fz - 1,
    4,
    1,
    fz + 1,
    BLOCK.COBBLESTONE
  );

  // chimney
  const [chx, chy, chz] = worldAt(wx, wy, wz, W - 2, 1, D - 2, rot);
  for (let i = 0; i < H + 2; i++)
    setIf(writer, chx, chy + i, chz, BLOCK.COBBLESTONE);
  setIf(writer, chx, chy + H + 2, chz, BLOCK.GLOWSTONE);

  // bench & torches
  fillLocal(writer, wx, wy, wz, rot, 1, 1, 1, 2, 1, 1, BLOCK.PLANKS);
  const [bx, by, bz] = worldAt(wx, wy, wz, 1, 2, 1, rot);
  setIf(writer, bx, by, bz, BLOCK.WHITE_WOOL);
  placeTorchFloor(writer, wx, wy, wz, rot, 1, D - 2);
  placeTorchFloor(writer, wx, wy, wz, rot, W - 2, D - 2);

  // entrance apron
  fillLocal(
    writer,
    wx,
    wy,
    wz,
    rot,
    Math.floor(W / 2),
    0,
    -1,
    Math.floor(W / 2),
    0,
    -3,
    BLOCK.GRAVEL
  );

  const ent = worldAt(wx, wy, wz, Math.floor(W / 2), 0, -1, rot);
  return {
    type: "blacksmith",
    entrance: { x: ent[0], y: wy, z: ent[2] },
    bbox: bboxFromLocal(wx, wy, wz, rot, W, H + 3, D),
  };
}

/* ---- NEW 6) Longhouse (9×13, elongated hall) ---- */
//this function has been generated with the help of copilot
export function placeLonghouse(writer, wx, wy, wz, rot = 0) {
  const W = 9,
    D = 13,
    H = 6;
  fillLocal(writer, wx, wy, wz, rot, -2, 0, -3, W + 2, H + 6, D + 3, BLOCK.AIR);

  fillLocal(
    writer,
    wx,
    wy,
    wz,
    rot,
    0,
    0,
    0,
    W - 1,
    0,
    D - 1,
    BLOCK.COBBLESTONE
  );
  boxHollow(writer, wx, wy, wz, rot, W, H, D, BLOCK.PLANKS);

  // log pillars every 3 blocks along sides
  for (const x of [0, 3, 6, 8]) {
    fillLocal(writer, wx, wy, wz, rot, x, 1, 0, x, H - 1, 0, BLOCK.WOOD);
    fillLocal(
      writer,
      wx,
      wy,
      wz,
      rot,
      x,
      1,
      D - 1,
      x,
      H - 1,
      D - 1,
      BLOCK.WOOD
    );
  }

  // doors both ends + gravel approaches
  carveDoor(writer, wx, wy, wz, rot, Math.floor(W / 2), 0, 2);
  fillLocal(
    writer,
    wx,
    wy,
    wz,
    rot,
    Math.floor(W / 2),
    0,
    -1,
    Math.floor(W / 2),
    0,
    -3,
    BLOCK.GRAVEL
  );
  carveDoor(writer, wx, wy, wz, rot, Math.floor(W / 2), D - 1, 2);
  fillLocal(
    writer,
    wx,
    wy,
    wz,
    rot,
    Math.floor(W / 2),
    0,
    D,
    Math.floor(W / 2),
    0,
    D + 2,
    BLOCK.GRAVEL
  );

  // windows in rhythm
  for (const zz of [3, 5, 7, 9]) {
    placeWindow(writer, wx, wy, wz, rot, 0, zz);
    placeWindow(writer, wx, wy, wz, rot, W - 1, zz);
  }

  // big roof
  slopeRoofGable(writer, wx, wy, wz, rot, W, D, H - 1, 3, BLOCK.PLANKS);

  // floor + torches
  fillLocal(writer, wx, wy, wz, rot, 1, 0, 1, W - 2, 0, D - 2, BLOCK.PLANKS);
  placeTorchFloor(writer, wx, wy, wz, rot, 1, 1);
  placeTorchFloor(writer, wx, wy, wz, rot, W - 2, D - 2);

  const ent = worldAt(wx, wy, wz, Math.floor(W / 2), 1, -1, rot);
  return {
    type: "longhouse",
    entrance: { x: ent[0], y: ent[1], z: ent[2] },
    bbox: bboxFromLocal(wx, wy, wz, rot, W, H + 5, D),
  };
}

/* ---- NEW 7) Watchtower (5×5 base, ~10 tall, balcony & roof cap) ---- */
//this function has been generated with the help of copilot
export function placeWatchtower(writer, wx, wy, wz, rot = 0) {
  const W = 5,
    D = 5,
    H = 10;
  fillLocal(writer, wx, wy, wz, rot, -2, 0, -2, W + 2, H + 4, D + 2, BLOCK.AIR);

  // base & shaft (cobble shell with plank infill floors)
  fillLocal(
    writer,
    wx,
    wy,
    wz,
    rot,
    0,
    0,
    0,
    W - 1,
    0,
    D - 1,
    BLOCK.COBBLESTONE
  );
  for (let y = 1; y < H; y++) {
    // walls
    fillLocal(writer, wx, wy, wz, rot, 0, y, 0, W - 1, y, 0, BLOCK.COBBLESTONE);
    fillLocal(
      writer,
      wx,
      wy,
      wz,
      rot,
      0,
      y,
      D - 1,
      W - 1,
      y,
      D - 1,
      BLOCK.COBBLESTONE
    );
    fillLocal(writer, wx, wy, wz, rot, 0, y, 0, 0, y, D - 1, BLOCK.COBBLESTONE);
    fillLocal(
      writer,
      wx,
      wy,
      wz,
      rot,
      W - 1,
      y,
      0,
      W - 1,
      y,
      D - 1,
      BLOCK.COBBLESTONE
    );
    // occasional floors
    if (y % 3 === 0)
      fillLocal(
        writer,
        wx,
        wy,
        wz,
        rot,
        1,
        y,
        1,
        W - 2,
        y,
        D - 2,
        BLOCK.PLANKS
      );
  }

  // door at ground
  carveDoor(writer, wx, wy, wz, rot, Math.floor(W / 2), 0, 2);
  fillLocal(
    writer,
    wx,
    wy,
    wz,
    rot,
    Math.floor(W / 2),
    0,
    -1,
    Math.floor(W / 2),
    0,
    -2,
    BLOCK.GRAVEL
  );

  // slit windows
  for (const z of [2]) {
    placeWindow(writer, wx, wy, wz, rot, 0, z, 1);
    placeWindow(writer, wx, wy, wz, rot, W - 1, z, 1);
  }

  // balcony ring
  fillLocal(writer, wx, wy, wz, rot, -1, H, -1, W, H, -1, BLOCK.PLANKS);
  fillLocal(writer, wx, wy, wz, rot, -1, H, D, W, H, D, BLOCK.PLANKS);
  fillLocal(writer, wx, wy, wz, rot, -1, H, -1, -1, H, D, BLOCK.PLANKS);
  fillLocal(writer, wx, wy, wz, rot, W, H, -1, W, H, D, BLOCK.PLANKS);

  // roof cap + glow
  fillLocal(
    writer,
    wx,
    wy,
    wz,
    rot,
    0,
    H + 1,
    0,
    W - 1,
    H + 1,
    D - 1,
    BLOCK.PLANKS
  );
  const [gx, gy, gz] = worldAt(
    wx,
    wy,
    wz,
    Math.floor(W / 2),
    H + 2,
    Math.floor(D / 2),
    rot
  );
  setIf(writer, gx, gy, gz, BLOCK.GLOWSTONE);

  const ent = worldAt(wx, wy, wz, Math.floor(W / 2), 1, -1, rot);
  return {
    type: "watchtower",
    entrance: { x: ent[0], y: ent[1], z: ent[2] },
    bbox: bboxFromLocal(wx, wy, wz, rot, W, H + 3, D),
  };
}

/* ---- NEW 8) Market Stall (5×4, striped canopy, counter) ---- */
//this function has been generated with the help of copilot
export function placeMarketStall(writer, wx, wy, wz, rot = 0) {
  const W = 5,
    D = 4,
    H = 4;
  fillLocal(writer, wx, wy, wz, rot, -2, 0, -2, W + 2, H + 4, D + 2, BLOCK.AIR);

  // ground
  fillLocal(writer, wx, wy, wz, rot, 0, 0, 0, W - 1, 0, D - 1, BLOCK.GRAVEL);

  // posts
  for (const [px, pz] of [
    [0, 0],
    [W - 1, 0],
    [0, D - 1],
    [W - 1, D - 1],
  ]) {
    fillLocal(writer, wx, wy, wz, rot, px, 1, pz, px, 3, pz, BLOCK.WOOD);
  }

  // canopy (red/white stripes)
  for (let lx = 0; lx < W; lx++) {
    const mat = lx % 2 === 0 ? BLOCK.RED_WOOL : BLOCK.WHITE_WOOL;
    fillLocal(writer, wx, wy, wz, rot, lx, 4, 0, lx, 4, D - 1, mat);
  }

  // counter
  fillLocal(writer, wx, wy, wz, rot, 1, 1, 1, W - 2, 1, 1, BLOCK.PLANKS);
  placeTorchFloor(writer, wx, wy, wz, rot, 2, D - 1);

  const ent = worldAt(wx, wy, wz, Math.floor(W / 2), 0, -1, rot);
  return {
    type: "market_stall",
    entrance: { x: ent[0], y: wy, z: ent[2] },
    bbox: bboxFromLocal(wx, wy, wz, rot, W, H + 2, D),
  };
}
