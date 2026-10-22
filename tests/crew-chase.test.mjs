import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import vm from 'node:vm';

const root = path.resolve(import.meta.dirname, '..');
const context = vm.createContext({ console });
vm.runInContext('const LOCATION_WIDTH = 1200, LOCATION_HEIGHT = 900;', context);
for (const file of ['TDLevels.js', 'TDCore.js', 'CrewCore.js', 'CrewRifts.js',
    'CrewRoulette.js', 'CrewChase.js'])
    vm.runInContext(fs.readFileSync(path.join(root, 'js', file), 'utf8'), context);
vm.runInContext('this.levels = TD_LEVELS; this.Core = CrewChase;', context);
const { Core, levels } = context;

function newRun() {
    const core = new Core(levels[0], { deck: ['lamp', 'coil', 'signal'], random: () => 0 });
    core.start();
    core.spawnTimer = 1000;
    return core;
}

test('a fork changes the physical street path and the pursuit clock', () => {
    const core = newRun();
    const original = JSON.stringify(core.route.points);
    const destination = core.route.points.at(-1).join(',');
    while (!core.riftPrompt) core.update(0.1);
    const stoppedAt = core.distance;
    const clock = core.chaseTime;
    core.dawnCharge = 100;
    assert.equal(core.chooseRift('left'), true);
    assert.equal(core.state, 'playing');
    assert.notEqual(JSON.stringify(core.route.points), original);
    assert.equal(core.route.points.at(-1).join(','), destination);
    assert.equal(core.distance, stoppedAt, 'switching streets must not teleport the wagon');
    assert.equal(core.chaseTime, clock + 8);
    assert.equal(core.routeChoices[0].choice, 'left');
    assert.ok(core.events.some(event => event.kind === 'chase_route' && event.path.length > 2));
});

test('straight street keeps the route but risks both rifts and time', () => {
    const core = newRun();
    while (!core.riftPrompt) core.update(0.1);
    const original = JSON.stringify(core.route.points);
    const clock = core.chaseTime;
    const souls = core.souls;
    assert.equal(core.chooseRift('both'), true);
    assert.equal(JSON.stringify(core.route.points), original);
    assert.equal(core.openRifts.length, 2);
    assert.equal(core.souls, souls + 30);
    assert.equal(core.chaseTime, clock - 5);
});

test('losing the trail ends the run before the villain can be caught', () => {
    const core = newRun();
    core.chaseTime = 0.05;
    core.update(0.1);
    assert.equal(core.state, 'lost');
    assert.ok(core.events.some(event => event.kind === 'villain_escaped'));
    assert.equal(core.update(0.1), undefined);
    assert.equal(core.state, 'lost');
});

test('all street districts can clear both forks and both reward stops', () => {
    for (const base of levels) {
        const deck = ['lamp', 'coil', 'signal', 'projector'];
        const level = { ...base, deckSize: 4,
            towerPool: ['lamp', 'coil', 'signal', 'projector', 'relay'], defaultDeck: deck };
        const core = new Core(level, { deck, random: () => 0, startingSouls: 5000 });
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
                assert.equal(core.chooseRift(core.routeChoices.length ? 'right' : 'left'), true);
            }
            if (core.roulettePrompt)
                assert.equal(core.chooseRoulette(core.rouletteHistory.length ? 'ability' : 'attack'), true);
            core.update(0.1);
        }
        assert.equal(core.state, 'won', `${base.id} should finish the street chase`);
        assert.equal(core.routeChoices.length, 2);
        assert.equal(core.rouletteHistory.length, 2);
        assert.ok(core.chaseTime > 0);
    }
});
