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

// Aussehen der Arenen (Physik steht in sim.js → ARENAS)
export const THEMES = {
  lava: {
    tiles: ['#e0b98f', '#c99a70'],
    center: '#ffd166',
    sky: '#ffe9d6',
    ground: '#ff5a24',
    rim: '#ff7a3d',
    liquid: [[0.16, 0.02, 0.03], [0.9, 0.2, 0.03], [1.0, 0.78, 0.3]],
    ember: '#ffae5c',
    emberDir: 1,
    hot: '#ff4a1c',
    debris: ['#8a6a4f', '#c99a70', '#5a3d2b'],
    splash: ['#ffcf4d', '#ff6a1c', '#ff3b1c'],
  },
  eis: {
    tiles: ['#eef9ff', '#c4e6f7'],
    center: '#8fe3ff',
    sky: '#f2fbff',
    ground: '#3a7bd5',
    rim: '#7fd0ff',
    liquid: [[0.01, 0.04, 0.12], [0.06, 0.3, 0.55], [0.7, 0.93, 1.0]],
    ember: '#ffffff',
    emberDir: -1,
    hot: '#2f8fff',
    debris: ['#ffffff', '#c4e6f7', '#8fcff0'],
    splash: ['#ffffff', '#bfe9ff', '#5bb8ff'],
  },
  dreh: {
    tiles: ['#ff7aa8', '#ffd166', '#4de1c1', '#8b9bff', '#ffa45c', '#c38bff'],
    sectors: true,
    center: '#ffffff',
    sky: '#fff0fb',
    ground: '#b23cff',
    rim: '#ff6bd6',
    liquid: [[0.1, 0.02, 0.2], [0.55, 0.1, 0.62], [1.0, 0.6, 0.9]],
    ember: '#ff9ce6',
    emberDir: 1,
    hot: '#ffffff',
    debris: ['#ff7aa8', '#ffd166', '#4de1c1'],
    splash: ['#ff9ce6', '#ffffff', '#c38bff'],
  },
};

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
uniform vec3 uDark;
uniform vec3 uMid;
uniform vec3 uHot;
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
  vec3 col = mix(uDark, uMid, smoothstep(0.42, 0.6, n));
  col = mix(col, uHot, smoothstep(0.62, 0.8, n));
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
    this.hemi = hemi;
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight('#ffffff', 2.2);
    sun.position.set(6, 14, 9);
    this.scene.add(sun);
    const rim = new THREE.DirectionalLight('#ff7a3d', 1.4);
    this.rim = rim;
    rim.position.set(-6, -4, -8);
    this.scene.add(rim);

    // Lava
    this.lavaMat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uDark: { value: new THREE.Vector3() },
        uMid: { value: new THREE.Vector3() },
        uHot: { value: new THREE.Vector3() },
      },
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
    this.theme = null;
    this.cinematic = null; // Zeitlupen-Kamera { x, z }
    this.applyTheme('lava');
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
    this.tmpC2 = new THREE.Color();

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

  applyTheme(id) {
    const th = THEMES[id] || THEMES.lava;
    this.theme = id;
    this.th = th;
    this.hemi.color.set(th.sky);
    this.hemi.groundColor.set(th.ground);
    this.rim.color.set(th.rim);
    const u = this.lavaMat.uniforms;
    u.uDark.value.set(...th.liquid[0]);
    u.uMid.value.set(...th.liquid[1]);
    u.uHot.value.set(...th.liquid[2]);
    if (this.embers) this.embers.material.color.set(th.ember);
    this.hot = new THREE.Color(th.hot);
    for (const cls of [...document.body.classList]) if (cls.startsWith('theme-')) document.body.classList.remove(cls);
    document.body.classList.add('theme-' + id);
    if (this.view && this.tileFx.length) this.colorTiles(this.view);
  }

  colorTiles(view) {
    const th = this.th;
    view.tiles.forEach((t, i) => {
      const fx = this.tileFx[i];
      if (!fx) return;
      let c;
      if (t.ring === 0) c = th.center;
      else if (th.sectors) {
        // Tortenstücke, damit man die Drehung sieht
        const a = Math.atan2(t.z, t.x) + Math.PI;
        c = th.tiles[Math.floor((a / (Math.PI * 2)) * 6 + 0.001) % th.tiles.length];
      } else c = th.tiles[t.ring % 2];
      fx.base.set(c).offsetHSL(fx.hue, 0, fx.light);
      if (t.ring === view.rings) fx.base.multiplyScalar(0.85);
    });
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
    this.tileFx = view.tiles.map(() => ({
      state: -1,
      since: 0,
      base: new THREE.Color(),
      hue: (Math.random() - 0.5) * 0.02,
      light: (Math.random() - 0.5) * 0.06,
      ax: Math.random() - 0.5,
      az: Math.random() - 0.5,
      spin: 1 + Math.random() * 2,
    }));
    this.arena.add(this.tileMesh);
    // Hügel-Modus: leuchtender Ring um den Hügel
    if (this.hillRing) {
      this.arena.remove(this.hillRing);
      this.hillRing = null;
    }
    if (view.goal === 'huegel') {
      const r = (CFG.HILL_RING + 0.55) * SQRT3 * CFG.TILE;
      this.hillRing = new THREE.Mesh(
        new THREE.RingGeometry(r - 0.16, r, 64),
        new THREE.MeshBasicMaterial({ color: '#ffd166', transparent: true, opacity: 0.8, depthWrite: false, toneMapped: false, side: THREE.DoubleSide }),
      );
      this.hillRing.rotation.x = -Math.PI / 2;
      this.hillRing.position.y = 0.03;
      this.arena.add(this.hillRing);
    }
    this.applyTheme(view.arena || 'lava');
  }

  makePlayer(p) {
    const sumo = buildSumo(p.team, p.look);
    const { group, inner, bodyMat, color, eyes, hat } = sumo;
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

    return { group, inner, bodyMat, color, eyes, hat, ground, shadow, marker, label, icon: label.querySelector('.picon'), rot: Math.atan2(p.fx, p.fz), flash: 0, trail: 0, lastIcon: '', spin: 0 };
  }

  // Emoji-Sprechblase über der Figur
  showEmote(id, emoji) {
    const o = this.playerObjs.get(id);
    if (!o || !emoji) return;
    let b = o.label.querySelector('.pemo');
    if (!b) {
      b = document.createElement('span');
      b.className = 'pemo';
      o.label.appendChild(b);
    }
    b.textContent = emoji;
    b.classList.remove('show');
    void b.offsetWidth;
    b.classList.add('show');
    clearTimeout(o.emoTimer);
    o.emoTimer = setTimeout(() => b.classList.remove('show'), 2200);
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
        const k = Math.min(2, e.power / CFG.DASH_KNOCK);
        if (e.charged) {
          this.ring(e.x, 0.4, e.z, '#ffe14d', 0.6, 5.5, 0.5);
          this.burst(e.x, 0.8, e.z, ['#ffe14d', '#ffffff'], 26, 10, 6, 0.24, 0.7);
        }
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
        this.burst(e.x, CFG.LAVA_Y + 0.2, e.z, this.th.splash, 34, 5, 9, 0.28, 1.1);
        this.ring(e.x, CFG.LAVA_Y + 0.05, e.z, this.th.splash[0], 0.5, 4, 0.8);
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
      case 'land':
        this.burst(e.x, 0.1, e.z, ['#ffffff', '#f3e0c8'], 14, 4, 1.5, 0.18, 0.5);
        this.ring(e.x, 0.05, e.z, '#ffffff', 0.4, 2.2, 0.35);
        this.shake = Math.max(this.shake, 0.12);
        break;
      default:
    }
  }

  // ---------- Pro Bild ----------

  render(view, dt) {
    this.view = view;
    this.time += dt;
    if ((view.arena || 'lava') !== this.theme) this.applyTheme(view.arena || 'lava');
    this.arena.rotation.y = -(view.angle || 0);
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
      let y = pos.getY(i) + this.emberSpeed[i] * dt * this.th.emberDir;
      if (y > CFG.LAVA_Y + 15) y = CFG.LAVA_Y;
      if (y < CFG.LAVA_Y) y = CFG.LAVA_Y + 15;
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
        if (t.state === 2) {
          const a = view.angle || 0;
          const wx = t.x * Math.cos(a) - t.z * Math.sin(a);
          const wz = t.x * Math.sin(a) + t.z * Math.cos(a);
          this.burst(wx, -0.2, wz, this.th.debris, 4, 1.5, 1.5, 0.22, 0.8);
        }
      } else fx.since += dt;
      let x = t.x;
      let y = 0;
      let z = t.z;
      let rx = 0;
      let rz = 0;
      let sc = 1;
      tmpC.copy(fx.base);
      if (view.goal === 'huegel' && t.ring <= CFG.HILL_RING && t.state === 0) {
        // Hügel: golden, in Teamfarbe wenn gehalten, flackernd wenn umkämpft
        tmpC.set('#ffd166');
        const hs = view.hillState;
        if (hs === 0 || hs === 1) tmpC.lerp(this.tmpC2.set(TEAM_COLORS[hs]), 0.55 + Math.sin(this.time * 6) * 0.15);
        else if (hs === 2) tmpC.lerp(this.tmpC2.set('#ffffff'), 0.3 + Math.sin(this.time * 20) * 0.3);
      }
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
      o.ground.visible = visible && (!p.falling || p.drop);
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
      const chg = p.charging ? Math.min(1, p.charge / CFG.CHARGE_MAX) : 0;
      if (chg > 0) {
        // Aufladen: Figur duckt sich und zittert immer stärker
        const wob = Math.sin(this.time * (30 + chg * 30)) * 0.04 * chg;
        sx = 1 + chg * 0.14 + wob;
        sy = 1 - chg * 0.16;
        sz = 1 + chg * 0.14 - wob;
        if (Math.random() < 0.3 + chg * 0.5) {
          const a = Math.random() * Math.PI * 2;
          this.spawn(p.x + Math.cos(a) * R * 1.3, p.y + 0.2, p.z + Math.sin(a) * R * 1.3, -Math.cos(a) * 2, 2 + chg * 3, -Math.sin(a) * 2, 0.35, 0.12 + chg * 0.1, chg > 0.95 ? '#ffffff' : '#ffe14d', 4);
        }
      }
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
      if (o.hat && o.hat.userData.bob) o.hat.position.y = o.hat.userData.bob + Math.sin(this.time * 3 + p.slot) * 0.06;
      // Augen
      for (const e of o.eyes) {
        if (stunned || p.falling) {
          const a = this.time * 22 + e.s;
          e.pupil.position.set(e.s * 0.32 + Math.cos(a) * 0.07, 0.32 + Math.sin(a) * 0.07, 1.04);
        } else e.pupil.position.set(e.s * 0.32, 0.32, 1.06);
        const angry = dashing || p.cool > 0.8 || chg > 0;
        e.brow.rotation.z = angry ? -e.s * 0.45 : -e.s * 0.1;
        e.brow.position.y = angry ? 0.56 : 0.62;
      }
      // Farben: Treffer-Blitz, Koloss, Turbo
      o.flash = Math.max(0, o.flash - dt);
      const em = o.bodyMat.emissive;
      if (o.flash > 0) em.set('#ffffff').multiplyScalar(o.flash * 4);
      else if (chg > 0) em.set(chg > 0.95 ? '#ffffff' : '#ffb830').multiplyScalar(chg * (0.35 + 0.25 * Math.sin(this.time * 25)));
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
    let dist2 = dist;
    let el2 = el;
    let follow = 2;
    if (this.cinematic) {
      // Zeitlupe: nah ran an das Opfer, flacher Blickwinkel
      cx = this.cinematic.x * 0.85;
      cz = this.cinematic.z * 0.85;
      dist2 = Math.min(dist, 11);
      el2 = (40 * Math.PI) / 180;
      follow = 3;
    }
    this.camDist = this.camDist ? this.camDist + (dist2 - this.camDist) * Math.min(1, dt * follow) : dist2;
    this.camEl = this.camEl ? this.camEl + (el2 - this.camEl) * Math.min(1, dt * follow) : el2;
    this.focus.x += (cx - this.focus.x) * Math.min(1, dt * follow);
    this.focus.z += (cz - this.focus.z) * Math.min(1, dt * follow);
    const az = this.azimuth;
    this.shake = Math.max(0, this.shake - dt * 1.6);
    const sh = this.shake * this.shake * 1.2;
    const cd = this.camDist;
    const ce = this.camEl;
    cam.position.set(
      this.focus.x + Math.sin(az) * Math.cos(ce) * cd + (Math.random() - 0.5) * sh,
      Math.sin(ce) * cd + (Math.random() - 0.5) * sh,
      this.focus.z + Math.cos(az) * Math.cos(ce) * cd + (Math.random() - 0.5) * sh,
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

// ---------- Figur (Spiel und Vorschau) ----------

function mat(color, opts = {}) {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.5, ...opts });
}

