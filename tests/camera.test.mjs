// CameraController flight and look-around: WASD along the view, Q/E along the world vertical,
// RMB look keeps the camera in place. The view and the terrain are stubs — only the math is checked.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { loadScripts, stub } from './browser-scripts.mjs';

const EPS = 1e-6;
// Flight over the longest frame (0.1 s) at zoom 1. The speed is read from Constants.js, not
// written here as a number: the user tunes CAMERA_FLY_SPEED with the editor's slider.
const STEP = loadScripts(['js/Constants.js']).get('CAMERA_FLY_SPEED') * 0.1;
// Frames of diagonal flight (up + sideways, the step is split between them) to cover 4000 px.
const FAR = Math.ceil(4000 * Math.SQRT2 / STEP);

function makeCamera(opts = {}) {
  const page = loadScripts(['js/Constants.js', 'js/CameraControl.js'], { BABYLON: stub(), performance });
  const CameraController = page.get('CameraController');
  const view = {
    camera: { fov: 0, position: { set() {} }, setTarget() {} },
    world: { canvas: { clientWidth: 1600, clientHeight: 900 } },
    engine: { getAspectRatio: () => 16 / 9 },
    fitShadowFrustum() {}, refreshMatrices() {}, pointerToGround: () => null,
  };
  const terrain = { heightAt: opts.heightAt || (() => 0), outerRing: 2400, hMin: 0 };
  const cam = new CameraController(view, { terrain, bounds: { w: 2048, h: 2048 }, free: !!opts.free });
  cam.c.limits = opts.limits ? 1 : 0;   // the test does not depend on the CAMERA_LIMITS value in Constants.js
  // Exercise flight at a stable test pose; the game's starting zoom and angle are art direction.
  cam.azimuth = -Math.PI / 2;
  cam.pitch = 57 * Math.PI / 180;
  cam.zoom = cam.zoomTarget = 1;
  cam.lookAt(1024, 1024);
  cam._apply();
  return { cam, liftMax: page.get('CAMERA_LIFT_MAX'), pitchMin: page.get('CAMERA_ORBIT_PITCH_MIN_DEG') };
}

const key = (cam, code, down = true) => cam._onKey({ code, target: null, preventDefault() {} }, down);

// One longest frame with the given keys held.
function fly(cam, ...codes) {
  for (const code of codes) key(cam, code);
  const from = { ...cam._eye() };
  cam.update(0.1);
  for (const code of codes) key(cam, code, false);
  const to = cam._eye();
  return { x: to.x - from.x, y: to.y - from.y, h: to.h - from.h };
}

function forward(cam) {
  const cp = Math.cos(cam.pitch);
  return { x: Math.cos(cam.azimuth) * cp, y: Math.sin(cam.azimuth) * cp, h: -Math.sin(cam.pitch) };
}

test('W и S — полёт вдоль взгляда: камера снижается, направление взгляда не меняется', () => {
  for (const free of [true, false]) {
    const { cam } = makeCamera({ free });
    const f = forward(cam), az = cam.azimuth, pitch = cam.pitch;
    const d = fly(cam, 'KeyW');
    assert.ok(Math.hypot(d.x - f.x * STEP, d.y - f.y * STEP, d.h - f.h * STEP) < EPS, 'W, free=' + free);
    assert.ok(d.h < 0, 'взгляд вниз — W снижает');
    const back = fly(cam, 'KeyS');
    assert.ok(Math.hypot(back.x + d.x, back.y + d.y, back.h + d.h) < EPS, 'S — обратно');
    assert.equal(cam.azimuth, az);
    assert.equal(cam.pitch, pitch);
  }
});

test('A и D — вбок без смены высоты, D — вправо на экране; стрелки дублируют WASD', () => {
  const { cam } = makeCamera({ free: true });
  const d = fly(cam, 'KeyD');
  const screen = cam.worldDeltaToScreen(d.x, d.y);
  assert.ok(Math.abs(screen.x - STEP) < EPS && Math.abs(screen.y) < EPS && Math.abs(d.h) < EPS);
  const a = fly(cam, 'ArrowLeft');
  assert.ok(Math.hypot(a.x + d.x, a.y + d.y, a.h) < EPS);
});

