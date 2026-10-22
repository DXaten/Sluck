import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import vm from 'node:vm';

const root = path.resolve(import.meta.dirname, '..');
const context = vm.createContext({ console });
vm.runInContext(fs.readFileSync(path.join(root, 'js/TDLevels.js'), 'utf8') + '\nthis.levels = TD_LEVELS;', context);
vm.runInContext(fs.readFileSync(path.join(root, 'js/TDCore.js'), 'utf8') + '\nthis.Core = TDCore;', context);
const { Core, levels } = context;

function run(core, policy = () => {}) {
    core.start();
    for (let tick = 0; tick < 3000 && core.state === 'playing'; tick++) {
        policy(core, tick);
        core.update(0.1);
    }
    return core;
}

function buildInOrder(types) {
    let next = 0;
    return (core, tick) => {
        if (tick % 10 !== 0) return;
        while (next < core.level.sites.length && core.credits >= Core.TOWERS[types[next]].cost) {
            assert.equal(core.place(core.level.sites[next].id, types[next]), true);
            next++;
        }
    };
}

function buildAndTrainLamps() {
    let next = 0;
    return (core, tick) => {
        if (tick % 10 !== 0) return;
        while (next < core.level.sites.length && core.credits >= Core.TOWERS.lamp.cost) {
            assert.equal(core.place(core.level.sites[next].id, 'lamp'), true);
            next++;
        }
        const price = core.typeUpgradeCost('lamp');
        if (price !== null && core.credits >= price) assert.equal(core.upgradeType('lamp'), true);
    };
}

test('encounters escalate, lamp spam fails, and several mixed defenses finish the route', () => {
    assert.equal(run(new Core(levels[0])).state, 'lost');
    const enemyCounts = [];
    for (const level of levels) {
        const lamps = run(new Core(level), buildInOrder(level.sites.map(() => 'lamp')));
        assert.equal(lamps.state, 'lost', `${level.id}: lamp spam must lose`);
        const trainedLamps = run(new Core(level), buildAndTrainLamps());
        assert.equal(trainedLamps.state, 'lost',
            `${level.id}: cheaper global training must not make a one-tower strategy sufficient`);

        const pattern = level.sites.map((_, i) => ['lamp', 'coil', 'signal'][i % 3]);
        const mixed = run(new Core(level), buildInOrder(pattern));
        assert.equal(mixed.state, 'won', `${level.id}: mixed towers should win`);
        assert.ok(mixed.convoy.hp > 0);
        assert.ok(mixed.score > 0);
        enemyCounts.push(mixed.spawnCount);

        const alternative = level.sites.map((_, i) => ['signal', 'coil', 'lamp'][i % 3]);
        assert.equal(run(new Core(level), buildInOrder(alternative)).state, 'won',
            `${level.id}: a different tower order should also work`);

        if (level.difficulty > 1) {
            const noCoil = level.sites.map((_, i) => ['lamp', 'signal'][i % 2]);
            assert.equal(run(new Core(level), buildInOrder(noCoil)).state, 'lost',
                `${level.id}: moth packs should require crowd control`);
        }
    }
    assert.ok(enemyCounts[0] < enemyCounts[1] && enemyCounts[1] < enemyCounts[2],
        'each level should spawn more enemies');
});

test('moth pressure rises after the first district teaches chain attacks', () => {
    const theater = new Core(levels[0]);
    theater.phaseSpawnCount = 1;
    theater.spawnEnemy();
    assert.equal(theater.enemies.length, 1, 'first phase introduces one moth at a time');

    theater.phase = 2;
    theater.phaseSpawnCount = 0;
    theater.spawnEnemy();
    assert.equal(theater.enemies.length, 3, 'second phase sends a pair');

    const waterfront = new Core(levels[2]);
    waterfront.phase = 2;
    waterfront.phaseSpawnCount = 2;
    waterfront.spawnEnemy();
    assert.equal(waterfront.enemies.length, 3, 'last district sends a larger pack');
});