// Baut eine Sumo-Figur in Einheitsgröße (Radius 1). Blickrichtung +z.
export function buildSumo(team, look = {}) {
  const color = new THREE.Color(TEAM_COLORS[team] || TEAM_COLORS[0]);
  const dark = new THREE.Color(TEAM_DARK[team] || TEAM_DARK[0]);
  const group = new THREE.Group();
  const inner = new THREE.Group();
  group.add(inner);
  const bodyMat = new THREE.MeshStandardMaterial({ color, roughness: 0.42, metalness: 0.02, emissive: new THREE.Color(0) });
  inner.add(new THREE.Mesh(new THREE.SphereGeometry(1, 32, 22), bodyMat));
  const gold = look.extra === 'goldguertel';
  const beltMat = gold ? mat('#ffc83d', { metalness: 0.8, roughness: 0.25, emissive: new THREE.Color('#4a3000') }) : mat(dark, { roughness: 0.6 });
  const belt = new THREE.Mesh(new THREE.TorusGeometry(0.97, gold ? 0.17 : 0.14, 10, 32), beltMat);
  belt.rotation.x = Math.PI / 2;
  belt.position.y = -0.25;
  inner.add(belt);
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
  const hat = buildHat(look.hat);
  if (hat) inner.add(hat);
  else {
    const knot = new THREE.Mesh(new THREE.SphereGeometry(0.24, 14, 10), mat('#1d1d24'));
    knot.position.set(0, 1.02, -0.12);
    knot.scale.set(1, 0.8, 1.3);
    inner.add(knot);
  }
  const extra = buildExtra(look.extra);
  if (extra) inner.add(extra);
  if (gold) {
    const buckle = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.08, 20), beltMat);
    buckle.rotation.x = Math.PI / 2;
    buckle.position.set(0, -0.25, 0.99);
    inner.add(buckle);
  }
  return { group, inner, bodyMat, color, eyes, hat };
}

