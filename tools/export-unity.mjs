// export-unity.mjs — the prototype as data for a Unity project (skill unity-port): constants,
// location objects, UI layout, terrain heights, assets and a porting report. The Unity side is the
// ArcRuntime package: its importer builds a scene from this folder, its C# API mirrors the kit's JS
// API (UI.Get, Location.FindByTag, Sound3D.Play, Model3D.Clips…), so game code ports line by line.
//
//   node tools/export-unity.mjs <UnityProject>   # writes <UnityProject>/Assets/ArcExport/
//   node tools/export-unity.mjs --report         # only the report, into dist/MIGRATION.md — any time
//
// What lands there:
//   arc-export.json — constants (Constants.js), objects (Objects.js), UI (UILayout.js), terrain grid
//                     sizes, asset list and golden numbers the importer checks itself against
//   terrain.bytes   — float32 LE heights at the grid nodes: the location grid, then the outer ring
//   assets/…        — every referenced asset under its kit path: C# keeps the 'assets/…' literals
//   MIGRATION.md    — what the game code calls and its C# twin, what has no twin, the scene contract
//                     (tags and UI ids the code asks for) and what the prototype changed in the kit
// and the ArcRuntime package itself (unity/com.arcengine.runtime) into <UnityProject>/Packages/ —
// see syncPackage. A file is rewritten only when its bytes differ, and the .meta Unity keeps next
// to an asset is never touched: a new GUID would break every reference to the model in the scene.
//
// COORDINATES — the only conversion, mirrored by ArcSpace in C#: map px (x right, y down the map,
// height up; 1 px = 1 cm, right-handed scene) -> Unity meters, left-handed, Y up:
//   X = x / 100,  Y = height / 100,  Z = −y / 100;  euler [x, y, z]° -> [−x, y, z]°.
// Golden points in arc-export.json (positions, heights, model bounds) are computed here, in JS, and
// the importer recomputes them in C#: the two sides cannot drift apart unnoticed.
import { execFileSync } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';
import vm from 'node:vm';
import { collectRefs } from './asset-scan.mjs';

const ROOT = path.resolve(path.dirname(url.fileURLToPath(import.meta.url)), '..');
export const FORMAT = 1;          // arc-export.json format: the importer refuses another one
export const PX_PER_M = 100;

// The kit's own modules: everything else in js/ is the game. A changed kit module is reported —
// its C# twin in ArcRuntime does not know about the change.
export const KIT_FILES = ['js/Constants.js', 'js/Objects.js', 'js/UILayout.js', 'js/Sound3D.js', 'js/World3D.js',
  'js/Terrain3D.js', 'js/CameraControl.js', 'js/Model3D.js', 'js/Gltf3D.js', 'js/Instances3D.js', 'js/Location3D.js',
  'js/Debug3D.js', 'js/UI.js', 'js/main.js'];

