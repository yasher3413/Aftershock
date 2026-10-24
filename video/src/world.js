// The 3D world: a sheet of ice with North America under it, 32 arenas, and
// the shockwave as a real ripple in the surface.
import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { T, TEAMS, MTL, WAVE, WAVES, PQ, camera, teamState, pulse } from "./timeline.js";
import { clamp, smooth, hash, shake } from "./motion.js";

// Plane extents in world units, and the matching mask canvas in stage px.
const PLANE = { x0: -16, x1: 16, z0: -10.5, z1: 10.5 };
const MASK_SCALE = 1; // mask px per stage px

function drawRings(ctx, rings, close) {
  ctx.beginPath();
  for (const r of rings) {
    ctx.moveTo(r[0], r[1]);
    for (let i = 2; i < r.length; i += 2) ctx.lineTo(r[i], r[i + 1]);
    if (close) ctx.closePath();
  }
}

/** Land in R, borders and coast in G, skate scratches in B. */
function makeMask() {
  const w = (PLANE.x1 - PLANE.x0) * 100 * MASK_SCALE;
  const h = (PLANE.z1 - PLANE.z0) * 100 * MASK_SCALE;
  const ox = -(PLANE.x0 * 100 + 960), oy = -(PLANE.z0 * 100 + 540);
  const layer = (paint) => {
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const g = c.getContext("2d");
    g.fillStyle = "#000";
    g.fillRect(0, 0, w, h);
    g.setTransform(MASK_SCALE, 0, 0, MASK_SCALE, ox * MASK_SCALE, oy * MASK_SCALE);
    paint(g);
    return g.getImageData(0, 0, w, h).data;
  };
  const land = layer((g) => {
    g.filter = "blur(1.5px)";
    g.fillStyle = "#fff";
    drawRings(g, PQ.land, true);
    g.fill();
    g.fillStyle = "#000";
    drawRings(g, PQ.lakes, true);
    g.fill();
  });
  const lines = layer((g) => {
    g.strokeStyle = "#fff";
    g.lineWidth = 1.3;
    drawRings(g, PQ.borders, false);
    g.stroke();
    g.lineWidth = 1.6;
    drawRings(g, PQ.land, true);
    g.stroke();
    drawRings(g, PQ.lakes, true);
    g.stroke();
  });
  const scratches = layer((g) => {
    g.strokeStyle = "#fff";
    for (let i = 0; i < 260; i++) {
      const cx = hash(i * 3.1) * 2600 - 340, cy = hash(i * 7.7) * 1700 - 300;
      const r = 120 + hash(i * 1.3) * 900, a0 = hash(i * 9.1) * Math.PI * 2;
      g.globalAlpha = 0.25 + hash(i * 5.5) * 0.6;
      g.lineWidth = 0.6 + hash(i * 2.2) * 0.9;
      g.beginPath();
      g.arc(cx, cy, r, a0, a0 + 0.08 + hash(i * 4.4) * 0.45);
      g.stroke();
    }
  });
  // The finale's engraving: the wordmark, and a seismograph line under it.
  const word = layer((g) => {
    g.fillStyle = "#fff";
    g.strokeStyle = "#fff";
    let size = 300;
    g.font = `900 ${size}px "Big Shoulders Display"`;
    size *= 940 / g.measureText("Puckquake").width;
    g.font = `900 ${size}px "Big Shoulders Display"`;
    g.textAlign = "center";
    g.fillText("Puckquake", 960, 540 + size * 0.34);
    g.lineWidth = 7;
    g.lineJoin = "round";
    g.beginPath();
    for (let x = 490; x <= 1430; x += 2) {
      const k = (x - 1180) / 55;
      const y = 540 + size * 0.34 + 74 - (k > 0 ? 46 * Math.exp(-k * 0.55) * Math.sin(k * 2.6) : 0);
      if (x === 490) g.moveTo(x, y); else g.lineTo(x, y);
    }
    g.stroke();
    g.beginPath();
    g.arc(1430, 540 + size * 0.34 + 74, 11, 0, Math.PI * 2);
    g.fill();
  });
  const data = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    data[i * 4] = land[i * 4];
    data[i * 4 + 1] = lines[i * 4];
    data[i * 4 + 2] = scratches[i * 4];
    data[i * 4 + 3] = word[i * 4];
  }
  const tex = new THREE.DataTexture(data, w, h, THREE.RGBAFormat);
  tex.flipY = false; // row 0 is the north edge (z0)
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.anisotropy = 8;
  tex.needsUpdate = true;
  return tex;
}