test('moth packs share an alley and can be cleared by one chain attack', () => {
    const core = new Core(levels[1]);
    core.phaseSpawnCount = 2; // The third first-phase group is a moth pack.
    core.spawnEnemy();
    assert.equal(core.enemies.length, 2);
    assert.equal(core.spawnCount, 2);
    assert.equal(core.spawnGroupCount, 1);
    assert.equal(core.enemies[0].spawnIndex, core.enemies[1].spawnIndex);
    assert.ok(core.enemies[0].x !== core.enemies[1].x || core.enemies[0].y !== core.enemies[1].y);
    const [x, y] = levels[1].spawns[0];
    assert.equal(core.fire({ type: 'coil', level: 1, x, y }), true);
    assert.equal(core.enemies.filter(e => e.hp > 0).length, 0);
    assert.equal(core.events.at(-1).targets.length, 2);
});

test('tower roles have distinct targeting, damage, and status effects', () => {
    const core = new Core(levels[0]);
    core.convoy.x = 0; core.convoy.y = 0;
    const enemy = (id, type, x) => ({ id, type, x, y: 0, hp: 300, maxHp: 300, marked: 0, slow: 0 });
    const porter = enemy(1, 'porter', 40);
    const moth = enemy(2, 'moth', 70);
    const wraith = enemy(3, 'wraith', 100);
    core.enemies = [porter, moth, wraith];

    assert.equal(core.fire({ type: 'lamp', level: 1, x: 0, y: 0 }), true);
    assert.ok(porter.hp < 300, 'lamp should damage its single armored target');
    assert.equal(moth.hp, 300);
    assert.equal(wraith.hp, 300);
    assert.equal(core.events.at(-1).targets.length, 1);

    assert.equal(core.fire({ type: 'coil', level: 1, x: 0, y: 0 }), true);
    assert.ok(moth.hp < 300, 'coil should chain from the first target into a swarm');
    assert.ok(wraith.hp < 300, 'a veiled spirit should still take some damage');
    const veiledDamage = 300 - wraith.hp;
    assert.equal(core.events.at(-1).targets.length, 3);

    assert.equal(core.fire({ type: 'signal', level: 1, x: 0, y: 0 }), true);
    assert.ok(core.enemies.every(e => e.slow > 0 && e.marked > 0),
        'signal should mark and slow everything in its area');
    assert.ok(wraith.hp < 300 - veiledDamage, 'signal should directly damage a spirit');
    assert.equal(core.events.at(-1).targets.length, 3);

    const before = wraith.hp;
    core.enemies = [wraith];
    assert.equal(core.fire({ type: 'coil', level: 1, x: 0, y: 0 }), true);
    assert.ok(before - wraith.hp > veiledDamage,
        'revealing a spirit should increase the damage from another tower');
    const beforeLamp = wraith.hp;
    assert.equal(core.fire({ type: 'lamp', level: 1, x: 0, y: 0 }), true);
    assert.ok(wraith.hp < beforeLamp, 'a marked spirit should become vulnerable to lamp shots');
});

test('lamp hits armor hardest, coil disperses swarms, and signal strips the veil', () => {
    function shotDamage(towerType, enemyType) {
        const core = new Core(levels[0]);
        core.enemies = [{ id: 1, type: enemyType, x: 20, y: 0,
            hp: 1000, maxHp: 1000, marked: 0, slow: 0 }];
        core.convoy.x = 0; core.convoy.y = 0;
        assert.equal(core.fire({ type: towerType, level: 1, x: 0, y: 0 }), true);
        return 1000 - core.enemies[0].hp;
    }
    assert.ok(shotDamage('lamp', 'porter') > shotDamage('coil', 'porter') * 3);
    assert.ok(shotDamage('coil', 'moth') > shotDamage('lamp', 'moth') * 8);
    assert.ok(shotDamage('signal', 'wraith') > shotDamage('lamp', 'wraith') * 2);
    assert.ok(shotDamage('projector', 'runner') > shotDamage('lamp', 'runner'));
    assert.ok(shotDamage('projector', 'porter') < shotDamage('lamp', 'porter'));
    assert.ok(shotDamage('projector', 'moth') < shotDamage('coil', 'moth'));
});