test('Q и E — вниз и вверх по мировой вертикали', () => {
  const { cam } = makeCamera({ free: true });
  const up = fly(cam, 'KeyE');
  assert.ok(Math.abs(up.x) < EPS && Math.abs(up.y) < EPS && Math.abs(up.h - STEP) < EPS);
  assert.ok(Math.abs(cam.lift - STEP) < EPS);
  const down = fly(cam, 'KeyQ');
  assert.ok(Math.abs(down.h + STEP) < EPS);
});

test('скорость по диагонали та же, противоположные клавиши гасят друг друга', () => {
  const { cam } = makeCamera({ free: true });
  const d = fly(cam, 'KeyW', 'KeyD', 'KeyE');
  assert.ok(Math.abs(Math.hypot(d.x, d.y, d.h) - STEP) < EPS);
  const none = fly(cam, 'KeyW', 'KeyS');
  assert.ok(Math.hypot(none.x, none.y, none.h) < EPS);
});

test('камера не опускается ниже земли + EYE_MIN, взгляд при этом не меняется', () => {
  const { cam } = makeCamera({ free: true, heightAt: (x, y) => 50 + 0.1 * x });
  const pitch = cam.pitch;
  key(cam, 'KeyQ');
  for (let i = 0; i < 200; i++) cam.update(0.1);
  const e = cam._eye();
  assert.ok(Math.abs(e.h - (50 + 0.1 * e.x + 40)) < 1e-3);
  assert.equal(cam.pitch, pitch);
});

test('CAMERA_LIMITS = 1: потолок полёта, цель внутри локации, наклон не ниже предела', () => {
  const { cam, liftMax, pitchMin } = makeCamera({ limits: true });
  key(cam, 'KeyE');
  key(cam, 'KeyD');
  for (let i = 0; i < FAR; i++) cam.update(0.1);
  assert.equal(cam.lift, liftMax);
  assert.equal(cam.target.x, 2048);
  cam._look(0, -3);
  assert.ok(cam.pitch >= pitchMin * Math.PI / 180 - EPS);
});

test('фиксированная изометрия сохраняет наклон при колесе и жесте масштабирования', () => {
  const { cam } = makeCamera({ limits: true });
  cam.c.orbit = 0;
  cam.follow({ x: 1024, y: 1024 });
  cam.home();
  const pitch = cam.pitch, startZoom = cam.zoom;
  for (let i = 0; i < 20; i++) {
    cam._onWheel({ deltaY: 100, preventDefault() {} });
    cam.update(0.1);
    assert.ok(Math.abs(cam.pitch - pitch) < EPS, 'колесо не меняет угол');
  }
  assert.ok(cam.zoom >= cam._isometricSafeZoom() - EPS, 'отдаление не открывает край земли');
  const farZoom = cam.zoom;
  for (let i = 0; i < 20; i++) {
    cam._onWheel({ deltaY: -100, preventDefault() {} });
    cam.update(0.1);
  }
  assert.ok(cam.zoom > farZoom && cam.zoom <= cam.c.zoomMax);
  assert.ok(Math.abs(cam.pitch - pitch) < EPS, 'приближение не меняет угол');

  cam.zoom = cam.zoomTarget = startZoom;
  cam._pointers = new Map([
    [1, { mode: 'touch', x: 0, y: 0 }],
    [2, { mode: 'touch', x: 50, y: 0 }],
  ]);
  cam._pinch = { dist: 100, anchor: null };
  cam._applyPinch();
  cam.update(0.1);
  assert.ok(cam.zoom < startZoom && cam.zoom >= cam._isometricSafeZoom() - EPS);
  assert.ok(Math.abs(cam.pitch - pitch) < EPS, 'жест не меняет угол');
});