function buildHat(id) {
  const g = new THREE.Group();
  const add = (geo, material, x, y, z, rx = 0, ry = 0, rz = 0) => {
    const m = new THREE.Mesh(geo, material);
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, rz);
    g.add(m);
    return m;
  };
  switch (id) {
    case 'party': {
      add(new THREE.ConeGeometry(0.38, 0.85, 20), mat('#ff5fa2'), 0, 1.3, 0, 0, 0, 0.15);
      add(new THREE.TorusGeometry(0.3, 0.05, 8, 20), mat('#ffe14d'), -0.02, 1.08, 0, Math.PI / 2, 0, 0.15);
      add(new THREE.SphereGeometry(0.13, 12, 10), mat('#ffe14d'), -0.1, 1.72, 0);
      break;
    }
    case 'zylinder': {
      const black = mat('#1b1b22', { roughness: 0.35 });
      add(new THREE.CylinderGeometry(0.62, 0.62, 0.06, 28), black, 0, 0.93, 0);
      add(new THREE.CylinderGeometry(0.4, 0.42, 0.62, 28), black, 0, 1.25, 0);
      add(new THREE.CylinderGeometry(0.425, 0.425, 0.1, 28), mat('#d7263d'), 0, 1.01, 0);
      break;
    }
    case 'cowboy': {
      const brown = mat('#9a5b2e', { roughness: 0.8 });
      add(new THREE.CylinderGeometry(0.9, 0.9, 0.05, 32), brown, 0, 0.88, 0);
      add(new THREE.TorusGeometry(0.88, 0.06, 8, 32), brown, 0, 0.93, 0, Math.PI / 2);
      const crown = add(new THREE.SphereGeometry(0.5, 20, 14), brown, 0, 1.08, 0);
      crown.scale.set(0.95, 0.75, 1.1);
      add(new THREE.CylinderGeometry(0.49, 0.49, 0.09, 24), mat('#3b2412'), 0, 0.98, 0);
      break;
    }
    case 'wikinger': {
      const metal = mat('#9aa3ad', { metalness: 0.6, roughness: 0.35 });
      add(new THREE.SphereGeometry(1.04, 28, 14, 0, Math.PI * 2, 0, Math.PI / 2.9), metal, 0, 0.02, 0);
      add(new THREE.TorusGeometry(0.87, 0.06, 8, 28), mat('#6b4a2b'), 0, 0.52, 0, Math.PI / 2);
      const horn = mat('#f3ead7', { roughness: 0.6 });
      for (const s of [-1, 1]) add(new THREE.ConeGeometry(0.14, 0.62, 14), horn, s * 0.78, 0.98, 0, 0, 0, -s * 0.75);
      break;
    }
    case 'krone': {
      const gold = mat('#ffc83d', { metalness: 0.7, roughness: 0.25, emissive: new THREE.Color('#5a3a00') });
      add(new THREE.CylinderGeometry(0.46, 0.42, 0.28, 16, 1, true), gold, 0, 1.0, 0).material.side = THREE.DoubleSide;
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2;
        add(new THREE.ConeGeometry(0.09, 0.26, 8), gold, Math.sin(a) * 0.44, 1.25, Math.cos(a) * 0.44);
        add(new THREE.SphereGeometry(0.055, 8, 6), mat(i % 2 ? '#ff3b6b' : '#3de1ff', { emissive: new THREE.Color('#330011') }), Math.sin(a) * 0.45, 1.0, Math.cos(a) * 0.45);
      }
      break;
    }
    case 'heiligenschein': {
      add(
        new THREE.TorusGeometry(0.45, 0.07, 10, 32),
        new THREE.MeshStandardMaterial({ color: '#fff2a8', emissive: new THREE.Color('#ffd84d'), emissiveIntensity: 1.2 }),
        0,
        0,
        0,
        Math.PI / 2,
      );
      g.position.y = 1.45;
      g.userData.bob = 1.45;
      break;
    }
    default:
      return null;
  }
  return g;
}

