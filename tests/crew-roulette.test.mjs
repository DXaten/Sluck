import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import vm from 'node:vm';

const root = path.resolve(import.meta.dirname, '..');
const context = vm.createContext({ console });
vm.runInContext('const LOCATION_WIDTH = 1200, LOCATION_HEIGHT = 900;', context);
for (const file of ['TDLevels.js', 'TDCore.js', 'CrewCore.js', 'CrewRifts.js', 'CrewRoulette.js'])
    vm.runInContext(fs.readFileSync(path.join(root, 'js', file), 'utf8'), context);
vm.runInContext('this.levels = TD_LEVELS; this.Core = CrewRoulette;', context);
const { Core, levels } = context;
const deck = ['lamp', 'coil', 'signal', 'projector'];

function newRun(random = () => 0.99) {
    const core = new Core(levels[1], { deck, random });
    assert.equal(core.start(), true);
    core.spawnTimer = 1000;
    return core;
}

function defeatMiniboss(core, id = 100) {
    const enemy = { id, type: 'porter', boss: 'miniboss', hp: 1, maxHp: 1,
        x: core.convoy.x + 100, y: core.convoy.y, marked: 0, slow: 0 };
    core.hurt(enemy, 1, 'lamp');
    assert.equal(enemy.hp, 0);
    return enemy;
}

test('a miniboss pauses the chase for three distinct rewards and choice is final', () => {
    const core = newRun();
    defeatMiniboss(core);
    const prompt = core.roulettePrompt;
    assert.equal(core.state, 'paused');
    assert.equal(prompt.round, 1);
    assert.deepEqual([...prompt.choices.map(choice => choice.id)], ['hero', 'attack', 'ability']);
    assert.equal(prompt.choices[0].heroType, 'projector', 'hero comes from the selected deck');
    assert.equal(core.chooseRoulette('unknown'), false);
    const before = core.time;
    core.update(0.1);
    assert.equal(core.time, before, 'the convoy and enemies must freeze while the wheel is open');
    assert.equal(core.events.filter(event => event.kind === 'roulette_prompt').length, 1);
    assert.equal(core.chooseRoulette('attack'), true);
    assert.equal(core.state, 'playing');
    assert.equal(core.roulettePrompt, null);
    assert.equal(core.attackMultiplier, 1.25);
    assert.equal(core.chooseRoulette('hero'), false, 'one miniboss cannot pay twice');
    assert.equal(core.rouletteHistory.length, 1);
    core.update(0.1);
    assert.equal(core.events.filter(event => event.kind === 'roulette_choice').length, 1);
    core.update(0.1);
    assert.equal(core.events.filter(event => event.kind === 'roulette_choice').length, 0);
});

test('hero reward is free, enters a crew seat, and waits safely if all six are full', () => {
    const core = newRun();
    defeatMiniboss(core);
    const soulsAfterBounty = core.souls;
    assert.equal(core.chooseRoulette('hero'), true);
    assert.equal(core.souls, soulsAfterBounty, 'the free hero spends no souls');
    assert.equal(core.crewSlots[0].type, 'projector');
    assert.equal(core.crewSlots[0].level, 1);
    assert.equal(core.towers.length, 1);
    assert.ok(core.events.some(event => event.kind === 'crew_hire' && event.cost === 0));

    core.souls = 5000;
    for (let i = 1; i < 6; i++) assert.equal(core.hire(0), true);
    assert.ok(core.crewSlots.every(Boolean));
    defeatMiniboss(core, 101);
    assert.equal(core.chooseRoulette('hero'), true);
    assert.equal(core.pendingHeroes.length, 1);
    assert.ok(core.crewSlots.every(Boolean), 'a full crew is never overwritten');
    assert.equal(core.mergeCrew(0, 1), true);
    assert.equal(core.pendingHeroes.length, 0);
    assert.ok(core.crewSlots.every(Boolean), 'the waiting hero takes the next freed seat');
    assert.equal(core.crewSlots[4].type, 'projector');
});