test('короткий tap оставляет слежение, перетаскивание пальцем переводит камеру в ручной режим', () => {
  const { cam } = makeCamera();
  cam._canvas = { getBoundingClientRect: () => ({ left: 0, top: 0 }), setPointerCapture() {} };
  cam.view.pointerToGround = (x, y) => ({ x: cam.target.x + x, y: cam.target.y + y });
  const caravan = { x: 1024, y: 1024 };
  cam.follow(caravan);
  cam.home();
  const touch = (x, y) => ({ pointerId: 1, pointerType: 'touch', button: 0,
    clientX: x, clientY: y, preventDefault() {} });

  cam._onDown(touch(100, 100));
  cam._onMove(touch(103, 104));
  cam._onUp(touch(103, 104));
  assert.equal(cam.followObj, caravan, 'tap с небольшим дрожанием не сбрасывает слежение');
  caravan.x += 50;
  cam.update(0.1);
  assert.ok(cam.target.x > 1024, 'камера продолжает следовать за караваном');

  const beforePan = cam.target.x;
  cam._onDown(touch(100, 100));
  cam._onMove(touch(120, 100));
  assert.equal(cam.followObj, null, 'явный drag отключает слежение');
  assert.ok(cam.target.x < beforePan, 'drag сдвигает карту');
  cam._onUp(touch(120, 100));
});

test('два пальца переключают на ручную камеру и сохраняют pinch zoom', () => {
  const { cam } = makeCamera();
  cam._canvas = { getBoundingClientRect: () => ({ left: 0, top: 0 }), setPointerCapture() {} };
  cam.view.pointerToGround = (x, y) => ({ x: cam.target.x + x, y: cam.target.y + y });
  const caravan = { x: 1024, y: 1024 };
  cam.follow(caravan);
  cam.home();
  const zoom = cam.zoom;
  const touch = (pointerId, x, y) => ({ pointerId, pointerType: 'touch', button: 0,
    clientX: x, clientY: y, preventDefault() {} });

  cam._onDown(touch(1, 100, 100));
  assert.equal(cam.followObj, caravan, 'первый палец ещё может быть tap');
  cam._onDown(touch(2, 200, 100));
  assert.equal(cam.followObj, null, 'второй палец начинает жест камеры');
  cam._onMove(touch(2, 250, 100));
  assert.ok(cam.zoom > zoom, 'разведение пальцев приближает');
  cam._onUp(touch(2, 250, 100));
  cam._onUp(touch(1, 100, 100));
});

test('режим каравана сохраняет слежение и изометрический угол при drag и pinch', () => {
  const { cam } = makeCamera({ limits: true });
  cam.c.orbit = 0;
  cam._canvas = { getBoundingClientRect: () => ({ left: 0, top: 0 }), setPointerCapture() {} };
  cam.view.pointerToGround = (x, y) => ({ x: cam.target.x + x, y: cam.target.y + y });
  const caravan = { x: 1024, y: 1024 };
  cam.follow(caravan);
  cam.followLock = true;
  const pitch = cam.pitch, azimuth = cam.azimuth, zoom = cam.zoom;
  const touch = (pointerId, x, y) => ({ pointerId, pointerType: 'touch', button: 0,
    clientX: x, clientY: y, preventDefault() {} });

  cam._onDown(touch(1, 100, 100));
  cam._onMove(touch(1, 140, 110));
  assert.equal(cam.followObj, caravan, 'один палец не выключает сопровождение');
  cam._onDown(touch(2, 200, 100));
  cam._onMove(touch(2, 250, 100));
  assert.equal(cam.followObj, caravan, 'pinch не выключает сопровождение');
  assert.ok(cam.zoom > zoom, 'pinch по-прежнему меняет масштаб');
  assert.equal(cam.pitch, pitch);
  assert.equal(cam.azimuth, azimuth);
  cam._onUp(touch(2, 250, 100));
  cam._onUp(touch(1, 140, 110));
  caravan.x += 70;
  cam.update(0.1);
  assert.ok(cam.target.x > 1024, 'камера продолжает ехать за караваном');
});