test('new tower cards unlock by district and a deck has distinct allowed types', () => {
    assert.equal(Core.validateDeck(levels[0], ['lamp', 'coil', 'signal']), true);
    assert.equal(Core.validateDeck(levels[0], ['lamp', 'coil', 'projector']), false);
    assert.equal(Core.validateDeck(levels[1], ['lamp', 'coil', 'signal', 'projector']), true);
    assert.equal(Core.validateDeck(levels[1], ['lamp', 'coil', 'signal', 'relay']), false);
    assert.equal(Core.validateDeck(levels[2], ['lamp', 'coil', 'projector', 'relay']), true);
    assert.equal(Core.validateDeck(levels[2], ['lamp', 'coil', 'coil', 'relay']), false);
    assert.equal(Core.validateDeck(levels[2], ['lamp', 'coil', 'relay']), false);

    const fallback = new Core(levels[2], { deck: ['lamp', 'coil', 'coil', 'relay'], random: () => 0 });
    assert.deepEqual([...fallback.deck], [...levels[2].defaultDeck], 'a stale saved deck falls back safely');
});

test('a three-card hand draws through the shuffled deck and failed builds keep the card', () => {
    const core = new Core(levels[1], { random: () => 0 });
    const firstHand = [...core.hand];
    assert.equal(new Set(firstHand).size, 3);
    const missing = core.deck.find(type => !firstHand.includes(type));
    const site = levels[1].sites[0].id;
    const cost = Core.TOWERS[firstHand[0]].cost;

    assert.equal(core.placeCard(site, 0), true);
    assert.equal(core.getTower(site).type, firstHand[0]);
    assert.equal(core.credits, levels[1].credits - cost);
    assert.equal(core.hand[0], missing, 'the fourth card arrives next, without a repeated draw');
    assert.ok(core.events.some(e => e.kind === 'draw' && e.handIndex === 0));

    const hand = [...core.hand], credits = core.credits;
    assert.equal(core.placeCard(site, 1), false, 'the occupied site rejects a card');
    assert.equal(core.placeCard(levels[1].sites[1].id, 9), false);
    assert.deepEqual([...core.hand], hand);
    assert.equal(core.credits, credits);
});

test('paid hand refresh changes available choices and is disabled when all three are visible', () => {
    const tutorial = new Core(levels[0], { random: () => 0 });
    const tutorialCredits = tutorial.credits;
    assert.equal(tutorial.refreshHand(), false);
    assert.equal(tutorial.credits, tutorialCredits);

    const core = new Core(levels[2], { random: () => 0 });
    const before = [...core.hand], omitted = core.deck.find(type => !before.includes(type));
    const credits = core.credits;
    assert.equal(core.refreshHand(), true);
    assert.equal(core.credits, credits - core.refreshCost);
    assert.ok(core.hand.includes(omitted), 'refresh should reveal the previously missing type');
    assert.equal(core.hand.length, 3);
    assert.equal(new Set(core.hand).size, 3);
    assert.ok(core.events.some(e => e.kind === 'refresh' && e.cost === core.refreshCost));
});

test('equal-rank towers merge into a random deck tower on one site and free the other', () => {
    const core = new Core(levels[2], { random: () => 0 });
    assert.equal(core.place('w1', 'lamp'), true);
    assert.equal(core.place('w2', 'coil'), true);
    const credits = core.credits, hand = [...core.hand];
    assert.equal(core.merge('w1', 'w2'), true);
    assert.equal(core.getTower('w1'), null);
    assert.equal(core.getTower('w2').level, 2);
    assert.ok(core.deck.includes(core.getTower('w2').type));
    assert.equal(core.credits, credits, 'merge uses two towers, not coins');
    assert.deepEqual([...core.hand], hand, 'merge does not consume a hand card');
    assert.ok(core.events.some(e => e.kind === 'merge' && e.sourceSiteId === 'w1' && e.targetSiteId === 'w2'));

    assert.equal(core.place('w1', 'lamp'), true, 'the freed site can be reused');
    assert.equal(core.merge('w1', 'w2'), false, 'different ranks cannot merge');
    assert.equal(core.upgrade('w1'), true);
    assert.equal(core.merge('w1', 'w2'), true);
    assert.equal(core.getTower('w2').level, 3);
    assert.equal(core.merge('w2', 'w2'), false);
});

