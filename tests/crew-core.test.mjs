import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import vm from 'node:vm';

const root = path.resolve(import.meta.dirname, '..');
const context = vm.createContext({ console });
for (const file of ['TDLevels.js', 'TDCore.js', 'CrewCore.js'])
    vm.runInContext(fs.readFileSync(path.join(root, 'js', file), 'utf8'), context);
vm.runInContext('this.levels = TD_LEVELS; this.Core = CrewCore;', context);
const { Core, levels } = context;

test('crew begins with 120 souls and two distinct offers from the selected deck', () => {
    const core = new Core(levels[1], { deck: ['lamp', 'coil', 'signal', 'projector'], random: () => 0 });
    assert.equal(core.souls, 120);
    assert.equal(core.hireCost, 45);
    assert.equal(core.crewSlots.length, 6);
    assert.equal(core.towers.length, 0);
    assert.deepEqual([...core.offers], ['lamp', 'coil']);
    assert.ok(core.offers.every(type => core.deck.includes(type)));
    assert.equal(new Set(core.offers).size, 2);
    assert.equal(core.place(levels[1].sites[0].id, 'lamp'), false,
        'crew mode must not allow old fixed-site construction');
    assert.equal(core.placeCard(levels[1].sites[0].id, 0), false);
});

test('the saved hire discount reduces the next hire price by ten souls', () => {
    const core = new Core(levels[1], { random: () => 0,
        modifiers: ['cheap_refresh'] });
    assert.equal(core.hireCost, 35);
    assert.equal(core.hire(0), true);
    assert.equal(core.souls, 85);
    assert.equal(core.hireCost, 47);
    core.souls = 1000;
    for (let i = 1; i < 6; i++) core.hire(0);
    assert.equal(core.hireCost, 107);
});

test('hiring spends souls, fills four active seats before two reserves, and escalates price', () => {
    const core = new Core(levels[0], { random: () => 0 });
    assert.equal(core.hire(0), true);
    assert.equal(core.souls, 75);
    assert.equal(core.hireCost, 57);
    assert.equal(core.hire(1), true);
    assert.equal(core.souls, 18);
    assert.equal(core.hire(0), false, 'a failed hire must not draw a new offer');
    assert.deepEqual([...core.offers], ['lamp', 'coil']);
    core.souls = 1000;
    for (let i = 2; i < 6; i++) assert.equal(core.hire(i % 2), true);
    assert.equal(core.towers.length, 4);
    assert.ok(core.crewSlots.every(Boolean));
    assert.equal(core.hire(0), false, 'all six seats are occupied');
    assert.equal(core.hireCost, 117, 'the price caps so replenishing after a merge remains possible');
    assert.ok(core.events.some(e => e.kind === 'crew_hire'));
});

test('hire events survive the next simulation tick exactly once', () => {
    const core = new Core(levels[0], { random: () => 0 });
    core.hire(0);
    core.start();
    core.update(0.1);
    assert.equal(core.events.filter(e => e.kind === 'crew_hire').length, 1);
    core.update(0.1);
    assert.equal(core.events.filter(e => e.kind === 'crew_hire').length, 0);
});

test('cross-type same-rank merge rolls a deck hero one rank higher and promotes reserve', () => {
    const core = new Core(levels[1], { random: () => 0.99 });
    core.souls = 1000;
    for (let i = 0; i < 6; i++) assert.equal(core.hire(i % 2), true);
    assert.notEqual(core.crewSlots[0].type, core.crewSlots[1].type);
    const reserve = core.crewSlots[4];
    assert.equal(core.mergeCrew(0, 1), true);
    assert.equal(core.crewSlots[1].type, core.deck.at(-1));
    assert.equal(core.crewSlots[1].level, 2);
    assert.equal(core.crewSlots[0], reserve, 'first reserve should occupy the vacated active seat');
    assert.equal(core.crewSlots[4], null);
    assert.equal(core.towers.length, 4);
    assert.ok(core.events.some(e => e.kind === 'crew_promote' && e.fromSlot === 4 && e.toSlot === 0));
    assert.equal(core.mergeCrew(0, 1), false, 'different ranks cannot merge');
    assert.equal(core.hire(0), true, 'a merge frees reserve capacity for another hire');
});

test('rank three is the cap and invalid drag targets leave the crew untouched', () => {
    const core = new Core(levels[0], { random: () => 0 });
    core.souls = 1000;
    for (let i = 0; i < 4; i++) core.hire(0);
    const before = core.crewSlots.slice();
    assert.equal(core.mergeCrew(0, 0), false);
    assert.equal(core.mergeCrew(-1, 1), false);
    assert.equal(core.mergeCrew(0, 5), false);
    assert.equal(core.crewSlots[0], before[0]);
    assert.equal(core.mergeCrew(0, 1), true); // rank 2 at slot 1
    assert.equal(core.mergeCrew(2, 3), true); // rank 2 at slot 3
    assert.equal(core.mergeCrew(1, 3), true); // rank 3 at slot 3
    core.crewSlots[0] = { ...core.crewSlots[3], level: 3 };
    assert.equal(core.mergeCrew(0, 3), false);
});

test('active followers track the moving wagon, attack nearby enemies, and kills pay souls', () => {
    const core = new Core(levels[0], { random: () => 0 });
    core.hire(0); // lamp
    core.start();
    const oldX = core.convoy.x;
    core.enemies.push({ id: 99, type: 'porter', hp: 1000, maxHp: 1000,
        x: oldX + 55, y: core.convoy.y, slow: 0, marked: 0, mode: 'route', routeDistance: 50 });
    core.update(0.1);
    assert.ok(core.convoy.x > oldX);
    assert.ok(Math.hypot(core.crewSlots[0].x - core.convoy.x,
        core.crewSlots[0].y - core.convoy.y) < 40);
    assert.ok(core.enemies.find(e => e.id === 99).hp < 1000);
    assert.ok(core.events.some(e => e.kind === 'shot'));
    const before = core.souls;
    const wounded = { id: 100, type: 'runner', hp: 1, x: 20, y: 20, marked: 0 };
    core.hurt(wounded, 5, 'lamp');
    assert.equal(core.souls, before + 28);
    assert.ok(core.events.some(e => e.kind === 'kill' && e.id === 100));
    assert.equal(core.level.phaseBonus, 0, 'crew economy has no automatic phase grant');
});

test('offers remain usable after repeated hires and mergers', () => {
    const core = new Core(levels[2], { deck: ['lamp', 'coil', 'signal', 'projector'], random: () => 0.4 });
    core.souls = 5000;
    for (let i = 0; i < 6; i++) {
        assert.equal(core.offers.length, 2);
        assert.equal(core.hire(0), true);
    }
    for (let round = 0; round < 4; round++) {
        const sameRank = core.crewSlots.map((hero, slot) => ({ hero, slot }))
            .filter(({ hero }) => hero && hero.level === 1);
        if (sameRank.length < 2) break;
        assert.equal(core.mergeCrew(sameRank[0].slot, sameRank[1].slot), true);
        assert.equal(core.hire(1), true);
        assert.ok(core.offers.every(type => core.deck.includes(type)));
    }
    assert.ok(core.towers.every(hero => core.crewSlots.includes(hero)));
    assert.ok(core.souls >= 0);
});
