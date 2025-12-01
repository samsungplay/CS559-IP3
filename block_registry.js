import {
  initAtlas,
  registerSolid,
  registerCross,
  getBlockData,
} from "./block_factory.js";

import * as T from "../libs/threeJS/build/three.module.js";

// list all available blocks here
export const BLOCK = {
  AIR: 0,
  STONE: 1,
  GRASS_BLOCK: 2,
  DIRT: 3,
  PLANKS: 4,
  ROSE: 5,
  DANDELION: 6,
  WATER: 7,
  SAPLING: 8,
  COBBLESTONE: 9,
  BEDROCK: 10,
  SAND: 11,
  GRAVEL: 12,
  WOOD: 13,
  LEAVES: 14,
  RED_MUSHROOM: 15,
  BROWN_MUSHROOM: 16,
  LAVA: 17,
  GOLD_ORE: 18,
  IRON_ORE: 19,
  COAL_ORE: 20,
  GOLD_BLOCK: 21,
  SPONGE: 22,
  GLASS: 23,
  RED_WOOL: 24,
  ORANGE_WOOL: 25,
  YELLOW_WOOL: 26,
  CHARTREUSE_WOOL: 27,
  GREEN_WOOL: 28,
  SPRING_GREEN_WOOL: 29,
  CYAN_WOOL: 30,
  CAPRI_WOOL: 31,
  ULTRAMARINE_WOOL: 32,
  VIOLET_WOOL: 33,
  PURPLE_WOOL: 34,
  MAGENTA_WOOL: 35,
  ROSE_WOOL: 36,
  DARK_GRAY_WOOL: 37,
  LIGHT_GRAY_WOOL: 38,
  WHITE_WOOL: 39,
  GRASS: 40,
  GLOWSTONE: 41,
  TORCH: 42,
};

if (!window.prototype) {
  //initialize the atlas texture
  const atlas = new T.TextureLoader().load("./textures/terrain.png");
  initAtlas(atlas);
}

