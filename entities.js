import { FBXLoader } from "../libs/threeJS/examples/jsm/loaders/FBXLoader.js";
import * as T from "../libs/threeJS/build/three.module.js";
import { GrObject } from "../libs/framework/GrObject.js";
import { BLOCK } from "./block_registry.js";
import { CHUNK_SIZE, Y_MAX, Y_MIN } from "./voxel_engine.js";
import { GrTickingObject } from "./base.js";
import { getBlockData, atlasTexture } from "./block_factory.js";

// Same face definitions as in voxel_engine.js
// this variable has been generated with the help of copilot
const HELD_FACES = [
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

// Exact same UV_ORDER as in voxel_engine.js
// this variable has been generated with the help of copilot
const HELD_UV_ORDER = {
  PX: (r) => [r.u1, r.v1, r.u1, r.v0, r.u0, r.v0, r.u0, r.v1],
  NX: (r) => [r.u0, r.v1, r.u0, r.v0, r.u1, r.v0, r.u1, r.v1],
  PY: (r) => [r.u0, r.v0, r.u1, r.v0, r.u1, r.v1, r.u0, r.v1],
  NY: (r) => [r.u0, r.v1, r.u1, r.v1, r.u1, r.v0, r.u0, r.v0],
  PZ: (r) => [r.u1, r.v1, r.u0, r.v1, r.u0, r.v0, r.u1, r.v0],
  NZ: (r) => [r.u0, r.v1, r.u1, r.v1, r.u1, r.v0, r.u0, r.v0],
};

// Same rotUV4 logic as in voxel_engine.js
// this function has been generated with the help of copilot
function heldRotUV4(uvArr, quarterTurns = 0) {
  let steps = ((quarterTurns % 4) + 4) % 4;
  while (steps--) {
    const tmpU = uvArr[0],
      tmpV = uvArr[1];
    uvArr[0] = uvArr[2];
    uvArr[1] = uvArr[3];
    uvArr[2] = uvArr[4];
    uvArr[3] = uvArr[5];
    uvArr[4] = uvArr[6];
    uvArr[5] = uvArr[7];
    uvArr[6] = tmpU;
    uvArr[7] = tmpV;
  }
  return uvArr;
}

/**
 * GrEntity
 * Base class for pig / sheep / creeper, etc.
 * - Wander, idle, head-scan
 * - Physics (gravity, coyote, ledge-grace)
 * - Swimming + bobbing
 * - Capsule collision, shore step-out
 *
 * Subclasses typically override:
 *   - _prepareRig(root)      (bone wiring)
 *   - _animateLegs(dt, v, inLiquid) (animation)
 */
//this class has been generated with the help of copilot
export class GrEntity extends GrTickingObject {
  constructor(name, modelPath, voxelWorld, opts = {}) {
    const root = new T.Group();
    super(name, root);

    // ---------- External world ----------
    this.world = voxelWorld;

    // ---------- Scene graph ----------
    this.root = root;
    this.visual = new T.Group();
    root.add(this.visual);

    // ---------- Swim bobbing ----------
    this.bobAmp =
      opts.bobAmp !== undefined && opts.bobAmp !== null ? opts.bobAmp : 0.25;

    // ---------- Facing / asset offset ----------
    this.modelYawOffsetRad =
      opts.modelYawOffsetRad !== undefined && opts.modelYawOffsetRad !== null
        ? opts.modelYawOffsetRad
        : -Math.PI / 2;
    this.visual.rotation.y = this.modelYawOffsetRad;

    // ---------- Physics ----------
    this.gravity =
      opts.gravity !== undefined && opts.gravity !== null
        ? opts.gravity
        : -24.0;
    this.terminalVel =
      opts.terminalVel !== undefined && opts.terminalVel !== null
        ? opts.terminalVel
        : -32.0;
    this.jumpSpeed =
      opts.jumpSpeed !== undefined && opts.jumpSpeed !== null
        ? opts.jumpSpeed
        : 9.0;
    this.jumpCooldown =
      opts.jumpCooldown !== undefined && opts.jumpCooldown !== null
        ? opts.jumpCooldown
        : 0.5;
    this.walkSpeed =
      opts.walkSpeed !== undefined && opts.walkSpeed !== null
        ? opts.walkSpeed
        : 1.5;
    this.swimSpeed =
      opts.swimSpeed !== undefined && opts.swimSpeed !== null
        ? opts.swimSpeed
        : 0.9;
    this.airControl =
      opts.airControl !== undefined && opts.airControl !== null
        ? opts.airControl
        : 0.55;

    // Ledge / step
    this.safeDropHeight =
      opts.safeDropHeight !== undefined && opts.safeDropHeight !== null
        ? opts.safeDropHeight
        : 2.0;
    this.dropProbeDist =
      opts.dropProbeDist !== undefined && opts.dropProbeDist !== null
        ? opts.dropProbeDist
        : 0.65;

    // Capsule (feet at pos.y)
    this.halfWidth =
      opts.halfWidth !== undefined && opts.halfWidth !== null
        ? opts.halfWidth
        : 0.35;
    this.height =
      opts.height !== undefined && opts.height !== null ? opts.height : 1.0;
    this.footClear =
      opts.footClear !== undefined && opts.footClear !== null
        ? opts.footClear
        : 0.06;
    this.chest =
      opts.chest !== undefined && opts.chest !== null ? opts.chest : 0.65;

    // Wander / idle
    this.wanderRadius =
      opts.wanderRadius !== undefined && opts.wanderRadius !== null
        ? opts.wanderRadius
        : 14;
    this.idleMin =
      opts.idleMin !== undefined && opts.idleMin !== null ? opts.idleMin : 0.8;
    this.idleMax =
      opts.idleMax !== undefined && opts.idleMax !== null ? opts.idleMax : 1.6;
    this.idleChance = Math.max(
      0,
      Math.min(
        1,
        opts.idleChance !== undefined && opts.idleChance !== null
          ? opts.idleChance
          : 0.35
      )
    );

    // Jump carry
    this.jumpCarryFactor =
      opts.jumpCarryFactor !== undefined && opts.jumpCarryFactor !== null
        ? opts.jumpCarryFactor
        : 0.85;
    this.jumpAirSpeedMul =
      opts.jumpAirSpeedMul !== undefined && opts.jumpAirSpeedMul !== null
        ? opts.jumpAirSpeedMul
        : 1.0;
    this.jumpCarryDecay =
      opts.jumpCarryDecay !== undefined && opts.jumpCarryDecay !== null
        ? opts.jumpCarryDecay
        : 0.15;

    // Coyote & ledge-grace
    this.coyoteSec =
      opts.coyoteSec !== undefined && opts.coyoteSec !== null
        ? opts.coyoteSec
        : 0.12;
    this.edgeGraceSec =
      opts.edgeGraceSec !== undefined && opts.edgeGraceSec !== null
        ? opts.edgeGraceSec
        : 0.2;

    // ---------- Leg/Head animation tunables ----------
    this.legAxis =
      opts.legAxis !== undefined && opts.legAxis !== null ? opts.legAxis : "z";
    this.legHzScale =
      opts.legHzScale !== undefined && opts.legHzScale !== null
        ? opts.legHzScale
        : 1.0;
    this.legAmpScale =
      opts.legAmpScale !== undefined && opts.legAmpScale !== null
        ? opts.legAmpScale
        : 1.0;

    this.headScanAxis =
      opts.headScanAxis !== undefined && opts.headScanAxis !== null
        ? opts.headScanAxis
        : "x";
    this.maxHeadYaw =
      opts.maxHeadYaw !== undefined && opts.maxHeadYaw !== null
        ? opts.maxHeadYaw
        : 0.6;
    this.headYawTurnRate =
      opts.headYawTurnRate !== undefined && opts.headYawTurnRate !== null
        ? opts.headYawTurnRate
        : 6.0;
    this.bodyLagTurnRate =
      opts.bodyLagTurnRate !== undefined && opts.bodyLagTurnRate !== null
        ? opts.bodyLagTurnRate
        : 2.2;
    this.headScanStepMin =
      opts.headScanStepMin !== undefined && opts.headScanStepMin !== null
        ? opts.headScanStepMin
        : 0.55;
    this.headScanStepMax =
      opts.headScanStepMax !== undefined && opts.headScanStepMax !== null
        ? opts.headScanStepMax
        : 1.1;
    this.headScanBodyLag =
      opts.headScanBodyLag !== undefined && opts.headScanBodyLag !== null
        ? opts.headScanBodyLag
        : 0.35;
    this.headScanDurationMin =
      opts.headScanDurationMin !== undefined &&
      opts.headScanDurationMin !== null
        ? opts.headScanDurationMin
        : 1.6;
    this.headScanDurationMax =
      opts.headScanDurationMax !== undefined &&
      opts.headScanDurationMax !== null
        ? opts.headScanDurationMax
        : 3.0;
    // --- Health & death ---
    this.maxHealth =
      opts.maxHealth !== undefined && opts.maxHealth !== null
        ? opts.maxHealth
        : 10;
    this.health = this.maxHealth;
    // --- Health bar ---
    this._healthBar = null;

    this.isDead = false;
    this.deathTimer = 0;
    this.deathDuration = 0.8; // seconds for death anim

    this._deathRotStart = 0; // for tipping over
    this._deathRotEnd = -Math.PI / 2; // lie on side (rotate around X)

    // ---------- Debug feet marker ----------
    if (opts.debugScene) {
      const g = new T.SphereGeometry(0.12, 12, 12);
      const m = new T.MeshBasicMaterial({ color: 0x00ffaa });
      this._feetDot = new T.Mesh(g, m);
      opts.debugScene.add(this._feetDot);
    }

    // ---------- Pose ----------
    this.pos = new T.Vector3(
      opts.x !== undefined && opts.x !== null ? opts.x : 0,
      opts.y !== undefined && opts.y !== null ? opts.y : 80,
      opts.z !== undefined && opts.z !== null ? opts.z : 0
    );
    this.yaw = 0;
    this.verticalVel = 0;
    this.dir = new T.Vector3(0, 0, 1);
    this.target = new T.Vector3(0, 0, 0);
    this.jumpCarry = new T.Vector3(0, 0, 0);

    // ---------- State ----------
    this.ready = false;
    this.state = "idle"; // idle | walk | jump | fall | swim
    this._idleTimer = 0;
    this._jumpTimer = 0;
    this._time = 0;

    // Support flags
    this._wasSupported = false;
    this._coyote = 0;
    this._ledgeGrace = 0;

    // For anims
    this._lastPosXZ = new T.Vector2(this.pos.x, this.pos.z);
    this._rig = { legs: {}, legBones: [], head: null };

    // Head-scan state
    this._headScan = {
      active: false,
      t: 0,
      duration: 0,
      stepT: 0,
      stepPeriod: 0,
      bodyLagT: 0,
      aimYawRel: 0,
      desiredYaw: 0,
      targetPos: null,
    };

    this._hurtMeshes = [];

    if (window.prototype) {
      // 1. Create Simple Geometry
      const width = (this.halfWidth || 0.35) * 2;
      const height = this.height || 1.0;

      const geo = new T.BoxGeometry(width, height, width);
      // Use color from opts, or default to gray
      const color = opts.color !== undefined ? opts.color : 0xcccccc;
      const mat = new T.MeshBasicMaterial({ color: color });

      const mesh = new T.Mesh(geo, mat);

      // 2. Adjust Pivot (FBX usually has pivot at feet, BoxGeometry is center)
      mesh.position.y = height / 2;

      this.visual.add(mesh);

      // 3. Register hurt mesh for flashing red
      mesh.userData.entity = this;
      mesh.userData.baseColor = mat.color.clone();
      this._hurtMeshes.push(mesh);

      // 4. Create Health Bar & Set Ready
      this._createHealthBar();
      this.ready = true;

      // 5. Trigger initial logic
      this._pickNewTarget("spawn");
      this._maybeEnterIdleByChance("spawn");

      // 6. Handle Player Hand Socket Special Case
      // Since we don't have bones in prototype mode, we attach the hand socket
      // directly to the visual mesh so items appear floating in front/side.
      if (this.name === "Player") {
        this._handSocket = new T.Object3D();
        this._handSocket.position.set(0.4, 0.8, 0.5); // Approximate hand position
        this.visual.add(this._handSocket);
      }
    } else {
      // ---------- Load FBX ----------
      const loader = new FBXLoader();
      loader.load(
        modelPath,
        (fbx) => {
          const s =
            opts.modelScale !== undefined && opts.modelScale !== null
              ? opts.modelScale
              : 0.0035;
          fbx.scale.set(s, s, s);

          const box = new T.Box3().setFromObject(fbx);
          const yOffset = -box.min.y; // feet at y=0
          fbx.position.set(0, yOffset, 0);

          fbx.traverse(function (o) {
            o.frustumCulled = false;
            if (o.isSkinnedMesh) {
              o.castShadow = true;
              o.receiveShadow = true;
            }
          });

          this._prepareRig(fbx); // subclass hook
          this.visual.add(fbx);
          this.visual.traverse((obj) => {
            if (obj.isMesh) {
              obj.userData.entity = this;
              this._hurtMeshes.push(obj);
              if (
                obj.material &&
                obj.material.color &&
                !obj.userData.baseColor
              ) {
                obj.userData.baseColor = obj.material.color.clone();
              }
            }
          });
          this._createHealthBar();
          this.ready = true;

          this._pickNewTarget("spawn");
          this._maybeEnterIdleByChance("spawn");
        },
        undefined,
        (err) => {
          console.error("🐾 Entity FBX load failed:", err);
        }
      );
    }

    // --- Combat / Hit Response ---
    this.knockbackVel = new T.Vector3(0, 0, 0);
    this.hurtSpeedMultiplier = 1.0;
    this.hurtTimer = 0;
    this.hurtBoostFactor = 2.4; // how fast they run when panicked
    this.hurtDuration = 3; // seconds
    this.invincibleTimer = 0;
    this.invincibleDuration = 0.5;

    // --- Fall damage ---
    this.fallDamageThreshold =
      opts.fallDamageThreshold !== undefined &&
      opts.fallDamageThreshold !== null
        ? opts.fallDamageThreshold
        : 5; // no damage for first 3 blocks
    this.fallDamagePerBlock =
      opts.fallDamagePerBlock !== undefined && opts.fallDamagePerBlock !== null
        ? opts.fallDamagePerBlock
        : 1; // 1 HP per extra block

    this._falling = false;
    this._maxFallY = this.pos.y;

    this._freezeSelfMovement = false;
  }

  _createHealthBar() {
    const barWidth = 0.7;
    const barHeight = 0.1;

    const bgGeo = new T.PlaneGeometry(barWidth, barHeight);
    const fgGeo = new T.PlaneGeometry(barWidth, barHeight);

    const bgMat = new T.MeshBasicMaterial({
      color: 0x000000,
      transparent: true,
      opacity: 0.5,
      depthTest: false,
    });

    const fgMat = new T.MeshBasicMaterial({
      color: 0x00ff00,
      depthTest: false,
    });

    const bg = new T.Mesh(bgGeo, bgMat);
    const fg = new T.Mesh(fgGeo, fgMat);
    fg.position.z = 0.001; // slightly in front of bg

    const group = new T.Group();
    group.add(bg);
    group.add(fg);

    // float above head
    group.position.y = this.height + 0.6;
    group.renderOrder = 999;

    this.root.add(group);

    this._healthBar = {
      group,
      fg,
      width: barWidth,
    };
  }

  _updateHealthBar() {
    if (!this._healthBar) return;

    if (this.isDead) {
      this._healthBar.group.visible = false;
      return;
    }

    const ratio = Math.max(0, this.health / this.maxHealth);

    // scale width
    this._healthBar.fg.scale.x = ratio;

    // shrink from right → left
    this._healthBar.fg.position.x = -(this._healthBar.width * (1 - ratio)) / 2;

    // color: green → yellow → red
    let color = 0x00ff00;
    if (ratio < 0.3) color = 0xff0000;
    else if (ratio < 0.6) color = 0xffff00;
    this._healthBar.fg.material.color.set(color);

    // face camera (billboard)
    const cam = this.world?.renderWorld?.camera;
    if (cam) {
      this._healthBar.group.lookAt(cam.position);
    }
  }

  _startDeath() {
    this.isDead = true;
    if (this._healthBar) {
      this._healthBar.group.visible = false;
    }
    this.deathTimer = this.deathDuration;

    // stop normal AI / movement
    this.state = "dead";
    this.dir.set(0, 0, 0);
    this.jumpCarry.set(0, 0, 0);
    this.knockbackVel.set(0, 0, 0);
    this.verticalVel = 0;
    this._headScan.active = false;

    // ensure no more hurt logic
    this.hurtTimer = 0;
    this.invincibleTimer = 0;

    // cache base quaternion so we rotate from clean pose
    if (!this.visual.userData.baseQuat) {
      this.visual.userData.baseQuat = this.visual.quaternion.clone();
    }

    // 90° tilt
    this._deathRotEnd = Math.PI / 2;
  }

  _updateDeath(dt) {
    this.deathTimer -= dt;
    if (this.deathTimer < 0) this.deathTimer = 0;

    const t =
      this.deathDuration > 0 ? 1 - this.deathTimer / this.deathDuration : 1;

    // Smoothstep easing (natural fall)
    const k = t * t * (3 - 2 * t);

    // --- Choose axis in world space, derived from current facing ---
    const up = new T.Vector3(0, 1, 0); // world up

    // forward in world space based on root orientation
    const forward = new T.Vector3(0, 0, 1)
      .applyQuaternion(this.root.quaternion)
      .normalize();

    // side axis (right) — perpendicular to up and forward
    const side = new T.Vector3().crossVectors(up, forward).normalize();

    // 🔧 OPTION A: roll around FORWARD → sideways fall (Minecraft-style)
    // const axis = forward;

    // 🔧 OPTION B: tilt around SIDE → face-plant backward/forward
    const axis = side; // <-- if this looks wrong, change to `side`

    const q = new T.Quaternion().setFromAxisAngle(axis, this._deathRotEnd * k);

    // restore base pose then apply death rotation
    this.visual.quaternion.copy(this.visual.userData.baseQuat);
    this.visual.quaternion.multiply(q);

    // keep corpse red
    if (this._hurtMeshes && this._hurtMeshes.length) {
      const hurtColor = new T.Color(0xff0000);
      for (const m of this._hurtMeshes) {
        if (!m.material || !m.userData.baseColor) continue;
        m.material.color.copy(hurtColor);
        m.material.needsUpdate = true;
      }
    }

    // keep transform synced
    this.root.position.copy(this.pos);
    this.root.rotation.y = this.yaw;

    // final despawn
    if (this.deathTimer <= 0 && this.world && this.world.despawnMob) {
      this.world.despawnMob(this);
    }
  }

  onHitByPlayer(player) {
    // already dead? ignore
    if (this.isDead) return;

    // short invincibility window
    if (this.invincibleTimer > 0) {
      return;
    }

    // --- DAMAGE ---
    const damage = 4; // tweak as you like
    this.health -= damage;

    if (this.health <= 0) {
      this._startDeath();
      return;
    }

    // --- Normal hurt / knockback below ---

    // Direction away from player
    const dir = this.pos.clone().sub(player.pos);
    if (dir.lengthSq() < 1e-6) {
      dir.set(1, 0, 0); // avoid NaN if overlapping
    }
    dir.normalize();

    const inLiquid = this._isLiquidAt(
      this.pos.x,
      this.pos.y + this.footClear + 0.05,
      this.pos.z
    );

    const baseKnockback = 10.5;
    const waterMultiplier = inLiquid ? 0.35 : 1.0;

    this.knockbackVel.copy(dir).multiplyScalar(baseKnockback * waterMultiplier);
    this.knockbackVel.y = 7;

    this.invincibleTimer = this.invincibleDuration;

    if (!(this instanceof GrCreeper)) {
      this.hurtSpeedMultiplier = this.hurtBoostFactor;
      this.hurtTimer = this.hurtDuration;

      // stop idle head-scan if it was going on
      this._headScan.active = false;

      // set a clear flee target away from the player
      const fleeTarget = this.pos.clone().addScaledVector(dir, 10);
      this.target.copy(fleeTarget);

      // and make sure AI is in walking mode
      this.state = "walk";
    }
  }

  _updateChunkMembership() {
    const world = this.world;
    const oldChunk = this._currentChunk;

    const cx = Math.floor(this.pos.x / CHUNK_SIZE);
    const cz = Math.floor(this.pos.z / CHUNK_SIZE);

    const newChunk = world.getChunk(cx, cz);
    // (assuming you already have world.registerRenderChunk())

    if (newChunk !== oldChunk) {
      // remove from previous chunk
      if (oldChunk && oldChunk.entities) {
        const i = oldChunk.entities.indexOf(this);
        if (i >= 0) oldChunk.entities.splice(i, 1);
      }
      // add to new chunk
      if (newChunk && newChunk.entities) {
        newChunk.entities.push(this);
      }
      this._currentChunk = newChunk;
    }
  }

  // ----- Rig + animation hooks (subclass overrides) -----
  _prepareRig(root) {
    // default: no-op. Pig/Sheep/Creeper override.
  }

  _animateLegs(dt, horizSpeed, inLiquid) {
    // default: no-op. Pig overrides with your existing leg/ head-bob logic.
  }

  // ---------------- Head scan ----------------
  _beginHeadScan() {
    const hs = this._headScan;
    hs.active = true;
    hs.t = 0;
    hs.duration =
      (this.headScanDurationMin ?? 1.6) +
      Math.random() *
        ((this.headScanDurationMax ?? 3.0) - (this.headScanDurationMin ?? 1.6));
    hs.stepT = 999;
    hs.stepPeriod = 0;
    hs.bodyLagT = this.headScanBodyLag ?? 0.35;
    hs.aimYawRel = 0;
    hs.desiredYaw = this.yaw;
    hs.targetPos = null;

    this._idleTimer =
      (this.idleMin ?? 0.8) +
      Math.random() * ((this.idleMax ?? 1.6) - (this.idleMin ?? 0.8));
    this.state = "idle";
    this.dir.set(0, 0, 0);
  }

  _pickScanTarget() {
    const r = 8 + Math.random() * this.wanderRadius;
    const a = Math.random() * Math.PI * 2;
    const tx = this.pos.x + Math.cos(a) * r;
    const tz = this.pos.z + Math.sin(a) * r;

    const hs = this._headScan;
    hs.targetPos = new T.Vector3(tx, 0, tz);

    const desiredYaw = Math.atan2(tx - this.pos.x, tz - this.pos.z);
    hs.desiredYaw = desiredYaw;

    let rel = desiredYaw - this.yaw;
    rel = ((rel + Math.PI) % (2 * Math.PI)) - Math.PI;
    const clamp = this.maxHeadYaw ?? 0.6;
    if (rel > clamp) rel = clamp;
    if (rel < -clamp) rel = -clamp;
    hs.aimYawRel = rel;

    hs.bodyLagT = this.headScanBodyLag ?? 0.35;
  }

  _updateHeadScan(dt) {
    const hs = this._headScan;
    if (!hs || !hs.active) return false;

    hs.t += dt;
    hs.stepT += dt;

    if (hs.stepT >= hs.stepPeriod) {
      hs.stepT = 0;
      const min = this.headScanStepMin ?? 0.55;
      const max = this.headScanStepMax ?? 1.1;
      hs.stepPeriod = min + Math.random() * (max - min);
      this._pickScanTarget();
    }

    const head = this._rig.head;
    if (head && head.userData && head.userData.baseQuat) {
      const axis = new T.Vector3(
        this.headScanAxis === "x" ? 1 : 0,
        this.headScanAxis === "y" ? 1 : 0,
        this.headScanAxis === "z" ? 1 : 0
      );
      const pitch = hs.aimYawRel * 0.7;
      const qTarget = head.userData.baseQuat
        .clone()
        .multiply(new T.Quaternion().setFromAxisAngle(axis, pitch));
      const lerp = 1 - Math.exp(-(this.headYawTurnRate ?? 6.0) * dt);
      head.quaternion.slerp(qTarget, lerp);
    }

    if (hs.bodyLagT > 0) {
      hs.bodyLagT -= dt;
    } else {
      let d = hs.desiredYaw - this.yaw;
      d = ((d + Math.PI) % (2 * Math.PI)) - Math.PI;
      const maxStep = (this.bodyLagTurnRate ?? 2.2) * dt;
      if (d > maxStep) d = maxStep;
      if (d < -maxStep) d = -maxStep;
      this.yaw += d;
    }

    if (hs.t >= hs.duration) {
      hs.active = false;
      if (hs.targetPos) this.target.copy(hs.targetPos);
      this.state = "walk";
      return false;
    }
    return true;
  }

  _maybeEnterIdleByChance(reason) {
    if (Math.random() < this.idleChance) {
      this._beginHeadScan();
      return true;
    }
    this.state = "walk";
    return false;
  }

  // ---------------- Utilities ----------------
  _dt(d) {
    return d / 1000;
  }
  _len2(x, z) {
    return x * x + z * z;
  }
  _floor(v) {
    return Math.floor(v);
  }
  _isSolidAt(wx, wy, wz) {
    const ix = this._floor(wx),
      iy = this._floor(wy),
      iz = this._floor(wz);
    const id = this.world.getBlockWorld(ix, iy, iz);
    if (id === undefined || id === null) return false;
    return !this.world.isLiquidId(id) && !this.world.isPlantId(id) && id !== 0;
  }
  _isLiquidAt(wx, wy, wz) {
    const ix = this._floor(wx),
      iy = this._floor(wy),
      iz = this._floor(wz);

    return this.world.isWaterAt(ix, iy, iz);
  }
  _findFloorYBelow(x, y, z, maxScan) {
    const fx = this._floor(x),
      fz = this._floor(z);
    const limit = maxScan || 256;
    for (let dy = 0; dy <= limit; dy++) {
      const yy = this._floor(y) - dy;
      if (this._isLiquidAt(fx, yy, fz)) return yy + 1;
      if (this._isSolidAt(fx, yy, fz)) return yy + 1;
    }
    return -Infinity;
  }
  _hasSupportAt(wx, feetY, wz) {
    const y = feetY - (this.footClear + 0.06);
    const hw = this.halfWidth;
    return (
      this._isSolidAt(wx - hw, y, wz - hw) ||
      this._isSolidAt(wx + hw, y, wz - hw) ||
      this._isSolidAt(wx - hw, y, wz + hw) ||
      this._isSolidAt(wx + hw, y, wz + hw)
    );
  }

  _capsuleFreeAt(
    wx,
    feetY,
    wz,
    footLift = 0.2,
    skipFoot = false,
    skipMid = false,
    dir = null,
    edgeBias = 0
  ) {
    const hw = this.halfWidth;
    const yFeet = feetY + footLift;
    const yMid = feetY + Math.min(0.5, this.height * 0.5);
    const yHead = feetY + this.height - 0.05;

    const bx = dir ? dir.x * edgeBias : 0;
    const bz = dir ? dir.z * edgeBias : 0;
    const epsX = dir ? dir.x * 0.02 : 0;
    const epsZ = dir ? dir.z * 0.02 : 0;

    const feetPts = [
      [wx - hw + bx, yFeet, wz - hw + bz],
      [wx + hw + bx, yFeet, wz - hw + bz],
      [wx - hw + bx, yFeet, wz + hw + bz],
      [wx + hw + bx, yFeet, wz + hw + bz],
    ];
    const midPts = [
      [wx - hw + bx, yMid, wz - hw + bz],
      [wx + hw + bx, yMid, wz + hw + bz],
    ];
    const headPts = [
      [wx - hw + bx + epsX, yHead, wz - hw + bz + epsZ],
      [wx + hw + bx + epsX, yHead, wz + hw + bz + epsZ],
    ];

    function forwardOnly(px, pz, cx, cz, fwd) {
      if (!fwd) return true;
      const dx = px - cx,
        dz = pz - cz;
      return dx * fwd.x + dz * fwd.z >= -0.0005;
    }

    const pts = [];
    if (!skipFoot)
      for (const p of feetPts)
        if (forwardOnly(p[0], p[2], wx, wz, dir)) pts.push(p);
    if (!skipMid)
      for (const p of midPts)
        if (forwardOnly(p[0], p[2], wx, wz, dir)) pts.push(p);
    for (const p of headPts)
      if (forwardOnly(p[0], p[2], wx, wz, dir)) pts.push(p);

    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      if (this._isSolidAt(p[0], p[1], p[2])) return false;
    }
    return true;
  }

  _obstacleAhead(stepDist) {
    const dist = stepDist || 0.45;
    const nx = this.pos.x + this.dir.x * dist;
    const nz = this.pos.z + this.dir.z * dist;

    const here = this._findFloorYBelow(
      this.pos.x,
      this.pos.y + 0.5,
      this.pos.z,
      64
    );
    const ahead = this._findFloorYBelow(nx, this.pos.y + 0.5, nz, 64);
    if (isFinite(here) && isFinite(ahead) && here - ahead > 0.15) {
      return false;
    }

    const yFeet = this.pos.y;
    const footSolid = this._isSolidAt(nx, yFeet + 0.2, nz);
    const kneeSolid = this._isSolidAt(nx, yFeet + 0.6, nz);
    const headSolid = this._isSolidAt(nx, yFeet + this.height - 0.1, nz);
    return footSolid || kneeSolid || headSolid;
  }

  _canStepOneBlock() {
    const nx = this.pos.x + this.dir.x * 0.6;
    const nz = this.pos.z + this.dir.z * 0.6;
    const landingFeet = this.pos.y + 1.0;
    return this._capsuleFreeAt(nx, landingFeet, nz);
  }

  _pickNewTarget(reason) {
    for (let tries = 0; tries < 8; tries++) {
      const r = 8 + Math.random() * this.wanderRadius;
      const a = Math.random() * Math.PI * 2;
      const tx = this.pos.x + Math.cos(a) * r;
      const tz = this.pos.z + Math.sin(a) * r;

      // Rough floor Y to check lava under the target
      const floorY = this._findFloorYBelow(tx, this.pos.y + 2, tz, 32);
      let bad = false;
      if (isFinite(floorY) && this.world.isLavaAt) {
        // check the block just below the "floor"
        if (this.world.isLavaAt(tx, floorY - 1, tz)) {
          bad = true;
        }
      }

      if (!bad) {
        this.target.set(tx, 0, tz);
        return;
      }
    }

    // fallback: one random target if we somehow failed all
    const r = 8 + Math.random() * this.wanderRadius;
    const a = Math.random() * Math.PI * 2;
    this.target.set(
      this.pos.x + Math.cos(a) * r,
      0,
      this.pos.z + Math.sin(a) * r
    );
  }

  _faceTowardTarget() {
    const dx = this.target.x - this.pos.x;
    const dz = this.target.z - this.pos.z;
    const L2 = this._len2(dx, dz);
    if (L2 < 1e-6) return false;
    const invL = 1 / Math.sqrt(L2);
    this.dir.set(dx * invL, 0, dz * invL);
    const desired = Math.atan2(this.dir.x, this.dir.z);
    let d = desired - this.yaw;
    d = ((d + Math.PI) % (2 * Math.PI)) - Math.PI;
    this.yaw += d * 0.12;
    return true;
  }

  _enterIdle() {
    this.state = "idle";
    this._idleTimer =
      this.idleMin +
      Math.random() * Math.max(0.01, this.idleMax - this.idleMin);
    this.dir.set(0, 0, 0);
  }

  _maybeAutoJump() {
    if (this._jumpTimer > 0) return false;
    const grounded =
      this._hasSupportAt(this.pos.x, this.pos.y, this.pos.z) ||
      this._coyote > 0;
    if (!grounded) return false;
    if (!this._obstacleAhead()) return false;
    if (!this._canStepOneBlock()) {
      this._pickNewTarget("blocked");
      this._maybeEnterIdleByChance("blocked");
      return false;
    }

    this.jumpCarry
      .copy(this.dir)
      .multiplyScalar(this.walkSpeed * this.jumpCarryFactor);

    this.verticalVel = this.jumpSpeed;
    this.state = "jump";
    this._jumpTimer = this.jumpCooldown;
    return true;
  }

  // ---------------- Per-frame update ----------------
  stepTick(delta) {
    if (!this.ready) return;

    const dt = this._dt(delta);
    this._time += dt;

    // If already dead, just play death animation & despawn
    if (this.isDead) {
      this._updateDeath(dt);
      return;
    }

    // timers
    if (this._jumpTimer > 0)
      this._jumpTimer = Math.max(0, this._jumpTimer - dt);
    if (this._ledgeGrace > 0)
      this._ledgeGrace = Math.max(0, this._ledgeGrace - dt);
    if (this._coyote > 0) this._coyote = Math.max(0, this._coyote - dt);

    const inLiquid = this._isLiquidAt(
      this.pos.x,
      this.pos.y + this.footClear + 0.05,
      this.pos.z
    );

    // Check specifically for lava at feet → instant death
    const inLava =
      this.world.isLavaAt &&
      this.world.isLavaAt(
        this.pos.x,
        this.pos.y + this.footClear + 0.05,
        this.pos.z
      );

    if (inLava) {
      if (!this.isDead) {
        this._startDeath();
      }
      this._updateDeath(dt);
      return;
    }

    // Allow head scan while idling
    if (this.state === "idle" && this._headScan.active) {
      this._updateHeadScan(dt);
    }

    // Track airborne state for fall damage (ignore liquids)
    const supportedNow =
      this._hasSupportAt(this.pos.x, this.pos.y, this.pos.z) || inLiquid;

    if (!supportedNow) {
      if (!this._falling) {
        this._falling = true;
        this._maxFallY = this.pos.y;
      } else if (this.pos.y > this._maxFallY) {
        this._maxFallY = this.pos.y;
      }
    } else if (!this._falling) {
      // reset on ground
      this._maxFallY = this.pos.y;
    }

    // Vertical accel
    if (inLiquid) {
      this.verticalVel = 0;
      this.state = "swim";
    } else {
      this.verticalVel += this.gravity * dt;
      if (this.verticalVel < this.terminalVel)
        this.verticalVel = this.terminalVel;
      if (this.verticalVel > 0 && this.state !== "jump") this.state = "jump";
      if (
        this.verticalVel < 0 &&
        this.state !== "fall" &&
        this.state !== "jump"
      )
        this.state = "fall";
    }

    // Segment landing
    const prevY = this.pos.y;
    let nextY = this.pos.y + this.verticalVel * dt;

    if (!inLiquid && this.verticalVel < 0) {
      const floorYPrev = this._findFloorYBelow(
        this.pos.x,
        prevY + 0.5,
        this.pos.z,
        256
      );

      if (isFinite(floorYPrev)) {
        const liquidFloor = this._isLiquidAt(
          this.pos.x,
          floorYPrev - 0.5,
          this.pos.z
        );

        if (!liquidFloor) {
          const landFeet = floorYPrev + this.footClear;
          if (nextY <= landFeet) {
            nextY = landFeet;
            this.verticalVel = 0;
            this._wasSupported = true;
            this._coyote = this.coyoteSec;

            // --- Fall damage ---
            if (this._falling) {
              const fallDist = this._maxFallY - landFeet;
              if (fallDist > this.fallDamageThreshold) {
                const extra = fallDist - this.fallDamageThreshold;
                const dmg = extra * this.fallDamagePerBlock;

                this.health -= dmg;
                if (dmg > 0) {
                  this.hurtTimer = this.hurtDuration;
                  this.invincibleTimer = this.invincibleDuration;
                }
                if (this.health <= 0 && !this.isDead) {
                  this._startDeath();
                  // we can immediately run death update and bail
                  this._updateDeath(dt);
                  return;
                }
              }
              this._falling = false;
              this._maxFallY = landFeet;
            }

            if (this.state !== "idle") {
              if (this.hurtTimer > 0 || this.knockbackVel.lengthSq() > 0.001) {
                this.state = "walk";
              } else {
                const movedXZ =
                  Math.hypot(
                    this.pos.x - this._lastPosXZ.x,
                    this.pos.z - this._lastPosXZ.y
                  ) / Math.max(dt, 1e-6);
                this.state = movedXZ > 0.05 ? "walk" : "idle";
              }
            }
          }
        }
      }
    }
    this.pos.y = nextY;

    // Idle timer
    if (this.state === "idle" && !this._headScan.active) {
      this._idleTimer -= dt;
      if (this._idleTimer <= 0) this.state = "walk";
    }

    // Target arrival / bounds
    const dx = this.target.x - this.pos.x;
    const dz = this.target.z - this.pos.z;
    const dist2 = this._len2(dx, dz);
    if (dist2 < 1.0 || dist2 > this.wanderRadius * this.wanderRadius * 1.1) {
      this._pickNewTarget(dist2 < 1.0 ? "arrived" : "too-far");
      this._maybeEnterIdleByChance("retarget");
    }

    // Face toward goal when walking OR swimming
    if (this.state === "walk" || this.state === "swim") {
      if (!this._faceTowardTarget()) {
        if (this.state === "walk") {
          this._maybeEnterIdleByChance("no-face");
        }
      }
    } else {
      this.dir.set(0, 0, 0);
    }

    // Horizontal speed
    let speed = inLiquid ? this.swimSpeed : this.walkSpeed;

    if (this._freezeSelfMovement) {
      speed = 0; // ✅ stops navigation movement only
    }

    // Panic speed boost
    if (this.hurtTimer > 0) {
      speed *= this.hurtSpeedMultiplier;
      this.hurtTimer -= dt;
    } else {
      this.hurtSpeedMultiplier = 1.0;
    }

    if (this.invincibleTimer > 0) {
      this.invincibleTimer = Math.max(0, this.invincibleTimer - dt);
    }

    // --- Hurt flash (material tint) ---
    if (this._hurtMeshes && this._hurtMeshes.length) {
      if (this.invincibleTimer > 0) {
        const hurtColor = new T.Color(0xff0000);

        for (const m of this._hurtMeshes) {
          if (!m.material || !m.userData.baseColor) continue;
          // lerp between original color and red
          m.material.color = hurtColor;
          m.material.needsUpdate = true;
        }
      } else {
        // restore original color once no longer hurt
        for (const m of this._hurtMeshes) {
          if (!m.material || !m.userData.baseColor) continue;
          m.material.color.copy(m.userData.baseColor);
          m.material.needsUpdate = true;
        }
      }
    }

    if (this.state === "fall" || this.state === "jump")
      speed *= this.airControl;
    if (this.state === "idle") speed = 0;

    if (!inLiquid && this._ledgeGrace <= 0) this._maybeAutoJump();

    const step = speed * dt;

    // Proposed XZ
    let nx = this.pos.x;
    let nz = this.pos.z;
    if (step > 0) {
      nx += this.dir.x * step;
      nz += this.dir.z * step;
    }

    // --- Avoid walking into lava (but allow external forces like knockback) ---
    if (step > 0 && this.world.isLavaAt) {
      const feetY = this.pos.y + this.footClear + 0.05;

      // Check end of step and midpoint of step
      const midX = (this.pos.x + nx) * 0.5;
      const midZ = (this.pos.z + nz) * 0.5;

      const lavaEnd = this.world.isLavaAt(nx, feetY, nz);
      const lavaMid = this.world.isLavaAt(midX, feetY, midZ);

      if (lavaEnd || lavaMid) {
        // cancel this walking step and retarget, similar to cliff avoidance
        nx = this.pos.x;
        nz = this.pos.z;

        this._pickNewTarget("lava-ahead");
        this._maybeEnterIdleByChance("lava-ahead");
      }
    }

    const groundedNow = this._hasSupportAt(this.pos.x, this.pos.y, this.pos.z);
    if (groundedNow) {
      this._coyote = this.coyoteSec;
      this._wasSupported = true;
    } else if (this._wasSupported) {
      this._wasSupported = false;
      this._coyote = this.coyoteSec;
    }

    if (!groundedNow) {
      nx += this.jumpCarry.x * this.jumpAirSpeedMul * dt;
      nz += this.jumpCarry.z * this.jumpAirSpeedMul * dt;
      const decay = Math.exp(-this.jumpCarryDecay * dt);
      this.jumpCarry.multiplyScalar(decay);
    }

    // --- APPLY KNOCKBACK TO PROPOSED POSITION ---
    if (this.knockbackVel.lengthSq() > 0.001) {
      // Add knockback into proposed movement
      nx += this.knockbackVel.x * dt;
      nz += this.knockbackVel.z * dt;

      // Optional: use Y for a hop
      if (this.knockbackVel.y > 0) {
        this.verticalVel = Math.max(this.verticalVel, this.knockbackVel.y);
        this.knockbackVel.y = 0;
      }

      const friction = inLiquid ? 0.55 : 0.82; // more damping in water
      this.knockbackVel.multiplyScalar(friction);

      if (this.knockbackVel.lengthSq() < 0.01) {
        this.knockbackVel.set(0, 0, 0);
      }
    }

    // Ledge step-off detection
    let steppingOff = false;
    if (!inLiquid && this.state !== "idle") {
      const aheadDist = this.halfWidth + 0.55;
      const ax = this.pos.x + this.dir.x * aheadDist;
      const az = this.pos.z + this.dir.z * aheadDist;
      const hereFloor = this._findFloorYBelow(
        this.pos.x,
        this.pos.y + 0.5,
        this.pos.z,
        128
      );
      const aheadFloor = this._findFloorYBelow(ax, this.pos.y + 0.5, az, 128);
      if (isFinite(hereFloor) && isFinite(aheadFloor)) {
        const drop = hereFloor - aheadFloor;
        if (drop > 0.15 && drop <= this.safeDropHeight) {
          steppingOff = true;
          this._ledgeGrace = Math.max(this._ledgeGrace, this.edgeGraceSec);
          if (this.verticalVel >= 0)
            this.verticalVel = Math.min(this.verticalVel, -2.5);
          this.state = "fall";
        } else if (drop > this.safeDropHeight) {
          nx = this.pos.x;
          nz = this.pos.z;
          this._pickNewTarget("unsafe-drop");
          this._maybeEnterIdleByChance("unsafe-drop");
        }
      }
    }

    // Collision / slide
    const skipFoot = steppingOff || this._ledgeGrace > 0;
    const skipMid = skipFoot;
    const footLift = skipFoot ? 0.55 : 0.2;
    const edgeBias = skipFoot ? this.halfWidth + 0.12 : 0.0;

    let pass =
      this._ledgeGrace > 0 ||
      this._capsuleFreeAt(
        nx,
        this.pos.y,
        nz,
        footLift,
        skipFoot,
        skipMid,
        this.dir,
        edgeBias
      );

    if (!pass && skipFoot) {
      const nx2 = nx + this.dir.x * 0.05;
      const nz2 = nz + this.dir.z * 0.05;
      pass = this._capsuleFreeAt(
        nx2,
        this.pos.y,
        nz2,
        0.5,
        true,
        true,
        this.dir,
        this.halfWidth + 0.1
      );
      if (pass) {
        nx = nx2;
        nz = nz2;
      }
    }

    if (step > 0 && !pass) {
      let steppedOut = false;

      if (inLiquid) {
        const hereFloor = this._findFloorYBelow(
          this.pos.x,
          this.pos.y + 0.5,
          this.pos.z,
          8
        );
        const aheadFloor = this._findFloorYBelow(nx, this.pos.y + 8, nz, 10);

        if (
          isFinite(hereFloor) &&
          isFinite(aheadFloor) &&
          hereFloor == aheadFloor
        ) {
          this.pos.x = nx;
          this.pos.z = nz;
          this.pos.y = aheadFloor + this.footClear;
          this.verticalVel = 0;
          this.state = "walk";
          this._wasSupported = true;
          this._coyote = this.coyoteSec;
          this._lastPosXZ.set(this.pos.x, this.pos.z);
          steppedOut = true;
        }
      }

      if (!steppedOut) {
        const side = new T.Vector3(-this.dir.z, 0, this.dir.x);
        const tryX = this.pos.x + side.x * step * 0.6;
        const tryZ = this.pos.z + side.z * step * 0.6;
        if (
          this._capsuleFreeAt(
            tryX,
            this.pos.y,
            tryZ,
            0.2,
            false,
            false,
            null,
            0
          )
        ) {
          nx = tryX;
          nz = tryZ;
        } else {
          this._pickNewTarget("blocked-slide");
          this._maybeEnterIdleByChance("blocked-slide");
        }
      }
    }

    // Apply XZ & compute horizSpeed for anims
    const beforeX = this._lastPosXZ.x,
      beforeZ = this._lastPosXZ.y;
    this.pos.x = nx;
    this.pos.z = nz;
    const moved2 = this._len2(this.pos.x - beforeX, this.pos.z - beforeZ);
    const horizSpeed = Math.sqrt(moved2) / Math.max(dt, 1e-6);

    // --- Swim floating & bobbing ---
    if (inLiquid) {
      const floorY = this._findFloorYBelow(
        this.pos.x,
        this.pos.y + 0.5,
        this.pos.z,
        8
      );

      if (isFinite(floorY)) {
        const waterSurface = floorY + 1.0;
        const sinkOffset = -1.5;
        const bobFreq = 4.5;
        const bob = this.bobAmp * Math.sin(this._time * bobFreq);
        const targetY = waterSurface + sinkOffset + bob;
        this.pos.y = targetY;
      }
    }

    // Transforms
    this.root.position.copy(this.pos);
    this.root.rotation.y = this.yaw;

    this._updateHealthBar();

    let animSpeed = horizSpeed;
    if (this.hurtTimer > 0) {
      animSpeed *= this.hurtBoostFactor; // or e.g. * 1.3 if you want milder
    }

    this._animateLegs(dt, animSpeed, inLiquid);

    // Bookkeeping
    this._lastPosXZ.set(this.pos.x, this.pos.z);

    // Debug feet
    if (this._feetDot)
      this._feetDot.position.set(this.pos.x, this.pos.y + 0.02, this.pos.z);
    this._updateChunkMembership();
  }
}