const ICE_VERT = /* glsl */ `
  uniform sampler2D mask;
  uniform float time;
  uniform vec4 waves[8]; // x, z, start time, amplitude
  uniform vec4 wave; // speed, amp, wavelength, decay
  uniform vec4 plane; // x0, x1, z0, z1
  varying vec3 vPos;
  varying vec3 vNormal;
  varying vec2 vUv;
  varying float vFront;

  vec2 uvOf(vec2 p) { return vec2((p.x - plane.x) / (plane.y - plane.x), (p.y - plane.z) / (plane.w - plane.z)); }
  float waveAt(vec2 p) {
    float h = 0.0;
    for (int i = 0; i < 8; i++) {
      float k = time - waves[i].z;
      if (k <= 0.0 || waves[i].w <= 0.0) continue;
      float r = distance(p, waves[i].xy);
      float b = k * wave.x - r; // distance behind the front
      if (b < 0.0) continue;
      float env = smoothstep(0.0, 0.35, b) * exp(-b / wave.w) * exp(-k / 4.5);
      h += wave.y * waves[i].w * env * sin(6.2831853 * b / wave.z);
    }
    return h;
  }
  float frontAt(vec2 p) {
    float f = 0.0;
    for (int i = 0; i < 8; i++) {
      float k = time - waves[i].z;
      if (k <= 0.0 || waves[i].w <= 0.0) continue;
      float r = distance(p, waves[i].xy);
      f += sqrt(waves[i].w) * exp(-pow((r - k * wave.x) / 0.16, 2.0)) * exp(-k / 3.2);
    }
    return f;
  }
  uniform float landIn;
  float heightAt(vec2 p) {
    float land = texture2D(mask, uvOf(p)).r;
    return land * 0.014 * landIn + waveAt(p);
  }
  void main() {
    vec3 p = position;
    vec2 xz = p.xz;
    vUv = uvOf(xz);
    float h = heightAt(xz);
    float e = 0.04;
    float hx = heightAt(xz + vec2(e, 0.0));
    float hz = heightAt(xz + vec2(0.0, e));
    vNormal = normalize(vec3(h - hx, e, h - hz));
    vFront = frontAt(xz);
    p.y = h;
    vPos = p;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(p, 1.0);
  }
`;

