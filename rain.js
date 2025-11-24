import * as T from "../libs/threeJS/build/three.module.js";
import { GrObject } from "../libs/framework/GrObject.js";
import { GrTickingObject } from "./base.js";

// this class has been generated with the help of copilot
export class GrRain extends GrTickingObject {
  constructor(
    world,
    {
      count = 1500,
      boxWidth = 40,
      boxHeight = 25,
      boxDepth = 40,
      speedMin = 18,
      speedMax = 32,
      streakLength = 1.0,
      color = 0x99bbff,
      opacity = 0.8, // this is the MAX opacity we fade to
    } = {}
  ) {
    const group = new T.Group();
    super("GrRain", group);
    this.rideable = group;

    this.world = world;
    this.count = count;
    this.boxWidth = boxWidth;
    this.boxHeight = boxHeight;
    this.boxDepth = boxDepth;
    this.streakLength = streakLength;
    this.speedMin = speedMin;
    this.speedMax = speedMax;

    // ---------- FADE STATE ----------
    this.currentOpacity = 0.0; // starts fully invisible
    this.targetOpacity = 0.0; // what we're fading toward
    this.maxOpacity = opacity; // upper bound
    this.fadeSpeed = 1.5; // opacity per second (tweak)
    // ---------------------------------

    // positions: 2 verts * 3 floats = 6 floats per drop
    const positions = new Float32Array(count * 6);
    const speeds = new Float32Array(count);

    // sideways tilt per streak
    const tiltX = new Float32Array(count);
    const tiltZ = new Float32Array(count);

    this.positions = positions;
    this.speeds = speeds;
    this.tiltX = tiltX;
    this.tiltZ = tiltZ;

    const geom = new T.BufferGeometry();
    geom.setAttribute("position", new T.BufferAttribute(positions, 3));
    this.geom = geom;

    const mat = new T.LineBasicMaterial({
      color,
      transparent: true,
      opacity: 0.0, // IMPORTANT: start at 0
      blending: T.AdditiveBlending,
      depthTest: true,
      depthWrite: false,
      linewidth: 1,
    });

    this.material = mat;

    const lines = new T.LineSegments(geom, mat);
    lines.frustumCulled = false;
    lines.visible = false; // start hidden until we fade in
    this.lines = lines;

    group.add(lines);

    // Spawn initial drops around camera
    for (let i = 0; i < count; i++) {
      this._spawn(i);
    }

    this.setVisible(true);
  }

  _getCenter() {
    // If you later wire the player in (rain.player = player),
    // we use the player's position.
    if (this.player && this.player.pos) {
      return this.player.pos;
    }
    // Fallback: center around the camera
    const cam = this.world.camera;
    return cam ? cam.position : new T.Vector3();
  }

  // Spawn streak i in front of camera
  // Spawn streak i around the center (player or camera)
  _spawn(i) {
    const center = this._getCenter();

    // Random point in an axis-aligned box centered on `center`
    const x = (Math.random() - 0.5) * this.boxWidth;
    const y = (Math.random() - 0.5) * this.boxHeight;
    const z = (Math.random() - 0.5) * this.boxDepth;

    const worldPos = new T.Vector3(center.x + x, center.y + y, center.z + z);

    const idx = i * 6;

    // top of streak
    this.positions[idx + 0] = worldPos.x;
    this.positions[idx + 1] = worldPos.y;
    this.positions[idx + 2] = worldPos.z;

    // bottom of streak
    this.positions[idx + 3] = worldPos.x;
    this.positions[idx + 4] = worldPos.y - this.streakLength;
    this.positions[idx + 5] = worldPos.z;

    // random fall speed
    this.speeds[i] =
      this.speedMin + Math.random() * (this.speedMax - this.speedMin);

    // random sideways drift
    this.tiltX[i] = (Math.random() - 0.5) * 0.07;
    this.tiltZ[i] = (Math.random() - 0.5) * 0.07;
  }

  stepTick(delta) {
    // match the dt style you use elsewhere (ms or seconds)
    let dt = delta / 1000;

    // ---------- FADE ANIMATION ----------
    const diff = this.targetOpacity - this.currentOpacity;
    if (Math.abs(diff) > 0.001) {
      const step = this.fadeSpeed * dt * Math.sign(diff);

      if (Math.abs(step) >= Math.abs(diff)) {
        this.currentOpacity = this.targetOpacity;
      } else {
        this.currentOpacity += step;
      }

      this.material.opacity = this.currentOpacity;

      // only toggle visibility of the *lines mesh*
      this.lines.visible = this.currentOpacity > 0.01;
    }
    // ------------------------------------

    // If effectively invisible, you can early-return to save some CPU
    if (!this.lines.visible) return;

    const cam = this.world.camera;
    const pos = this.positions;
    const speeds = this.speeds;
    const tiltX = this.tiltX;
    const tiltZ = this.tiltZ;

    for (let i = 0; i < this.count; i++) {
      const idx = i * 6;

      const v = speeds[i];
      const tx = tiltX[i] * v * dt;
      const tz = tiltZ[i] * v * dt;

      // FALL + SIDEWAYS TILT
      pos[idx + 1] -= v * dt; // top y
      pos[idx + 4] -= v * dt; // bottom y
      pos[idx + 0] += tx; // top x
      pos[idx + 3] += tx; // bottom x
      pos[idx + 2] += tz; // top z
      pos[idx + 5] += tz; // bottom z

      // If drop fell below camera, respawn near camera again
      if (pos[idx + 1] < cam.position.y - this.boxHeight) {
        this._spawn(i);
      }
    }

    this.geom.attributes.position.needsUpdate = true;
  }

  // Public API: fade toward on/off
  setVisible(visible) {
    this.targetOpacity = visible ? this.maxOpacity : 0.0;
  }
}