let pigCounter = 0;

//this class has been generated with the help of copilot
export class GrPig extends GrEntity {
  constructor(modelPath, voxelWorld, opts = {}) {
    super(`GrPig${pigCounter++}`, modelPath, voxelWorld, {
      // Pig defaults (can still be overridden via opts)
      walkSpeed: 1.5,
      swimSpeed: 0.9,
      wanderRadius: 14,
      idleChance: 0.35,
      legAxis: "z",
      bobAmp: 0.25,
      color: 0xffaa00,
      ...opts,
    });
  }

  // ---------- Rig: pig-specific bones ----------
  _prepareRig(root) {
    const boneMap = new Map();
    root.traverse(function (o) {
      if (o.isSkinnedMesh && o.skeleton) {
        for (let i = 0; i < o.skeleton.bones.length; i++) {
          const b = o.skeleton.bones[i];
          if (!b || !b.name) continue;
          let top = b;
          while (top.parent && top.parent.name === b.name) top = top.parent;
          if (!boneMap.has(b.name)) boneMap.set(b.name, top);
        }
      }
    });

    const FL = boneMap.get("LegFL") || root.getObjectByName("LegFL") || null;
    const FR = boneMap.get("LegFR") || root.getObjectByName("LegFR") || null;
    const BL = boneMap.get("LegBL") || root.getObjectByName("LegBL") || null;
    const BR = boneMap.get("LegBR") || root.getObjectByName("LegBR") || null;
    const Head = boneMap.get("Head") || root.getObjectByName("Head") || null;

    this._rig.legs = { FL, FR, BL, BR };
    this._rig.legBones = [FL, FR, BL, BR].filter(Boolean);
    this._rig.head = Head;

    for (let i = 0; i < this._rig.legBones.length; i++) {
      const b = this._rig.legBones[i];
      b.userData.baseQuat = b.quaternion.clone();
    }
    if (Head) Head.userData.baseQuat = Head.quaternion.clone();
  }