function buildExtra(id) {
  const g = new THREE.Group();
  const add = (geo, material, x, y, z, rx = 0, ry = 0, rz = 0) => {
    const m = new THREE.Mesh(geo, material);
    m.position.set(x, y, z);
    m.rotation.set(rx, ry, rz);
    g.add(m);
    return m;
  };
  switch (id) {
    case 'sonnenbrille': {
      const lens = mat('#0d0d12', { roughness: 0.1, metalness: 0.5 });
      for (const s of [-1, 1]) add(new THREE.BoxGeometry(0.38, 0.22, 0.06), lens, s * 0.32, 0.34, 1.1);
      add(new THREE.BoxGeometry(0.3, 0.05, 0.05), lens, 0, 0.4, 1.12);
      break;
    }
    case 'schnurrbart': {
      const hair = mat('#3b2412', { roughness: 0.9 });
      for (const s of [-1, 1]) {
        const m = add(new THREE.SphereGeometry(0.2, 12, 8), hair, s * 0.17, 0.05, 1.0, 0, 0, s * 0.35);
        m.scale.set(1.2, 0.35, 0.45);
      }
      break;
    }
    case 'herzbrille': {
      const red = mat('#ff3b6b', { emissive: new THREE.Color('#5a0018') });
      for (const s of [-1, 1]) {
        // Herz aus zwei Kugeln und einem Kegel
        const h = new THREE.Group();
        const k1 = new THREE.Mesh(new THREE.SphereGeometry(0.1, 12, 8), red);
        k1.position.set(-0.075, 0.04, 0);
        const k2 = k1.clone();
        k2.position.x = 0.075;
        const tip = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.2, 12), red);
        tip.rotation.z = Math.PI;
        tip.position.y = -0.08;
        h.add(k1, k2, tip);
        h.scale.set(1.3, 1.3, 0.5);
        h.position.set(s * 0.32, 0.34, 1.1);
        g.add(h);
      }
      break;
    }
    default:
      return null;
  }
  return g;
}