// Kit JS -> its C# twin in ArcRuntime (namespace Arc). Methods and objects are PascalCase; data
// records (rec.Def, UI records) keep the file's field names: def.x stays Def.x.
// [pattern, C#, note]; note 'manual' — no twin, port by hand with the Unity API.
export const API = [
  [/\bUI\.get\(/, 'UI.Get("id")', 'null, если id нет — проверка как в JS'],
  [/\.setText\(/, 'el.SetText(text)'],
  [/\.setValue\(/, 'el.SetValue(v)'],
  [/\.show\(/, 'el.Show(on)'],
  [/\.onClick\(/, 'el.OnClick(() => …)'],
  [/\bUI\.def\(/, 'UI.Def("id")'],
  [/\bUI\.add\(/, 'UI.Add(record)'],
  [/\bUI\.remove\(/, 'UI.Remove("id")'],
  [/\bUI\.size\(/, 'UI.Size()'],
  [/\.findByTag\(/, 'app.Location.FindByTag("tag")', 'List<LocationObject>, пустой — как []'],
  [/\.setHidden\(/, 'app.Location.SetHidden(rec, hidden)'],
  [/\.placeObject\(/, 'app.Location.PlaceObject(rec)'],
  [/\.removeObject\(/, 'app.Location.RemoveObject(rec)'],
  [/\blocation\.addObject\(/, 'app.Location.AddObject(def)'],
  [/\blocation\.objects\b/, 'app.Location.Objects'],
  [/\.heightAt\(/, 'app.Location.Terrain.HeightAt(x, y)'],
  [/\.tiltAt\(/, 'app.Location.Terrain.TiltAt(x, y, heading, halfLen, halfWid)'],
  [/\bModel3D\.clips\(/, 'Model3D.Clips(rec.Mesh)', 'null, пока модели нет — как в JS'],
  [/(?<!Sound3D)\.play\(/, 'clips.Play("run", new ClipOptions { … })'],
  [/\bclips\.stop\(|\.names\(\)|\.has\(/, 'clips.Stop() / Names() / Has(name)'],
  [/\bSound3D\.play\(/, 'Sound3D.Play("assets/…", new SoundOptions { … })', 'путь — тот же литерал'],
  [/\bSound3D\.music\(/, 'Sound3D.Music("assets/…")'],
  [/\bSound3D\.stopAll\(/, 'Sound3D.StopAll()'],
  [/\bSound3D\.setMuted\(/, 'Sound3D.SetMuted(on)'],
  [/\.setVolume\(/, 'handle.SetVolume(v)'],
  [/\bcamera\.follow\(|\.follow\(/, 'app.Camera.Follow(obj)', 'obj — с полями x, y (IMapPoint)'],
  [/\bcamera\.(home|lookAt|shake)\(/, 'app.Camera.Home() / LookAt(x, y) / Shake(ms, amp)'],
  [/\bWorld3D\.engine\.getFps\(\)/, 'World3D.GetFps()'],
  [/\bStore\.(get|set|remove|getJSON)\(/, 'Store.Get / Set / Remove / GetJSON', 'PlayerPrefs'],
  [/\bIS_MOBILE\b/, 'Arc.IsMobile'],
  [/typeof\s+[A-Z][A-Z0-9_]+\s*!==/, 'Arc.Const("NAME", fallback)', 'константа с дефолтом — как typeof в JS'],
  [/\bMath\.random\(/, 'UnityEngine.Random.value'],
  [/\bperformance\.now\(/, 'Time.realtimeSinceStartupAsDouble * 1000'],
  [/\bBABYLON\./, '—', 'manual'],
  [/\bWorld3D\.(?!engine\.getFps)\w+/, '—', 'manual'],
  [/\.view\b|\bView3D\b|projectToScreen|pointerToGround/, '—', 'manual'],
  [/\b(addInstances|Instances3D)\b/, '—', 'manual'],
  [/\bModel3D\.(load|build)\(/, '—', 'manual'],
  [/\bDebug3D\./, '—', 'manual'],
  [/\bdocument\.|\bwindow\.(?!app\b)|addEventListener\(/, '—', 'manual'],
  [/\b(setTimeout|setInterval|requestAnimationFrame)\(/, '—', 'manual'],
  [/\bfetch\(/, '—', 'manual'],
];

// What never has a twin and is not in the game code: the look and the tools of the kit.
const NOT_PORTED = [
  'Toon-шейдер (ArcToonPlugin), контур рёбер и обводка силуэта — заменить: URP Shader Graph / Renderer Feature. Числа WORLD3D_TOON_* лежат в ArcConstants.',
  'Цвет тени WORLD3D_SHADOW_COLOR — в URP тень серая; нужен свой шейдер.',
  'Instances3D (thin instances) — заменить на GPU instancing (Graphics.RenderMeshInstanced) или обычные префабы.',
  'Debug3D и редактор — не переносятся: в Unity свой инспектор и Frame Debugger.',
  'Земля за краем локации — кольцо из шума с клеткой 64 px; высоту за краем Terrain3D.HeightAt в C# берёт из кольца (в JS — шум напрямую), расхождение — доли px.',
];

// --- The kit in node:vm: the same scripts the page runs ------------------------------------------

function runScripts(root, files, globals = {}) {
  const ctx = vm.createContext({ console, navigator: { userAgent: 'Mozilla/5.0 (Windows NT 10.0)', platform: 'Win32', maxTouchPoints: 0 },
    innerWidth: 1920, innerHeight: 1080, ...globals });
  ctx.window = ctx;
  for (const f of files) vm.runInContext(fs.readFileSync(path.join(root, f), 'utf8'), ctx, { filename: f });
  return (name) => vm.runInContext(name, ctx);
}

// Any field, call or new returns the stub itself: Terrain3D builds meshes we do not need.
function stub() {
  const proxy = new Proxy(function () {}, {
    get: (t, key) => (key === 'then' || typeof key === 'symbol' ? undefined : proxy),
    set: () => true, apply: () => proxy, construct: () => proxy,
  });
  return proxy;
}

// Constants.js: every `const NAME = <literal>` (numbers and strings), in file order.
export function readConstants(root, get) {
  const src = fs.readFileSync(path.join(root, 'js/Constants.js'), 'utf8');
  const numbers = [], strings = [];
  for (const [, name] of src.matchAll(/^const ([A-Z][A-Z0-9_]*)\s*=/gm)) {
    const v = get(name);
    if (typeof v === 'number') numbers.push({ name, value: v });
    else if (typeof v === 'string') strings.push({ name, value: v });
  }
  return { numbers, strings };
}

// --- Coordinates: the one conversion -----------------------------------------------------------

export const toUnity = (x, y, h) => [x / PX_PER_M, h / PX_PER_M, -y / PX_PER_M];
export const eulerToUnity = (rot) => [-rot[0], rot[1], rot[2]];

// --- Records with every field: JsonUtility in Unity gives 0 for a missing one -------------------

const num = (v, d = 0) => (Number.isFinite(Number(v)) && v !== '' && v != null ? Number(v) : d);
const vec3 = (v, d) => (Array.isArray(v) ? [0, 1, 2].map(i => num(v[i], d)) : [d, d, d]);

// placeObject reads rot/scale the same way: an old record keeps a number (heading, uniform scale).
export function normalizeObject(d) {
  const rot = Array.isArray(d.rot) ? vec3(d.rot, 0) : [0, num(d.rot), 0];
  const scale = (Array.isArray(d.scale) ? vec3(d.scale, 1) : [num(d.scale, 1), num(d.scale, 1), num(d.scale, 1)])
    .map(v => (v > 0 ? v : 1));
  const a = d.anim || {}, s = d.sound || {};
  return {
    name: String(d.name || 'object'), model: String(d.model || ''), kind: d.kind === 'actor' ? 'actor' : 'prop',
    x: num(d.x), y: num(d.y), h: num(d.h), rot, scale,
    tag: String(d.tag || ''), hidden: !!d.hidden, clip: String(d.clip || ''),
    anim: { part: String(a.part || ''), axis: String(a.axis || 'y'), speed: num(a.speed), dir: a.dir === 'ccw' ? 'ccw' : 'cw', pivot: [], axisVec: [] },
    sound: { src: String(s.src || ''), volume: s.volume == null ? 1 : num(s.volume, 1), loop: s.loop !== false,
      falloffMin: Math.max(0, num(s.falloffMin)), falloffMax: Math.max(0, num(s.falloffMax)) },
  };
}

// The kind's defaults under the record — the same merge the editor starts a new element from.
export function normalizeUI(rec, DEFAULTS) {
  const base = DEFAULTS[rec.kind] || DEFAULTS.panel;
  const all = { id: '', kind: 'panel', parent: '', anchor: 'top-left', x: 0, y: 0, w: 0, h: 0, stretch: '', text: '',
    fontSize: 20, color: '', shadow: '', fill: '', border: '', radius: 0, value: 0, alpha: 1, visible: 1 };
  const r = { ...all, ...base, ...rec };
  for (const k of ['x', 'y', 'w', 'h', 'fontSize', 'radius', 'value', 'alpha', 'visible']) r[k] = num(r[k], all[k]);
  for (const k of ['id', 'kind', 'parent', 'anchor', 'stretch', 'text', 'color', 'shadow', 'fill', 'border']) r[k] = String(r[k] == null ? '' : r[k]);
  return r;
}

// --- Terrain: the location grid of Terrain3D and its outer ring --------------------------------

export function exportTerrain(T) {
  const ring = { cell: T.constructor.RING_CELL, extent: T.outerRing };
  ring.x0 = -ring.extent; ring.y0 = -ring.extent;
  ring.nx = Math.ceil((T.worldW + 2 * ring.extent) / ring.cell) + 1;
  ring.ny = Math.ceil((T.worldH + 2 * ring.extent) / ring.cell) + 1;
  const heights = new Float32Array(T.nx * T.ny + ring.nx * ring.ny);
  heights.set(T.hgrid, 0);
  let k = T.nx * T.ny;
  for (let j = 0; j < ring.ny; j++) {
    for (let i = 0; i < ring.nx; i++) heights[k++] = T.terrainNoise(ring.x0 + i * ring.cell, ring.y0 + j * ring.cell) - 1;
  }
  return {
    meta: { file: 'terrain.bytes', width: T.worldW, height: T.worldH,
      grid: { x0: 0, y0: 0, cell: T.cell, nx: T.nx, ny: T.ny },
      ring: { x0: ring.x0, y0: ring.y0, cell: ring.cell, nx: ring.nx, ny: ring.ny, holeX1: (T.nx - 1) * T.cell, holeY1: (T.ny - 1) * T.cell } },
    bytes: Buffer.from(heights.buffer),
  };
}

// Points spread over the grid, its edges and beyond: heightAt in C# must give the same numbers.
export function goldenHeights(T) {
  const out = [], W = T.worldW, H = T.worldH;
  let s = 12345;
  const rnd = () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  const pts = [[0, 0], [W, H], [W / 2, H / 2], [T.cell * 3.5, T.cell * 7.25], [W - 0.5, 1.5]];
  for (let i = 0; i < 40; i++) pts.push([rnd() * W, rnd() * H]);
  for (const [x, y] of pts) out.push(x, y, T.heightAt(x, y));
  return out;
}

// --- Model bounds in Unity world: what the imported object must cover --------------------------

const D2R = Math.PI / 180;
const rotX = (p, a) => { const c = Math.cos(a), s = Math.sin(a); return [p[0], p[1] * c - p[2] * s, p[1] * s + p[2] * c]; };
const rotY = (p, a) => { const c = Math.cos(a), s = Math.sin(a); return [p[0] * c + p[2] * s, p[1], -p[0] * s + p[2] * c]; };
const rotZ = (p, a) => { const c = Math.cos(a), s = Math.sin(a); return [p[0] * c - p[1] * s, p[0] * s + p[1] * c, p[2]]; };

// Babylon's placeObject: scale, then yaw-pitch-roll (roll first) with rotation.y = −rot[1], then position.
function placeBabylon(p, o, ground) {
  let q = [p[0] * o.scale[0], p[1] * o.scale[1], p[2] * o.scale[2]];
  q = rotY(rotX(rotZ(q, o.rot[2] * D2R), o.rot[0] * D2R), -o.rot[1] * D2R);
  return [q[0] + o.x, q[1] + ground + o.h, q[2] + o.y];
}

// Bounds and the centroid of the DISTINCT points: a model turned or mirrored by the wrong fit moves
// its centroid by its asymmetry even when the box looks the same (the mill: 19 cm).
function boundsOf(points) {
  const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity], c = [0, 0, 0];
  for (const p of points) for (let i = 0; i < 3; i++) { if (p[i] < min[i]) min[i] = p[i]; if (p[i] > max[i]) max[i] = p[i]; c[i] += p[i] / points.length; }
  return { min, max, centroid: c };
}

// Model points without repeats (a triangle corner per vertex in the FBX parse): 0.01 px grid.
function distinct(points) {
  const seen = new Map();
  for (const p of points) seen.set(p.map(v => Math.round(v * 100)).join(','), p);
  return [...seen.values()];
}

// glTF: node world matrices (column vectors), POSITION vertices. A skinned mesh ignores its node
// transform (glTF spec) — its vertices are already in the model's space.
function gltfModelPoints(buf) {
  const jsonLen = buf.readUInt32LE(12);
  const json = JSON.parse(buf.subarray(20, 20 + jsonLen).toString('utf8'));
  const bin = buf.subarray(28 + jsonLen);
  const positions = (a) => {
    const bv = json.bufferViews[a.bufferView], off = (bv.byteOffset || 0) + (a.byteOffset || 0), stride = bv.byteStride || 12, out = [];
    for (let i = 0; i < a.count; i++) out.push([0, 1, 2].map(j => bin.readFloatLE(off + i * stride + j * 4)));
    return out;
  };
  const mul = (a, b) => { const r = new Array(16).fill(0); for (let c = 0; c < 4; c++) for (let rr = 0; rr < 4; rr++) for (let k = 0; k < 4; k++) r[c * 4 + rr] += a[k * 4 + rr] * b[c * 4 + k]; return r; };
  const local = (n) => {
    if (n.matrix) return n.matrix;
    const [x, y, z, w] = n.rotation || [0, 0, 0, 1], [sx, sy, sz] = n.scale || [1, 1, 1], [tx, ty, tz] = n.translation || [0, 0, 0];
    return [(1 - 2 * (y * y + z * z)) * sx, (2 * (x * y + z * w)) * sx, (2 * (x * z - y * w)) * sx, 0,
      (2 * (x * y - z * w)) * sy, (1 - 2 * (x * x + z * z)) * sy, (2 * (y * z + x * w)) * sy, 0,
      (2 * (x * z + y * w)) * sz, (2 * (y * z - x * w)) * sz, (1 - 2 * (x * x + y * y)) * sz, 0, tx, ty, tz, 1];
  };
  const I = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1], pts = [];
  const walk = (i, parent) => {
    const n = json.nodes[i], m = mul(parent, local(n));
    if (n.mesh != null) {
      const w = n.skin != null ? I : m;
      for (const prim of json.meshes[n.mesh].primitives) {
        for (const p of positions(json.accessors[prim.attributes.POSITION])) {
          pts.push([0, 1, 2].map(r => w[r] * p[0] + w[4 + r] * p[1] + w[8 + r] * p[2] + w[12 + r]));
        }
      }
    }
    for (const c of n.children || []) walk(c, m);
  };
  for (const i of json.scenes[json.scene || 0].nodes) walk(i, I);
  // Gltf3D.build: × 100 (meters -> px), turned 90° about Y (glTF front +Z -> kit nose +X).
  return pts.map(p => rotY([p[0] * 100, p[1] * 100, p[2] * 100], Math.PI / 2));
}

// Model space of the kit (px, Babylon axes) -> the Unity object's local space (m): mirror Z, /100.
const modelToLocal = (p) => [p[0] / PX_PER_M, p[1] / PX_PER_M, -p[2] / PX_PER_M];

// Per object: { name, min, max } in Unity meters, or null when the model cannot be read here.
// An FBX part that spins (def.anim) also gets its pivot and axis in the object's local space —
// Unity's importer gives the part node its own axes, the kit spins about the FBX ones.
export async function modelBounds(root, objects, heightAt) {
  const cache = new Map();
  let Model3D = null;
  const modelOf = async (model) => {
    if (cache.has(model)) return cache.get(model);
    let info = null;
    const file = path.join(root, model);
    if (fs.existsSync(file)) {
      const buf = fs.readFileSync(file);
      if (/\.glb$/i.test(model)) info = { points: gltfModelPoints(buf), parts: [] };
      else if (/\.fbx$/i.test(model)) {
        if (!Model3D) {
          const get = runScripts(root, ['js/Constants.js', 'libs/babylon.js', 'js/Gltf3D.js', 'js/Model3D.js'],
            { DecompressionStream, Response, Blob, TextDecoder, setTimeout, clearTimeout });
          Model3D = get('Model3D');
        }
        const parsed = await Model3D.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
        const points = [];
        for (const part of parsed.parts) for (let i = 0; i < part.positions.length; i += 3) points.push([part.positions[i], part.positions[i + 1], part.positions[i + 2]]);
        info = { points, parts: parsed.parts.map(p => ({ name: p.name, pivot: [...p.pivot], axes: { x: [...p.axes.x], y: [...p.axes.y], z: [...p.axes.z] } })) };
      }
    }
    cache.set(model, info);
    return info;
  };
  const out = [];
  for (const o of objects) {
    const info = await modelOf(o.model);
    if (!info || !info.points.length) { out.push(null); continue; }
    const part = o.anim.part && info.parts.find(p => p.name === o.anim.part);
    if (part) {
      const axis = String(o.anim.axis || 'y'), v = part.axes[axis.slice(-1)] || part.axes.y, sign = axis[0] === '-' ? -1 : 1;
      o.anim.pivot = modelToLocal(part.pivot);
      o.anim.axisVec = [v[0] * sign, v[1] * sign, -v[2] * sign];
    }
    const ground = heightAt(o.x, o.y);
    const b = boundsOf(distinct(info.points).map(p => placeBabylon(p, o, ground)).map(p => toUnity(p[0], p[2], p[1])));
    out.push({ name: o.name, ...b });
  }
  return out;
}

// --- The porting report ---------------------------------------------------------------------------

function git(root, args) {
  try { return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim(); } catch { return null; }
}

// What the prototype changed in the kit: against the tag arc-base (the commit it was copied from).
export function kitDiff(root) {
  if (git(root, ['rev-parse', '--is-inside-work-tree']) !== 'true') return { base: null, why: 'нет git-репозитория' };
  const base = git(root, ['rev-parse', '--verify', '--quiet', 'arc-base^{commit}']);
  if (!base) return { base: null, why: 'нет тега arc-base' };
  const changed = (git(root, ['diff', '--name-status', base]) || '').split('\n').filter(Boolean)
    .map(l => { const [st, ...rest] = l.split('\t'); return { status: st[0], file: rest[rest.length - 1] }; });
  const untracked = (git(root, ['ls-files', '--others', '--exclude-standard']) || '').split('\n').filter(Boolean)
    .map(file => ({ status: 'A', file }));
  return { base: base.slice(0, 7), files: changed.concat(untracked).filter(f => /^(js|libs|assets)\/|^index\.html$/.test(f.file)) };
}

export function gameFiles(root) {
  return fs.readdirSync(path.join(root, 'js')).filter(f => f.endsWith('.js')).map(f => 'js/' + f)
    .filter(f => !KIT_FILES.includes(f)).sort();
}

// The comment block a kit file starts with (every file of the kit has one, the agent writes it for a
// new file anyway): what the feature is, in the author's words. null — the file has none.
export function headerOf(text) {
  const lines = text.replace(/^﻿/, '').split(/\r?\n/);
  let i = 0;
  while (i < lines.length && !lines[i].trim()) i++;
  const out = [];
  if (/^\s*\/\*/.test(lines[i] || '')) {
    for (; i < lines.length; i++) {
      out.push(lines[i].replace(/^\s*\/\*+\s?|\s*\*+\/\s*$|^\s*\*\s?/g, ''));
      if (/\*\//.test(lines[i])) break;
    }
  } else {
    for (; i < lines.length && /^\s*\/\//.test(lines[i]); i++) out.push(lines[i].replace(/^\s*\/\/\s?/, ''));
  }
  const text2 = out.join('\n').trim();
  return text2 || null;
}

// Members of the kit's globals and of app.location / app.camera / terrain: a call no API row knows
// is reported as unknown — a kit function the export has no twin for, or a typo.
const KIT_MEMBER = /(?<!\bwindow\.|\bdocument\.)\b(UI|Sound3D|Model3D|Gltf3D|Clips3D|Store|World3D|Debug3D|Instances3D|Terrain3D|Location3D|CameraController|location|camera|terrain)\.(\w+)/g;
const STICKY = API.map(([rx]) => new RegExp(rx.source, 'y'));

function knownCall(code, at, dot) {
  return STICKY.some(rx => { rx.lastIndex = 0; if (rx.test(code.slice(at))) return true; rx.lastIndex = 0; return rx.test(code.slice(dot)); });
}

// Kit calls of the game code: per API row — uses and the first place; calls no row knows; the
// header of every file; tags, UI ids and constant names the code mentions.
export function scanGame(root, files) {
  const rows = API.map(([rx, cs, note]) => ({ js: rx.source, cs, note: note || '', count: 0, first: '' }));
  const tags = new Set(), uiIds = new Set(), names = new Set(), unknown = new Map(), headers = {};
  for (const f of files) {
    const text = fs.readFileSync(path.join(root, f), 'utf8');
    headers[f] = headerOf(text);
    text.split(/\r?\n/).forEach((line, i) => {
      const code = line.replace(/\/\/.*$/, '');
      API.forEach(([rx], k) => {
        if (rx.test(code)) { rows[k].count++; if (!rows[k].first) rows[k].first = f + ':' + (i + 1); }
      });
      for (const m of code.matchAll(KIT_MEMBER)) {
        if (knownCall(code, m.index, m.index + m[1].length)) continue;
        const call = m[1] + '.' + m[2], u = unknown.get(call) || { call, count: 0, first: f + ':' + (i + 1) };
        u.count++;
        unknown.set(call, u);
      }
      for (const m of code.matchAll(/findByTag\(\s*['"]([^'"]+)['"]/g)) tags.add(m[1]);
      for (const m of code.matchAll(/_TAG\s*=\s*['"]([^'"]+)['"]/g)) tags.add(m[1]);
      for (const m of code.matchAll(/UI\.(?:get|def)\(\s*['"]([^'"]+)['"]/g)) uiIds.add(m[1]);
      for (const m of code.matchAll(/\b[A-Z][A-Z0-9]*_[A-Z0-9_]+\b/g)) names.add(m[0]);
    });
  }
  return { rows: rows.filter(r => r.count), unknown: [...unknown.values()], headers,
    tags: [...tags], uiIds: [...uiIds], names: [...names] };
}

export function report({ files, scan, diff, constants, objects, layout, assets, bounds }) {
  const L = [];
  const objTags = new Set(objects.map(o => o.tag).filter(Boolean)), layoutIds = new Set(layout.map(r => r.id));
  L.push('# Перенос в Unity — отчёт экспорта', '');
  L.push('Сгенерирован `node tools/export-unity.mjs` — не править руками, он перезаписывается при каждом экспорте.',
    'Как переносить — скилл `unity-port` (`claude/skills/unity-port/SKILL.md` в проекте ArcEngine).', '');
  // What the game is made of: every game file with its header comment, in the author's words.
  L.push('## Фичи — файлы игры и их шапки', '');
  if (!files.length) L.push('Нет файлов игры в js/ (всё, кроме модулей набора).', '');
  for (const f of files) {
    const h = scan.headers && scan.headers[f];
    L.push('### `' + f + '`', '');
    L.push(h ? h.split('\n').map(s => '> ' + s).join('\n') : '**Нет шапки** — что делает файл, неизвестно: опишите его комментарием в начале файла.', '');
  }
  const twin = scan.rows.filter(r => r.note !== 'manual'), manual = scan.rows.filter(r => r.note === 'manual');
  L.push('## Вызовы набора и их двойники в C#', '');
  if (twin.length) {
    L.push('| JS (шаблон) | C# (ArcRuntime) | раз | первое место | заметка |', '|---|---|---|---|---|');
    for (const r of twin) L.push('| `' + r.js.replace(/\|/g, '\\|') + '` | `' + r.cs + '` | ' + r.count + ' | ' + r.first + ' | ' + r.note + ' |');
  } else L.push('Код игры не зовёт API набора.');
  L.push('');
  L.push('## Без двойника — перенести руками', '');
  if (manual.length) {
    L.push('| JS (шаблон) | раз | первое место |', '|---|---|---|');
    for (const r of manual) L.push('| `' + r.js.replace(/\|/g, '\\|') + '` | ' + r.count + ' | ' + r.first + ' |');
  } else L.push('Нет: код игры ходит только через API набора.');
  L.push('');
  const unknown = scan.unknown || [];
  L.push('## Нет в таблице экспорта — проверить', '');
  if (unknown.length) {
    L.push('Обращения к набору, о которых экспорт ничего не знает: функция набора без C#-двойника (дописать его в пакет',
      'и строку в `API` экспорта) или опечатка.', '', '| вызов | раз | первое место |', '|---|---|---|');
    for (const u of unknown) L.push('| `' + u.call + '` | ' + u.count + ' | ' + u.first + ' |');
  } else L.push('Нет: каждое обращение к набору есть в таблице.');
  L.push('');
  L.push('## Контракт сцены', '');
  const missTags = scan.tags.filter(t => !objTags.has(t)), missIds = scan.uiIds.filter(id => !layoutIds.has(id));
  L.push('- Теги из кода: ' + (scan.tags.map(t => '`' + t + '`' + (objTags.has(t) ? '' : ' **нет в Objects.js**')).join(', ') || '—'));
  L.push('- id интерфейса из кода: ' + (scan.uiIds.map(id => '`' + id + '`' + (layoutIds.has(id) ? '' : ' **нет в UILayout.js**')).join(', ') || '—'));
  if (missTags.length || missIds.length) L.push('', 'Чего нет в сцене, того не будет и в Unity: код получит null / пустой список, как в JS.');
  L.push('');
  const used = constants.numbers.concat(constants.strings).filter(c => scan.names.includes(c.name));
  L.push('## Константы, которые читает игра', '', 'В Unity — ассет `ArcConstants` (правится в инспекторе), в коде — `Arc.Const("NAME", дефолт)`.', '');
  L.push(used.length ? used.map(c => '- `' + c.name + '` = ' + JSON.stringify(c.value)).join('\n') : '- нет', '');
  L.push('## Что изменено в наборе', '');
  if (!diff.base) {
    L.push('Не посчитано: ' + diff.why + '. Прототип, скопированный из набора, помечает исходный коммит:',
      '`git tag arc-base <коммит>` — тогда здесь будет список изменённых модулей набора и новых файлов.');
  } else if (!diff.files.length) {
    L.push('С `arc-base` (' + diff.base + ') код и ассеты набора не менялись.');
  } else {
    L.push('Относительно `arc-base` (' + diff.base + '). Изменённый модуль набора — его двойник в ArcRuntime о правке не знает: перенести её руками.', '');
    for (const f of diff.files) L.push('- ' + ({ A: 'новый', M: 'изменён', D: 'удалён', R: 'переименован' }[f.status] || f.status) + ': `' + f.file + '`' + (KIT_FILES.includes(f.file) ? ' — **модуль набора**' : ''));
  }
  L.push('');
  L.push('## Не переносится автоматически', '', NOT_PORTED.map(s => '- ' + s).join('\n'), '');
  const noBounds = objects.filter((o, i) => !bounds[i]).map(o => o.name);
  L.push('## Ассеты', '', assets.map(a => '- `' + a + '`').join('\n') || '- нет', '');
  if (noBounds.length) L.push('Модель не прочитана экспортом (нет файла или формат не FBX/GLB): ' + noBounds.join(', ') + ' — импорт не проверит её габариты.', '');
  return L.join('\n');
}

// --- Writing ------------------------------------------------------------------------------------

function writeIfChanged(file, data) {
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(data, 'utf8');
  if (fs.existsSync(file) && fs.readFileSync(file).equals(buf)) return false;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, buf);
  return true;
}

// The ArcRuntime package (unity/com.arcengine.runtime) goes into the Unity project as an EMBEDDED
// package — the very version this export was made for, no download. A project that references it
// in Packages/manifest.json (the kit's own test bench: "file:…") keeps that reference. A package file
// edited inside the Unity project is not overwritten: .arc-export.json there remembers what the
// last export wrote (Unity ignores dot-names), a file that no longer matches it is the user's.
export const PACKAGE = 'com.arcengine.runtime';

export function syncPackage(root, project) {
  let manifest = null;
  try { manifest = JSON.parse(fs.readFileSync(path.join(project, 'Packages', 'manifest.json'), 'utf8')); } catch { /* none */ }
  const ref = manifest && manifest.dependencies && manifest.dependencies[PACKAGE];
  if (ref) return { mode: 'manifest', ref, written: [], kept: [] };
  const src = path.join(root, 'unity', PACKAGE), dst = path.join(project, 'Packages', PACKAGE);
  const hash = (buf) => crypto.createHash('sha1').update(buf).digest('hex');
  const recordFile = path.join(dst, '.arc-export.json');
  let record = {};
  try { record = JSON.parse(fs.readFileSync(recordFile, 'utf8')); } catch { /* first export */ }
  const files = [];
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); if (e.isDirectory()) walk(f); else files.push(path.relative(src, f).split(path.sep).join('/')); } };
  walk(src);
  const written = [], kept = [], next = {};
  for (const rel of files) {
    const buf = fs.readFileSync(path.join(src, rel)), out = path.join(dst, rel);
    const mine = fs.existsSync(out) ? hash(fs.readFileSync(out)) : null;
    if (mine && record[rel] && mine !== record[rel] && mine !== hash(buf)) { kept.push(rel); next[rel] = record[rel]; continue; }
    if (writeIfChanged(out, buf)) written.push(rel);
    next[rel] = hash(buf);
  }
  for (const rel of Object.keys(record)) {
    if (next[rel] || !fs.existsSync(path.join(dst, rel))) continue;
    if (hash(fs.readFileSync(path.join(dst, rel))) === record[rel]) fs.rmSync(path.join(dst, rel));   // the kit dropped it
  }
  writeIfChanged(recordFile, JSON.stringify(next, null, 1) + '\n');
  return { mode: 'embedded', written, kept };
}

// Assets this export no longer has: removed with their .meta (Unity would keep a dead asset).
function removeStale(dir, keep) {
  if (!fs.existsSync(dir)) return [];
  const gone = [];
  const walk = (d) => {
    for (const e of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) { walk(full); continue; }
      if (e.name.endsWith('.meta')) continue;
      if (!keep.has(full)) { fs.rmSync(full); fs.rmSync(full + '.meta', { force: true }); gone.push(full); }
    }
  };
  walk(dir);
  return gone;
}

export async function collect(root = ROOT) {
  const get = runScripts(root, ['js/Constants.js', 'js/Objects.js', 'js/UILayout.js', 'libs/simplex-noise.js', 'js/Terrain3D.js',
    'js/Location3D.js', 'js/UI.js'],
    { BABYLON: stub(), World3D: stub() });
  const constants = readConstants(root, get);
  const W = Math.max(64, get('LOCATION_WIDTH')), H = Math.max(64, get('LOCATION_HEIGHT'));
  const Terrain3D = get('Terrain3D');
  const T = new Terrain3D({ scene: stub() }, { worldW: W, worldH: H });
  const objects = (get('typeof LOCATION_OBJECTS !== "undefined" ? LOCATION_OBJECTS : []') || []).map(normalizeObject);
  const DEFAULTS = get('UI.DEFAULTS');
  const layout = (get('typeof UI_LAYOUT !== "undefined" ? UI_LAYOUT : []') || []).map(r => normalizeUI(r, DEFAULTS));
  const terrain = exportTerrain(T);
  const scan = await collectRefs(root);
  const assets = scan.refs.filter(r => fs.existsSync(path.join(root, r))).sort();
  const bounds = await modelBounds(root, objects, (x, y) => T.heightAt(x, y));
  const files = gameFiles(root);
  const game = scanGame(root, files);
  const diff = kitDiff(root);
  const space = [];
  for (const o of objects) { const g = T.heightAt(o.x, o.y); space.push(o.x, o.y, g + o.h, ...toUnity(o.x, o.y, g + o.h)); }
  const data = {
    format: FORMAT, pxPerMeter: PX_PER_M,
    constants: constants.numbers, strings: constants.strings,
    terrain: terrain.meta,
    grounds: [...get('Location3D.GROUNDS')],
    objects, ui: layout, assets,
    golden: {
      heights: goldenHeights(T),
      space,
      bounds: bounds.map((b, i) => b ? { index: i, min: b.min, max: b.max, centroid: b.centroid } : null).filter(Boolean),
    },
  };
  return { data, terrainBytes: terrain.bytes, report: report({ files, scan: game, diff, constants, objects, layout, assets, bounds }), assets };
}

export async function exportUnity(root, project) {
  if (!fs.existsSync(path.join(project, 'Assets'))) throw new Error('не Unity-проект (нет папки Assets): ' + project);
  const out = path.join(project, 'Assets', 'ArcExport');
  const { data, terrainBytes, report: md, assets } = await collect(root);
  const written = [];
  const put = (rel, buf) => { if (writeIfChanged(path.join(out, rel), buf)) written.push(rel); };
  put('arc-export.json', JSON.stringify(data, null, 1) + '\n');
  put('terrain.bytes', terrainBytes);
  put('MIGRATION.md', md);
  const keep = new Set();
  for (const a of assets) {
    const dst = path.join(out, a);
    keep.add(dst);
    put(a, fs.readFileSync(path.join(root, a)));
  }
  const gone = removeStale(path.join(out, 'assets'), keep);
  const pkg = syncPackage(root, project);
  return { out, written, gone, data, pkg };
}

if (process.argv[1] && path.resolve(process.argv[1]) === url.fileURLToPath(import.meta.url)) {
  const project = process.argv.slice(2).find(a => !a.startsWith('--'));
  if (!project && process.argv.includes('--report')) {
    try {
      const { report: md } = await collect(ROOT);
      const file = path.join(ROOT, 'dist', 'MIGRATION.md');
      writeIfChanged(file, md);
      console.log('Отчёт о переносе в Unity: ' + file);
    } catch (e) {
      console.error('Отчёт не собран: ' + e.message);
      process.exit(1);
    }
    process.exit(0);
  }
  if (!project) {
    console.log('Использование: node tools/export-unity.mjs <папка Unity-проекта>   (пишет Assets/ArcExport/)');
    console.log('               node tools/export-unity.mjs --report             (только отчёт: dist/MIGRATION.md)');
    process.exit(1);
  }
  try {
    const r = await exportUnity(ROOT, path.resolve(project));
    console.log('Экспорт: ' + r.out);
    console.log('  объектов ' + r.data.objects.length + ', элементов UI ' + r.data.ui.length + ', констант ' + r.data.constants.length +
      ', ассетов ' + r.data.assets.length + '; изменено файлов ' + r.written.length + (r.gone.length ? ', удалено ' + r.gone.length : ''));
    console.log(r.pkg.mode === 'manifest'
      ? '  пакет ' + PACKAGE + ' — по ссылке из Packages/manifest.json: ' + r.pkg.ref
      : '  пакет ' + PACKAGE + ' — в Packages/ проекта, изменено файлов ' + r.pkg.written.length);
    for (const f of r.pkg.kept) console.log('  ! не перезаписан (изменён в Unity-проекте): Packages/' + PACKAGE + '/' + f);
    console.log('  дальше — импорт в Unity: меню ArcEngine > Import export (или batchmode -executeMethod ArcEngine.Editor.ArcImporter.ImportCli);');
    console.log('  что переносить руками — Assets/ArcExport/MIGRATION.md');
  } catch (e) {
    console.error('Экспорт не удался: ' + e.message);
    process.exit(1);
  }
}