  // ---------- Animation: pig gait + head bob ----------
  _animateLegs(dt, horizSpeed, inLiquid) {
    const legs = this._rig.legBones;
    if (!legs || legs.length === 0) return;

    const speedNorm = Math.min(
      Math.max(horizSpeed / Math.max(this.walkSpeed, 1e-6), 0),
      1
    );

    const baseAmp = inLiquid ? 0.1 : 0.22; // radians
    const amp =
      speedNorm < 0.05
        ? 0
        : baseAmp * (0.4 + 0.6 * speedNorm) * this.legAmpScale;
    const baseHz = inLiquid ? 0.8 : 1.0;
    const maxHz = inLiquid ? 1.2 : 1.6;
    const freq = (baseHz + (maxHz - baseHz) * speedNorm) * this.legHzScale;
    const phase = this._time * freq * Math.PI * 2;

    const axis =
      this.legAxis === "y"
        ? new T.Vector3(0, 1, 0)
        : this.legAxis === "z"
        ? new T.Vector3(0, 0, 1)
        : new T.Vector3(1, 0, 0);

    function swingQuat(angle) {
      return new T.Quaternion().setFromAxisAngle(axis, angle);
    }
    function applySwing(bone, angle) {
      if (!bone) return;
      const base = bone.userData.baseQuat || bone.quaternion;
      bone.quaternion.copy(base).multiply(swingQuat(angle));
    }

    const FL = this._rig.legs.FL,
      FR = this._rig.legs.FR,
      BL = this._rig.legs.BL,
      BR = this._rig.legs.BR;

    const s0 = Math.sin(phase) * amp;
    const s1 = Math.sin(phase + Math.PI) * amp;
    applySwing(FL, s0);
    applySwing(BR, s0);
    applySwing(FR, s1);
    applySwing(BL, s1);

    // Gentle head bob ONLY when not scanning
    const head = this._rig.head;
    const scanning = this._headScan && this._headScan.active ? true : false;
    if (!inLiquid && !scanning && (this.state === "walk" || speedNorm > 0.1)) {
      const bobAxis = new T.Vector3(1, 0, 0);
      const bob = 0.03 * speedNorm * Math.sin(phase * 0.5);
      const qBob = new T.Quaternion().setFromAxisAngle(bobAxis, bob);
      if (head && head.userData && head.userData.baseQuat)
        head.quaternion.copy(head.userData.baseQuat).multiply(qBob);
    }
  }
}