test('a merged tower keeps the deck-wide rank of its random resulting type', () => {
    const core = new Core({ ...levels[2], credits: 1000 }, { random: () => 0 });
    assert.equal(core.place('w1', 'coil'), true);
    assert.equal(core.place('w2', 'signal'), true);
    assert.equal(core.upgradeType('lamp'), true);
    assert.equal(core.upgradeType('lamp'), true);
    assert.equal(core.typeRanks.lamp, 3);
    assert.equal(core.getTower('w1').level, 1);
    assert.equal(core.getTower('w2').level, 1);

    assert.equal(core.merge('w1', 'w2'), true);
    assert.equal(core.getTower('w1'), null);
    assert.equal(core.getTower('w2').type, 'lamp');
    assert.equal(core.getTower('w2').level, 3,
        'a newly merged lamp must not lose its global training');
    assert.ok(core.events.some(e => e.kind === 'merge' && e.level === 3));
});

test('projector prioritizes a runner; relay strengthens nearby shots without stacking', () => {
    const core = new Core(levels[2]);
    const runner = { id: 1, type: 'runner', x: 100, y: 0, hp: 500, maxHp: 500, marked: 0, slow: 0 };
    const porter = { id: 2, type: 'porter', x: 40, y: 0, hp: 500, maxHp: 500, marked: 0, slow: 0 };
    core.enemies = [porter, runner];
    core.convoy.x = 0; core.convoy.y = 0;
    assert.equal(core.fire({ type: 'projector', level: 1, x: 0, y: 0 }), true);
    assert.ok(runner.hp < 500);
    assert.equal(porter.hp, 500, 'a closer armored enemy should not distract the projector');

    const lamp = { siteId: 'w1', type: 'lamp', level: 1, cooldown: 0, x: 0, y: 0 };
    const relay = { siteId: 'w2', type: 'relay', level: 1, cooldown: 0, x: 200, y: 0 };
    core.enemies = [porter];
    core.towers = [lamp];
    assert.equal(core.fire(lamp), true);
    const normalDamage = 500 - porter.hp;
    porter.hp = 500;
    core.towers.push(relay);
    assert.equal(core.fire(lamp), true);
    const boostedDamage = 500 - porter.hp;
    assert.ok(boostedDamage > normalDamage);
    const afterShot = porter.hp;
    assert.equal(core.fire(relay), false);
    assert.equal(porter.hp, afterShot, 'relay is support, not another attack tower');

    porter.hp = 500;
    core.towers.push({ ...relay, siteId: 'w3', x: 220 });
    core.fire(lamp);
    assert.equal(500 - porter.hp, boostedDamage, 'two equal relays do not stack');
});

test('mixed decks with the unlocked towers can defend later beacons', () => {
    const station = new Core(levels[1]);
    const stationTypes = ['lamp', 'coil', 'signal', 'projector', 'coil', 'signal', 'lamp'];
    assert.equal(run(station, buildInOrder(stationTypes)).state, 'won');

    const waterfront = new Core(levels[2]);
    const waterfrontTypes = ['lamp', 'coil', 'signal', 'relay', 'coil', 'signal', 'lamp', 'coil'];
    assert.equal(run(waterfront, buildInOrder(waterfrontTypes)).state, 'won');
});