const ICE_FRAG = /* glsl */ `
  uniform sampler2D mask;
  uniform vec3 camPos;
  uniform float landIn;
  uniform float flash;
  uniform vec2 origin;
  varying vec3 vPos;
  varying vec3 vNormal;
  varying vec2 vUv;
  varying float vFront;
  uniform float wordIn;
  uniform float wordT0;
  uniform vec2 wordOrigin;
  uniform float time;
  uniform vec4 wave;

  void main() {
    vec4 m = texture2D(mask, vUv);
    float land = m.r * smoothstep(0.35, 1.0, landIn);
    vec3 N = normalize(vNormal);
    vec3 V = normalize(camPos - vPos);
    vec3 ocean = vec3(0.028, 0.050, 0.072);
    vec3 ground = vec3(0.085, 0.135, 0.175);
    vec3 col = mix(ocean, ground, land);
    col += m.g * smoothstep(0.0, 0.6, landIn) * vec3(0.12, 0.17, 0.21) * (0.5 + 0.5 * land);
    col += m.b * land * vec3(0.03, 0.04, 0.05);

    // Key light from the northwest, soft.
    vec3 L = normalize(vec3(-0.45, 0.75, -0.5));
    col *= 0.62 + 0.38 * max(dot(N, L), 0.0);

    // Glossy ice: an arena ceiling reflected at grazing angles.
    vec3 R = reflect(-V, N);
    float horizon = pow(1.0 - clamp(abs(R.y), 0.0, 1.0), 5.0);
    vec3 env = vec3(0.02, 0.035, 0.055) + vec3(0.16, 0.24, 0.32) * horizon;
    float fres = 0.02 + 0.98 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
    col += env * fres * 0.4;
    vec3 H = normalize(L + V);
    col += pow(max(dot(N, H), 0.0), 260.0) * vec3(0.55, 0.66, 0.78) * 0.22;

    // The engraving: cut into the ice, lit as the last shockwave passes.
    if (wordIn > 0.0) {
      vec2 px = vec2(1.6 / 3200.0, 1.6 / 2100.0);
      float aL = texture2D(mask, vUv - vec2(px.x, 0.0)).a, aR = texture2D(mask, vUv + vec2(px.x, 0.0)).a;
      float aU = texture2D(mask, vUv - vec2(0.0, px.y)).a, aD = texture2D(mask, vUv + vec2(0.0, px.y)).a;
      vec2 grad = vec2(aR - aL, aD - aU);
      float a = m.a * wordIn;
      float r = distance(vPos.xz, wordOrigin);
      float passed = (time - wordT0) * wave.x - r;
      float lit = smoothstep(-0.05, 0.9, passed);
      float flare = exp(-pow(passed / 0.35, 2.0));
      vec3 Nb = normalize(vec3(-grad.x * 3.0, 1.0, -grad.y * 3.0));
      float rim = clamp(dot(Nb, normalize(vec3(-0.5, 0.6, 0.6))), 0.0, 1.0);
      col = mix(col, col * 0.45, a);                                  // the cut is darker ice
      col += length(grad) * wordIn * (0.2 + 0.8 * lit) * vec3(0.75, 0.86, 1.0) * rim;   // its edges catch light
      col += a * (0.2 * lit + 0.6 * flare) * vec3(0.72, 0.84, 1.0);  // and glow as the wave crosses
    }

    // The shockwave front, and the flash at the origin.
    col += vec3(1.0, 0.29, 0.34) * vFront * 0.95;
    vec2 o = vPos.xz - origin;
    col += vec3(1.0, 0.29, 0.34) * flash * exp(-dot(o, o) / 0.35);

    // Fall off into the dark at the edges of the sheet.
    float edge = smoothstep(7.0, 13.5, length(vPos.xz * vec2(0.8, 1.22)));
    col = mix(col, vec3(0.030, 0.050, 0.072), edge);
    // Colors above are authored in sRGB; the output pass expects linear.
    gl_FragColor = vec4(pow(max(col, 0.0), vec3(2.2)), 1.0);
  }
`;

// The app's arena marker: a ring that fills with the playoff odds.
const RING_FRAG = /* glsl */ `
  uniform float p;
  uniform float alpha;
  uniform vec3 arc;
  uniform float pulse;
  uniform vec3 pulseColor;
  varying vec2 vUv;
  void main() {
    vec2 q = vUv * 2.0 - 1.0;
    float r = length(q);
    float aa = fwidth(r) * 1.2;
    float band = smoothstep(0.62 - aa, 0.62 + aa, r) * (1.0 - smoothstep(0.86 - aa, 0.86 + aa, r));
    float a = atan(q.x, q.y); // 0 at north, clockwise
    float frac = (a < 0.0 ? a + 6.2831853 : a) / 6.2831853;
    float on = step(frac, p);
    vec3 track = pow(vec3(0.16, 0.24, 0.31), vec3(2.2));
    vec3 col = mix(track, arc, on);
    float disc = 1.0 - smoothstep(0.62 - aa, 0.62 + aa, r);
    vec3 inner = pow(vec3(0.03, 0.05, 0.07), vec3(2.2));
    float halo = pulse * exp(-pow((r - 0.95) / 0.08, 2.0));
    vec3 c = mix(inner, col, band) + pulseColor * halo;
    float a2 = max(max(band, disc * 0.92), halo);
    gl_FragColor = vec4(c, a2 * alpha);
  }
`;
const RING_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;