let sheepCounter = 0;

//this class has been generated with the help of copilot
export class GrSheep extends GrEntity {
  constructor(modelPath, voxelWorld, opts = {}) {
    super(`GrSheep${sheepCounter++}`, modelPath, voxelWorld, {
      // Sheep-y defaults (can still be overridden via opts)
      walkSpeed: 1.3, // a bit slower than pig
      swimSpeed: 0.8,
      wanderRadius: 15, // stays closer
      idleChance: 0.5, // more likely to idle/graze
      halfWidth: 0.4,
      height: 1.2,
      chest: 0.75,
      footClear: 0.05,
      bobAmp: 0.2,

      // Slightly puffier scale if needed, tweak if it looks wrong
      modelScale: 0.003,
      color: 0xffffff,

      ...opts,
    });

    // Grazing state
    this._grazing = false;
    this.grazeChance =
      opts.grazeChance !== undefined && opts.grazeChance !== null
        ? opts.grazeChance
        : 0.3;
    this.grazeMin =
      opts.grazeMin !== undefined && opts.grazeMin !== null
        ? opts.grazeMin
        : 1.5;
    this.grazeMax =
      opts.grazeMax !== undefined && opts.grazeMax !== null
        ? opts.grazeMax
        : 3.0;

    // NEW: environment config
    this.grazeScanRadius =
      opts.grazeScanRadius !== undefined ? opts.grazeScanRadius : 2; // blocks
    this.grazeMinBlocks =
      opts.grazeMinBlocks !== undefined ? opts.grazeMinBlocks : 4; // how many grass blocks needed

    // Either a list of block IDs, or a predicate
    this.grazeBlockIds = opts.grazeBlockIds || [BLOCK.GRASS_BLOCK];
    this.grazeReplaceId =
      opts.grazeReplaceId !== undefined && opts.grazeReplaceId !== null
        ? opts.grazeReplaceId
        : BLOCK.DIRT; // or BLOCK.DIRT_BLOCK – match your IDs

    // Runtime grazing target
    this._grazeTarget = null; // { x, y, z } of chosen block
    this._grazeTime = 0; // how long we've been grazing this patch
    this._grazeEatDelay = 1.0; // seconds until the block gets eaten
  }

  // ---------- Rig: sheep-specific bones ----------
  _prepareRig(root) {
    const boneMap = new Map();
    root.traverse(function (o) {
      if (o.isSkinnedMesh && o.skeleton) {
        for (let i = 0; i < o.skeleton.bones.length; i++) {
          const b = o.skeleton.bones[i];
          if (!b || !b.name) continue;
          let top = b;
          while (top.parent && top.parent.name === b.name) top = top.parent;
          if (!boneMap.has(b.name)) boneMap.set(b.name, top);
        }
      }
    });

    const FL = boneMap.get("LegFL") || root.getObjectByName("LegFL") || null;
    const FR = boneMap.get("LegFR") || root.getObjectByName("LegFR") || null;
    const BL = boneMap.get("LegBL") || root.getObjectByName("LegBL") || null;
    const BR = boneMap.get("LegBR") || root.getObjectByName("LegBR") || null;
    const Head = boneMap.get("Head") || root.getObjectByName("Head") || null;
    const Spine = boneMap.get("Spine") || root.getObjectByName("Spine") || null;

    this._rig.legs = { FL, FR, BL, BR };
    this._rig.legBones = [FL, FR, BL, BR].filter(Boolean);
    this._rig.head = Head;
    this._rig.neck = Spine;

    for (let i = 0; i < this._rig.legBones.length; i++) {
      const b = this._rig.legBones[i];
      b.userData.baseQuat = b.quaternion.clone();
    }
    if (Head) {
      Head.userData.baseQuat = Head.quaternion.clone();
      Head.userData.basePos = Head.position.clone(); // <-- REQUIRED
    }
    if (Spine) {
      Spine.userData.baseQuat = Spine.quaternion.clone();
    }
  }

  // ---------- Grazing helpers ----------
  _beginGraze() {
    // Choose a grass block to nibble on
    this._grazeTarget = this._pickGrazeTargetBlock();
    if (!this._grazeTarget) {
      // No actual block to eat → fall back to normal idle/head-scan
      if (super._maybeEnterIdleByChance) {
        super._maybeEnterIdleByChance("no-graze-target");
      }
      return;
    }

    this._grazing = true;
    this.state = "idle";

    const min = this.grazeMin;
    const max = this.grazeMax;
    this._idleTimer = min + Math.random() * Math.max(0.01, max - min);

    this.dir.set(0, 0, 0);

    if (this._headScan) {
      this._headScan.active = false;
    }

    // Reset grazing timer + random delay until we actually “eat” the block
    this._grazeTime = 0;
    this._grazeEatDelay = 0.7 + Math.random() * 0.8; // 0.7–1.5s, tweak to taste
  }

  _consumeGrazeBlock() {
    if (!this._grazeTarget) return;

    const { x, y, z } = this._grazeTarget;
    const id = this.world.getBlockWorld(x, y, z);

    // Only replace if it's still grazeable (hasn't been changed by something else)
    if (this._isGrazeBlockId(id)) {
      // Adjust to your actual world API
      console.log("replaced some block!");
      this.world.setBlockWorld(x, y, z, this.grazeReplaceId);
    }
  }

  _updateGraze(dt) {
    if (!this._grazing || !this._grazeTarget) return;

    this._grazeTime += dt;

    if (this._grazeTime >= this._grazeEatDelay) {
      this._consumeGrazeBlock();
      // Only eat once per graze session; you could let it pick another target if you want
      this._grazeTarget = null;
    }
  }

  // When idle finishes (GrEntity will flip state away from "idle"), we stop grazing
  _endGraze() {
    this._grazing = false;
    this._grazeTarget = null;
  }

  _canGrazeHere() {
    // Find floor under the sheep
    const floorY = this._findFloorYBelow(
      this.pos.x,
      this.pos.y + 0.5,
      this.pos.z,
      8
    );
    if (!isFinite(floorY)) return false;

    // Block that forms the floor is at y = floorY - 1
    const baseX = this._floor(this.pos.x);
    const baseZ = this._floor(this.pos.z);
    const blockY = floorY - 1;

    let count = 0;
    const r = this.grazeScanRadius | 0;

    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        // Optional: circular area instead of square
        if (dx * dx + dz * dz > r * r) continue;

        const id = this.world.getBlockWorld(baseX + dx, blockY, baseZ + dz);
        if (this._isGrazeBlockId(id)) {
          count++;
          if (count >= this.grazeMinBlocks) {
            return true;
          }
        }
      }
    }

    return false;
  }

  _isGrazeBlockId(id) {
    if (id == null) return false;

    // Let opts override everything
    if (this.isGrazeBlock) {
      return this.isGrazeBlock(id, this.world);
    }

    if (this.grazeBlockIds && this.grazeBlockIds.length > 0) {
      return this.grazeBlockIds.includes(id);
    }

    // Fallback: treat no blocks as grazeable unless specified
    return false;
  }

  // In GrSheep (or wherever your graze logic lives)
  _pickGrazeTargetBlock() {
    // 1) Prefer a block directly under the HEAD
    if (this._rig && this._rig.head) {
      // world-space head position
      if (!this._headWorldPos) this._headWorldPos = new T.Vector3();

      const head = this._rig.head;
      head.updateWorldMatrix(true, false);
      head.getWorldPosition(this._headWorldPos);

      const hx = this._headWorldPos.x;
      const hy = this._headWorldPos.y;
      const hz = this._headWorldPos.z;

      // Find “floor” below the head (water/solid)
      const floorY = this._findFloorYBelow(hx, hy, hz, 8);
      if (isFinite(floorY)) {
        // The grass block itself is just below the floor (like your old code)
        const gx = this._floor(hx);
        const gz = this._floor(hz);
        const gy = floorY - 1;

        const id = this.world.getBlockWorld(gx, gy, gz);
        if (this._isGrazeBlockId(id)) {
          // ✅ This is the block the sheep is actually over with its head
          return { x: gx, y: gy, z: gz };
        }

        // 1b) Small local search around head (just in case the head is slightly off)
        const r = this.grazeScanRadius | 0; // e.g., 2
        for (let dz = -r; dz <= r; dz++) {
          for (let dx = -r; dx <= r; dx++) {
            const x = gx + dx;
            const z = gz + dz;

            // for robustness, you can either reuse gy
            const id2 = this.world.getBlockWorld(x, gy, z);
            if (this._isGrazeBlockId(id2)) {
              return { x, y: gy, z };
            }
          }
        }
      }
    }

    // 2) Fallback: feet-based search (no longer random; pick nearest)
    const floorYFeet = this._findFloorYBelow(
      this.pos.x,
      this.pos.y + 0.5,
      this.pos.z,
      8
    );
    if (!isFinite(floorYFeet)) return null;

    const baseX = this._floor(this.pos.x);
    const baseZ = this._floor(this.pos.z);
    const blockY = floorYFeet - 1;

    const r = this.grazeScanRadius | 0;
    let best = null;
    let bestDist2 = Infinity;

    for (let dz = -r; dz <= r; dz++) {
      for (let dx = -r; dx <= r; dx++) {
        // optional: keep circular
        if (dx * dx + dz * dz > r * r) continue;

        const x = baseX + dx;
        const z = baseZ + dz;
        const id = this.world.getBlockWorld(x, blockY, z);
        if (!this._isGrazeBlockId(id)) continue;

        const d2 = dx * dx + dz * dz;
        if (d2 < bestDist2) {
          bestDist2 = d2;
          best = { x, y: blockY, z };
        }
      }
    }

    return best; // may be null if nothing found
  }

  _maybeEnterIdleByChance(reason) {
    // Prefer grazing, but only if enough grass is around
    if (Math.random() < this.grazeChance && this._canGrazeHere()) {
      this._beginGraze();
      return true;
    }

    // Otherwise, fall back to normal head-scan idle from GrEntity
    return super._maybeEnterIdleByChance(reason);
  }

  // ---------- Step hook: clear grazing when idle ends ----------
  stepTick(delta) {
    // Let base handle physics, state transitions, swim, etc.
    const dt = this._dt(delta);
    super.stepTick(delta);

    // If we were grazing but the base logic kicked us out of idle, stop grazing
    if (this._grazing && this.state !== "idle") {
      this._endGraze();
    }
    // Grazing animation pass
    if (this._grazing) {
      this._updateGraze(dt);
      this._animateGraze(dt);
    } else {
      this._restoreGrazePose(dt);
    }
  }

  _animateGraze(dt) {
    const head = this._rig.head;
    const neck = this._rig.neck;
    if (!head || !head.userData || !head.userData.baseQuat) return;

    // ----- Head downward tilt + nibble -----
    const axis = new T.Vector3(0, 0, 1);

    const downAngle = -1.0;
    const nibble = 0.12 * Math.sin(this._time * 6.0);

    const headQ = head.userData.baseQuat
      .clone()
      .multiply(new T.Quaternion().setFromAxisAngle(axis, downAngle + nibble));

    head.quaternion.slerp(headQ, 1 - Math.exp(-7 * dt));

    // ----- Neck tilt assist (optional) -----
    if (neck && neck.userData && neck.userData.baseQuat) {
      const neckDown = -0.2;
      const neckQ = neck.userData.baseQuat
        .clone()
        .multiply(new T.Quaternion().setFromAxisAngle(axis, neckDown));
      neck.quaternion.slerp(neckQ, 1 - Math.exp(-7 * dt));
    }

    // ----- Translate head downward slightly -----
    if (head.userData.basePos) {
      const offset = new T.Vector3(0, -0.12, 0.05);
      head.position.copy(head.userData.basePos).add(offset);
    }
  }

  _restoreGrazePose(dt) {
    const head = this._rig.head;
    const neck = this._rig.neck;

    if (head && head.userData && head.userData.baseQuat) {
      const baseHead = head.userData.baseQuat;
      const lerp = 1 - Math.exp(-5 * dt);
      head.quaternion.slerp(baseHead, lerp);

      if (head.userData.basePos) {
        head.position.copy(head.userData.basePos);
      }
    }

    if (neck && neck.userData && neck.userData.baseQuat) {
      const baseNeck = neck.userData.baseQuat;
      const lerpN = 1 - Math.exp(-5 * dt);
      neck.quaternion.slerp(baseNeck, lerpN);
    }
  }

  // ---------- Animation: sheep gait + grazing head pose ----------
  _animateLegs(dt, horizSpeed, inLiquid) {
    const legs = this._rig.legBones;
    if (!legs || legs.length === 0) return;

    /** -------------------
     *  LEG ANIMATION
     * ------------------- */
    const speedNorm = Math.min(
      Math.max(horizSpeed / Math.max(this.walkSpeed, 1e-6), 0),
      1
    );

    const baseAmp = inLiquid ? 0.1 : 0.2;
    const amp =
      speedNorm < 0.05
        ? 0
        : baseAmp * (0.4 + 0.6 * speedNorm) * this.legAmpScale;

    const baseHz = inLiquid ? 0.7 : 0.9;
    const maxHz = inLiquid ? 1.2 : 1.4;
    const freq = (baseHz + (maxHz - baseHz) * speedNorm) * this.legHzScale;
    const phase = this._time * freq * Math.PI * 2;

    const axis =
      this.legAxis === "y"
        ? new T.Vector3(0, 1, 0)
        : this.legAxis === "z"
        ? new T.Vector3(0, 0, 1)
        : new T.Vector3(1, 0, 0);

    function swingQuat(angle) {
      return new T.Quaternion().setFromAxisAngle(axis, angle);
    }
    function applySwing(bone, angle) {
      if (!bone) return;
      const base = bone.userData.baseQuat || bone.quaternion;
      bone.quaternion.copy(base).multiply(swingQuat(angle));
    }

    const FL = this._rig.legs.FL,
      FR = this._rig.legs.FR,
      BL = this._rig.legs.BL,
      BR = this._rig.legs.BR;

    const s0 = Math.sin(phase) * amp;
    const s1 = Math.sin(phase + Math.PI) * amp;

    applySwing(FL, s0);
    applySwing(BR, s0);
    applySwing(FR, s1);
    applySwing(BL, s1);

    /** -------------------
     *  NORMAL HEAD BOB
     * ------------------- */
    const head = this._rig.head;
    if (!head) return;

    const scanning = this._headScan && this._headScan.active ? true : false;
    const axisX = new T.Vector3(1, 0, 0);

    if (!inLiquid && !scanning && (this.state === "walk" || speedNorm > 0.1)) {
      const bob = 0.03 * speedNorm * Math.sin(phase * 0.5);
      const qBob = new T.Quaternion().setFromAxisAngle(axisX, bob);
      head.quaternion.copy(head.userData.baseQuat).multiply(qBob);
    }
  }
}

