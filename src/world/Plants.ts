import * as THREE from 'three/webgpu';
import { Baker, jitter } from './Baker';

/** Procedural low-poly plant/prop prototypes (baked, vertex-coloured). */
type Rnd = () => number;
const ico = (d = 1) => new THREE.IcosahedronGeometry(1, d);
const cyl = (rt: number, rb: number, h: number, s = 7) => new THREE.CylinderGeometry(rt, rb, h, s);
const cone = (r: number, h: number, s = 7) => new THREE.ConeGeometry(r, h, s);
const pick = <T,>(rnd: Rnd, a: T[]) => a[Math.floor(rnd() * a.length)];
const canopy = (y0: number) => (y: number) => Math.max(0, Math.min(1, (y - y0) / 2));

export function roundTree(rnd: Rnd, palette: string[], trunk = '#9a6b4a'): THREE.BufferGeometry {
  const b = new Baker();
  const h = 1.6 + rnd() * 1.0;
  b.add(cyl(0.16, 0.26, h), trunk, [0, h / 2, 0]);
  const n = 3 + Math.floor(rnd() * 3);
  for (let i = 0; i < n; i++) {
    const s = 0.75 + rnd() * 0.55, a = rnd() * 6.28, r = i === 0 ? 0 : 0.55 + rnd() * 0.3;
    b.add(jitter(ico(1), rnd, 0.08), pick(rnd, palette), [Math.cos(a) * r, h + 0.35 + rnd() * 0.6 + (i === 0 ? 0.3 : 0), Math.sin(a) * r],
      [rnd() * 3, rnd() * 3, rnd() * 3], [s, s * (0.85 + rnd() * 0.2), s], canopy(h - 0.5));
  }
  return b.build();
}

export function birch(rnd: Rnd): THREE.BufferGeometry {
  const b = new Baker();
  const h = 2.6 + rnd() * 1.2;
  b.add(cyl(0.1, 0.15, h, 6), '#f1ede4', [0, h / 2, 0]);
  for (let i = 0; i < 4; i++) b.add(cyl(0.106, 0.11, 0.08, 6), '#3d3a36', [0, 0.4 + i * h * 0.22 + rnd() * 0.2, 0], [0, rnd() * 3, 0]);
  const pal = ['#b7d96a', '#9ccf5a', '#cfe27a', '#e6d65a'];
  for (let i = 0; i < 4; i++) {
    const s = 0.5 + rnd() * 0.35;
    b.add(jitter(ico(1), rnd, 0.1), pick(rnd, pal), [(rnd() - 0.5) * 0.7, h - 0.3 + i * 0.45, (rnd() - 0.5) * 0.7], [rnd(), rnd(), rnd()], [s, s * 1.3, s], canopy(h - 1));
  }
  return b.build();
}

export function maple(rnd: Rnd): THREE.BufferGeometry {
  const pal = pick(rnd, [['#e8562e', '#f07a2a', '#d9432a'], ['#f2a12e', '#f5c242', '#e88a2a'], ['#c73a2e', '#e05a3a', '#b8322a'], ['#f07a2a', '#f2b23e', '#d9542e']]);
  return roundTree(rnd, pal, '#6e4a36');
}

export function pine(rnd: Rnd, snowy = false): THREE.BufferGeometry {
  const b = new Baker();
  b.add(cyl(0.12, 0.2, 1.0, 6), '#8a5c3e', [0, 0.5, 0]);
  const tiers = 3 + Math.floor(rnd() * 2);
  const col = pick(rnd, snowy ? ['#2f7a55', '#3a8a5e', '#2b6e50'] : ['#3f9a5a', '#4aa864', '#378a52']);
  for (let i = 0; i < tiers; i++) {
    const r = 1.3 - i * 0.28, y = 1.2 + i * 0.75, ry = rnd() * 3;
    b.add(cone(r, 1.3, 7), col, [0, y, 0], [0, ry, 0], 1, Math.min(1, i * 0.35 + 0.2));
    if (snowy) b.add(cone(r * 0.72, 0.6, 7), '#f7fbff', [0, y + 0.4, 0], [0, ry, 0], 1, Math.min(1, i * 0.35 + 0.2));
  }
  return b.build();
}