test('attack reward increases hero damage for the run but not Dawn pulse damage', () => {
    const core = newRun();
    defeatMiniboss(core);
    assert.equal(core.chooseRoulette('attack'), true);
    const runner = { id: 201, type: 'runner', hp: 1000, maxHp: 1000, marked: 0 };
    core.hurt(runner, 10, 'lamp');
    assert.equal(1000 - runner.hp, 10 * core.attackMultiplier *
        (1.8 + 0.3 * (levels[1].difficulty - 1)));
    const pulseTarget = { id: 202, type: 'runner', hp: 1000, maxHp: 1000, marked: 0 };
    core.hurt(pulseTarget, 10, 'dawn');
    assert.equal(1000 - pulseTarget.hp, 10, 'a crew attack bonus must not multiply Dawn abilities');
    defeatMiniboss(core, 102);
    assert.equal(core.chooseRoulette('attack'), true);
    assert.equal(core.attackMultiplier, 1.5, 'the second miniboss may increase the level-long bonus');
});

test('one-use ward prevents the next street breach, including a lethal one', () => {
    const core = newRun();
    defeatMiniboss(core);
    assert.equal(core.chooseRoulette('ability'), true);
    assert.equal(core.wardCharges, 1);
    core.convoy.hp = 1;
    core.enemies = [{ id: 300, type: 'runner', hp: 10, maxHp: 10,
        x: core.convoy.x, y: core.convoy.y, speed: 0, slow: 0, marked: 0,
        routeDistance: 0, mode: 'route' }];
    core.update(0.1);
    assert.equal(core.state, 'playing', 'the ward should reverse a normal lethal breach');
    assert.equal(core.convoy.hp, 1);
    assert.equal(core.wardCharges, 0);
    assert.ok(core.events.some(event => event.kind === 'roulette_ward' && event.blocked === 1));
    assert.equal(core.events.some(event => event.kind === 'lost'), false);
    core.convoy.hp = 2;
    core.enemies = [{ id: 301, type: 'runner', hp: 10, maxHp: 10,
        x: core.convoy.x, y: core.convoy.y, speed: 0, slow: 0, marked: 0,
        routeDistance: 0, mode: 'route' }];
    core.update(0.1);
    assert.equal(core.convoy.hp, 1, 'the ward is spent after a single dangerous moment');
    assert.equal(core.events.some(event => event.kind === 'roulette_ward'), false);
});

test('simultaneous miniboss victories queue separate choices without replay', () => {
    const core = newRun(() => 0);
    defeatMiniboss(core, 401);
    defeatMiniboss(core, 402);
    assert.equal(core.roulettePrompt.round, 1);
    assert.equal(core.rouletteQueue.length, 1);
    assert.equal(core.chooseRoulette('attack'), true);
    assert.equal(core.state, 'paused');
    assert.equal(core.roulettePrompt.round, 2);
    assert.equal(core.chooseRoulette('ability'), true);
    assert.equal(core.state, 'playing');
    assert.equal(core.rouletteHistory.length, 2);
    assert.equal(core.wardCharges, 1);
    assert.equal(core.chooseRoulette('hero'), false);
    assert.equal(core.rouletteQueue.length, 0);
});

test('both roulette stops resolve during an ordinary full street chase', () => {
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
            if (core.roulettePrompt)
                assert.equal(core.chooseRoulette(core.rouletteHistory.length ? 'ability' : 'attack'), true);
            core.update(0.1);
        }
        assert.equal(core.state, 'won', `${level.id}: the reward pause must not deadlock the chase`);
        assert.equal(core.rouletteHistory.length, 2, `${level.id}: both minibosses should pay once`);
        assert.equal(core.attackMultiplier, 1.25);
        assert.equal(core.wardCharges, 1);
    }
});