let creeperCounter = 0;

// this class has been generated with the help of copilot
export class GrCreeper extends GrEntity {
  constructor(modelPath, voxelWorld, opts = {}) {
    super(`GrCreeper${creeperCounter++}`, modelPath, voxelWorld, {
      // Creeper-ish movement defaults
      walkSpeed: 1.8,
      swimSpeed: 0.8,
      wanderRadius: 12,
      idleChance: 0.4,
      // Hitbox
      halfWidth: 0.28,
      height: 1.65,
      chest: 1.45,
      footClear: 0.02,
      // Bobbing
      bobAmp: 0.18,
      // Model
      modelScale: 0.003,
      headScanAxis: "y",
      color: 0x00ff00,
      ...opts,
    });

    // ⭐ Simple chase + explode tuning
    this.chaseRange = opts.chaseRange ?? 20;
    this.explodeRange = opts.explodeRange ?? 2.5;
    this.explodeFuseTime = opts.explodeFuseTime ?? 1.5;
    this.explodeDamageRadius = opts.explodeDamageRadius ?? 3.5;
    this.explodeKnockback = opts.explodeKnockback ?? 12;
    this.explodeKnockUp = opts.explodeKnockUp ?? 10;

    this._exploding = false;
    this._fuseTimer = 0;
    this._flashPhase = 0;
    this._skinMeshes = [];
    this._chasingPlayer = false;
  }

  // ---------- Rig: creeper-specific bones ----------
  _prepareRig(root) {
    const boneMap = new Map();

    root.traverse((o) => {
      // ⭐ Collect skinned meshes so we can flash them later
      if (o.isSkinnedMesh || o.isMesh) {
        this._skinMeshes.push(o);

        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const mat of mats) {
          if (!mat) continue;
          if (!mat.userData) mat.userData = {};

          if (mat.color && !mat.userData.baseColor) {
            mat.userData.baseColor = mat.color.clone();
          }
          if (mat.emissive && !mat.userData.baseEmissive) {
            mat.userData.baseEmissive = mat.emissive.clone();
          }
        }
      }

      if (o.isSkinnedMesh && o.skeleton) {
        for (let i = 0; i < o.skeleton.bones.length; i++) {
          const b = o.skeleton.bones[i];
          if (!b || !b.name) continue;
          let top = b;
          while (top.parent && top.parent.name === b.name) top = top.parent;
          if (!boneMap.has(b.name)) boneMap.set(b.name, top);
        }
      }
    });

    const FL = boneMap.get("FLLeg") || root.getObjectByName("FLLeg") || null;
    const FR = boneMap.get("FRLeg") || root.getObjectByName("FRLeg") || null;
    const BL = boneMap.get("BLLeg") || root.getObjectByName("BLLeg") || null;
    const BR = boneMap.get("BRLeg") || root.getObjectByName("BRLeg") || null;
    const Head = boneMap.get("Head") || root.getObjectByName("Head") || null;
    const Spine = boneMap.get("Spine") || root.getObjectByName("Spine") || null;

    this._rig.legs = { FL, FR, BL, BR };
    this._rig.legBones = [FL, FR, BL, BR].filter(Boolean);
    this._rig.head = Head;
    this._rig.spine = Spine;

    for (let i = 0; i < this._rig.legBones.length; i++) {
      const b = this._rig.legBones[i];
      b.userData.baseQuat = b.quaternion.clone();
    }
    if (Head) {
      Head.userData.baseQuat = Head.quaternion.clone();
      Head.userData.basePos = Head.position.clone();
    }
    if (Spine) {
      Spine.userData.baseQuat = Spine.quaternion.clone();
    }
  }

  // ---------- Animation: creeper gait + subtle head bob ----------
  _animateLegs(dt, horizSpeed, inLiquid) {
    const legs = this._rig.legBones;
    if (!legs || legs.length === 0) return;

    const speedNorm = Math.min(
      Math.max(horizSpeed / Math.max(this.walkSpeed, 1e-6), 0),
      1
    );

    const baseAmp = inLiquid ? 0.08 : 0.16;
    const amp =
      speedNorm < 0.05
        ? 0
        : baseAmp * (0.5 + 0.5 * speedNorm) * this.legAmpScale;

    const baseHz = inLiquid ? 0.7 : 0.9;
    const maxHz = inLiquid ? 1.2 : 1.4;
    const freq = (baseHz + (maxHz - baseHz) * speedNorm) * this.legHzScale;
    const phase = this._time * freq * Math.PI * 2;

    const axis =
      this.legAxis === "y"
        ? new T.Vector3(0, 1, 0)
        : this.legAxis === "z"
        ? new T.Vector3(0, 0, 1)
        : new T.Vector3(1, 0, 0);

    function swingQuat(angle) {
      return new T.Quaternion().setFromAxisAngle(axis, angle);
    }
    function applySwing(bone, angle) {
      if (!bone) return;
      const base = bone.userData.baseQuat || bone.quaternion;
      bone.quaternion.copy(base).multiply(swingQuat(angle));
    }

    const FL = this._rig.legs.FL,
      FR = this._rig.legs.FR,
      BL = this._rig.legs.BL,
      BR = this._rig.legs.BR;

    const s0 = Math.sin(phase) * amp;
    const s1 = Math.sin(phase + Math.PI) * amp;
    applySwing(FL, s0);
    applySwing(BR, s0);
    applySwing(FR, s1);
    applySwing(BL, s1);

    const head = this._rig.head;
    const spine = this._rig.spine;
    if (!head || !head.userData || !head.userData.baseQuat) return;

    const baseHeadQuat = head.userData.baseQuat;
    const scanning = this._headScan && this._headScan.active ? true : false;

    if (!inLiquid && !scanning && (this.state === "walk" || speedNorm > 0.1)) {
      const bobAxis = new T.Vector3(1, 0, 0);
      const bob = 0.02 * speedNorm * Math.sin(phase * 0.6);
      const qBob = new T.Quaternion().setFromAxisAngle(bobAxis, bob);
      head.quaternion.copy(baseHeadQuat).multiply(qBob);

      if (spine && spine.userData && spine.userData.baseQuat) {
        const baseSpineQuat = spine.userData.baseQuat;
        const swayAxis = new T.Vector3(0, 1, 0);
        const sway = 0.01 * Math.sin(phase * 0.5);
        const qSway = new T.Quaternion().setFromAxisAngle(swayAxis, sway);
        spine.quaternion.copy(baseSpineQuat).multiply(qSway);
      }
      return;
    }

    if (!scanning) {
      const relaxLerp = 1 - Math.exp(-5 * dt);
      head.quaternion.slerp(baseHeadQuat, relaxLerp);

      if (spine && spine.userData && spine.userData.baseQuat) {
        const baseSpineQuat = spine.userData.baseQuat;
        spine.quaternion.slerp(baseSpineQuat, relaxLerp);
      }
      return;
    }
  }

  // ============================================================
  // ⭐ AI + Explosion logic
  // ============================================================

  _getPlayer() {
    return this.world.player;
  }

  // ⭐ Override idle-by-chance: NEVER idle while chasing
  _maybeEnterIdleByChance(reason) {
    if (this._chasingPlayer) {
      // Stay in walk while aggro
      this.state = "walk";
      this._headScan.active = false;
      return false;
    }
    // Normal behavior when not chasing
    return super._maybeEnterIdleByChance(reason);
  }

  // ⭐ Override target picking: chase player if in chase mode
  _pickNewTarget(reason) {
    const player = this._getPlayer();

    if (this._chasingPlayer && player) {
      this.target.set(player.pos.x, this.pos.y, player.pos.z);
      return;
    }

    super._pickNewTarget(reason);
  }

  // ⭐ Called after base physics each tick
  stepTick(delta) {
    super.stepTick(delta);

    const dt = Math.min(delta * 0.001, 0.05);
    this._updateChaseAndExplosion(dt);
  }

  _updateChaseAndExplosion(dt) {
    const player = this._getPlayer();
    if (!player || this.dead) {
      this._chasingPlayer = false;
      this._resetFuseAndFlash();
      return;
    }

    const dx = player.pos.x - this.pos.x;
    const dy = player.pos.y - this.pos.y;
    const dz = player.pos.z - this.pos.z;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

    // ---------- CHASE LOGIC ----------
    if (!this._exploding) {
      if (dist <= this.chaseRange) {
        this._chasingPlayer = true;
        const chaseY = this.pos.y;
        this.target.set(player.pos.x, chaseY, player.pos.z);

        // ⭐ If we were idle/head-scanning, snap back into walk right away
        if (this.state === "idle") {
          this.state = "walk";
          this._headScan.active = false;
          this._idleTimer = 0;
        }
      } else {
        this._chasingPlayer = false;
      }

      // Start fuse when close enough
      if (dist <= this.explodeRange) {
        this._exploding = true;
        this._fuseTimer = this.explodeFuseTime;
        this._flashPhase = 0;

        this._chasingPlayer = false;
        // 🚫 STOP SELF MOVEMENT
        this._freezeSelfMovement = true;
        this.state = "idle";
        this.dir.set(0, 0, 0);
        this.target.copy(this.pos);
      }

      return;
    }

    // ---------- FUSE ALREADY ACTIVE ----------
    if (dist > this.explodeRange + 4.0 || this.isDead) {
      this._chasingPlayer = false;
      this._resetFuseAndFlash();
      return;
    }

    this._fuseTimer -= dt;
    this._updateFlash(dt);

    if (this._fuseTimer <= 0) {
      this._doExplosion(player);
    }
  }

  _updateFlash(dt) {
    this._flashPhase += dt * 10;
    const on = Math.floor(this._flashPhase) % 2 === 0;
    this._setFlashState(on);
  }

  _setFlashState(on) {
    for (const mesh of this._skinMeshes) {
      const mats = Array.isArray(mesh.material)
        ? mesh.material
        : [mesh.material];
      for (const mat of mats) {
        if (!mat) continue;
        const baseColor = mat.userData?.baseColor;
        const baseEmissive = mat.userData?.baseEmissive;

        if (on) {
          if (mat.emissive) {
            mat.emissive.setHex(0xffffff);
          } else if (mat.color) {
            mat.color.setHex(0xffffff);
          }
        } else {
          if (mat.emissive && baseEmissive) {
            mat.emissive.copy(baseEmissive);
          }
          if (mat.color && baseColor) {
            mat.color.copy(baseColor);
          }
        }
      }
    }
  }

  _resetFuseAndFlash() {
    this._exploding = false;
    this._fuseTimer = 0;
    this._flashPhase = 0;
    this._setFlashState(false);
    this._freezeSelfMovement = false;
  }

  _doExplosion(player) {
    const cx = Math.floor(this.pos.x);
    const cy = Math.floor(this.pos.y);
    const cz = Math.floor(this.pos.z);
    const r = this.explodeDamageRadius;

    if (this.world && this.world.getBlockWorld && this.world.setBlockWorld) {
      this.world.beginBatch();
      const rCeil = Math.ceil(r);
      for (let x = cx - rCeil; x <= cx + rCeil; x++) {
        for (let y = cy - rCeil; y <= cy + rCeil; y++) {
          for (let z = cz - rCeil; z <= cz + rCeil; z++) {
            const dx = x + 0.5 - this.pos.x;
            const dy = y + 0.5 - this.pos.y;
            const dz = z + 0.5 - this.pos.z;
            const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
            if (dist > r + 0.5) continue;

            const id = this.world.getBlockWorld(x, y, z);
            if (id !== BLOCK.AIR) {
              this.world.setBlockWorld(x, y, z, BLOCK.AIR);
            }
          }
        }
      }
      this.world.endBatch();
    }

    if (player && player.pos) {
      const push = new T.Vector3(
        player.pos.x - this.pos.x,
        0,
        player.pos.z - this.pos.z
      );
      const len = push.length();
      if (len > 1e-3) {
        push.divideScalar(len);

        if (player.jumpCarry) {
          player.jumpCarry.add(
            push.clone().multiplyScalar(this.explodeKnockback)
          );
        } else if (player.dir) {
          player.dir.add(push.clone().multiplyScalar(0.8));
        }

        if (typeof player.verticalVel === "number") {
          player.verticalVel = Math.max(
            player.verticalVel,
            this.explodeKnockUp
          );
        }
      }
    }

    this._resetFuseAndFlash();
    if (this.root) this.root.visible = false;

    this.world.despawnMob(this);
  }
}

// new FBXLoader().load(
//   "./models/minecraft-player/source/MinecraftPlayer/Player.fbx",
//   (fbx) => {
//     debugPrintBoneHierarchy(fbx);
//   }
// );

// Debug: print full hierarchy, marking bones and skinned meshes
// this function has been generated with the help of copilot
function debugPrintBoneHierarchy(object3D) {
  console.log("===== Debug Hierarchy:", object3D.name || "(root)", "=====");

  function walk(node, depth) {
    const indent = "  ".repeat(depth);

    const name = node.name && node.name.length ? node.name : "(no-name)";
    const tags = [];

    if (node.isBone) tags.push("BONE");
    if (node.isSkinnedMesh) tags.push("SKINNED_MESH");
    if (node.type) tags.push(node.type);

    const tagStr = tags.length ? ` [${tags.join(", ")}]` : "";

    console.log(`${indent}${name}${tagStr}`);

    for (const child of node.children) {
      walk(child, depth + 1);
    }
  }

  walk(object3D, 0);
  console.log("===== End Hierarchy =====");
}

// this class has been generated with the help of copilot
export class GrPlayer extends GrEntity {
  constructor(modelPath, voxelWorld, scene, opts = {}) {
    const mergedOpts = {
      // Player-sized capsule
      height: 1.7,
      halfWidth: 0.35,
      chest: 1.0,

      // Movement
      walkSpeed: 4.0,
      swimSpeed: 2.0,
      airControl: 0.6, // slightly tamer in air

      // Disable AI idling/wander
      idleChance: 0.0,
      wanderRadius: 32,

      // Animation axes
      legAxis: "z",
      armAxis: "z",

      // Forward carry while jumping (bunny-hop feel, but not crazy)
      jumpCarryFactor: 0.35,
      jumpSpeed: 8.0,
      modelScale: 0.003,
      color: 0x0000ff,

      ...opts,
    };

    super("Player", modelPath, voxelWorld, mergedOpts);
    this.waterTintEl = opts.waterTintEl;
    this.armAxis = mergedOpts.armAxis ?? mergedOpts.legAxis ?? "z";
    this.scene = scene;

    // ---------- View / camera ----------
    this.camera = opts.camera || null;
    this._viewMode = opts.viewMode || "third"; // "first" | "third"
    this.cameraHeight = opts.cameraHeight ?? 1.5; // eye height from feet
    this.cameraDistance = opts.cameraDistance ?? 5.0;
    // extra lift only in first-person
    this.firstPersonEyeExtra = opts.firstPersonEyeExtra ?? 0.15;
    this.firstPersonForwardOffset = opts.firstPersonForwardOffset ?? 0.3;

    // Look angles
    this.yaw = 0;
    this.pitch = 0;
    this.pitchMin = -Math.PI / 2 + 0.1; // look almost straight up/down
    this.pitchMax = Math.PI / 2 - 0.1;

    this.mouseSensitivity = opts.mouseSensitivity ?? 0.0025;
    this.turnSpeed = opts.turnSpeed ?? 1.8; // keyboard yaw speed (unused if pointer lock)

    // ---------- Input state ----------
    this._keys = {}; // e.code → boolean
    this._wantJump = false;

    this.domElement = opts.domElement || null; // should be renderer.domElement
    this._mouseLookEnabled = true; // we use pointer lock

    // ---------- Mesh tracking for view mode ----------
    this._meshParts = {
      all: [],
      head: null,
      headOut: null,
    };

    // ---------- Swim ----------
    this._swimUp = false;
    this._swimDown = false;
    this.swimUpSpeed = 5.0;
    this.swimDownSpeed = 4.0;

    // ---------- Sprint / Sneak / FOV ----------
    this.isSprinting = false;
    this.isSneaking = false;
    this._moveForward = 0;
    this._moveSide = 0;

    this.baseFov = this.camera ? this.camera.fov : 70;
    this.currentFov = this.baseFov;
    this.sprintFov = this.baseFov + 10;
    this.sneakFov = this.baseFov - 5;
    this._fovLerpSpeed = 8.0;
    this._lastSafePos = new T.Vector3(0, 70, 0); // or whatever initial spawn

    // ---------- Held item + hand swing ----------
    this.heldItem = null;
    this.heldItemMesh = null;

    this._handSocket = null;
    this._handSwingPhase = 1; // 1 = idle
    this._handSwingSpeed = 8.0; // how fast the swing plays
    this._handSwingAmount = 0.9; // radians amplitude

    // ---------- Block highlight + targeting ----------
    this.reachDistance = opts.reachDistance ?? 5.0;
    this._aimBlock = null; // T.Vector3 of solid block you're looking at
    this._aimBlockId = BLOCK.AIR;
    this._aimPlacePos = null; // T.Vector3 of empty cell where we'd place a block

    const highlightGeo = new T.BoxGeometry(1.02, 1.02, 1.02);
    const highlightMat = new T.MeshBasicMaterial({
      color: 0xffff00,
      wireframe: true,
      transparent: true,
      opacity: 0.9,
      depthWrite: false,
    });
    this._blockHighlight = new T.Mesh(highlightGeo, highlightMat);
    this._blockHighlight.visible = false;
    this.root.add(this._blockHighlight);

    // ---------- Bind input ----------
    this._bindInputEvents();
  }