export function palm(rnd: Rnd): THREE.BufferGeometry {
  const b = new Baker();
  const segs = 7, lean = 0.25 + rnd() * 0.35, dir = rnd() * 6.28;
  let x = 0, y = 0, z = 0;
  for (let i = 0; i < segs; i++) {
    const t = i / segs;
    const dx = Math.cos(dir) * lean * t * 0.9, dz = Math.sin(dir) * lean * t * 0.9;
    b.add(cyl(0.13 - t * 0.04, 0.17 - t * 0.04, 0.62, 7), i % 2 ? '#b58a5c' : '#9c7348', [x, y + 0.31, z], [dz * 0.6, 0, -dx * 0.6], 1, t * 0.4);
    x += dx * 0.62; z += dz * 0.62; y += 0.6;
  }
  const top: [number, number, number] = [x, y, z];
  const fr = 7 + Math.floor(rnd() * 3);
  const greens = ['#4fbf4a', '#62cc52', '#3fae46'];
  for (let i = 0; i < fr; i++) {
    const a = (i / fr) * 6.28 + rnd() * 0.3;
    for (let k = 0; k < 3; k++) {
      const d = 0.45 + k * 0.62, droop = -0.15 - k * k * 0.16;
      b.add(ico(0), pick(rnd, greens), [top[0] + Math.cos(a) * d, top[1] + droop + 0.1, top[2] + Math.sin(a) * d],
        [0, -a, -0.35 - k * 0.3], [0.42, 0.05, 0.22 - k * 0.03], 1);
    }
  }
  for (let i = 0; i < 3; i++) b.add(ico(0), '#6b4a2a', [top[0] + Math.cos(i * 2.1) * 0.2, top[1] - 0.15, top[2] + Math.sin(i * 2.1) * 0.2], [0, 0, 0], 0.13, 0.8);
  return b.build();
}

export function willow(rnd: Rnd): THREE.BufferGeometry {
  const b = new Baker();
  const h = 2.2 + rnd() * 0.6;
  b.add(cyl(0.18, 0.3, h, 7), '#6f5a44', [0, h / 2, 0]);
  b.add(jitter(ico(1), rnd, 0.1), '#7fa85a', [0, h + 0.5, 0], [0, 0, 0], [1.6, 0.8, 1.6], 0.6);
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * 6.28;
    b.add(cyl(0.22, 0.12, 1.8, 5), pick(rnd, ['#8fb862', '#76a352', '#9cc070']), [Math.cos(a) * 1.25, h - 0.3, Math.sin(a) * 1.25], [0, a, 0], [1, 1, 0.6], (y) => Math.max(0, Math.min(1, (h + 0.6 - y) / 2)));
  }
  return b.build();
}

export function deadTree(rnd: Rnd): THREE.BufferGeometry {
  const b = new Baker();
  const c = '#8a6a4e';
  b.add(cyl(0.08, 0.16, 2, 5), c, [0, 1, 0]);
  for (let i = 0; i < 3; i++) {
    const a = rnd() * 6.28, y = 1 + rnd() * 0.8;
    b.add(cyl(0.03, 0.06, 0.9, 4), c, [Math.cos(a) * 0.3, y + 0.3, Math.sin(a) * 0.3], [Math.sin(a) * 0.8, 0, -Math.cos(a) * 0.8]);
  }
  return b.build();
}