// Light columns: brightest at the base and the cap.
const COL_FRAG = /* glsl */ `
  uniform vec3 color;
  uniform float alpha;
  varying vec2 vUv;
  void main() {
    float y = vUv.y;
    float glow = 0.25 + 0.75 * pow(1.0 - y, 1.6) + 1.4 * smoothstep(0.985, 1.0, y);
    gl_FragColor = vec4(color * glow, alpha);
  }
`;

const BLUE = new THREE.Color("#5AA2FF");
const RED = new THREE.Color("#FF4A57");
const WHITE = new THREE.Color("#E3EBF0");

export function createWorld(canvas, width, height) {
  const qp = new URLSearchParams(location.search);
  const renderer = new THREE.WebGLRenderer({ canvas, alpha: false, antialias: true, preserveDrawingBuffer: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(1);
  renderer.setSize(width, height, false);
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.setClearColor(0x000000, 1);

  const scene = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(30, width / height, 0.02, 200);

  // Ice.
  const seg = +(qp.get("seg") || 0.6);
  const geo = new THREE.PlaneGeometry(PLANE.x1 - PLANE.x0, PLANE.z1 - PLANE.z0, Math.round(640 * seg), Math.round(420 * seg));
  geo.rotateX(-Math.PI / 2);
  geo.translate((PLANE.x0 + PLANE.x1) / 2, 0, (PLANE.z0 + PLANE.z1) / 2);
  const ice = new THREE.ShaderMaterial({
    vertexShader: ICE_VERT,
    fragmentShader: ICE_FRAG,
    uniforms: {
      mask: { value: makeMask() },
      time: { value: 0 },
      waves: { value: Array.from({ length: 8 }, () => new THREE.Vector4(0, 0, 0, 0)) },
      origin: { value: new THREE.Vector2(MTL.wx, MTL.wz) },
      wave: { value: new THREE.Vector4(WAVE.speed, WAVE.amp, WAVE.wavelength, WAVE.decay) },
      plane: { value: new THREE.Vector4(PLANE.x0, PLANE.x1, PLANE.z0, PLANE.z1) },
      camPos: { value: new THREE.Vector3() },
      landIn: { value: 1 },
      wordIn: { value: 0 },
      wordT0: { value: 0 },
      wordOrigin: { value: new THREE.Vector2() },
      flash: { value: 0 },
    },
    extensions: { derivatives: true },
  });
  scene.add(new THREE.Mesh(geo, ice));

  // Sky: near black overhead, a faint arena haze at the horizon.
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(150, 48, 24),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      vertexShader: `varying vec3 vDir; void main() { vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
      fragmentShader: `varying vec3 vDir; void main() {
        float h = clamp(vDir.y, 0.0, 1.0);
        vec3 c = mix(vec3(0.030, 0.050, 0.072), vec3(0.008, 0.013, 0.020), pow(h, 0.45));
        gl_FragColor = vec4(pow(c, vec3(2.2)), 1.0);
      }`,
    }),
  );
  sky.renderOrder = -1;
  scene.add(sky);

  // Arenas.
  const ringGeo = new THREE.PlaneGeometry(0.42, 0.42);
  ringGeo.rotateX(-Math.PI / 2);
  const colGeo = new THREE.CylinderGeometry(0.022, 0.022, 1, 20, 1, true);
  colGeo.translate(0, 0.5, 0);
  const capGeo = new THREE.SphereGeometry(0.03, 20, 12);
  const poolGeo = new THREE.PlaneGeometry(1, 1);
  poolGeo.rotateX(-Math.PI / 2);
  const arenas = TEAMS.map((team) => {
    const ringMat = new THREE.ShaderMaterial({
      vertexShader: RING_VERT,
      fragmentShader: RING_FRAG,
      uniforms: {
        p: { value: 0 }, alpha: { value: 0 }, arc: { value: WHITE.clone() },
        pulse: { value: 0 }, pulseColor: { value: BLUE.clone() },
      },
      transparent: true,
      depthWrite: false,
      extensions: { derivatives: true },
    });
    const ring = new THREE.Mesh(ringGeo, ringMat);
    ring.renderOrder = 2;
    const colMat = new THREE.ShaderMaterial({
      vertexShader: RING_VERT,
      fragmentShader: COL_FRAG,
      uniforms: { color: { value: WHITE.clone() }, alpha: { value: 1 } },
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });
    const col = new THREE.Mesh(colGeo, colMat);
    col.renderOrder = 3;
    const capMat = new THREE.MeshBasicMaterial({ color: WHITE.clone(), transparent: true, toneMapped: false });
    const cap = new THREE.Mesh(capGeo, capMat);
    cap.renderOrder = 4;
    // A pool of arena light on the ice.
    const poolMat = new THREE.ShaderMaterial({
      vertexShader: RING_VERT,
      fragmentShader: `uniform vec3 color; uniform float k; varying vec2 vUv;
        void main() { vec2 q = vUv * 2.0 - 1.0; gl_FragColor = vec4(color * k * exp(-dot(q, q) * 4.0), 1.0); }`,
      uniforms: { color: { value: WHITE.clone() }, k: { value: 0 } },
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const pool = new THREE.Mesh(poolGeo, poolMat);
    pool.renderOrder = 1;
    scene.add(pool, ring, col, cap);
    return { team, ring, col, cap, pool };
  });

  const composer = new EffectComposer(renderer, new THREE.WebGLRenderTarget(width, height, { type: THREE.HalfFloatType, samples: +(qp.get("samples") ?? 0) }));
  composer.setPixelRatio(1);
  composer.setSize(width, height);
  composer.addPass(new RenderPass(scene, cam));
  const bloom = new UnrealBloomPass(new THREE.Vector2(width, height), 0.55, 0.45, 0.82);
  if (!new URLSearchParams(location.search).has("nobloom")) composer.addPass(bloom);
  composer.addPass(new OutputPass());

  const tmp = new THREE.Vector3();

  function update(t) {
    const c = camera(t);
    cam.position.set(...c.pos);
    sky.position.copy(cam.position);
    cam.fov = c.fov;
    cam.up.set(0, 1, 0);
    // The camera takes the hit: the goal, then the quake (magnitude 6.8 shakes the app too).
    const s1 = shake(t, T.goal, 0.035, 0.45), s2 = shake(t, T.quake, 0.07, 0.5);
    cam.position.x += s1[0] + s2[0];
    cam.position.y += s1[1] * 0.5 + s2[1] * 0.5;
    cam.lookAt(c.target[0] + s1[0] + s2[0], c.target[1] + s1[1] + s2[1], c.target[2]);
    cam.updateProjectionMatrix();
    cam.updateMatrixWorld();
    ice.uniforms.camPos.value.copy(cam.position);
    ice.uniforms.time.value = t;
    // The eight most recent shockwaves.
    const live = WAVES.filter((w) => w.t0 <= t).slice(-8);
    ice.uniforms.waves.value.forEach((v, i) => {
      const w = live[i];
      if (w) v.set(w.team.wx, w.team.wz, w.t0, w.amp);
      else v.set(0, 0, 0, 0);
    });
    // The continent is etched into the ice as the camera leaves ice level.
    ice.uniforms.landIn.value = smooth(clamp((t - T.crane + 0.05) / 1.5)) * (1 - smooth(clamp((t - T.finale + 1.2) / 1.0)));
    const fin = WAVES.find((w) => w.finale);
    ice.uniforms.wordIn.value = smooth(clamp((t - T.finale + 0.6) / 0.8));
    ice.uniforms.wordT0.value = fin.t0;
    ice.uniforms.wordOrigin.value.set(fin.team.wx, fin.team.wz);
    const fk = t - T.quake;
    ice.uniforms.flash.value = fk > 0 ? Math.exp(-fk * 2.6) * 2.2 : 0;
    // The goal itself flashes the lamp at Montreal.
    const gk = t - T.goal;
    ice.uniforms.flash.value += gk > 0 ? Math.exp(-gk * 2.0) * 1.6 : 0;

    for (let i = 0; i < arenas.length; i++) {
      const a = arenas[i];
      const s = teamState(a.team, t);
      const pl = pulse(a.team, t);
      const hk = pl.k;
      const sign = (s.away > 0.01 ? a.team.delta > 0 : pl.up) ? BLUE : RED;
      // Ring on the ice, at the arena.
      a.ring.position.set(a.team.wx, 0.04, a.team.wz);
      a.ring.material.uniforms.p.value = s.odds;
      a.ring.material.uniforms.alpha.value = s.lit;
      a.ring.material.uniforms.arc.value.copy(WHITE).lerp(sign, hk * 0.9);
      a.ring.material.uniforms.pulse.value = hk * 1.4;
      a.ring.material.uniforms.pulseColor.value.copy(sign);
      // Column: odds on the map, the change in the ranking.
      const h = s.h;
      a.col.position.set(s.x, 0.04 + s.y, s.z);
      a.col.scale.set(1 + s.away * 3.5, Math.abs(h) < 1e-4 ? 1e-4 : h, 1 + s.away * 3.5);
      const colColor = WHITE.clone().lerp(sign, Math.max(hk, s.away));
      a.col.material.uniforms.color.value.copy(colColor).multiplyScalar(0.45 + hk * 1.2 + s.away * 0.35);
      a.col.material.uniforms.alpha.value = s.lit * (0.9 + 0.1 * hk);
      a.col.visible = s.lit > 0.001 && Math.abs(h) > 0.002;
      a.cap.position.set(s.x, 0.04 + s.y + h, s.z);
      a.cap.scale.setScalar((0.8 + hk * 0.9 + s.away * 0.5) * s.lit);
      a.cap.material.color.copy(colColor).multiplyScalar(1.0 + hk * 1.4);
      a.cap.visible = a.col.visible;
      // Light pool on the ice under the arena.
      const size = 0.9 + hk * 1.6;
      a.pool.position.set(a.team.wx, 0.03, a.team.wz);
      a.pool.scale.set(size, 1, size);
      a.pool.material.uniforms.k.value = (0.03 + 0.10 * hk) * s.lit * (1 - s.away);
      a.pool.material.uniforms.color.value.copy(WHITE).lerp(sign, hk);
      a.pool.visible = a.pool.material.uniforms.k.value > 0.001;
    }
  }

  /** Render at time t, nudged by (jx, jy) pixels for anti-aliasing. */
  function render(t, jx = 0, jy = 0) {
    update(t);
    if (jx || jy) cam.setViewOffset(width, height, jx, jy, width, height);
    else cam.clearViewOffset();
    composer.render();
  }

  /** Screen position of a world point, in output pixels, or null behind the camera. */
  function project(x, y, z) {
    tmp.set(x, y, z).project(cam);
    if (tmp.z > 1) return null;
    return [(tmp.x * 0.5 + 0.5) * width, (-tmp.y * 0.5 + 0.5) * height, tmp.z];
  }

  return { render, project, camera: cam, update };
}