//register the blocks
registerSolid(BLOCK.STONE, { col: 1, row: 0 });
registerSolid(
  BLOCK.GRASS_BLOCK,
  {
    top: { col: 0, row: 0 },
    north: { col: 3, row: 0 },
    south: { col: 3, row: 0 },
    east: { col: 3, row: 0 },
    west: { col: 3, row: 0 },
    bottom: { col: 2, row: 0 },
  },
  {
    rotations: {
      north: 2,
      south: 2,
      east: 2,
      west: 2,
    },
    tintColors: {
      top: 0xbeff66,
    },
  }
);
registerSolid(BLOCK.DIRT, {
  col: 2,
  row: 0,
});
registerSolid(BLOCK.PLANKS, {
  row: 0,
  col: 4,
});
registerCross(BLOCK.ROSE, { col: 12, row: 0 }, {}, 0.9);
registerCross(BLOCK.DANDELION, { col: 13, row: 0 }, {}, 0.9);
registerSolid(
  BLOCK.WATER,
  { col: 14, row: 0 },
  { occludesFaces: false, transparentRendering: true }
);
registerCross(BLOCK.SAPLING, { col: 15, row: 0 }, {}, 0.9);
registerSolid(BLOCK.COBBLESTONE, { row: 1, col: 0 });
registerSolid(BLOCK.BEDROCK, { row: 1, col: 1 });
registerSolid(BLOCK.SAND, { row: 1, col: 2 });
registerSolid(BLOCK.GRAVEL, { row: 1, col: 3 });
registerSolid(BLOCK.WOOD, {
  top: { row: 1, col: 5 },
  bottom: { row: 1, col: 5 },
  south: { row: 1, col: 4 },
  east: { row: 1, col: 4 },
  west: { row: 1, col: 4 },
  north: { row: 1, col: 4 },
});
registerSolid(
  BLOCK.LEAVES,
  { row: 3, col: 4 },
  {
    tintColors: "green",
    occludesFaces: false,
  }
);
registerCross(BLOCK.RED_MUSHROOM, { col: 12, row: 1 }, {}, 0.9);
registerCross(BLOCK.BROWN_MUSHROOM, { col: 13, row: 1 }, {}, 0.9);
registerSolid(BLOCK.LAVA, { row: 15, col: 15 });
registerSolid(
  BLOCK.GOLD_ORE,
  { row: 2, col: 0 },
  {
    rotations: {
      north: 2,
      south: 2,
      east: 2,
      west: 2,
    },
  }
);
registerSolid(
  BLOCK.IRON_ORE,
  { row: 2, col: 1 },
  {
    rotations: {
      north: 2,
      south: 2,
      east: 2,
      west: 2,
    },
  }
);
registerSolid(
  BLOCK.COAL_ORE,
  { row: 2, col: 2 },
  {
    rotations: {
      north: 2,
      south: 2,
      east: 2,
      west: 2,
    },
  }
);
registerSolid(BLOCK.GOLD_BLOCK, { row: 1, col: 7 });
registerSolid(BLOCK.SPONGE, { row: 3, col: 0 });
registerSolid(BLOCK.GLASS, { row: 3, col: 1 }, { occludesFaces: false });
registerSolid(BLOCK.RED_WOOL, { row: 4, col: 0 }, { tintColors: 0xe32c2c });
registerSolid(BLOCK.ORANGE_WOOL, { row: 4, col: 0 }, { tintColors: 0xff8c00 });
registerSolid(BLOCK.YELLOW_WOOL, { row: 4, col: 0 }, { tintColors: 0xffd83d });
registerSolid(
  BLOCK.CHARTREUSE_WOOL,
  { row: 4, col: 0 },
  { tintColors: 0xa9ff3d }
);
registerSolid(BLOCK.GREEN_WOOL, { row: 4, col: 0 }, { tintColors: 0x4caf50 });
registerSolid(
  BLOCK.SPRING_GREEN_WOOL,
  { row: 4, col: 0 },
  { tintColors: 0x00ff7f }
);
registerSolid(BLOCK.CYAN_WOOL, { row: 4, col: 0 }, { tintColors: 0x00ffff });
registerSolid(BLOCK.CAPRI_WOOL, { row: 4, col: 0 }, { tintColors: 0x3da8ff });
registerSolid(
  BLOCK.ULTRAMARINE_WOOL,
  { row: 4, col: 0 },
  { tintColors: 0x1e3aff }
);
registerSolid(BLOCK.VIOLET_WOOL, { row: 4, col: 0 }, { tintColors: 0x8a2be2 });
registerSolid(BLOCK.PURPLE_WOOL, { row: 4, col: 0 }, { tintColors: 0xa020f0 });
registerSolid(BLOCK.MAGENTA_WOOL, { row: 4, col: 0 }, { tintColors: 0xff00ff });
registerSolid(BLOCK.ROSE_WOOL, { row: 4, col: 0 }, { tintColors: 0xff66b2 });
registerSolid(
  BLOCK.DARK_GRAY_WOOL,
  { row: 4, col: 0 },
  { tintColors: 0x555555 }
);
registerSolid(
  BLOCK.LIGHT_GRAY_WOOL,
  { row: 4, col: 0 },
  { tintColors: 0xaaaaaa }
);
registerSolid(BLOCK.WHITE_WOOL, { row: 4, col: 0 }, { tintColors: 0xffffff });
registerCross(BLOCK.GRASS, { row: 2, col: 7 }, { tintColors: 0xbeff66 });
registerSolid(
  BLOCK.GLOWSTONE,
  { row: 6, col: 9 },
  {
    rotations: {
      north: 2,
      south: 2,
      east: 2,
      west: 2,
    },
    emissive: true,
    emissiveColor: 0xffcc66,
    emissiveIntensity: 1.5,
  }
);
registerCross(
  BLOCK.TORCH,
  { row: 5, col: 0 },
  { emissive: true, emissiveColor: 0xffcc66, emissiveIntensity: 1.5 }
);