export function saguaro(rnd: Rnd): THREE.BufferGeometry {
  const b = new Baker();
  const g = pick(rnd, ['#5f9a4a', '#6aa652', '#548c44']);
  const h = 2.2 + rnd() * 1.2;
  b.add(new THREE.CapsuleGeometry(0.28, h, 4, 8), g, [0, h / 2 + 0.2, 0]);
  const arms = 1 + Math.floor(rnd() * 2);
  for (let i = 0; i < arms; i++) {
    const s = i === 0 ? 1 : -1, y = h * (0.4 + rnd() * 0.25);
    b.add(new THREE.CapsuleGeometry(0.18, 0.5, 3, 7), g, [s * 0.45, y, 0], [0, 0, Math.PI / 2]);
    b.add(new THREE.CapsuleGeometry(0.18, 0.7 + rnd() * 0.4, 3, 7), g, [s * 0.72, y + 0.45, 0]);
  }
  if (rnd() < 0.5) b.add(ico(0), '#ff7aa8', [0, h + 0.55, 0], [0, 0, 0], 0.12);
  return b.build();
}

export function barrelCactus(rnd: Rnd): THREE.BufferGeometry {
  const b = new Baker();
  b.add(new THREE.SphereGeometry(0.35, 10, 7), '#6aa652', [0, 0.3, 0], [0, 0, 0], [1, 1.1, 1]);
  b.add(ico(0), pick(rnd, ['#ffd84d', '#ff7aa8', '#ff9a5c']), [0, 0.68, 0], [0, 0, 0], 0.12);
  return b.build();
}

export function pricklyPear(rnd: Rnd): THREE.BufferGeometry {
  const b = new Baker();
  const pads = 4 + Math.floor(rnd() * 3);
  for (let i = 0; i < pads; i++) {
    const a = rnd() * 6.28, y = 0.3 + Math.floor(i / 2) * 0.42;
    b.add(new THREE.SphereGeometry(0.28, 8, 6), '#7fae5a', [Math.cos(a) * 0.2 * (i % 3), y, Math.sin(a) * 0.2 * (i % 3)], [0, a, (rnd() - 0.5) * 0.6], [1, 1.25, 0.32]);
    if (rnd() < 0.4) b.add(ico(0), '#e0405a', [Math.cos(a) * 0.2 * (i % 3), y + 0.36, Math.sin(a) * 0.2 * (i % 3)], [0, 0, 0], 0.06);
  }
  return b.build();
}

export function bush(rnd: Rnd, pal: string[], berries?: string): THREE.BufferGeometry {
  const b = new Baker();
  const n = 2 + Math.floor(rnd() * 3);
  for (let i = 0; i < n; i++) {
    const s = 0.35 + rnd() * 0.3, x = (rnd() - 0.5) * 0.8, z = (rnd() - 0.5) * 0.8;
    b.add(jitter(ico(1), rnd, 0.1), pick(rnd, pal), [x, s * 0.7, z], [rnd(), rnd(), rnd()], s, 0.4);
    if (berries) for (let k = 0; k < 3; k++) {
      const a = rnd() * 6.28;
      b.add(ico(0), berries, [x + Math.cos(a) * s * 0.8, s * (0.7 + rnd() * 0.5), z + Math.sin(a) * s * 0.8], [0, 0, 0], 0.07, 0.4);
    }
  }
  return b.build();
}

export function fern(rnd: Rnd): THREE.BufferGeometry {
  const b = new Baker();
  const n = 6 + Math.floor(rnd() * 3);
  const col = pick(rnd, ['#4f9a43', '#5fae4a', '#3f8a40']);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * 6.28 + rnd() * 0.3;
    b.add(ico(0), col, [Math.cos(a) * 0.32, 0.22, Math.sin(a) * 0.32], [0, -a, 0.5 + rnd() * 0.3], [0.4, 0.03, 0.09], (y) => Math.min(1, y * 2));
  }
  return b.build();
}