  // Small helper
  _key(code) {
    return !!this._keys[code];
  }

  // ---------------- Input binding (keys + pointer lock) ----------------
  _bindInputEvents() {
    this._onKeyDown = (e) => {
      this._keys[e.code] = true;

      // Toggle first/third person
      if (e.code === "F5" || e.code === "KeyV") {
        this._toggleViewMode();
      }

      if (e.code === "KeyK") {
        this.world.spawnMobAt(
          "creeper",
          this.pos.x + 6,
          this.pos.y + 4,
          this.pos.z
        );
      }

      if (e.code === "KeyL") {
        this.world.spawnMobAt("pig", this.pos.x, this.pos.y + 4, this.pos.z);
      }

      if (e.code === "KeyJ") {
        this.world.spawnMobAt("sheep", this.pos.x, this.pos.y + 4, this.pos.z);
      }

      if (e.code === "KeyC") {
        this.setHeldItem(null);
      }
    };

    this._onKeyUp = (e) => {
      this._keys[e.code] = false;
    };

    window.addEventListener("keydown", this._onKeyDown);
    window.addEventListener("keyup", this._onKeyUp);

    this._onMouseDown = (e) => {
      if (!this.domElement) return;
      // Only interact when pointer lock is active on the canvas
      if (document.pointerLockElement !== this.domElement) return;

      // 0 = left, 2 = right
      if (e.button === 0) {
        this.triggerHandSwing();
        this._handlePrimaryInteraction();
      } else if (e.button === 2) {
        e.preventDefault();
        // Place block
        this._tryPlaceBlock();
      }
    };

    window.addEventListener("mousedown", this._onMouseDown);

    // Pointer lock + mouse look
    if (this.domElement && this._mouseLookEnabled) {
      const canvas = this.domElement;

      this._onClick = () => {
        if (document.pointerLockElement !== canvas) {
          canvas.requestPointerLock();
        }
      };

      this._onMouseMove = (e) => {
        if (document.pointerLockElement !== canvas) return;

        const dx = e.movementX ?? 0;
        const dy = e.movementY ?? 0;

        this.yaw -= dx * this.mouseSensitivity;
        this.pitch -= dy * this.mouseSensitivity;

        if (this.pitch < this.pitchMin) this.pitch = this.pitchMin;
        if (this.pitch > this.pitchMax) this.pitch = this.pitchMax;
      };

      canvas.addEventListener("click", this._onClick);
      document.addEventListener("mousemove", this._onMouseMove);

      this._onContextMenu = (e) => {
        e.preventDefault();
      };
      canvas.addEventListener("contextmenu", this._onContextMenu);
    }
  }

  dispose() {
    window.removeEventListener("keydown", this._onKeyDown);
    window.removeEventListener("keyup", this._onKeyUp);
    window.removeEventListener("mousedown", this._onMouseDown);

    if (this.domElement && this._mouseLookEnabled) {
      const canvas = this.domElement;
      if (this._onClick) canvas.removeEventListener("click", this._onClick);
      if (this._onMouseMove)
        document.removeEventListener("mousemove", this._onMouseMove);
      if (this._onContextMenu)
        canvas.removeEventListener("contextmenu", this._onContextMenu);
    }
  }

  triggerHandSwing() {
    this._handSwingPhase = 0; // restart swing
  }

  _updateHandSwing(dt) {
    // Just advance 0 → 1, swing shape is applied in _animateLegs
    if (this._handSwingPhase < 1) {
      this._handSwingPhase += dt * this._handSwingSpeed;
      if (this._handSwingPhase > 1) this._handSwingPhase = 1;
    }
  }

  // ---------------- View mode ----------------
  _toggleViewMode() {
    this._viewMode = this._viewMode === "third" ? "first" : "third";
    this._applyViewModeVisibility();
  }
  _applyViewModeVisibility() {
    const m = this._meshParts;
    if (!m) return;

    // 1) Show everything by default
    if (m.all && m.all.length) {
      for (const mesh of m.all) {
        mesh.visible = true;
      }
    }

    // 2) In first-person, hide just the head meshes
    if (this._viewMode === "first") {
      if (m.head) m.head.visible = false;
      if (m.headOut) m.headOut.visible = false;
    }
  }

  // ---------------- Disable AI behaviors ----------------
  _pickNewTarget(reason) {
    // Player doesn’t wander randomly.
    const r = 10;
    this.target.set(
      this.pos.x + Math.sin(this.yaw) * r,
      0,
      this.pos.z + Math.cos(this.yaw) * r
    );
  }
  _maybeEnterIdleByChance(reason) {
    return false;
  }
  _beginHeadScan() {}
  _updateHeadScan(dt) {
    return false;
  }
  _maybeAutoJump() {
    return false;
  }
  _faceTowardTarget() {
    return this._len2(this.dir.x, this.dir.z) > 1e-6;
  }

  // ---------------- Rig setup ----------------
  _prepareRig(root) {
    if (window.prototype) return;
    const boneMap = new Map();

    root.traverse((o) => {
      if (o.isSkinnedMesh) {
        const mats = Array.isArray(o.material) ? o.material : [o.material];

        for (const mat of mats) {
          if (!mat) continue;
          mat.transparent = false; // ✅ disable transparency mode
          mat.opacity = 1;
          mat.alphaTest = 0.000001; // ✅ no alpha discard
          mat.depthWrite = true;
          mat.needsUpdate = true;
        }
        // --- TRACK MESHES FOR VIEW MODE ---
        this._meshParts.all.push(o);
        if (o.name === "Head") this._meshParts.head = o;
        if (o.name === "HeadOut") this._meshParts.headOut = o;
        if (o.skeleton) {
          for (let i = 0; i < o.skeleton.bones.length; i++) {
            const b = o.skeleton.bones[i];
            if (!b || !b.name) continue;
            let top = b;
            while (top.parent && top.parent.name === b.name) {
              top = top.parent;
            }
            if (!boneMap.has(b.name)) boneMap.set(b.name, top);
          }
        }
      }
    });

    const LLeg = boneMap.get("LLeg") || root.getObjectByName("LLeg") || null;
    const RLeg = boneMap.get("RLeg") || root.getObjectByName("RLeg") || null;
    const LArm = boneMap.get("LArm") || root.getObjectByName("LArm") || null;
    const RArm = boneMap.get("RArm") || root.getObjectByName("RArm") || null;
    const Spine = boneMap.get("Spine") || root.getObjectByName("Spine") || null;
    const Head = boneMap.get("Head") || root.getObjectByName("Head") || null;

    this._rig.legs = { L: LLeg, R: RLeg };
    this._rig.legBones = [LLeg, RLeg].filter(Boolean);
    this._rig.arms = { L: LArm, R: RArm };
    // ===== HAND SOCKET (ATTACHED TO RIGHT ARM BONE) =====

    if (RArm) {
      this._handSocket = new T.Object3D();
      this._handSocket.name = "RightHandSocket";

      // Position forward + down from arm bone pivot
      this._handSocket.position.set(1, 2, 0);
      this._handSocket.rotation.set(Math.PI / 2, 0, 0);

      // Save base pose so we can animate around it
      this._handSocket.userData.basePos = this._handSocket.position.clone();
      this._handSocket.userData.baseRot = this._handSocket.rotation.clone();

      RArm.add(this._handSocket);
    }

    this._rig.spine = Spine;
    this._rig.head = Head;

    const toTag = [LLeg, RLeg, LArm, RArm, Spine, Head].filter(Boolean);
    for (const b of toTag) {
      b.userData.baseQuat = b.quaternion.clone();
      b.userData.baseScale = b.scale.clone();
      b.userData.basePos = b.position.clone();
    }

    this._applyViewModeVisibility();
  }

  setHeldItem(blockId) {
    this.heldItem = blockId;

    if (!this._handSocket) return;

    // Remove existing item
    if (this.heldItemMesh) {
      this._handSocket.remove(this.heldItemMesh);
      this.heldItemMesh.traverse((o) => {
        if (o.isMesh) {
          if (o.geometry) o.geometry.dispose();
          if (o.material) o.material.dispose();
        }
      });
      this.heldItemMesh = null;
    }

    if (blockId == null) return;

    if (window.prototype) {
      const geom = new T.BoxGeometry(0.4, 0.4, 0.4);
      const mat = new T.MeshBasicMaterial({ color: 0xffff00 }); // Yellow item
      const mesh = new T.Mesh(geom, mat);
      this.heldItemMesh = mesh;
      this._handSocket.add(mesh);
      return;
    }

    const bd = getBlockData(blockId);
    if (!bd) return;

    const mesh =
      bd.kind === "cross"
        ? this._createCrossHeldItem(blockId, bd)
        : this._createSolidHeldItem(blockId, bd);

    // Minecraft-y scale in hand
    mesh.scale.set(1, 1, 1);

    this.heldItemMesh = mesh;
    this._handSocket.add(mesh);
  }

