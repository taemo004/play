// 3D-Darstellung mit three.js: Lava, schwebende Sechseck-Arena, Sumo-Kugeln, Effekte, Kamera.
import * as THREE from 'three';
import { CFG } from './sim.js';

export const TEAM_COLORS = ['#ff4d5e', '#3d8bff'];
const TEAM_DARK = ['#7d1020', '#0f2f75'];
const POWER_COLORS = { heavy: '#ff9f1c', turbo: '#ffe14d', shock: '#4de1ff' };
export const POWER_ICONS = { heavy: '🪨', turbo: '⚡', shock: '💥' };
export const POWER_NAMES = { heavy: 'Koloss', turbo: 'Turbo', shock: 'Schockwelle' };
const SQRT3 = Math.sqrt(3);
const MAX_PARTICLES = 320;

function softDotTexture(inner = 'rgba(255,255,255,1)', outer = 'rgba(255,255,255,0)') {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, inner);
  grd.addColorStop(1, outer);
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

const LAVA_VERT = /* glsl */ `
varying vec2 vP;
void main() {
  vP = position.xy;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const LAVA_FRAG = /* glsl */ `
uniform float uTime;
varying vec2 vP;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p) {
  vec2 i = floor(p); vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}
float fbm(vec2 p) {
  float v = 0.0; float a = 0.5;
  for (int i = 0; i < 4; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; }
  return v;
}
void main() {
  vec2 p = vP * 0.16;
  float t = uTime * 0.07;
  float n = fbm(p + vec2(t, -t * 0.7) + fbm(p * 1.7 - vec2(t * 1.3, t)) * 0.9);
  vec3 dark = vec3(0.16, 0.02, 0.03);
  vec3 mid = vec3(0.9, 0.2, 0.03);
  vec3 hot = vec3(1.0, 0.78, 0.3);
  vec3 col = mix(dark, mid, smoothstep(0.42, 0.6, n));
  col = mix(col, hot, smoothstep(0.62, 0.8, n));
  float r = length(vP);
  float fade = 1.0 - smoothstep(30.0, 80.0, r);
  gl_FragColor = vec4(col, fade);
}`;

export class Renderer {
  constructor(canvas, labelsEl) {
    this.canvas = canvas;
    this.labelsEl = labelsEl;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setClearColor(0x000000, 0);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(42, 1, 0.1, 250);
    this.time = 0;
    this.shake = 0;
    this.azimuth = 0;
    this.topDown = false;
    this.camR = 10;
    this.focus = new THREE.Vector3();
    this.tileFx = [];
    this.playerObjs = new Map();
    this.powerObjs = new Map();
    this.localIds = new Set();

    const hemi = new THREE.HemisphereLight('#ffe9d6', '#ff5a24', 1.5);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight('#ffffff', 2.2);
    sun.position.set(6, 14, 9);
    this.scene.add(sun);
    const rim = new THREE.DirectionalLight('#ff7a3d', 1.4);
    rim.position.set(-6, -4, -8);
    this.scene.add(rim);

    // Lava
    this.lavaMat = new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 } },
      vertexShader: LAVA_VERT,
      fragmentShader: LAVA_FRAG,
      transparent: true,
    });
    const lava = new THREE.Mesh(new THREE.CircleGeometry(90, 64), this.lavaMat);
    lava.rotation.x = -Math.PI / 2;
    lava.position.y = CFG.LAVA_Y;
    this.scene.add(lava);

    this.dotTex = softDotTexture();
    this.shadowTex = softDotTexture('rgba(0,0,0,0.55)', 'rgba(0,0,0,0)');
    this.makeEmbers();

    this.arena = new THREE.Group();
    this.scene.add(this.arena);
    this.playersGroup = new THREE.Group();
    this.scene.add(this.playersGroup);

    // Partikel (ein einziges InstancedMesh für alle Funken, Staub und Brocken)
    const pGeo = new THREE.BoxGeometry(1, 1, 1);
    const pMat = new THREE.MeshBasicMaterial({ toneMapped: false });
    this.pMesh = new THREE.InstancedMesh(pGeo, pMat, MAX_PARTICLES);
    this.pMesh.frustumCulled = false;
    this.pMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.particles = [];
    const white = new THREE.Color('#ffffff');
    for (let i = 0; i < MAX_PARTICLES; i++) {
      this.particles.push({ life: 0 });
      this.pMesh.setColorAt(i, white);
    }
    this.scene.add(this.pMesh);
    this.pIdx = 0;

    // Druckwellen-Ringe
    this.rings = [];
    const ringGeo = new THREE.RingGeometry(0.85, 1, 48);
    for (let i = 0; i < 10; i++) {
      const mesh = new THREE.Mesh(
        ringGeo,
        new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false, side: THREE.DoubleSide, toneMapped: false, blending: THREE.AdditiveBlending }),
      );
      mesh.rotation.x = -Math.PI / 2;
      mesh.visible = false;
      this.scene.add(mesh);
      this.rings.push({ mesh, life: 0 });
    }

    this.tmpM = new THREE.Matrix4();
    this.tmpQ = new THREE.Quaternion();
    this.tmpE = new THREE.Euler();
    this.tmpV = new THREE.Vector3();
    this.tmpS = new THREE.Vector3();
    this.tmpC = new THREE.Color();

    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  makeEmbers() {
    const n = 160;
    const pos = new Float32Array(n * 3);
    this.emberSpeed = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = 3 + Math.random() * 28;
      pos[i * 3] = Math.cos(a) * r;
      pos[i * 3 + 1] = CFG.LAVA_Y + Math.random() * 14;
      pos[i * 3 + 2] = Math.sin(a) * r;
      this.emberSpeed[i] = 0.6 + Math.random() * 1.6;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const mat = new THREE.PointsMaterial({
      size: 0.35,
      map: this.dotTex,
      color: '#ffae5c',
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      toneMapped: false,
    });
    this.embers = new THREE.Points(geo, mat);
    this.scene.add(this.embers);
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, w * h > 900000 ? 1.5 : 2));
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // Neue Partie: Arena und Figuren passend zur Partie aufbauen
  setup(view, { localIds = [], azimuth = 0, topDown = false } = {}) {
    this.view = view;
    this.azimuth = azimuth;
    this.topDown = topDown;
    this.localIds = new Set(localIds);
    this.buildArena(view);
    for (const obj of this.playerObjs.values()) {
      this.playersGroup.remove(obj.group);
      this.scene.remove(obj.ground);
      obj.label.remove();
    }
    this.playerObjs.clear();
    for (const obj of this.powerObjs.values()) this.removePower(obj);
    this.powerObjs.clear();
    for (const p of view.players) this.playerObjs.set(p.id, this.makePlayer(p));
    this.camR = (view.outerRing + 0.6) * SQRT3 * CFG.TILE + 0.4;
  }

  buildArena(view) {
    if (this.tileMesh) {
      this.arena.remove(this.tileMesh);
      this.tileMesh.geometry.dispose();
    }
    const geo = new THREE.CylinderGeometry(CFG.TILE * 0.95, CFG.TILE * 0.72, 1.5, 6, 1);
    geo.translate(0, -0.75, 0);
    const posAttr = geo.getAttribute('position');
    const cols = new Float32Array(posAttr.count * 3);
    for (let i = 0; i < posAttr.count; i++) {
      const y = posAttr.getY(i);
      const k = y > -0.01 ? 1 : 0.3;
      cols[i * 3] = cols[i * 3 + 1] = cols[i * 3 + 2] = k;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.8, metalness: 0.05, flatShading: true });
    const n = view.tiles.length;
    this.tileMesh = new THREE.InstancedMesh(geo, mat, n);
    this.tileMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.tileFx = view.tiles.map((t) => {
      const base = new THREE.Color(t.ring === 0 ? '#ffd166' : t.ring % 2 ? '#e0b98f' : '#c99a70');
      base.offsetHSL((Math.random() - 0.5) * 0.02, 0, (Math.random() - 0.5) * 0.06);
      if (t.ring === view.rings) base.multiplyScalar(0.85);
      return { state: -1, since: 0, base, ax: Math.random() - 0.5, az: Math.random() - 0.5, spin: 1 + Math.random() * 2 };
    });
    this.hot = new THREE.Color('#ff4a1c');
    this.arena.add(this.tileMesh);
  }

  makePlayer(p) {
    const color = new THREE.Color(TEAM_COLORS[p.team]);
    const dark = new THREE.Color(TEAM_DARK[p.team]);
    const group = new THREE.Group();
    const inner = new THREE.Group();
    group.add(inner);
    const bodyMat = new THREE.MeshStandardMaterial({ color, roughness: 0.42, metalness: 0.02, emissive: new THREE.Color(0) });
    const body = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 22), bodyMat);
    inner.add(body);
    const belt = new THREE.Mesh(new THREE.TorusGeometry(0.97, 0.14, 10, 32), new THREE.MeshStandardMaterial({ color: dark, roughness: 0.6 }));
    belt.rotation.x = Math.PI / 2;
    belt.position.y = -0.25;
    inner.add(belt);
    const knot = new THREE.Mesh(new THREE.SphereGeometry(0.24, 14, 10), new THREE.MeshStandardMaterial({ color: '#1d1d24', roughness: 0.5 }));
    knot.position.set(0, 1.02, -0.12);
    knot.scale.set(1, 0.8, 1.3);
    inner.add(knot);
    const white = new THREE.MeshStandardMaterial({ color: '#ffffff', roughness: 0.3 });
    const black = new THREE.MeshBasicMaterial({ color: '#111118' });
    const eyes = [];
    for (const s of [-1, 1]) {
      const eye = new THREE.Mesh(new THREE.SphereGeometry(0.22, 16, 12), white);
      eye.position.set(s * 0.32, 0.32, 0.86);
      inner.add(eye);
      const pupil = new THREE.Mesh(new THREE.SphereGeometry(0.11, 12, 8), black);
      pupil.position.set(s * 0.32, 0.32, 1.06);
      inner.add(pupil);
      const brow = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.07, 0.08), black);
      brow.position.set(s * 0.32, 0.6, 0.86);
      inner.add(brow);
      eyes.push({ pupil, brow, s });
    }
    this.playersGroup.add(group);

    const ground = new THREE.Group();
    const shadow = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ map: this.shadowTex, transparent: true, depthWrite: false }),
    );
    shadow.rotation.x = -Math.PI / 2;
    ground.add(shadow);
    const isLocal = this.localIds.has(p.id);
    let marker = null;
    if (isLocal) {
      marker = new THREE.Mesh(
        new THREE.RingGeometry(1.15, 1.4, 40),
        new THREE.MeshBasicMaterial({ color: this.localIds.size > 1 ? TEAM_COLORS[p.team] : '#ffffff', transparent: true, opacity: 0.75, depthWrite: false, toneMapped: false }),
      );
      marker.rotation.x = -Math.PI / 2;
      marker.position.y = 0.02;
      ground.add(marker);
    }
    this.scene.add(ground);

    const label = document.createElement('div');
    label.className = 'plabel team' + p.team + (isLocal ? ' me' : '');
    label.innerHTML = `<span class="pname"></span><span class="picon"></span>`;
    label.querySelector('.pname').textContent = isLocal && this.localIds.size === 1 ? 'DU' : p.name;
    this.labelsEl.appendChild(label);

    return { group, inner, body, bodyMat, color, eyes, ground, shadow, marker, label, icon: label.querySelector('.picon'), rot: Math.atan2(p.fx, p.fz), flash: 0, trail: 0, lastIcon: '', spin: 0 };
  }

  renameLabel(id, name) {
    const o = this.playerObjs.get(id);
    if (o && !(this.localIds.has(id) && this.localIds.size === 1)) o.label.querySelector('.pname').textContent = name;
  }

  makePowerObj(pu) {
    const col = new THREE.Color(POWER_COLORS[pu.type] || '#ffffff');
    const group = new THREE.Group();
    const gem = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.42, 0),
      new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 0.9, roughness: 0.2, flatShading: true }),
    );
    group.add(gem);
    const beam = new THREE.Mesh(
      new THREE.CylinderGeometry(0.4, 0.4, 7, 16, 1, true),
      new THREE.MeshBasicMaterial({ color: col, transparent: true, opacity: 0.18, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide, toneMapped: false }),
    );
    beam.position.y = 3;
    group.add(beam);
    const glow = new THREE.Mesh(
      new THREE.PlaneGeometry(2.2, 2.2),
      new THREE.MeshBasicMaterial({ map: this.dotTex, color: col, transparent: true, opacity: 0.8, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }),
    );
    glow.rotation.x = -Math.PI / 2;
    glow.position.y = -0.85;
    group.add(glow);
    group.position.set(pu.x, 0.9, pu.z);
    this.scene.add(group);
    const label = document.createElement('div');
    label.className = 'pulabel';
    label.textContent = POWER_ICONS[pu.type] || '?';
    this.labelsEl.appendChild(label);
    return { group, gem, label, born: this.time };
  }

  removePower(obj) {
    this.scene.remove(obj.group);
    obj.group.traverse((o) => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) o.material.dispose();
    });
    obj.label.remove();
  }

  // ---------- Effekte ----------

  spawn(x, y, z, vx, vy, vz, life, size, color, grav = 14) {
    const idx = this.pIdx;
    const p = this.particles[idx];
    this.pIdx = (idx + 1) % MAX_PARTICLES;
    Object.assign(p, { x, y, z, vx, vy, vz, life, max: life, size, grav, rx: Math.random() * 6, ry: Math.random() * 6 });
    this.pMesh.setColorAt(idx, this.tmpC.set(color));
    this.pMesh.instanceColor.needsUpdate = true;
  }

  burst(x, y, z, colors, count, speed, up = 3, size = 0.18, life = 0.6) {
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = speed * (0.4 + Math.random() * 0.8);
      this.spawn(x, y, z, Math.cos(a) * s, up * (0.5 + Math.random()), Math.sin(a) * s, life * (0.6 + Math.random() * 0.7), size * (0.6 + Math.random() * 0.8), colors[i % colors.length]);
    }
  }

  ring(x, y, z, color, from, to, life = 0.45) {
    const r = this.rings.find((o) => o.life <= 0) || this.rings[0];
    Object.assign(r, { x, y, z, from, to, life, max: life });
    r.mesh.material.color.set(color);
    r.mesh.visible = true;
  }

  onEvent(e) {
    const po = (id) => this.view && this.view.players.find((p) => p.id === id);
    switch (e.type) {
      case 'dash': {
        const p = po(e.id);
        if (!p) break;
        const o = this.playerObjs.get(p.id);
        if (o) o.trail = 0.25;
        this.burst(p.x, 0.1, p.z, ['#ffffff', '#f3e0c8'], 8, 2.5, 1.5, 0.14, 0.35);
        break;
      }
      case 'hit': {
        const k = Math.min(1.2, e.power / CFG.DASH_KNOCK);
        this.burst(e.x, 0.7, e.z, ['#ffffff', '#ffe14d', '#ff9f1c'], 22, 7 * k, 4, 0.2, 0.55);
        this.ring(e.x, 0.3, e.z, '#ffffff', 0.4, 3.2 * k, 0.35);
        this.shake = Math.max(this.shake, 0.35 * k);
        const o = this.playerObjs.get(e.b);
        if (o) o.flash = 0.18;
        break;
      }
      case 'clash':
        this.burst(e.x, 0.7, e.z, ['#ffffff', '#4de1ff', '#ffe14d'], 30, 8, 5, 0.22, 0.6);
        this.ring(e.x, 0.3, e.z, '#4de1ff', 0.4, 4, 0.4);
        this.shake = Math.max(this.shake, 0.5);
        for (const id of [e.a, e.b]) {
          const o = this.playerObjs.get(id);
          if (o) o.flash = 0.18;
        }
        break;
      case 'bump':
        this.burst(e.x, 0.6, e.z, ['#ffffff'], 5, 2.5, 2, 0.12, 0.3);
        this.shake = Math.max(this.shake, 0.06);
        break;
      case 'splash':
        this.burst(e.x, CFG.LAVA_Y + 0.2, e.z, ['#ffcf4d', '#ff6a1c', '#ff3b1c'], 34, 5, 9, 0.28, 1.1);
        this.ring(e.x, CFG.LAVA_Y + 0.05, e.z, '#ffb347', 0.5, 4, 0.8);
        break;
      case 'power':
        this.burst(e.x, 0.8, e.z, [POWER_COLORS[e.kind], '#ffffff'], 24, 4, 5, 0.18, 0.7);
        this.ring(e.x, 0.1, e.z, POWER_COLORS[e.kind], 0.5, 2.5, 0.5);
        break;
      case 'shock':
        this.ring(e.x, 0.15, e.z, '#4de1ff', 0.5, CFG.SHOCK_RADIUS * 1.1, 0.5);
        this.ring(e.x, 0.25, e.z, '#ffffff', 0.3, CFG.SHOCK_RADIUS * 0.8, 0.4);
        this.burst(e.x, 0.4, e.z, ['#4de1ff', '#ffffff'], 36, 10, 2, 0.16, 0.5);
        this.shake = Math.max(this.shake, 0.4);
        break;
      case 'pspawn':
        this.ring(e.x, 0.05, e.z, POWER_COLORS[e.kind] || '#fff', 0.2, 1.6, 0.6);
        break;
      case 'shrink':
        this.shake = Math.max(this.shake, 0.08);
        break;
      default:
    }
  }

  // ---------- Pro Bild ----------

  render(view, dt) {
    this.view = view;
    this.time += dt;
    this.lavaMat.uniforms.uTime.value = this.time;
    this.updateEmbers(dt);
    this.updateTiles(view, dt);
    this.updatePlayers(view, dt);
    this.updatePowerups(view, dt);
    this.updateParticles(dt);
    this.updateCamera(view, dt);
    this.renderer.render(this.scene, this.camera);
    this.updateLabels(view);
  }

  updateEmbers(dt) {
    const pos = this.embers.geometry.getAttribute('position');
    for (let i = 0; i < pos.count; i++) {
      let y = pos.getY(i) + this.emberSpeed[i] * dt;
      if (y > CFG.LAVA_Y + 15) y = CFG.LAVA_Y;
      pos.setY(i, y);
    }
    pos.needsUpdate = true;
  }

  updateTiles(view, dt) {
    const { tmpM, tmpQ, tmpE, tmpV, tmpS, tmpC } = this;
    view.tiles.forEach((t, i) => {
      const fx = this.tileFx[i];
      if (!fx) return;
      if (fx.state !== t.state) {
        fx.state = t.state;
        fx.since = 0;
        if (t.state === 2) this.burst(t.x, -0.2, t.z, ['#8a6a4f', '#c99a70', '#5a3d2b'], 4, 1.5, 1.5, 0.22, 0.8);
      } else fx.since += dt;
      let x = t.x;
      let y = 0;
      let z = t.z;
      let rx = 0;
      let rz = 0;
      let sc = 1;
      tmpC.copy(fx.base);
      if (t.state === 1) {
        const k = Math.min(1, fx.since / CFG.CRUMBLE_TIME);
        const amp = 0.02 + k * 0.07;
        x += Math.sin(this.time * 47 + i) * amp;
        z += Math.cos(this.time * 53 + i * 1.7) * amp;
        y = -k * 0.12;
        tmpC.lerp(this.hot, 0.25 + k * 0.45 + Math.sin(this.time * 14) * 0.12);
      } else if (t.state === 2) {
        const s = fx.since;
        y = -0.5 * 22 * s * s - 0.1;
        rx = fx.ax * s * fx.spin * 2;
        rz = fx.az * s * fx.spin * 2;
        tmpC.lerp(this.hot, 0.6);
        if (y < CFG.LAVA_Y - 2) sc = 0;
      }
      tmpE.set(rx, 0, rz);
      tmpQ.setFromEuler(tmpE);
      tmpV.set(x, y, z);
      tmpS.set(sc, sc, sc);
      tmpM.compose(tmpV, tmpQ, tmpS);
      this.tileMesh.setMatrixAt(i, tmpM);
      this.tileMesh.setColorAt(i, tmpC);
    });
    this.tileMesh.instanceMatrix.needsUpdate = true;
    if (this.tileMesh.instanceColor) this.tileMesh.instanceColor.needsUpdate = true;
  }

  updatePlayers(view, dt) {
    for (const p of view.players) {
      const o = this.playerObjs.get(p.id);
      if (!o) continue;
      const visible = !p.out;
      o.group.visible = visible;
      o.ground.visible = visible && !p.falling;
      if (!visible) continue;
      const R = p.radius;
      // Drehung zur Blickrichtung (kürzester Weg)
      const target = Math.atan2(p.fx, p.fz);
      let d = target - o.rot;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      o.rot += d * Math.min(1, dt * 16);
      o.group.rotation.y = o.rot;
      const dashing = p.dashT > 0;
      const stunned = p.stunT > 0;
      const bob = Math.sin(this.time * 7 + p.slot * 1.3) * 0.04;
      let sx = 1 + bob * 0.5;
      let sy = 1 - bob;
      let sz = 1 + bob * 0.5;
      if (dashing) {
        sx = 0.82;
        sy = 0.86;
        sz = 1.32;
      }
      const cur = o.inner.scale;
      const k = Math.min(1, dt * 18);
      cur.set(cur.x + (sx * R - cur.x) * k, cur.y + (sy * R - cur.y) * k, cur.z + (sz * R - cur.z) * k);
      o.group.position.set(p.x, p.y + cur.y * 0.98, p.z);
      // Taumeln nach Treffer, Drehen beim Fallen
      if (p.falling) o.spin += dt * 9;
      else o.spin *= Math.exp(-dt * 10);
      o.inner.rotation.z = stunned ? Math.sin(this.time * 32) * 0.28 : 0;
      o.inner.rotation.x = p.falling ? -o.spin : 0;
      // Augen
      for (const e of o.eyes) {
        if (stunned || p.falling) {
          const a = this.time * 22 + e.s;
          e.pupil.position.set(e.s * 0.32 + Math.cos(a) * 0.07, 0.32 + Math.sin(a) * 0.07, 1.04);
        } else e.pupil.position.set(e.s * 0.32, 0.32, 1.06);
        const angry = dashing || p.cool > 0.8;
        e.brow.rotation.z = angry ? -e.s * 0.45 : -e.s * 0.1;
        e.brow.position.y = angry ? 0.56 : 0.62;
      }
      // Farben: Treffer-Blitz, Koloss, Turbo
      o.flash = Math.max(0, o.flash - dt);
      const em = o.bodyMat.emissive;
      if (o.flash > 0) em.set('#ffffff').multiplyScalar(o.flash * 4);
      else if (p.turboT > 0) em.set('#ffe14d').multiplyScalar(0.25 + 0.2 * Math.sin(this.time * 18));
      else if (p.heavyT > 0) em.set('#ff9f1c').multiplyScalar(0.18);
      else em.set(0);
      o.bodyMat.color.copy(o.color);
      if (p.heavyT > 0) o.bodyMat.color.multiplyScalar(0.7);
      // Sprint-Spur
      o.trail = Math.max(0, o.trail - dt);
      if (dashing || o.trail > 0.1) {
        if (Math.random() < 0.8) this.spawn(p.x + (Math.random() - 0.5) * R, p.y + R * (0.4 + Math.random() * 0.8), p.z + (Math.random() - 0.5) * R, 0, 0.5, 0, 0.3, 0.22 * R, TEAM_COLORS[p.team], 0);
      }
      // Boden: Schatten und Markierung
      o.ground.position.set(p.x, 0.015, p.z);
      o.shadow.scale.setScalar(R * 2.6);
      if (o.marker) {
        o.marker.scale.setScalar(R * (1 + Math.sin(this.time * 5) * 0.05));
        o.marker.material.opacity = p.doomed ? 0 : 0.7;
      }
      const icon = p.heavyT > 0 ? POWER_ICONS.heavy : p.turboT > 0 ? POWER_ICONS.turbo : '';
      if (icon !== o.lastIcon) {
        o.icon.textContent = icon;
        o.lastIcon = icon;
      }
    }
  }

  updatePowerups(view, dt) {
    const seen = new Set();
    for (const pu of view.powerups) {
      seen.add(pu.id);
      let o = this.powerObjs.get(pu.id);
      if (!o) this.powerObjs.set(pu.id, (o = this.makePowerObj(pu)));
      const age = this.time - o.born;
      const grow = Math.min(1, age * 3);
      o.group.position.set(pu.x, 0.9 + Math.sin(this.time * 3 + pu.id) * 0.15, pu.z);
      o.gem.rotation.y += dt * 2.5;
      o.gem.scale.setScalar(grow);
    }
    for (const [id, o] of this.powerObjs) {
      if (seen.has(id)) continue;
      this.removePower(o);
      this.powerObjs.delete(id);
    }
  }

  updateParticles(dt) {
    const { tmpM, tmpQ, tmpE, tmpV, tmpS } = this;
    for (let i = 0; i < MAX_PARTICLES; i++) {
      const p = this.particles[i];
      if (p.life <= 0) {
        if (p.wasAlive !== false) {
          tmpS.set(0, 0, 0);
          tmpM.compose(tmpV.set(0, -99, 0), tmpQ.identity(), tmpS);
          this.pMesh.setMatrixAt(i, tmpM);
          p.wasAlive = false;
        }
        continue;
      }
      p.wasAlive = true;
      p.life -= dt;
      p.vy -= p.grav * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      const k = Math.max(0, p.life / p.max);
      const s = p.size * k;
      tmpE.set(p.rx + this.time * 4, p.ry + this.time * 3, 0);
      tmpQ.setFromEuler(tmpE);
      tmpM.compose(tmpV.set(p.x, p.y, p.z), tmpQ, tmpS.set(s, s, s));
      this.pMesh.setMatrixAt(i, tmpM);
    }
    this.pMesh.instanceMatrix.needsUpdate = true;
    for (const r of this.rings) {
      if (r.life <= 0) continue;
      r.life -= dt;
      const k = 1 - Math.max(0, r.life / r.max);
      const s = r.from + (r.to - r.from) * (1 - (1 - k) * (1 - k));
      r.mesh.position.set(r.x, r.y, r.z);
      r.mesh.scale.setScalar(s);
      r.mesh.material.opacity = (1 - k) * 0.9;
      if (r.life <= 0) r.mesh.visible = false;
    }
  }

  updateCamera(view, dt) {
    const target = Math.max(4.5, (view.outerRing + 0.6) * SQRT3 * CFG.TILE + 0.4);
    this.camR += (target - this.camR) * Math.min(1, dt * 0.8);
    const R = this.camR;
    const cam = this.camera;
    const vfov = (cam.fov * Math.PI) / 180;
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * cam.aspect);
    const el = ((this.topDown ? 78 : 56) * Math.PI) / 180;
    const dist = Math.max(R / Math.tan(hfov / 2), (R * (this.topDown ? 1.05 : 0.95)) / Math.tan(vfov / 2)) * 1.02 + 1;
    // Leicht zur Action schwenken
    let cx = 0;
    let cz = 0;
    let n = 0;
    for (const p of view.players) {
      if (p.out || p.doomed) continue;
      cx += p.x;
      cz += p.z;
      n++;
    }
    if (n) {
      cx = (cx / n) * 0.12;
      cz = (cz / n) * 0.12;
    }
    this.focus.x += (cx - this.focus.x) * Math.min(1, dt * 2);
    this.focus.z += (cz - this.focus.z) * Math.min(1, dt * 2);
    const az = this.azimuth;
    this.shake = Math.max(0, this.shake - dt * 1.6);
    const sh = this.shake * this.shake * 1.2;
    cam.position.set(
      this.focus.x + Math.sin(az) * Math.cos(el) * dist + (Math.random() - 0.5) * sh,
      Math.sin(el) * dist + (Math.random() - 0.5) * sh,
      this.focus.z + Math.cos(az) * Math.cos(el) * dist + (Math.random() - 0.5) * sh,
    );
    cam.up.set(0, 1, 0);
    cam.lookAt(this.focus.x, -0.6, this.focus.z);
  }

  updateLabels(view) {
    const w = window.innerWidth;
    const h = window.innerHeight;
    const v = this.tmpV;
    for (const p of view.players) {
      const o = this.playerObjs.get(p.id);
      if (!o) continue;
      if (p.out || p.y < -2) {
        o.label.style.display = 'none';
        continue;
      }
      v.set(p.x, p.y + p.radius * 2.25 + 0.2, p.z).project(this.camera);
      o.label.style.display = '';
      o.label.style.transform = `translate(${((v.x + 1) / 2) * w}px, ${((1 - v.y) / 2) * h}px) translate(-50%, -100%)`;
    }
    for (const [id, o] of this.powerObjs) {
      v.copy(o.group.position).setY(o.group.position.y + 0.8).project(this.camera);
      o.label.style.transform = `translate(${((v.x + 1) / 2) * w}px, ${((1 - v.y) / 2) * h}px) translate(-50%, -100%)`;
    }
  }
}