export function mushrooms(rnd: Rnd, red: boolean): THREE.BufferGeometry {
  const b = new Baker();
  const n = 1 + Math.floor(rnd() * 3);
  for (let i = 0; i < n; i++) {
    const s = 0.6 + rnd() * 0.6, x = (rnd() - 0.5) * 0.4, z = (rnd() - 0.5) * 0.4;
    b.add(cyl(0.04, 0.05, 0.22, 6), '#f4ead8', [x, 0.11 * s, z], [0, 0, 0], s);
    b.add(new THREE.SphereGeometry(0.13, 8, 5, 0, 6.29, 0, 1.6), red ? '#e0402e' : '#b07a4e', [x, 0.2 * s, z], [0, 0, 0], [s, s * 0.8, s]);
    if (red) for (let k = 0; k < 3; k++) {
      const a = rnd() * 6.28;
      b.add(ico(0), '#ffffff', [x + Math.cos(a) * 0.07 * s, 0.29 * s, z + Math.sin(a) * 0.07 * s], [0, 0, 0], 0.025 * s);
    }
  }
  return b.build();
}

export function reeds(rnd: Rnd): THREE.BufferGeometry {
  const b = new Baker();
  const n = 5 + Math.floor(rnd() * 5);
  for (let i = 0; i < n; i++) {
    const h = 0.9 + rnd() * 0.8, x = (rnd() - 0.5) * 0.6, z = (rnd() - 0.5) * 0.6, lx = (rnd() - 0.5) * 0.2;
    b.add(cyl(0.012, 0.022, h, 4), pick(rnd, ['#6f9a4a', '#7fa852', '#8aa85a']), [x, h / 2, z], [lx, 0, 0], 1, (y) => Math.min(1, y / 1.5));
    if (rnd() < 0.55) b.add(new THREE.CapsuleGeometry(0.035, 0.16, 2, 5), '#6b4a2e', [x, h - 0.02, z + lx * h * 0.5], [lx, 0, 0], 1, 1);
  }
  return b.build();
}

export function lilyPad(rnd: Rnd): THREE.BufferGeometry {
  const b = new Baker();
  b.add(new THREE.CylinderGeometry(0.42, 0.42, 0.03, 10, 1, false, 0.3, 5.8), pick(rnd, ['#5aa84a', '#6ab852', '#4f9a43']), [0, 0, 0]);
  if (rnd() < 0.45) {
    const pc = pick(rnd, ['#ffb3d0', '#ffffff', '#ffd0e0']);
    for (let i = 0; i < 6; i++) { const a = i * 1.047; b.add(cone(0.06, 0.16, 4), pc, [Math.cos(a) * 0.06, 0.08, Math.sin(a) * 0.06], [Math.sin(a) * 0.5, 0, -Math.cos(a) * 0.5]); }
    b.add(ico(0), '#ffd84d', [0, 0.1, 0], [0, 0, 0], 0.04);
  }
  return b.build();
}

export function tallFlower(rnd: Rnd, kind: 'lupine' | 'sunflower' | 'foxglove'): THREE.BufferGeometry {
  const b = new Baker();
  const n = kind === 'sunflower' ? 1 + Math.floor(rnd() * 2) : 2 + Math.floor(rnd() * 3);
  for (let i = 0; i < n; i++) {
    const h = (kind === 'sunflower' ? 1.2 : 0.7) + rnd() * 0.4, x = (rnd() - 0.5) * 0.5, z = (rnd() - 0.5) * 0.5;
    const sway = (y: number) => Math.min(1, y / h);
    b.add(cyl(0.02, 0.03, h, 4), '#4f9a43', [x, h / 2, z], [0, 0, 0], 1, sway);
    if (kind === 'sunflower') {
      b.add(cyl(0.2, 0.2, 0.04, 10), '#ffcc2e', [x, h, z + 0.03], [1.2, 0, 0], 1, 1);
      b.add(cyl(0.1, 0.1, 0.06, 8), '#6b4a2a', [x, h, z + 0.05], [1.2, 0, 0], 1, 1);
    } else {
      const col = kind === 'lupine' ? pick(rnd, ['#8a6bff', '#b98cff', '#ff8ac8', '#6b8cff']) : pick(rnd, ['#ff8ac8', '#ffb3d0', '#e06bd0']);
      for (let k = 0; k < 5; k++) b.add(cone(0.07 - k * 0.008, 0.14, 5), col, [x, h - 0.3 + k * 0.1, z], [Math.PI, 0, 0], 1, 1);
    }
  }
  return b.build();
}