  _createSolidHeldItem(blockId, bd) {
    const positions = [];
    const normals = [];
    const uvs = [];
    const colors = [];
    const indices = [];
    let vertCount = 0;

    for (const f of HELD_FACES) {
      const rect = bd.faces[f.key];
      if (!rect) continue;

      // 1) Positions + normals (local cube from 0..1)
      for (let i = 0; i < 4; i++) {
        const vx = f.v[i][0];
        const vy = f.v[i][1];
        const vz = f.v[i][2];
        positions.push(vx, vy, vz);
        normals.push(f.n[0], f.n[1], f.n[2]);
      }

      // 2) UVs using same logic as chunk mesher
      let uv4 = HELD_UV_ORDER[f.key](rect);
      if (bd.rot && bd.rot[f.key]) {
        uv4 = heldRotUV4([...uv4], bd.rot[f.key]);
      }
      uvs.push(...uv4);

      // 3) Vertex colors (tint) – same as pushFace()
      const tint = bd.tints?.[f.key] ?? 0xffffff;
      const c = new T.Color(tint);
      for (let i = 0; i < 4; i++) {
        colors.push(c.r, c.g, c.b);
      }

      // 4) Indices
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

    // Center the cube so it sits nicely in the hand (from 0..1 => centered at origin)
    geom.translate(-0.5, -0.5, -0.5);

    const mat = new T.MeshLambertMaterial({
      map: atlasTexture,
      vertexColors: true,
      alphaTest: 0.5,
      side: T.FrontSide,
    });

    const mesh = new T.Mesh(geom, mat);
    mesh.rotation.y = Math.PI / 4; // slight turn so you see 3 faces

    return mesh;
  }

  _createCrossHeldItem(blockId, bd) {
    const baseMat = bd.material;

    const b = new T.Mesh(
      bd.geometry,
      baseMat.clone ? baseMat.clone() : baseMat
    );

    // Orient in hand
    b.rotation.z = -Math.PI / 2;
    b.rotation.y = -Math.PI / 6;

    const g = new T.Group();
    g.add(b);

    // ✅ Move this particular cross closer to the hand,
    // without touching the socket or solid blocks.
    // Tune these three numbers by eye:
    g.position.set(
      -0.6, // sideways relative to socket
      0, // slightly down into hand
      0 // pull toward the palm (negative Z if your socket points forward)
    );

    return g;
  }

  // ---------------- Walk / sprint / sneak animation ----------------
  _animateLegs(dt, horizSpeed, inLiquid) {
    const LLeg = this._rig.legs?.L;
    const RLeg = this._rig.legs?.R;
    const LArm = this._rig.arms?.L;
    const RArm = this._rig.arms?.R;
    const Spine = this._rig.spine;

    const speedNorm = Math.min(
      Math.max(horizSpeed / Math.max(this.walkSpeed, 1e-6), 0),
      1
    );

    // Base amplitudes
    let baseAmpLeg = inLiquid ? 0.2 : 0.35;
    let baseAmpArm = inLiquid ? 0.15 : 0.25;
    let baseHz = inLiquid ? 1.0 : 1.6;
    let maxHz = inLiquid ? 1.4 : 2.0;

    // Sprint → stronger & faster gait
    if (this.isSprinting) {
      baseAmpLeg *= 1.3;
      baseAmpArm *= 1.2;
      baseHz *= 1.25;
      maxHz *= 1.25;
    }

    // Sneak → smaller, slower gait
    if (this.isSneaking) {
      baseAmpLeg *= 0.6;
      baseAmpArm *= 0.6;
      baseHz *= 0.7;
      maxHz *= 0.7;
    }

    const ampLeg = baseAmpLeg * (0.4 + 0.6 * speedNorm) * this.legAmpScale;
    const ampArm = baseAmpArm * (0.4 + 0.6 * speedNorm) * this.legAmpScale;

    const freq = (baseHz + (maxHz - baseHz) * speedNorm) * this.legHzScale;
    const phase = this._time * freq * Math.PI * 2;

    const legAxisVec = new T.Vector3(
      this.legAxis === "x" ? 1 : 0,
      this.legAxis === "y" ? 1 : 0,
      this.legAxis === "z" ? 1 : 0
    );
    const armAxisVec = new T.Vector3(
      this.armAxis === "x" ? 1 : 0,
      this.armAxis === "y" ? 1 : 0,
      this.armAxis === "z" ? 1 : 0
    );

    function swing(bone, base, angle, axis) {
      if (!bone || !base) return;
      const q = new T.Quaternion().setFromAxisAngle(axis, angle);
      bone.quaternion.copy(base).multiply(q);
    }

    // If almost not moving → relax all bones toward base pose
    if (speedNorm < 0.05) {
      const lerp = 1 - Math.exp(-5 * dt);
      for (const b of [LLeg, RLeg, LArm, RArm]) {
        if (b && b.userData.baseQuat) {
          b.quaternion.slerp(b.userData.baseQuat, lerp);
        }
      }
      // also relax spine (rot/scale/pos) when not sneaking/sprinting
      if (Spine && Spine.userData.baseQuat && Spine.userData.baseScale) {
        Spine.quaternion.slerp(Spine.userData.baseQuat, lerp);
        Spine.scale.lerp(Spine.userData.baseScale, lerp);
        Spine.position.lerp(Spine.userData.basePos, lerp);
      }
    } else {
      // Legs
      if (LLeg && LLeg.userData.baseQuat && RLeg && RLeg.userData.baseQuat) {
        swing(
          LLeg,
          LLeg.userData.baseQuat,
          Math.sin(phase) * ampLeg,
          legAxisVec
        );
        swing(
          RLeg,
          RLeg.userData.baseQuat,
          Math.sin(phase + Math.PI) * ampLeg,
          legAxisVec
        );
      }

      // Arms
      if (LArm && LArm.userData.baseQuat && RArm && RArm.userData.baseQuat) {
        swing(
          LArm,
          LArm.userData.baseQuat,
          Math.sin(phase + Math.PI) * ampArm,
          armAxisVec
        );
        swing(
          RArm,
          RArm.userData.baseQuat,
          Math.sin(phase) * ampArm,
          armAxisVec
        );
      }
    }

    // Spine lean + crouch
    // Spine lean + crouch
    if (Spine && Spine.userData.baseQuat && Spine.userData.baseScale) {
      const qBase = Spine.userData.baseQuat;
      const sBase = Spine.userData.baseScale;
      const pBase = Spine.userData.basePos;

      let leanAngle = 0;
      if (this.isSprinting) {
        // try this as "forward"; if it still feels backward, flip the sign
        leanAngle = -0.18;
      } else if (this.isSneaking) {
        leanAngle = -0.5;
      }

      const axis = new T.Vector3(0, 0, 1);
      const qTilt = new T.Quaternion().setFromAxisAngle(axis, leanAngle);

      // ✅ Apply tilt in local space: tilt first, then base
      const qTarget = qTilt.clone().multiply(qBase.clone());

      const lerpRot = 1 - Math.exp(-6 * dt);
      Spine.quaternion.slerp(qTarget, lerpRot);

      const lerpPose = 1 - Math.exp(-8 * dt);
      if (this.isSneaking) {
        const targetScale = new T.Vector3(sBase.x, sBase.y * 0.85, sBase.z);
        const targetPos = pBase.clone();
        targetPos.y -= 0.08;
        Spine.scale.lerp(targetScale, lerpPose);
        Spine.position.lerp(targetPos, lerpPose);
      } else {
        Spine.scale.lerp(sBase, lerpPose);
        Spine.position.lerp(pBase, lerpPose);
      }
    }

    // ---------- HEAD LOOK (pitch-driven) ----------
    const Head = this._rig.head;

    if (Head && Head.userData.baseQuat) {
      // limit how far head can tilt so it doesn't snap backwards
      const maxHeadPitch = 0.6; // radians (~34°)
      const headPitch = T.MathUtils.clamp(
        this.pitch,
        -maxHeadPitch,
        maxHeadPitch
      );

      // Axis for head nodding (usually X, but some rigs use Z)
      const headAxis = new T.Vector3(0, 0, 1); // try (1,0,0) or (0,0,1) if wrong

      const qLook = new T.Quaternion().setFromAxisAngle(headAxis, headPitch);

      // Apply rotation in local bone space
      const qTarget = Head.userData.baseQuat.clone().multiply(qLook);

      const lerp = 1 - Math.exp(-10 * dt); // smooth motion
      Head.quaternion.slerp(qTarget, lerp);
    }

    // ---- Attack swing overlay on RIGHT ARM (entire arm swings) ----
    if (RArm && RArm.userData.baseQuat && this._handSwingPhase < 1) {
      const p = this._handSwingPhase; // 0 → 1
      // Emphasize middle of swing, but not too harsh
      const swingT = Math.sin(p * Math.PI); // 0 → 1 → 0

      // Treat it as going around a kind of circle:
      // - Y: sweep across body
      // - X: big downward chop
      // - Z: a bit of roll for arc feeling
      const yawAxis = new T.Vector3(1, 0, 0); // around body
      const pitchAxis = new T.Vector3(0, 0, 1); // up/down
      const rollAxis = new T.Vector3(0, 1, 0); // twist

      // Tune these three for “swing-y-ness”
      const yawAngle = -0.45 * swingT; // large sideways arc
      const pitchAngle = -0.7 * swingT; // down / forward
      const rollAngle = 0.3 * swingT; // slight wrist roll

      const qYaw = new T.Quaternion().setFromAxisAngle(yawAxis, yawAngle);
      const qPitch = new T.Quaternion().setFromAxisAngle(pitchAxis, pitchAngle);
      const qRoll = new T.Quaternion().setFromAxisAngle(rollAxis, rollAngle);

      // Order matters: start by yawing out, then chopping down, then rolling
      const qAttack = qYaw.multiply(qPitch).multiply(qRoll);

      // Multiply on top of the gait pose
      RArm.quaternion.multiply(qAttack);
    }
  }

  // ---------------- Input → dir / yaw / swim / sprint / sneak ----------------
  _applyInput(dt) {
    const w = this._key("KeyW") || this._key("ArrowUp") ? 1 : 0;
    const s = this._key("KeyS") || this._key("ArrowDown") ? 1 : 0;
    const a = this._key("KeyA") ? 1 : 0;
    const d = this._key("KeyD") ? 1 : 0;

    // local input (x = right, z = forward)
    let xLocal = a - d; // +1 = right, -1 = left
    let zLocal = w - s; // +1 = forward, -1 = back

    // normalize local vector
    const len = Math.hypot(xLocal, zLocal);
    if (len > 0) {
      xLocal /= len;
      zLocal /= len;
    }

    // rotate by yaw into world space
    const sinY = Math.sin(this.yaw);
    const cosY = Math.cos(this.yaw);

    const dirX = xLocal * cosY + zLocal * sinY;
    const dirZ = -xLocal * sinY + zLocal * cosY;

    if (len > 0) {
      this.dir.set(dirX, 0, dirZ).normalize();
      if (!this._isLiquidAt(this.pos.x, this.pos.y, this.pos.z)) {
        if (this.state !== "jump" && this.state !== "fall") {
          this.state = "walk";
        }
      }
    } else {
      this.dir.set(0, 0, 0);
      if (
        this.state !== "jump" &&
        this.state !== "fall" &&
        this.state !== "swim"
      ) {
        this.state = "idle";
      }
    }

    const inLiquid = this._isLiquidAt(
      this.pos.x,
      this.pos.y + this.footClear + 0.05,
      this.pos.z
    );

    const eyeY = this.pos.y + this.height * 0.9;

    // Check which liquid is at the eye level
    const ex = Math.floor(this.pos.x);
    const ey = Math.floor(eyeY + 0.05);
    const ez = Math.floor(this.pos.z);

    let eyeInWater = false;
    let eyeInLava = false;

    if (this.world.isWaterAt) eyeInWater = this.world.isWaterAt(ex, ey, ez);
    if (this.world.isLavaAt) eyeInLava = this.world.isLavaAt(ex, ey, ez);

    if (this.waterTintEl) {
      if (eyeInWater || eyeInLava) {
        this.waterTintEl.style.opacity = "1";

        // You can tweak these colors to match your CSS
        if (eyeInLava) {
          this.waterTintEl.style.backgroundColor = "rgba(255, 120, 0, 0.45)"; // orange
        } else {
          this.waterTintEl.style.backgroundColor = "rgba(0, 80, 255, 0.35)"; // blue
        }
      } else {
        this.waterTintEl.style.opacity = "0";
      }
    }

    const jumpHeld = this._key("Space");
    const shiftHeld = this._key("ShiftLeft") || this._key("ShiftRight");
    const ctrlHeld = this._key("ControlLeft") || this._key("ControlRight");

    this._swimUp = false;
    this._swimDown = false;
    this._wantJump = jumpHeld;

    if (inLiquid) {
      if (jumpHeld) this._swimUp = true;
      else if (shiftHeld) this._swimDown = true;
    }

    // --- Sprint / Sneak ---
    // In water: no sprint, but allow sneak (for crouch pose/camera) with Ctrl
    if (inLiquid) {
      this.isSprinting = false;
      this.isSneaking = ctrlHeld; // can crouch in water, even while idle
    } else {
      // On land: Shift = sprint, Ctrl = sneak
      this.isSprinting = shiftHeld && zLocal > 0 && xLocal === 0;
      this.isSneaking = !this.isSprinting && ctrlHeld; // can also sneak while standing still
    }
  }

  // ---------------- Camera ----------------
  _updateCamera() {
    if (!this.camera) return;

    let eyeHeight = this.cameraHeight;

    if (this.isSneaking) {
      eyeHeight *= 0.8;
    }

    if (this._viewMode === "first") {
      eyeHeight += this.firstPersonEyeExtra;
    }

    eyeHeight = Math.min(eyeHeight, this.height - 0.05);

    const baseEye = new T.Vector3(
      this.pos.x,
      this.pos.y + eyeHeight,
      this.pos.z
    );

    const viewDir = new T.Vector3(
      Math.sin(this.yaw) * Math.cos(this.pitch),
      Math.sin(this.pitch),
      Math.cos(this.yaw) * Math.cos(this.pitch)
    ).normalize();

    if (this._viewMode === "first") {
      // ✅ PUSH CAMERA FORWARD INTO EYE POSITION
      const eye = baseEye
        .clone()
        .add(viewDir.clone().multiplyScalar(this.firstPersonForwardOffset));

      const target = eye.clone().add(viewDir);
      this.camera.position.copy(eye);
      this.camera.lookAt(target);
    } else {
      const dist = this.cameraDistance;
      const camPos = baseEye
        .clone()
        .sub(viewDir.clone().multiplyScalar(dist))
        .add(new T.Vector3(0, dist * 0.3, 0));

      this.camera.position.copy(camPos);
      this.camera.lookAt(baseEye);
    }
  }

  // Conservative capsule → world collision, tailored for the player (slightly shrunk)
  _capsuleFreeAtPlayer(wx, feetY, wz) {
    const hw = this.halfWidth * 0.85; // slightly smaller than visual
    const yFeet = feetY + 0.1;
    const yMid = feetY + this.height * 0.5;
    const yHead = feetY + this.height - 0.05;

    const samples = [
      // feet ring
      [wx - hw, yFeet, wz - hw],
      [wx + hw, yFeet, wz - hw],
      [wx - hw, yFeet, wz + hw],
      [wx + hw, yFeet, wz + hw],

      // mid ring
      [wx - hw, yMid, wz - hw],
      [wx + hw, yMid, wz + hw],

      // head ring
      [wx - hw, yHead, wz - hw],
      [wx + hw, yHead, wz + hw],
    ];

    for (const [x, y, z] of samples) {
      if (this._isSolidAt(x, y, z)) {
        return false;
      }
    }
    return true;
  }

  _moveHorizWithCollision(targetX, targetZ) {
    const maxStepDist = 0.25; // smaller → safer, larger → faster
    let cx = this.pos.x;
    let cz = this.pos.z;

    // 0) If current position is already intersecting, try to nudge out once.
    if (!this._capsuleFreeAtPlayer(cx, this.pos.y, cz)) {
      const radius = 0.2;
      for (let i = 0; i < 8; i++) {
        const ang = (i / 8) * Math.PI * 2;
        const nx = cx + Math.cos(ang) * radius;
        const nz = cz + Math.sin(ang) * radius;
        if (this._capsuleFreeAtPlayer(nx, this.pos.y, nz)) {
          cx = nx;
          cz = nz;
          break;
        }
      }
    }

    const dx = targetX - cx;
    const dz = targetZ - cz;
    const dist = Math.hypot(dx, dz);
    if (dist < 1e-6) {
      return { x: cx, z: cz };
    }

    const steps = Math.ceil(dist / maxStepDist);
    const stepX = dx / steps;
    const stepZ = dz / steps;

    for (let i = 0; i < steps; i++) {
      const nx = cx + stepX;
      const nz = cz + stepZ;

      if (this._capsuleFreeAtPlayer(nx, this.pos.y, nz)) {
        // full diagonal step OK
        cx = nx;
        cz = nz;
      } else {
        // try slide in X only
        let moved = false;
        if (this._capsuleFreeAtPlayer(nx, this.pos.y, cz)) {
          cx = nx;
          moved = true;
        }
        // try slide in Z only
        if (this._capsuleFreeAtPlayer(cx, this.pos.y, nz)) {
          cz = nz;
          moved = true;
        }

        if (!moved) {
          // still blocked → stop this frame
          break;
        }
      }
    }

    return { x: cx, z: cz };
  }

  _updateFov(dt) {
    if (!this.camera) return;

    let target = this.baseFov;
    if (this.isSprinting) target = this.sprintFov;
    else if (this.isSneaking) target = this.sneakFov;

    const k = 1 - Math.exp(-this._fovLerpSpeed * dt);
    this.currentFov = this.currentFov + (target - this.currentFov) * k;

    this.camera.fov = this.currentFov;
    this.camera.updateProjectionMatrix();
  }

  // Find the *top* of the water column at the player's XZ.
  _getWaterSurfaceY() {
    const wx = this.pos.x;
    const wz = this.pos.z;

    let y = Math.floor(this.pos.y);
    let inWater = false;
    let lastWaterY = null;

    for (let yy = y; yy <= Y_MAX; yy++) {
      const id = this.world.getBlockWorld(wx, yy, wz);
      if (this.world.isLiquidId(id)) {
        inWater = true;
        lastWaterY = yy;
      } else {
        if (inWater && lastWaterY !== null) {
          return lastWaterY + 3.0; // your tuned fudge
        }
        if (!inWater) {
          break;
        }
      }
    }

    if (inWater && lastWaterY !== null) {
      return lastWaterY + 3.0;
    }

    return null;
  }

  // --- Prevent snapping into ceilings when jumping upwards ---
  _clipUpward(feetY, nextFeetY) {
    if (nextFeetY <= feetY) return nextFeetY;

    const headOld = feetY + this.height - 0.05;
    const headNew = nextFeetY + this.height - 0.05;
    const step = 0.1;

    let y = headOld;
    while (y <= headNew) {
      if (this._isSolidAt(this.pos.x, y, this.pos.z)) {
        const blockY = Math.floor(y); // solid block at this Y
        const allowedHead = blockY - 0.001;
        const allowedFeet = allowedHead - this.height;
        this.verticalVel = 0; // bonk head → stop going up
        return allowedFeet;
      }
      y += step;
    }
    return nextFeetY;
  }

  // ---------------- Player-specific stepTick ----------------
  stepTick(delta) {
    if (!this.ready) return;

    const dt = this._dt(delta);
    this._time += dt;

    // 1. Timers
    if (this._jumpTimer > 0)
      this._jumpTimer = Math.max(0, this._jumpTimer - dt);
    if (this._ledgeGrace > 0)
      this._ledgeGrace = Math.max(0, this._ledgeGrace - dt);
    if (this._coyote > 0) this._coyote = Math.max(0, this._coyote - dt);

    // 2. Input → direction, yaw, flags
    this._applyInput(dt);

    const inLiquid = this._isLiquidAt(
      this.pos.x,
      this.pos.y + this.footClear + 0.05,
      this.pos.z
    );

    if (inLiquid) {
      // --- swimming physics ---
      this.state = "swim";

      // 💧 kill any leftover land jump momentum
      this.jumpCarry.set(0, 0, 0);

      const damp = Math.exp(-2.0 * dt);
      this.verticalVel *= damp;

      const passiveSinkSpeed = 1.2;
      if (!this._swimUp && !this._swimDown) {
        this.verticalVel -= passiveSinkSpeed * dt;
      }

      if (this._swimUp) {
        this.verticalVel += this.swimUpSpeed * dt;
      } else if (this._swimDown) {
        this.verticalVel -= this.swimDownSpeed * dt;
      }
    } else {
      // --- land gravity / jumping ---
      const groundedNowForJump = this._hasSupportAt(
        this.pos.x,
        this.pos.y,
        this.pos.z
      );

      if (this._wantJump) {
        // 1) If *grounded*, always allow jump (bunny hop)
        if (groundedNowForJump) {
          let groundSpeed = this.walkSpeed;
          if (this.isSprinting) groundSpeed = this.walkSpeed * 1.8;
          else if (this.isSneaking) groundSpeed = this.walkSpeed * 0.5;

          this.jumpCarry
            .copy(this.dir)
            .multiplyScalar(groundSpeed * this.jumpCarryFactor);

          this.verticalVel = this.jumpSpeed;
          this.state = "jump";
          this._jumpTimer = this.jumpCooldown; // still useful for coyote
        }
        // 2) Coyote jump (only if cooldown expired)
        else if (this._coyote > 0 && this._jumpTimer <= 0) {
          let groundSpeed = this.walkSpeed;
          if (this.isSprinting) groundSpeed = this.walkSpeed * 1.8;
          else if (this.isSneaking) groundSpeed = this.walkSpeed * 0.5;

          this.jumpCarry
            .copy(this.dir)
            .multiplyScalar(groundSpeed * this.jumpCarryFactor);

          this.verticalVel = this.jumpSpeed;
          this.state = "jump";
          this._jumpTimer = this.jumpCooldown;
        }
      }

      // Regular gravity
      this.verticalVel += this.gravity * dt;
      if (this.verticalVel < this.terminalVel)
        this.verticalVel = this.terminalVel;

      if (this.verticalVel > 0 && this.state !== "jump") {
        this.state = "jump";
      }
      if (
        this.verticalVel < 0 &&
        this.state !== "fall" &&
        this.state !== "jump"
      ) {
        this.state = "fall";
      }
    }

    // 4. Apply vertical motion & landing
    const prevY = this.pos.y;
    let nextY = this.pos.y + this.verticalVel * dt;
    // --- A. In water: stop at solid seabed, but still allow normal sinking elsewhere ---
    if (inLiquid && this.verticalVel < 0) {
      // Where will the *feet* be if we apply this step?
      const feetNext = nextY; // your pos.y is feet
      const sampleBelow = feetNext - this.footClear - 0.05;

      // If the block directly below the feet would be solid, clamp
      if (this._isSolidAt(this.pos.x, sampleBelow, this.pos.z)) {
        const blockY = Math.floor(sampleBelow); // that solid block's Y
        const landFeet = blockY + 1 + this.footClear; // stand just above it

        if (nextY <= landFeet) {
          // ✅ Only accept this landing if capsule is not intersecting
          if (this._capsuleFreeAtPlayer(this.pos.x, landFeet, this.pos.z)) {
            nextY = landFeet;
            this.verticalVel = 0;

            const movedXZ =
              Math.hypot(
                this.pos.x - this._lastPosXZ.x,
                this.pos.z - this._lastPosXZ.y
              ) / Math.max(dt, 1e-6);

            if (this.state !== "swim") {
              this.state = movedXZ > 0.05 ? "walk" : "idle";
            }
            this._wasSupported = true;
            this._coyote = this.coyoteSec;
          } else {
            // ❗ Capsule would be intersecting (edge/ledge case)
            // Don't snap all the way down; just stop vertical motion here.
            nextY = prevY;
            this.verticalVel = 0;
          }
        }
      }
    }
    // --- B. If not in water, apply ceiling & ground logic as before ---

    // clip upward vs ceilings to avoid snapping
    if (!inLiquid && this.verticalVel > 0) {
      nextY = this._clipUpward(this.pos.y, nextY);
    }

    if (!inLiquid && this.verticalVel < 0) {
      const floorYPrev = this._findFloorYBelow(
        this.pos.x,
        prevY + 0.5,
        this.pos.z,
        256
      );

      if (isFinite(floorYPrev)) {
        const liquidFloor = this._isLiquidAt(
          this.pos.x,
          floorYPrev - 0.5,
          this.pos.z
        );

        if (!liquidFloor) {
          const landFeet = floorYPrev + this.footClear;
          if (nextY <= landFeet) {
            nextY = landFeet;
            this.verticalVel = 0;

            const movedXZ =
              Math.hypot(
                this.pos.x - this._lastPosXZ.x,
                this.pos.z - this._lastPosXZ.y
              ) / Math.max(dt, 1e-6);

            if (this.state !== "swim") {
              this.state = movedXZ > 0.05 ? "walk" : "idle";
            }
            this._wasSupported = true;
            this._coyote = this.coyoteSec;
          }
        }
      }
    }

    this.pos.y = nextY;

    // 5. Horizontal speed + sprint/sneak
    let baseSpeed = inLiquid ? this.swimSpeed : this.walkSpeed;

    if (inLiquid && this.isSneaking) {
      baseSpeed *= 0.6; // slower sneak-swim
    }
    // Ground modifiers
    if (!inLiquid) {
      if (this.isSprinting) {
        // Sprint on ground only
        baseSpeed = this.walkSpeed * 1.8;
      } else if (this.isSneaking) {
        baseSpeed = this.walkSpeed * 0.5;
      }
    }

    // Now apply air control properly
    let speed = baseSpeed;

    if (this.state === "fall" || this.state === "jump") {
      let airBase = this.isSprinting ? this.walkSpeed * 1.8 : this.walkSpeed; // small sprint bonus
      speed = airBase * this.airControl;
    }

    if (this.dir.lengthSq() === 0) {
      speed = 0;
    }

    const step = speed * dt;

    // 6. Proposed XZ using player dir, even in air
    let nx = this.pos.x;
    let nz = this.pos.z;

    if (step > 0 && (this.dir.x !== 0 || this.dir.z !== 0)) {
      nx += this.dir.x * step;
      nz += this.dir.z * step;
    }

    // 7. Ground support tracking
    const groundedNow = this._hasSupportAt(this.pos.x, this.pos.y, this.pos.z);
    if (groundedNow) {
      this._coyote = this.coyoteSec;
      this._wasSupported = true;
    } else if (this._wasSupported) {
      this._wasSupported = false;
      this._coyote = this.coyoteSec;
    }

    // 8. Jump carry – **land only**, not in water
    if (!groundedNow && !inLiquid) {
      nx += this.jumpCarry.x * this.jumpAirSpeedMul * dt;
      nz += this.jumpCarry.z * this.jumpAirSpeedMul * dt;
      const decay = Math.exp(-this.jumpCarryDecay * dt);
      this.jumpCarry.multiplyScalar(decay);
    }

    // --- 9–10. Horizontal collision using conservative substepping ---
    const beforeX = this._lastPosXZ.x;
    const beforeZ = this._lastPosXZ.y;

    const moved = this._moveHorizWithCollision(nx, nz);
    this.pos.x = moved.x;
    this.pos.z = moved.z;

    // --- 11. Compute horizSpeed for animation ---
    const moved2 = this._len2(this.pos.x - beforeX, this.pos.z - beforeZ);
    const horizSpeed = Math.sqrt(moved2) / Math.max(dt, 1e-6);

    // 12. Water surface bobbing ONLY when pushing up *against* the surface
    if (inLiquid && this._swimUp) {
      const surfaceY = this._getWaterSurfaceY();
      if (surfaceY !== null) {
        const desiredHeadY = surfaceY - 0.05;
        const desiredFeetY = desiredHeadY - this.height;

        if (this.pos.y >= desiredFeetY) {
          this.pos.y = desiredFeetY;

          const bobFreq = 3.5;
          const bob = this.bobAmp * Math.sin(this._time * bobFreq);
          this.pos.y += bob * 0.12;

          this.verticalVel = 0;
        }
      }
    }

    // 13. World transforms, anim, bookkeeping
    this.root.position.copy(this.pos);
    this.root.rotation.y = this.yaw;
    this._updateHandSwing(dt);

    this._animateLegs(dt, horizSpeed, inLiquid);

    this._lastPosXZ.set(this.pos.x, this.pos.z);

    if (this._feetDot)
      this._feetDot.position.set(this.pos.x, this.pos.y + 0.02, this.pos.z);

    this._updateChunkMembership();

    // ✅ NEW: remember the last *valid* position every frame
    if (this._capsuleFreeAtPlayer(this.pos.x, this.pos.y, this.pos.z)) {
      this._lastSafePos.copy(this.pos);
    }

    // ---- SMART UN-STUCK (edge-aware) ----
    if (!this._capsuleFreeAtPlayer(this.pos.x, this.pos.y, this.pos.z)) {
      let fixed = false;

      const blockX = Math.floor(this.pos.x) + 0.5;
      const blockZ = Math.floor(this.pos.z) + 0.5;

      // direction toward block center
      const toCenter = new T.Vector3(
        blockX - this.pos.x,
        0,
        blockZ - this.pos.z
      );

      const horizPush = 0.12; // small push toward block center
      const maxLift = 0.5; // max vertical correction

      const liftSteps = 6;

      for (let i = 1; i <= liftSteps; i++) {
        const lift = (maxLift * i) / liftSteps;

        const testX = this.pos.x + toCenter.x * horizPush;
        const testZ = this.pos.z + toCenter.z * horizPush;
        const testY = this.pos.y + lift;

        if (this._capsuleFreeAtPlayer(testX, testY, testZ)) {
          this.pos.set(testX, testY, testZ);
          this.verticalVel = 0;
          fixed = true;
          break;
        }
      }

      // Hard fallback if still trapped
      if (!fixed && this._lastSafePos) {
        this.pos.copy(this._lastSafePos);
        this.verticalVel = 0;
      }
    }
    // 14. Camera & FOV
    this._updateCamera();
    this._updateFov(dt);
    this._updateAimTarget();
  }

  _updateAimTarget() {
    this._aimBlock = null;
    this._aimBlockId = BLOCK.AIR;
    this._aimPlacePos = null;

    if (!this.camera || !this.world) {
      if (this._blockHighlight) this._blockHighlight.visible = false;
      return;
    }

    // --- Ray from camera center ---
    const origin = this.camera.position.clone();
    const dir = new T.Vector3();
    this.camera.getWorldDirection(dir).normalize();

    // Distance from camera to player (for third person)
    const camToPlayer = origin.distanceTo(this.pos);

    // Let the ray go far enough so that points within `reachDistance`
    // of the PLAYER are still hit even when the camera is behind.
    const reach = this.reachDistance ?? 5.0;
    const maxDist = reach + camToPlayer + 0.5;

    const step = 0.1;
    const maxSteps = Math.floor(maxDist / step);

    let lastEmptyCell = null;

    for (let i = 0; i <= maxSteps; i++) {
      const t = i * step;
      const pos = origin.clone().addScaledVector(dir, t);

      const ix = Math.floor(pos.x);
      const iy = Math.floor(pos.y);
      const iz = Math.floor(pos.z);

      const id = this.world.getBlockWorld(ix, iy, iz);

      if (id !== BLOCK.AIR && !this.world.isLiquidId(id)) {
        // Hit a block: check if it's actually within "reach" of the PLAYER,
        // not just within ray length.
        const blockCenter = new T.Vector3(ix + 0.5, iy + 0.5, iz + 0.5);
        const distFromPlayer = blockCenter.distanceTo(this.pos);

        if (distFromPlayer <= reach + 0.01) {
          this._aimBlock = new T.Vector3(ix, iy, iz);
          this._aimBlockId = id;
          this._aimPlacePos = lastEmptyCell ? lastEmptyCell.clone() : null;
        }
        break;
      } else {
        // Treat both air and liquid as "non-solid" for targeting
        lastEmptyCell = new T.Vector3(ix, iy, iz);
      }
    }

    // --- Highlight mesh ---
    if (this._blockHighlight) {
      if (this._aimBlock) {
        const bx = this._aimBlock.x + 0.5;
        const by = this._aimBlock.y + 0.5;
        const bz = this._aimBlock.z + 0.5;

        const worldPos = new T.Vector3(bx, by, bz);
        this._blockHighlight.visible = true;

        // Place highlight at worldPos then convert to player's local space
        this._blockHighlight.position.copy(worldPos);
        this.root.worldToLocal(this._blockHighlight.position);

        // 🔹 Cancel out the player's yaw so the box stays axis-aligned to the world
        this._blockHighlight.quaternion.copy(this.root.quaternion).invert();
      } else {
        this._blockHighlight.visible = false;
      }
    }
  }

  // Axis-aligned AABB vs. block cell [x,x+1]×[y,y+1]×[z,z+1]
  _aabbIntersectsEntityBlock(x, y, z, entity) {
    if (!entity || !entity.pos) return false;

    const hw = entity.halfWidth ?? 0.4;
    const h = entity.height ?? 1.0;

    const exMinX = entity.pos.x - hw;
    const exMaxX = entity.pos.x + hw;
    const exMinY = entity.pos.y;
    const exMaxY = entity.pos.y + h;
    const exMinZ = entity.pos.z - hw;
    const exMaxZ = entity.pos.z + hw;

    const bxMinX = x;
    const bxMaxX = x + 1;
    const bxMinY = y;
    const bxMaxY = y + 1;
    const bxMinZ = z;
    const bxMaxZ = z + 1;

    return (
      exMaxX > bxMinX &&
      exMinX < bxMaxX &&
      exMaxY > bxMinY &&
      exMinY < bxMaxY &&
      exMaxZ > bxMinZ &&
      exMinZ < bxMaxZ
    );
  }

  _wouldOverlapEntityAt(x, y, z) {
    // 1) Player themself
    if (this._aabbIntersectsEntityBlock(x, y, z, this)) return true;

    // 2) Other mobs / entities registered in the world
    if (this.world && Array.isArray(this.world.mobs)) {
      for (const mob of this.world.mobs) {
        if (!mob || mob === this) continue;
        if (this._aabbIntersectsEntityBlock(x, y, z, mob)) {
          return true;
        }
      }
    }

    return false;
  }

  _tryPlaceBlock() {
    if (!this.world) return;
    if (!this.heldItem) return;
    if (!this._aimPlacePos) return;

    const x = this._aimPlacePos.x;
    const y = this._aimPlacePos.y;
    const z = this._aimPlacePos.z;

    const existing = this.world.getBlockWorld(x, y, z);

    // #2: allow placing *into liquid* (water/lava) but not into solid blocks
    if (existing !== BLOCK.AIR && !this.world.isLiquidId(existing)) {
      return;
    }

    // #1: don't place if any entity (including player) occupies that cell
    if (this._wouldOverlapEntityAt(x, y, z)) {
      return;
    }

    // Torch special-case: directional meta
    if (this.heldItem === BLOCK.TORCH) {
      let meta = 0; // default: floor torch

      if (this._aimBlock) {
        const bx = this._aimBlock.x;
        const by = this._aimBlock.y;
        const bz = this._aimBlock.z;

        // support block position relative to torch cell
        const dx = bx - x;
        const dy = by - y;
        const dz = bz - z;

        // On top of a block (torch cell is above support)
        if (dx === 0 && dz === 0 && dy === -1) {
          meta = 0; // floor
        } else if (dy === 0) {
          // Side-attached
          if (dx === 1 && dz === 0) {
            meta = 3; // block east of torch → lean east
          } else if (dx === -1 && dz === 0) {
            meta = 4; // block west of torch → lean west
          } else if (dz === 1 && dx === 0) {
            meta = 2; // block south of torch → lean south
          } else if (dz === -1 && dx === 0) {
            meta = 1; // block north of torch → lean north
          }
        }
      }

      this.world.setBlockWorldWithMeta(x, y, z, this.heldItem, meta);
    } else {
      // Normal block placement
      this.world.setBlockWorld(x, y, z, this.heldItem);
    }

    // Hand animation
    this.triggerHandSwing();
  }

  _handlePrimaryInteraction() {
    if (!this.camera || !this.scene) return;

    const REACH = this.reachDistance;

    const origin = this.camera.position.clone();
    const dir = new T.Vector3();
    this.camera.getWorldDirection(dir).normalize();

    const camToPlayer = origin.distanceTo(this.pos);
    const maxDist = REACH + camToPlayer + 0.5;

    const raycaster = new T.Raycaster(origin, dir, 0, maxDist);
    const intersects = raycaster.intersectObjects(this.scene.children, true);

    if (!intersects.length) return;

    // ✅ We now take the FIRST valid hit within reach
    for (const hit of intersects) {
      const hitPoint = hit.point;
      const distFromPlayer = hitPoint.distanceTo(this.pos);

      if (distFromPlayer > REACH) continue;

      const obj = hit.object;
      const entity = obj.userData.entity;

      // 1️⃣ If first visible hit is an entity → attack
      if (entity instanceof GrEntity && entity !== this) {
        entity.onHitByPlayer(this);
        return;
      }

      // 2️⃣ Otherwise it's a block → break block and STOP
      const blockPos = this._aimBlock;

      if (!blockPos) return;

      const { x, y, z } = blockPos;
      const id = this.world.getBlockWorld(x, y, z);
      if (id !== BLOCK.AIR) {
        this.world.setBlockWorld(x, y, z, BLOCK.AIR);
        return;
      }
    }
  }

  // --- Player-specific liquid check: water OR lava are swimmable ---
  _isLiquidAt(wx, wy, wz) {
    const ix = Math.floor(wx);
    const iy = Math.floor(wy);
    const iz = Math.floor(wz);

    // If world exposes helpers, use them:
    if (this.world.isWaterAt || this.world.isLavaAt) {
      let inWater = false;
      let inLava = false;

      if (this.world.isWaterAt) inWater = this.world.isWaterAt(ix, iy, iz);
      if (this.world.isLavaAt) inLava = this.world.isLavaAt(ix, iy, iz);

      return inWater || inLava;
    }

    // Fallback to generic liquid check if helpers don't exist
    if (this.world.isLiquidAt) {
      return this.world.isLiquidAt(ix, iy, iz);
    }

    return false;
  }
}