test('lamp_focus, coil_fork and signal_echo change their actual attack effects', () => {
    function lampDamage(modifiers) {
        const core = new Core(levels[0], { modifiers });
        const enemy = { id: 1, type: 'porter', x: 20, y: 0, hp: 1000, maxHp: 1000, marked: 0, slow: 0 };
        core.enemies = [enemy];
        core.fire({ type: 'lamp', level: 1, x: 0, y: 0 });
        return 1000 - enemy.hp;
    }
    const baseDamage = lampDamage([]);
    assert.ok(Math.abs(lampDamage(['lamp_focus']) / baseDamage - 1.2) < 1e-9);
    assert.ok(Math.abs(lampDamage(['lamp_focus', 'lamp_focus']) / baseDamage - 1.2) < 1e-9,
        'duplicate unlocks must not stack');

    function chainTargets(modifiers) {
        const core = new Core(levels[1], { modifiers });
        core.convoy.x = 0; core.convoy.y = 0;
        core.enemies = [10, 30, 50, 70, 90].map((x, i) => ({
            id: i + 1, type: 'moth', x, y: 0, hp: 1000, maxHp: 1000, marked: 0, slow: 0
        }));
        core.fire({ type: 'coil', level: 1, x: 0, y: 0 });
        return core.events.at(-1).targets.length;
    }
    assert.equal(chainTargets([]), 4);
    assert.equal(chainTargets(['coil_fork']), 5);

    function signalStatus(modifiers) {
        const core = new Core(levels[1], { modifiers });
        const enemy = { id: 1, type: 'wraith', x: 20, y: 0, hp: 1000, maxHp: 1000, marked: 0, slow: 0 };
        core.enemies = [enemy];
        core.fire({ type: 'signal', level: 1, x: 0, y: 0 });
        return { mark: enemy.marked, slow: enemy.slow };
    }
    const normal = signalStatus([]), echoed = signalStatus(['signal_echo']);
    assert.ok(Math.abs(echoed.mark - normal.mark - 0.7) < 1e-9);
    assert.ok(Math.abs(echoed.slow - normal.slow - 0.7) < 1e-9);
});

test('projector_lens extends only projector reach; relay_circuit extends only support aura', () => {
    const enemy = () => ({ id: 1, type: 'runner', x: 265, y: 0,
        hp: 1000, maxHp: 1000, marked: 0, slow: 0 });
    const plain = new Core(levels[2]);
    plain.enemies = [enemy()];
    assert.equal(plain.fire({ type: 'projector', level: 1, x: 0, y: 0 }), false);
    const lens = new Core(levels[2], { modifiers: ['projector_lens'] });
    lens.enemies = [enemy()];
    assert.equal(lens.fire({ type: 'projector', level: 1, x: 0, y: 0 }), true);
    assert.ok(lens.enemies[0].hp < 1000);

    function lampWithRelay(modifiers) {
        const core = new Core(levels[2], { modifiers });
        const target = { id: 1, type: 'porter', x: 20, y: 0,
            hp: 1000, maxHp: 1000, marked: 0, slow: 0 };
        const lamp = { siteId: 'a', type: 'lamp', level: 1, x: 0, y: 0 };
        const relay = { siteId: 'b', type: 'relay', level: 1, x: 300, y: 0 };
        core.enemies = [target];
        core.towers = [lamp, relay];
        assert.equal(core.fire(relay), false, 'aura range must not become an attack range');
        core.fire(lamp);
        return 1000 - target.hp;
    }
    assert.ok(lampWithRelay(['relay_circuit']) > lampWithRelay([]));
    assert.equal(lampWithRelay(['projector_lens']), lampWithRelay([]),
        'the projector lens must not extend a relay aura');
});

test('cheap_refresh changes the actual paid hand refresh from 40 to 25 credits', () => {
    const plain = new Core(levels[2], { random: () => 0 });
    const cheap = new Core(levels[2], { random: () => 0, modifiers: ['cheap_refresh', 'unknown'] });
    assert.equal(plain.refreshCost, 40);
    assert.equal(cheap.refreshCost, 25);
    assert.deepEqual([...cheap.modifiers], ['cheap_refresh']);
    assert.equal(plain.refreshHand(), true);
    assert.equal(cheap.refreshHand(), true);
    assert.equal(levels[2].credits - plain.credits, 40);
    assert.equal(levels[2].credits - cheap.credits, 25);
});

test('enemies stay on rendered alleys and convoy streets', () => {
    for (const level of levels) {
        const core = new Core({ ...level, hp: 9999 });
        core.start();
        let sawAlley = false, sawStreet = false;
        for (let tick = 0; tick < 400; tick++) {
            core.update(0.1);
            for (const enemy of core.enemies) {
                if (enemy.mode === 'alley') {
                    sawAlley = true;
                    const spawn = level.spawns[enemy.spawnIndex];
                    const alley = Core.route([spawn, [enemy.entry.x, enemy.entry.y]]);
                    const nearest = Core.projectOnRoute(alley, enemy.x, enemy.y);
                    assert.ok(Math.hypot(enemy.x - nearest.x, enemy.y - nearest.y) < 1e-5,
                        `${level.id}: enemy left its alley`);
                } else {
                    sawStreet = true;
                    const expected = Core.pointAt(core.route, enemy.routeDistance);
                    assert.ok(Math.hypot(enemy.x - expected.x, enemy.y - expected.y) < 1e-5,
                        `${level.id}: enemy left the street route`);
                }
            }
        }
        assert.ok(sawAlley && sawStreet, `${level.id}: both route segments should be exercised`);
    }
});

