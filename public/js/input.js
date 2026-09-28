// Eingabe: Touch (links wischen = laufen, rechts tippen = rammen), Tastatur und Gamepad.
// Für „Zu zweit an einem Gerät“ wird der Bildschirm geteilt; die obere Hälfte ist um 180° gedreht,
// damit man sich gegenübersitzen kann.

const STICK_R = 56;
const DEAD = 0.12;

const KEYSETS = {
  both: {
    up: ['KeyW', 'ArrowUp'],
    down: ['KeyS', 'ArrowDown'],
    left: ['KeyA', 'ArrowLeft'],
    right: ['KeyD', 'ArrowRight'],
    dash: ['Space', 'ShiftLeft', 'ShiftRight', 'Enter', 'KeyJ', 'KeyK'],
  },
  wasd: { up: ['KeyW'], down: ['KeyS'], left: ['KeyA'], right: ['KeyD'], dash: ['Space', 'KeyF', 'KeyG', 'ShiftLeft'] },
  arrows: {
    up: ['ArrowUp'],
    down: ['ArrowDown'],
    left: ['ArrowLeft'],
    right: ['ArrowRight'],
    dash: ['Enter', 'ShiftRight', 'KeyL', 'Numpad0', 'Minus', 'Period'],
  },
};

export class Controls {
  constructor(root) {
    this.root = root;
    this.slots = [];
    this.keys = new Set();
    this.onDash = null;
    window.addEventListener('keydown', (e) => {
      if (e.target && e.target.tagName === 'INPUT') return;
      // Ramm-Taste: drücken lädt auf, loslassen rammt
      if (!e.repeat) {
        for (const s of this.slots) if (KEYSETS[s.keys].dash.includes(e.code)) s.keyHold.add(e.code);
      }
      this.keys.add(e.code);
      if (this.slots.length && (e.code.startsWith('Arrow') || e.code === 'Space')) e.preventDefault();
    });
    window.addEventListener('keyup', (e) => {
      this.keys.delete(e.code);
      for (const s of this.slots) if (s.keyHold.delete(e.code)) this.dash(s);
    });
    window.addEventListener('blur', () => {
      this.keys.clear();
      for (const s of this.slots) s.keyHold.clear();
    });
    root.addEventListener('pointerdown', (e) => this.down(e));
    root.addEventListener('pointermove', (e) => this.move(e));
    root.addEventListener('pointerup', (e) => this.up(e));
    root.addEventListener('pointercancel', (e) => this.up(e));
    root.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  // slots: [{ keys: 'both'|'wasd'|'arrows', region: 'full'|'bottom'|'top', gamepad: index }]
  configure(slots) {
    this.root.innerHTML = '';
    this.slots = slots.map((cfg, i) => {
      const pad = document.createElement('div');
      pad.className = `pad pad-${cfg.region}`;
      pad.innerHTML = `
        <div class="stick-hint"><div class="stick-base"></div><span>Wischen<br>zum Laufen</span></div>
        <div class="stick"><div class="stick-knob"></div></div>
        <div class="dash-btn"><div class="dash-charge"></div><div class="dash-ring"></div><span>RAMMEN</span><small>halten = stärker</small></div>`;
      this.root.appendChild(pad);
      return {
        ...cfg,
        i,
        pad,
        stick: pad.querySelector('.stick'),
        knob: pad.querySelector('.stick-knob'),
        hint: pad.querySelector('.stick-hint'),
        btn: pad.querySelector('.dash-btn'),
        rotated: cfg.region === 'top',
        pointer: null,
        ox: 0,
        oy: 0,
        vx: 0,
        vy: 0,
        dashes: 0,
        dashPointer: null,
        keyHold: new Set(),
        gpDash: false,
        used: false,
      };
    });
  }

  clear() {
    this.configure([]);
  }

  // Bildschirm- in Pad-Koordinaten (aus Sicht des Spielers)
  local(s, e) {
    const r = s.pad.getBoundingClientRect();
    let x = e.clientX - r.left;
    let y = e.clientY - r.top;
    if (s.rotated) {
      x = r.width - x;
      y = r.height - y;
    }
    return { x, y, w: r.width, h: r.height };
  }

  slotAt(e) {
    for (const s of this.slots) {
      const r = s.pad.getBoundingClientRect();
      if (e.clientX >= r.left && e.clientX <= r.right && e.clientY >= r.top && e.clientY <= r.bottom) return s;
    }
    return null;
  }

  down(e) {
    const s = this.slotAt(e);
    if (!s) return;
    e.preventDefault();
    const l = this.local(s, e);
    if (l.x > l.w * 0.5) {
      // Rechte Hälfte: halten lädt auf, loslassen rammt
      if (s.dashPointer !== null) return;
      s.dashPointer = e.pointerId;
      try {
        this.root.setPointerCapture(e.pointerId);
      } catch {
        /* egal */
      }
      s.btn.classList.add('press');
      return;
    }
    if (s.pointer !== null) return;
    s.pointer = e.pointerId;
    try {
      this.root.setPointerCapture(e.pointerId);
    } catch {
      /* egal */
    }
    s.ox = l.x;
    s.oy = l.y;
    s.vx = s.vy = 0;
    s.used = true;
    s.hint.classList.add('gone');
    s.stick.style.transform = `translate(${l.x}px, ${l.y}px)`;
    s.stick.classList.add('on');
    s.knob.style.transform = 'translate(-50%, -50%)';
  }

  move(e) {
    for (const s of this.slots) {
      if (s.pointer !== e.pointerId) continue;
      e.preventDefault();
      const l = this.local(s, e);
      let dx = l.x - s.ox;
      let dy = l.y - s.oy;
      const d = Math.hypot(dx, dy);
      // Mitwandernder Stick: zieht man weiter, rutscht der Mittelpunkt hinterher
      if (d > STICK_R) {
        s.ox += (dx / d) * (d - STICK_R);
        s.oy += (dy / d) * (d - STICK_R);
        dx = l.x - s.ox;
        dy = l.y - s.oy;
        s.stick.style.transform = `translate(${s.ox}px, ${s.oy}px)`;
      }
      let vx = dx / STICK_R;
      let vy = dy / STICK_R;
      const m = Math.hypot(vx, vy);
      if (m < DEAD) vx = vy = 0;
      else {
        // leichte Kurve: kleine Ausschläge feiner, volle Auslenkung = volle Kraft
        const k = Math.min(1, (m - DEAD) / (1 - DEAD) * 1.25) / m;
        vx *= k;
        vy *= k;
      }
      s.vx = vx;
      s.vy = vy;
      s.knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
    }
  }

  up(e) {
    for (const s of this.slots) {
      if (s.dashPointer === e.pointerId) {
        s.dashPointer = null;
        s.btn.classList.remove('press');
        this.dash(s);
      }
      if (s.pointer !== e.pointerId) continue;
      s.pointer = null;
      s.vx = s.vy = 0;
      s.stick.classList.remove('on');
    }
  }

  dash(s) {
    s.dashes++;
    if (this.onDash) this.onDash(s.i);
  }

  setCooldown(i, frac, heavy, charge = 0) {
    const s = this.slots[i];
    if (!s) return;
    const f = Math.max(0, Math.min(1, frac));
    s.btn.style.setProperty('--cd', f.toFixed(3));
    s.btn.style.setProperty('--ch', charge.toFixed(3));
    s.btn.classList.toggle('ready', f <= 0);
    s.btn.classList.toggle('heavy', !!heavy);
    s.btn.classList.toggle('charging', charge > 0);
    s.btn.classList.toggle('full', charge >= 0.99);
  }

  // Richtung im Bildschirm-Raum (x rechts, y unten, Länge ≤ 1) und Anzahl Ramm-Tipper seit Start
  read(i) {
    const s = this.slots[i];
    if (!s) return { x: 0, y: 0, dash: 0, hold: false };
    let x = 0;
    let y = 0;
    if (s.pointer !== null) {
      // Touch-Stick ist aus Sicht des Spielers; gedrehte Hälfte zurückdrehen
      x = s.rotated ? -s.vx : s.vx;
      y = s.rotated ? -s.vy : s.vy;
    } else {
      const k = KEYSETS[s.keys];
      const on = (list) => list.some((c) => this.keys.has(c));
      x = (on(k.right) ? 1 : 0) - (on(k.left) ? 1 : 0);
      y = (on(k.down) ? 1 : 0) - (on(k.up) ? 1 : 0);
      const pads = navigator.getGamepads ? navigator.getGamepads() : [];
      const gp = s.gamepad != null ? pads[s.gamepad] : null;
      if (gp) {
        const gx = gp.axes[0] || 0;
        const gy = gp.axes[1] || 0;
        if (Math.hypot(gx, gy) > 0.2) {
          x = gx;
          y = gy;
        }
        const pressed = [0, 1, 2, 3, 5, 7].some((b) => gp.buttons[b] && gp.buttons[b].pressed);
        if (!pressed && s.gpDash) this.dash(s);
        s.gpDash = pressed;
      }
      const l = Math.hypot(x, y);
      if (l > 1) {
        x /= l;
        y /= l;
      }
    }
    return { x, y, dash: s.dashes, hold: s.dashPointer !== null || s.keyHold.size > 0 || s.gpDash };
  }
}
