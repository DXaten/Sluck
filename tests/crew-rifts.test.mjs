import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import vm from 'node:vm';

const root = path.resolve(import.meta.dirname, '..');
const context = vm.createContext({ console });
vm.runInContext('const LOCATION_WIDTH = 1200, LOCATION_HEIGHT = 900;', context);
for (const file of ['TDLevels.js', 'TDCore.js', 'CrewCore.js', 'CrewRifts.js'])
    vm.runInContext(fs.readFileSync(path.join(root, 'js', file), 'utf8'), context);
vm.runInContext('this.levels = TD_LEVELS; this.Core = CrewRifts;', context);
const { Core, levels } = context;

function reachFirstRift(core) {
    core.start();
    core.distance = core.route.total * Core.BREAKS[0] - 1;
    core.update(0.1);
    assert.equal(core.state, 'paused');
    assert.equal(core.riftPrompt.stage, 0);
}

test('the caravan pauses at a rift and sealing uses Dawn charge rather than souls', () => {
    const core = new Core(levels[0], { random: () => 0 });
    reachFirstRift(core);
    const pair = core.riftPrompt.pair;
    assert.equal(pair.length, 2);
    assert.ok(pair.every(rift => rift.entry && rift.x >= 55 && rift.y >= 55));
    assert.equal(core.chooseRift('left'), false, 'cannot seal without charge');
    assert.equal(core.state, 'paused');
    core.dawnCharge = Core.SEAL_COST;
    const souls = core.souls;
    assert.equal(core.chooseRift('left'), true);
    assert.equal(core.dawnCharge, 0);
    assert.equal(core.souls, souls);
    assert.deepEqual([...core.openRifts.map(rift => rift.id)], [pair[1].id]);
    assert.equal(core.state, 'playing');
    assert.equal(core.chooseRift('both'), false, 'a decision can only be made once');
    core.update(0.1);
    assert.ok(core.events.some(e => e.kind === 'rift_choice' && e.choice === 'left'),
        'the choice must remain visible to the UI on the following frame');
});

test('opening both rifts grants souls and spawns each rift-specific enemy pattern', () => {
    const core = new Core(levels[1], { random: () => 0 });
    reachFirstRift(core);
    const before = core.souls;
    assert.equal(core.chooseRift('both'), true);
    assert.equal(core.souls, before + Core.OPEN_BONUS);
    assert.equal(core.openRifts.length, 2);
    core.enemies = [];
    core.phaseSpawnCount = 0;
    const oldCount = core.spawnCount;
    core.spawnEnemy();
    assert.equal(core.enemies.length, 3, 'station moth pack and one porter');
    assert.equal(core.spawnCount, oldCount + 3);
    assert.ok(core.enemies.every(enemy => core.openRifts.some(rift => rift.id === enemy.riftId)));
    assert.deepEqual([...new Set(core.enemies.map(enemy => enemy.type))].sort(), ['moth', 'porter']);
    core.enemies = [];
    core.spawnEnemy();
    assert.deepEqual([...core.enemies.map(enemy => enemy.type)].sort(), ['runner', 'wraith']);
});

test('a miniboss appears after the first rift decision and has more HP than normal', () => {
    const core = new Core(levels[0], { random: () => 0 });
    reachFirstRift(core);
    core.chooseRift('both');
    core.distance = core.route.total * (Core.BREAKS[0] + 0.12) + 1;
    core.update(0.1);
    const miniboss = core.enemies.find(enemy => enemy.boss === 'miniboss');
    assert.ok(miniboss);
    assert.ok(miniboss.maxHp > 2 * 235);
    assert.equal(core.minibossSpawned[0], true);
    core.update(0.1);
    assert.equal(core.enemies.filter(enemy => enemy.boss === 'miniboss').length, 1,
        'the encounter only spawns once');
});

function beginFinale(core) {
    core.start();
    core.distance = core.route.total;
    Object.assign(core.convoy, Core.pointAt(core.route, core.distance));
    core.beaconActive = true;
    core.beaconWaveStarted = true;
    core.beaconHold = 0.05;
    core.spawnBeaconWave();
    return core.enemies.find(enemy => enemy.boss === 'final');
}

test('the final boss must fall before the beacon can count as won', () => {
    const core = new Core(levels[0], { random: () => 0 });
    const boss = beginFinale(core);
    assert.ok(boss.maxHp >= 750);
    core.update(0.1);
    assert.equal(core.state, 'playing', 'hold timer alone must not grant victory');
    boss.hp = 1;
    core.hurt(boss, 1, 'lamp');
    assert.equal(core.finalBossDefeated, true);
    for (let tick = 0; tick < 20 && core.state === 'playing'; tick++) core.update(0.1);
    assert.equal(core.state, 'won');
    assert.ok(core.events.some(event => event.kind === 'won'));
});

test('a final boss breach ends in defeat instead of an endless one-second hold', () => {
    const core = new Core(levels[0], { random: () => 0 });
    const boss = beginFinale(core);
    core.convoy.hp = 10;
    boss.x = core.convoy.x;
    boss.y = core.convoy.y;
    boss.routeDistance = core.route.total;
    core.update(0.1);
    assert.equal(core.state, 'lost');
    assert.equal(core.convoy.hp, 0);
    assert.equal(core.finalBossDefeated, false);
    assert.equal(core.events.filter(event => event.kind === 'boss_breach').length, 1);
    assert.equal(core.events.filter(event => event.kind === 'won').length, 0);
    core.update(0.1);
    assert.equal(core.state, 'lost', 'the result is terminal');
});

test('final encounters on every district terminate within a bounded time', () => {
    for (const level of levels) {
        const core = new Core(level, { random: () => 0 });
        const boss = beginFinale(core);
        core.convoy.hp = 99;
        core.enemies = [boss]; // isolate the final boss from supporting wave enemies
        for (let tick = 0; tick < 600 && core.state === 'playing'; tick++) core.update(0.1);
        assert.equal(core.state, 'lost', `${level.id}: an unopposed boss must eventually breach`);
        assert.equal(core.finalBossDefeated, false);
    }
});

test('a balanced fully trained crew can finish each district, including both rift decisions', () => {
    for (const level of levels) {
        const core = new Core(level, { random: () => 0, startingSouls: 5000 });
        for (let i = 0; i < 4; i++) assert.equal(core.hire(0), true);
        ['lamp', 'lamp', 'coil', 'signal'].forEach((type, slot) => {
            core.crewSlots[slot].type = type;
            core.crewSlots[slot].level = 3;
        });
        core._syncActiveCrew();
        core.start();
        for (let tick = 0; tick < 4000 && ['playing', 'paused'].includes(core.state); tick++) {
            if (core.riftPrompt) {
                core.dawnCharge = 100;
                assert.equal(core.chooseRift('left'), true);
            }
            core.update(0.1);
        }
        assert.equal(core.state, 'won', `${level.id}: a strong mixed crew must be viable`);
        assert.equal(core.riftDecisions.length, 2);
        assert.equal(core.finalBossDefeated, true);
        assert.ok(core.convoy.hp > 0);
    }
});