test('district phase transitions pay one resupply bonus', () => {
    const core = new Core(levels[0]);
    const initialCredits = core.credits;
    core.distance = core.route.total / 3 - 0.5;
    core.start();
    core.update(0.1);
    assert.equal(core.phase, 2);
    assert.equal(core.credits, initialCredits + levels[0].phaseBonus);
    assert.ok(core.events.some(e => e.kind === 'phase' && e.phase === 2 && e.bonus === levels[0].phaseBonus));
    core.update(0.1);
    assert.equal(core.credits, initialCredits + levels[0].phaseBonus);
});

test('arrival gives six seconds to prepare, then a horde travels from the route start', () => {
    for (const level of levels) {
        const core = new Core({ ...level, hp: 9999 });
        core.distance = core.route.total - 1;
        core.start();
        core.update(0.1);

        assert.equal(core.state, 'playing', `${level.id}: arrival is not victory`);
        assert.equal(core.distance, core.route.total);
        assert.equal(core.phase, 3);
        assert.equal(core.beaconActive, true);
        assert.equal(core.beaconPrep, 6);
        assert.equal(core.beaconHoldSeconds, 25);
        assert.equal(core.beaconHold, 25);
        assert.equal(core.events.filter(e => e.kind === 'beacon_prep').length, 1);
        const initialSpawns = core.spawnCount;
        const endpoint = { x: core.convoy.x, y: core.convoy.y };

        core.setPaused(true);
        core.update(0.1);
        assert.equal(core.beaconPrep, 6, 'pausing freezes preparation');
        assert.equal(core.beaconHold, 25, 'pausing freezes the defense timer');
        core.setPaused(false);
        for (let tick = 0; tick < 59; tick++) core.update(0.1);
        assert.equal(core.spawnCount, initialSpawns, `${level.id}: no wave during preparation`);
        assert.equal(core.beaconHold, 25);
        for (let tick = 0; tick < 3 && !core.beaconWaveStarted; tick++) core.update(0.1);
        assert.equal(core.beaconWaveStarted, true);
        assert.ok(core.events.some(e => e.kind === 'beacon_wave'));
        const horde = core.enemies.filter(e => e.beaconWave);
        assert.equal(horde.length, level.beaconWavePattern.length);
        assert.ok(horde.every(e => e.mode === 'route' && e.spawnIndex === -1));
        assert.ok(horde.every(e => e.routeDistance < 30), `${level.id}: horde begins at the street start`);
        assert.ok(core.spawnCount > initialSpawns);
        for (let tick = 0; tick < 249; tick++) core.update(0.1);
        assert.equal(core.state, 'playing', `${level.id}: the beacon cannot light early`);
        assert.ok(core.beaconHold > 0 && core.beaconHold < 0.2);
        assert.equal(core.distance, core.route.total, `${level.id}: convoy stays parked`);
        assert.deepEqual({ x: core.convoy.x, y: core.convoy.y }, endpoint);

        core.update(0.1);
        assert.equal(core.state, 'won', `${level.id}: beacon lights after survival`);
        assert.equal(core.beaconHold, 0);
        assert.ok(core.events.some(e => e.kind === 'won'));
    }
});

test('a final breach defeats the caravan even when the beacon timer expires', () => {
    const core = new Core({ ...levels[0], hp: 1 });
    core.distance = core.route.total - 1;
    core.start();
    core.update(0.1);
    core.beaconPrep = 0;
    core.beaconWaveStarted = true;
    core.beaconHold = 0.05;
    core.spawnBeaconWave();
    const enemy = core.enemies[0];
    enemy.x = core.convoy.x;
    enemy.y = core.convoy.y;

    core.update(0.1);
    assert.equal(core.state, 'lost');
    assert.ok(core.events.some(e => e.kind === 'lost'));
    assert.ok(!core.events.some(e => e.kind === 'won'));
});