// Kleine drehende Vorschau der eigenen Figur (Menü „Deine Figur“)
export class Preview {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.renderer.setClearColor(0x000000, 0);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(32, 1, 0.1, 50);
    this.camera.position.set(0, 1.6, 6.2);
    this.camera.lookAt(0, 0.35, 0);
    this.scene.add(new THREE.HemisphereLight('#ffffff', '#ff7a5a', 1.6));
    const sun = new THREE.DirectionalLight('#ffffff', 2);
    sun.position.set(3, 5, 6);
    this.scene.add(sun);
    this.sumo = null;
    this.running = false;
    this.t = 0;
  }

  setLook(look, team = 0) {
    if (this.sumo) this.scene.remove(this.sumo.group);
    this.sumo = buildSumo(team, look);
    this.scene.add(this.sumo.group);
  }

  start() {
    if (this.running) return;
    this.running = true;
    let last = performance.now();
    const loop = (now) => {
      if (!this.running) return;
      requestAnimationFrame(loop);
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      this.t += dt;
      const w = this.canvas.clientWidth;
      const h = this.canvas.clientHeight;
      if (this.canvas.width !== Math.round(w * devicePixelRatio)) {
        this.renderer.setPixelRatio(Math.min(2, devicePixelRatio));
        this.renderer.setSize(w, h, false);
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
      }
      if (this.sumo) {
        this.sumo.group.rotation.y = Math.sin(this.t * 0.8) * 0.7;
        this.sumo.inner.position.y = Math.abs(Math.sin(this.t * 3)) * 0.12;
        const hat = this.sumo.hat;
        if (hat && hat.userData.bob) hat.position.y = hat.userData.bob + Math.sin(this.t * 3) * 0.06;
      }
      this.renderer.render(this.scene, this.camera);
    };
    requestAnimationFrame(loop);
  }

  stop() {
    this.running = false;
  }
}