test('CAMERA_LIMITS = 0: игровая камера летает без потолка и границ и смотрит выше горизонта', () => {
  const { cam, liftMax } = makeCamera();
  key(cam, 'KeyE');
  key(cam, 'KeyD');
  for (let i = 0; i < FAR; i++) cam.update(0.1);
  assert.ok(cam.lift > liftMax * 5);
  assert.ok(cam.target.x > 2048 * 2);
  cam._look(0, -3);
  assert.ok(cam.pitch < 0);
});

test('осмотр (ПКМ): камера на месте, цель поворачивается вокруг неё; свободная смотрит и вверх', () => {
  const { cam } = makeCamera({ free: true });
  const eye = { ...cam._eye() }, az = cam.azimuth;
  cam._look(0.3, -0.2);
  const e = cam._eye();
  assert.ok(Math.hypot(e.x - eye.x, e.y - eye.y, e.h - eye.h) < EPS);
  assert.ok(Math.abs(cam.azimuth - az - 0.3) < EPS);
  cam._look(0, -3);
  assert.ok(cam.pitch < 0, 'взгляд выше горизонта');
  const up = cam._eye();
  assert.ok(Math.hypot(up.x - eye.x, up.y - eye.y, up.h - eye.h) < EPS);
});

// The shadow box is capped by WORLD3D_SHADOW_RADIUS and cannot cover a whole frame, so it is led
// by where the camera STANDS, not by the ground at the frame center: raise the head next to a
// building and that point is a thousand px past it (tests/shadow.test.mjs picks up from here).
test('теневому фрустуму уходит место камеры и её курс, а не точка взгляда', () => {
  const { cam } = makeCamera({ free: true });
  let got = null;
  cam.view.fitShadowFrustum = (c, maxR) => { got = { c, maxR }; };
  cam.pitch = -2 * Math.PI / 180;   // чуть выше горизонта — как на скриншоте пользователя
  cam._apply();
  const e = cam._eye();
  assert.ok(Math.hypot(cam.target.x - e.x, cam.target.y - e.y) > 500, 'точка взгляда далеко от камеры');
  assert.ok(Math.abs(got.c.x - e.x) < EPS && Math.abs(got.c.y - e.y) < EPS, 'точка — под камерой');
  assert.equal(got.c.h, 0, 'высота — земля под камерой');
  assert.ok(Math.hypot(got.c.dx - Math.cos(cam.azimuth), got.c.dy - Math.sin(cam.azimuth)) < EPS, 'курс — единичный');
});

// Flying forward and down takes the target under the ground (lift < 0) and toward the horizon the
// frame center runs off: both used to go into the size of the box through groundFocus().k, and the
// box either shrank to a fraction of the frame or chased a point a thousand px away.
test('запрошенный размер коробки теней — след кадра, от подъёма и наклона не зависит', () => {
  const { cam } = makeCamera({ free: true });
  let maxR = null;
  cam.view.fitShadowFrustum = (c, r) => { maxR = r; };
  cam._apply();
  const base = maxR;
  assert.ok(base > 900, 'след кадра при zoom 1');
  for (const lift of [-250, 900]) {
    cam.lift = lift;
    cam.target.h = lift;
    cam._apply();
    assert.equal(maxR, base, 'подъём ' + lift);
  }
  cam.pitch = -2 * Math.PI / 180;
  cam._apply();
  assert.equal(maxR, base, 'взгляд к горизонту');
});

test('home и lookAt возвращают цель на землю, слежение гасит высоту полёта', () => {
  const { cam } = makeCamera({ free: true });
  fly(cam, 'KeyE');
  cam.lookAt(100, 200);
  assert.equal(cam.lift, 0);
  fly(cam, 'KeyE');
  cam.home();
  assert.equal(cam.lift, 0);
  fly(cam, 'KeyE');
  cam.follow({ x: 1000, y: 1000 });
  for (let i = 0; i < 300; i++) cam.update(0.1);
  assert.ok(Math.abs(cam.lift) < 1e-3 && Math.abs(cam.target.x - 1000) < 1e-3);
});