test('building, upgrades and pausing respect resources and state', () => {
    const core = new Core(levels[0]);
    const site = levels[0].sites[0].id;
    assert.equal(core.place(site, 'lamp'), true);
    assert.equal(core.place(site, 'lamp'), false);
    assert.equal(core.credits, levels[0].credits - Core.TOWERS.lamp.cost);
    assert.equal(core.upgrade(site), true);
    assert.equal(core.getTower(site).level, 2);
    core.start();
    core.setPaused(true);
    const before = core.distance;
    core.update(0.1);
    assert.equal(core.distance, before);
    core.setPaused(false);
    core.update(0.1);
    assert.ok(core.distance > before);
    assert.equal(core.sell(site), true);
    assert.equal(core.getTower(site), null);
});

test('a type upgrade raises existing and future towers of that type from the bottom deck', () => {
    const core = new Core({ ...levels[0], credits: 1000 });
    const [first, second, third] = levels[0].sites;
    assert.equal(core.place(first.id, 'lamp'), true);
    assert.equal(core.place(second.id, 'coil'), true);
    const price = core.typeUpgradeCost('lamp');
    assert.equal(price, Math.round(Core.TOWERS.lamp.cost * 0.8));
    const before = core.credits;
    assert.equal(core.upgradeType('lamp'), true);
    assert.equal(core.credits, before - price);
    assert.equal(core.typeRanks.lamp, 2);
    assert.equal(core.getTower(first.id).level, 2);
    assert.equal(core.getTower(second.id).level, 1);
    assert.equal(core.place(third.id, 'lamp'), true);
    assert.equal(core.getTower(third.id).level, 2);
    assert.equal(core.typeUpgradeCost('lamp'), Math.round(Core.TOWERS.lamp.cost * 1.2));
    assert.equal(core.upgradeType('lamp'), true);
    assert.equal(core.typeRanks.lamp, 3);
    assert.equal(core.upgradeType('lamp'), false);
    assert.equal(core.typeUpgradeCost('lamp'), null);
});

test('deck-wide training costs less than two extra towers, leaving build and merge choices viable', () => {
    for (const [type, spec] of Object.entries(Core.TOWERS)) {
        const deck = levels[2].defaultDeck.includes(type) ? levels[2].defaultDeck :
            ['lamp', 'coil', 'signal', 'projector'];
        const core = new Core({ ...levels[2], credits: 1000 },
            { deck });
        assert.ok(core.deck.includes(type));
        const first = core.typeUpgradeCost(type);
        assert.ok(first > 0 && first < spec.cost, `${type}: first upgrade should be affordable`);
        assert.equal(core.upgradeType(type), true);
        const second = core.typeUpgradeCost(type);
        assert.ok(second > first && second < spec.cost * 1.5,
            `${type}: second upgrade should be attainable during one district`);
    }
});

test('the convoy lights street lanterns and spends their charge on a route-wide cleansing pulse', () => {
    const core = new Core(levels[0]);
    core.start();
    for (let index = 0; index < 3; index++) {
        core.distance = core.lanterns[index].distance - 1;
        core.update(0.1);
        assert.equal(core.litLanterns, index + 1);
        assert.equal(core.dawnCharge, (index + 1) * 20);
        assert.ok(core.events.some(e => e.kind === 'lantern_lit' && e.index === index));
    }
    const lamp = core.lanterns[0];
    assert.equal(core.dawnMultiplier({ x: lamp.x, y: lamp.y }), 1.15);
    assert.equal(core.dawnMultiplier({ x: -1000, y: -1000 }), 1);
    core.spawnBeaconWave();
    const target = core.enemies.find(enemy => enemy.beaconWave);
    const before = target.hp;
    assert.equal(core.useDawnPulse(), true);
    assert.equal(core.dawnCharge, 10);
    assert.equal(target.hp, before - 55);
    assert.ok(target.marked >= 5 && target.slow >= 4);
    assert.ok(core.events.some(e => e.kind === 'dawn_pulse' && e.affected > 0));
    assert.equal(core.useDawnPulse(), false);
});