export function rock(rnd: Rnd, col: string, snowy = false): THREE.BufferGeometry {
  const b = new Baker();
  b.add(jitter(new THREE.DodecahedronGeometry(1, 0), rnd, 0.22), col, [0, 0.3, 0], [rnd(), rnd(), rnd()], [1, 0.7, 1]);
  if (snowy) b.add(jitter(new THREE.DodecahedronGeometry(0.75, 0), rnd, 0.15), '#f5f8fc', [0, 0.72, 0], [rnd(), rnd(), rnd()], [1, 0.32, 1]);
  return b.build();
}

export function pumpkin(rnd: Rnd): THREE.BufferGeometry {
  const b = new Baker();
  const s = 0.7 + rnd() * 0.5;
  for (let i = 0; i < 6; i++) { const a = i * 1.047; b.add(new THREE.SphereGeometry(0.16, 8, 6), '#f08a2a', [Math.cos(a) * 0.1 * s, 0.17 * s, Math.sin(a) * 0.1 * s], [0, -a, 0], [s * 0.8, s, s * 1.2]); }
  b.add(cyl(0.025, 0.03, 0.12, 5), '#5a7a2e', [0, 0.36 * s, 0]);
  return b.build();
}

export function shell(rnd: Rnd): THREE.BufferGeometry {
  const b = new Baker();
  if (rnd() < 0.5) {
    for (let i = 0; i < 5; i++) { const a = i * 1.2566; b.add(cone(0.05, 0.22, 4), '#ff8a6b', [Math.cos(a) * 0.1, 0.02, Math.sin(a) * 0.1], [0, -a, Math.PI / 2], [1, 1, 0.5]); }
  } else b.add(new THREE.SphereGeometry(0.12, 8, 4, 0, 6.29, 0, 1.4), pick(rnd, ['#ffe6d0', '#ffd0c0', '#f4f0e8']), [0, 0, 0], [0, rnd() * 3, 0], [1, 0.6, 1.3]);
  return b.build();
}

export function tropicalPlant(rnd: Rnd): THREE.BufferGeometry {
  const b = new Baker();
  const n = 5 + Math.floor(rnd() * 3);
  for (let i = 0; i < n; i++) {
    const a = (i / n) * 6.28 + rnd() * 0.4;
    b.add(new THREE.SphereGeometry(0.3, 8, 5), pick(rnd, ['#2fa84a', '#3fbf5a', '#25964a']), [Math.cos(a) * 0.38, 0.35 + rnd() * 0.2, Math.sin(a) * 0.38], [0, -a, 0.6], [1.2, 0.1, 0.65], (y) => Math.min(1, y * 2));
  }
  if (rnd() < 0.6) for (let k = 0; k < 3; k++) b.add(ico(0), pick(rnd, ['#ff4a6b', '#ff7aa8', '#ffb02e']), [(rnd() - 0.5) * 0.6, 0.6 + rnd() * 0.2, (rnd() - 0.5) * 0.6], [0, 0, 0], 0.09, 0.8);
  return b.build();
}

export function dryTuft(rnd: Rnd): THREE.BufferGeometry {
  const b = new Baker();
  const col = pick(rnd, ['#c9a46a', '#b8945a', '#d9b87a']);
  for (let i = 0; i < 7; i++) { const a = rnd() * 6.28; b.add(cone(0.03, 0.4 + rnd() * 0.2, 3), col, [Math.cos(a) * 0.08, 0.2, Math.sin(a) * 0.08], [Math.sin(a) * 0.5, 0, -Math.cos(a) * 0.5], 1, (y) => Math.min(1, y * 2.5)); }
  return b.build();
}
