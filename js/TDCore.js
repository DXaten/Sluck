// Pure tower-defense simulation. Coordinates and decisions never depend on Babylon.
class TDCore {
    constructor(level, options = {}) {
        this.level = level;
        this.route = TDCore.route(level.path);
        this.lanterns = TDCore.DAWN.fractions.map(fraction => {
            const distance = this.route.total * fraction;
            return { ...TDCore.pointAt(this.route, distance), distance, lit: false };
        });
        this.litLanterns = 0;
        this.dawnCharge = 0;
        this.state = 'ready';
        this.time = 0;
        this.distance = 0;
        this.convoy = { x: level.path[0][0], y: level.path[0][1], hp: level.hp, maxHp: level.hp };
        this.credits = level.credits;
        this.score = 0;
        this.phase = 1;
        this.beaconHoldSeconds = level.beaconHoldSeconds || 25;
        this.beaconHold = this.beaconHoldSeconds;
        this.beaconPrepSeconds = level.beaconPrepSeconds || 6;
        this.beaconPrep = 0;
        this.beaconActive = false;
        this.beaconWaveStarted = false;
        this.spawnTimer = 0;
        this.spawnCount = 0;
        this.spawnGroupCount = 0;
        this.phaseSpawnCount = 0;
        this.nextEnemyId = 1;
        this.enemies = [];
        this.towers = [];
        this.events = [];
        this.options = options;
        this.modifiers = [...new Set(Array.isArray(options.modifiers) ? options.modifiers : [])]
            .filter(id => TDCore.MODIFIER_IDS.includes(id));
        this.random = typeof options.random === 'function' ? options.random : Math.random;
        const fallbackDeck = level.defaultDeck || (level.towerPool || ['lamp', 'coil', 'signal']).slice(0, level.deckSize || 3);
        this.deck = (TDCore.validateDeck(level, options.deck) ? options.deck : fallbackDeck).slice();
        this.typeRanks = Object.fromEntries(this.deck.map(type => [type, 1]));
        this.drawPile = [];
        this.hand = this.dealHand();
        this.refreshCost = this.modifiers.includes('cheap_refresh') ? 25 : (level.refreshCost || 40);
    }

    static validateDeck(level, deck) {
        const pool = level.towerPool || ['lamp', 'coil', 'signal'];
        const size = level.deckSize || Math.min(4, pool.length);
        return Array.isArray(deck) && deck.length === size && new Set(deck).size === size &&
            deck.every(type => pool.includes(type) && !!TDCore.TOWERS[type]);
    }

    randomIndex(length) {
        return Math.min(length - 1, Math.floor(Math.max(0, this.random()) * length));
    }

    shuffleDeck() {
        const cards = this.deck.slice();
        for (let i = cards.length - 1; i > 0; i--) {
            const j = this.randomIndex(i + 1);
            [cards[i], cards[j]] = [cards[j], cards[i]];
        }
        return cards;
    }

    drawCard() {
        if (!this.drawPile.length) this.drawPile = this.shuffleDeck();
        return this.drawPile.pop();
    }

    dealHand() {
        return Array.from({ length: 3 }, () => this.drawCard());
    }

    static route(points) {
        const lengths = [];
        let total = 0;
        for (let i = 1; i < points.length; i++) {
            total += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
            lengths.push(total);
        }
        return { points, lengths, total };
    }

    static pointAt(route, distance) {
        const points = route.points;
        let previous = 0;
        for (let i = 0; i < route.lengths.length; i++) {
            const end = route.lengths[i];
            if (distance <= end || i === route.lengths.length - 1) {
                const t = Math.max(0, Math.min(1, (distance - previous) / (end - previous)));
                return {
                    x: points[i][0] + (points[i + 1][0] - points[i][0]) * t,
                    y: points[i][1] + (points[i + 1][1] - points[i][1]) * t
                };
            }
            previous = end;
        }
        return { x: points[0][0], y: points[0][1] };
    }

    static projectOnRoute(route, x, y) {
        let best = { x: route.points[0][0], y: route.points[0][1], distance: 0 };
        let nearest = Infinity, previous = 0;
        for (let i = 1; i < route.points.length; i++) {
            const a = route.points[i - 1], b = route.points[i];
            const dx = b[0] - a[0], dy = b[1] - a[1];
            const t = Math.max(0, Math.min(1, ((x - a[0]) * dx + (y - a[1]) * dy) / (dx * dx + dy * dy)));
            const px = a[0] + dx * t, py = a[1] + dy * t;
            const d = Math.hypot(x - px, y - py);
            if (d < nearest) { nearest = d; best = { x: px, y: py, distance: previous + Math.hypot(dx, dy) * t }; }
            previous = route.lengths[i - 1];
        }
        return best;
    }

    start() {
        if (this.state !== 'ready') return false;
        this.state = 'playing';
        this.events.push({ kind: 'start' });
        return true;
    }

    setPaused(paused) {
        if (this.state === 'playing' && paused) this.state = 'paused';
        else if (this.state === 'paused' && !paused) this.state = 'playing';
        return this.state;
    }

    getTower(siteId) { return this.towers.find(t => t.siteId === siteId) || null; }

    place(siteId, type) {
        if (this.state === 'won' || this.state === 'lost') return false;
        const site = this.level.sites.find(s => s.id === siteId);
        const spec = TDCore.TOWERS[type];
        if (!site || !spec || this.getTower(siteId) || this.credits < spec.cost) return false;
        this.credits -= spec.cost;
        this.towers.push({ siteId, type, level: this.typeRanks[type] || 1, cooldown: 0, x: site.x, y: site.y });
        this.events.push({ kind: 'build', siteId, type });
        return true;
    }

    placeCard(siteId, handIndex) {
        if (!Number.isInteger(handIndex) || handIndex < 0 || handIndex >= this.hand.length) return false;
        const type = this.hand[handIndex];
        if (!this.place(siteId, type)) return false;
        const drawn = this.drawCard();
        this.hand[handIndex] = drawn;
        this.events.push({ kind: 'draw', handIndex, type: drawn });
        return true;
    }

    refreshHand() {
        if (this.state === 'won' || this.state === 'lost' || this.deck.length <= this.hand.length ||
            this.credits < this.refreshCost) return false;
        this.credits -= this.refreshCost;
        const previous = this.hand;
        this.drawPile = this.shuffleDeck();
        this.hand = this.dealHand();
        if (previous.every(type => this.hand.includes(type))) {
            const oldCard = this.hand[0];
            this.hand[0] = this.drawPile.pop();
            this.drawPile.push(oldCard);
        }
        this.events.push({ kind: 'refresh', cost: this.refreshCost, hand: this.hand.slice() });
        return true;
    }

    merge(sourceSiteId, targetSiteId) {
        if (sourceSiteId === targetSiteId || this.state === 'won' || this.state === 'lost') return false;
        const source = this.getTower(sourceSiteId), target = this.getTower(targetSiteId);
        if (!source || !target || source.level !== target.level || source.level >= 3) return false;
        const type = this.deck[this.randomIndex(this.deck.length)];
        this.towers.splice(this.towers.indexOf(source), 1);
        target.type = type;
        // A merge grants one rank, while deck-wide training sets the minimum
        // rank for every tower of the resulting type.
        target.level = Math.max(target.level + 1, this.typeRanks[type] || 1);
        target.cooldown = 0;
        this.events.push({ kind: 'merge', sourceSiteId, targetSiteId, type, level: target.level });
        return true;
    }

    typeUpgradeCost(type) {
        const rank = this.typeRanks[type];
        if (!rank || rank >= 3) return null;
        return Math.round(TDCore.TOWERS[type].cost * (rank === 1 ? 0.8 : 1.2));
    }

    upgradeType(type) {
        if (this.state === 'won' || this.state === 'lost' || this.state === 'paused') return false;
        const cost = this.typeUpgradeCost(type);
        if (cost === null || this.credits < cost) return false;
        this.credits -= cost;
        const rank = ++this.typeRanks[type];
        for (const tower of this.towers) if (tower.type === type)
            tower.level = Math.max(tower.level, rank);
        this.events.push({ kind: 'upgrade_type', type, rank, cost });
        return true;
    }

    useDawnPulse() {
        if (this.state !== 'playing' || this.dawnCharge < TDCore.DAWN.pulseCost) return false;
        this.dawnCharge -= TDCore.DAWN.pulseCost;
        const litEnd = this.lanterns[this.litLanterns - 1]?.distance || 0;
        let affected = 0;
        for (const enemy of this.enemies) {
            if (enemy.hp <= 0 || enemy.mode !== 'route' || enemy.routeDistance > litEnd) continue;
            enemy.marked = Math.max(enemy.marked, TDCore.DAWN.pulseMark);
            enemy.slow = Math.max(enemy.slow, TDCore.DAWN.pulseSlow);
            this.hurt(enemy, TDCore.DAWN.pulseDamage, 'dawn');
            affected++;
        }
        this.events.push({ kind: 'dawn_pulse', affected, charge: this.dawnCharge, litEnd });
        return true;
    }

    upgrade(siteId) {
        const tower = this.getTower(siteId);
        if (!tower || tower.level >= 3 || this.state === 'won' || this.state === 'lost') return false;
        const cost = TDCore.upgradeCost(tower);
        if (this.credits < cost) return false;
        this.credits -= cost;
        tower.level++;
        this.events.push({ kind: 'upgrade', siteId });
        return true;
    }

    sell(siteId) {
        const index = this.towers.findIndex(t => t.siteId === siteId);
        if (index < 0 || this.state === 'won' || this.state === 'lost') return false;
        const tower = this.towers[index];
        this.credits += Math.floor((TDCore.TOWERS[tower.type].cost +
            (tower.level > 1 ? TDCore.upgradeCost({ ...tower, level: 1 }) : 0) +
            (tower.level > 2 ? TDCore.upgradeCost({ ...tower, level: 2 }) : 0)) * 0.65);
        this.towers.splice(index, 1);
        this.events.push({ kind: 'sell', siteId });
        return true;
    }

    static upgradeCost(tower) { return Math.round(TDCore.TOWERS[tower.type].cost * (0.65 + 0.3 * tower.level)); }

    spawnEnemy() {
        const wave = this.level.waves[this.phase - 1];
        const type = wave.pattern[this.phaseSpawnCount % wave.pattern.length];
        const spec = TDCore.ENEMIES[type];
        const spawnIndex = this.spawnGroupCount % this.level.spawns.length;
        const point = this.level.spawns[spawnIndex];
        const entry = TDCore.projectOnRoute(this.route, point[0], point[1]);
        const scale = 1 + (this.level.difficulty - 1) * 0.17 + (this.phase - 1) * 0.12;
        const count = type === 'moth' ? (wave.mothPack || this.level.mothPack || 1) : 1;
        for (let i = 0; i < count; i++) {
            // Pack members begin in a short line on the rendered alley.
            const offset = i * 0.08;
            const enemy = {
                id: this.nextEnemyId++, type, spawnIndex,
                x: point[0] + (entry.x - point[0]) * offset,
                y: point[1] + (entry.y - point[1]) * offset,
                hp: Math.round(spec.hp * scale), maxHp: Math.round(spec.hp * scale),
                speed: spec.speed, slow: 0, marked: 0, entry,
                routeDistance: entry.distance, mode: 'alley'
            };
            this.enemies.push(enemy);
            this.spawnCount++;
            this.events.push({ kind: 'spawn', enemy });
        }
        this.spawnGroupCount++;
        this.phaseSpawnCount++;
    }

    spawnBeaconWave() {
        const point = this.level.path[0];
        const pattern = this.level.beaconWavePattern;
        const scale = 1 + (this.level.difficulty - 1) * 0.17 + 0.24;
        for (let i = 0; i < pattern.length; i++) {
            const type = pattern[i], spec = TDCore.ENEMIES[type];
            const hp = Math.round(spec.hp * scale);
            const travelFraction = type === 'porter' ? 0.58 : type === 'wraith' ? 0.55 : 0.5;
            const enemy = {
                id: this.nextEnemyId++, type, spawnIndex: -1,
                x: point[0], y: point[1], hp, maxHp: hp,
                speed: this.route.total / (this.beaconHoldSeconds * travelFraction),
                slow: 0, marked: 0, entry: { x: point[0], y: point[1], distance: 0 },
                routeDistance: -i * 28, mode: 'route', beaconWave: true
            };
            this.enemies.push(enemy);
            this.spawnCount++;
            this.events.push({ kind: 'spawn', enemy });
        }
        this.events.push({ kind: 'beacon_wave', count: pattern.length });
    }

    hurt(enemy, damage, attackType) {
        if (enemy.hp <= 0) return;
        const resistance = TDCore.MATCHUPS[attackType][enemy.type];
        // Fog veils a spirit, but never makes a tower completely useless. Signal strips
        // the veil for its mark duration and remains the efficient answer to spirits.
        const multiplier = enemy.type === 'wraith' && enemy.marked <= 0 && attackType !== 'signal'
            ? resistance * 0.35 : resistance;
        enemy.hp = Math.max(0, enemy.hp - damage * multiplier);
        if (enemy.hp === 0) {
            const reward = TDCore.ENEMIES[enemy.type].reward;
            this.credits += reward;
            this.score += reward * 10;
            this.events.push({ kind: 'kill', id: enemy.id, x: enemy.x, y: enemy.y });
        }
    }

    relayMultiplier(tower) {
        let bonus = 0;
        const radius = TDCore.TOWERS.relay.radius * (this.modifiers.includes('relay_circuit') ? 1.18 : 1);
        for (const relay of this.towers) {
            if (relay === tower || relay.type !== 'relay') continue;
            if (Math.hypot(relay.x - tower.x, relay.y - tower.y) > radius) continue;
            bonus = Math.max(bonus, TDCore.TOWERS.relay.bonus + 0.1 * (relay.level - 1));
        }
        return 1 + bonus;
    }

    dawnMultiplier(tower) {
        return this.lanterns.some(lantern => lantern.lit &&
            Math.hypot(lantern.x - tower.x, lantern.y - tower.y) <= TDCore.DAWN.auraRadius)
            ? TDCore.DAWN.auraMultiplier : 1;
    }

    fire(tower) {
        if (tower.type === 'relay') return false;
        const spec = TDCore.TOWERS[tower.type];
        const range = spec.range * (1 + 0.12 * (tower.level - 1)) *
            (tower.type === 'projector' && this.modifiers.includes('projector_lens') ? 1.18 : 1);
        const damage = spec.damage * (1 + 0.5 * (tower.level - 1)) * this.relayMultiplier(tower) *
            this.dawnMultiplier(tower) *
            (tower.type === 'lamp' && this.modifiers.includes('lamp_focus') ? 1.2 : 1);
        if (tower.type === 'signal') {
            const targets = this.enemies.filter(e => e.hp > 0 && Math.hypot(e.x - tower.x, e.y - tower.y) <= range);
            if (!targets.length) return false;
            for (const enemy of targets) {
                const echo = this.modifiers.includes('signal_echo') ? 0.7 : 0;
                enemy.marked = Math.max(enemy.marked, spec.mark + echo);
                enemy.slow = Math.max(enemy.slow, spec.slow + echo);
                this.hurt(enemy, damage, 'signal');
            }
            this.events.push({ kind: 'shot', type: tower.type, x: tower.x, y: tower.y,
                targets: targets.map(e => ({ x: e.x, y: e.y })) });
            return true;
        }
        let target = null;
        let best = Infinity;
        for (const enemy of this.enemies) {
            if (enemy.hp <= 0) continue;
            if (Math.hypot(enemy.x - tower.x, enemy.y - tower.y) > range) continue;
            if (tower.type === 'projector' && target && target.type === 'runner' && enemy.type !== 'runner') continue;
            const distance = Math.hypot(enemy.x - this.convoy.x, enemy.y - this.convoy.y);
            if (tower.type === 'projector' && enemy.type === 'runner' && (!target || target.type !== 'runner')) {
                best = distance; target = enemy;
            } else if (distance < best) { best = distance; target = enemy; }
        }
        if (!target) return false;
        if (tower.type === 'coil') {
            const chain = [target];
            while (chain.length < spec.jumps + (this.modifiers.includes('coil_fork') ? 1 : 0)) {
                const last = chain[chain.length - 1];
                const next = this.enemies.filter(e => e.hp > 0 && !chain.includes(e) &&
                    Math.hypot(e.x - last.x, e.y - last.y) <= spec.jumpRange)
                    .sort((a, b) => Math.hypot(a.x - last.x, a.y - last.y) - Math.hypot(b.x - last.x, b.y - last.y))[0];
                if (!next) break;
                chain.push(next);
            }
            chain.forEach((enemy, i) => this.hurt(enemy, damage * (1 - i * 0.12), 'coil'));
            this.events.push({ kind: 'shot', type: tower.type, x: tower.x, y: tower.y,
                targets: chain.map(e => ({ x: e.x, y: e.y })) });
        } else {
            this.hurt(target, damage, tower.type);
            this.events.push({ kind: 'shot', type: tower.type, x: tower.x, y: tower.y,
                targets: [{ x: target.x, y: target.y }] });
        }
        return true;
    }

    update(dt) {
        this.events.length = 0;
        if (this.state !== 'playing') return;
        dt = Math.max(0, Math.min(0.1, dt));
        this.time += dt;
        this.distance = Math.min(this.route.total, this.distance + this.level.speed * dt);
        Object.assign(this.convoy, TDCore.pointAt(this.route, this.distance));
        for (const lantern of this.lanterns) if (!lantern.lit && this.distance >= lantern.distance) {
            lantern.lit = true;
            this.litLanterns++;
            this.dawnCharge = Math.min(TDCore.DAWN.maxCharge,
                this.dawnCharge + TDCore.DAWN.chargePerLantern);
            this.events.push({ kind: 'lantern_lit', index: this.litLanterns - 1,
                x: lantern.x, y: lantern.y, charge: this.dawnCharge });
        }
        const phase = Math.min(3, Math.floor(this.distance / this.route.total * 3) + 1);
        if (phase !== this.phase) {
            this.phase = phase;
            this.phaseSpawnCount = 0;
            this.spawnTimer = 0;
            const bonus = this.level.phaseBonus || 0;
            this.credits += bonus;
            this.events.push({ kind: 'phase', phase, bonus });
        }
        const arrived = !this.beaconActive && this.distance >= this.route.total;
        if (arrived) {
            this.beaconActive = true;
            this.beaconPrep = this.beaconPrepSeconds;
            this.events.push({ kind: 'beacon_prep', seconds: this.beaconPrepSeconds });
        }

        this.spawnTimer -= dt;
        if (this.spawnTimer <= 0 && !this.beaconActive && this.distance < this.route.total - 40) {
            this.spawnEnemy();
            this.spawnTimer += this.level.waves[this.phase - 1].interval;
        }

        for (const tower of this.towers) {
            if (tower.type === 'relay') continue;
            tower.cooldown -= dt;
            if (tower.cooldown <= 0 && this.fire(tower)) tower.cooldown = TDCore.TOWERS[tower.type].interval / (1 + 0.18 * (tower.level - 1));
        }

        for (const enemy of this.enemies) {
            if (enemy.hp <= 0) continue;
            const dx = this.convoy.x - enemy.x, dy = this.convoy.y - enemy.y;
            const distance = Math.hypot(dx, dy);
            if (distance <= 28) {
                enemy.hp = 0;
                this.convoy.hp = Math.max(0, this.convoy.hp - TDCore.ENEMIES[enemy.type].breach);
                this.events.push({ kind: 'breach', type: enemy.type, x: enemy.x, y: enemy.y, hp: this.convoy.hp });
                continue;
            }
            const factor = enemy.slow > 0 ? 0.48 : 1;
            const step = enemy.speed * factor * dt;
            if (enemy.mode === 'alley') {
                const ex = enemy.entry.x - enemy.x, ey = enemy.entry.y - enemy.y;
                const remaining = Math.hypot(ex, ey);
                if (remaining <= step) {
                    enemy.x = enemy.entry.x; enemy.y = enemy.entry.y; enemy.mode = 'route';
                } else { enemy.x += ex / remaining * step; enemy.y += ey / remaining * step; }
            } else {
                const delta = this.distance - enemy.routeDistance;
                enemy.routeDistance += Math.sign(delta) * Math.min(Math.abs(delta), step);
                Object.assign(enemy, TDCore.pointAt(this.route, enemy.routeDistance));
            }
            enemy.slow = Math.max(0, enemy.slow - dt);
            enemy.marked = Math.max(0, enemy.marked - dt);
        }
        this.enemies = this.enemies.filter(e => e.hp > 0);
        if (this.convoy.hp <= 0) {
            this.state = 'lost';
            this.events.push({ kind: 'lost' });
        } else if (this.beaconActive && !arrived) {
            if (!this.beaconWaveStarted) {
                this.beaconPrep = Math.max(0, this.beaconPrep - dt);
                if (this.beaconPrep <= 0) {
                    this.beaconWaveStarted = true;
                    this.spawnBeaconWave();
                }
            } else {
                this.beaconHold = Math.max(0, this.beaconHold - dt);
                if (this.beaconHold <= 0) {
                    this.state = 'won';
                    this.score += this.convoy.hp * 100;
                    this.events.push({ kind: 'won' });
                }
            }
        }
    }
}

TDCore.TOWERS = {
    lamp: { cost: 85, range: 210, damage: 44, interval: 0.8 },
    coil: { cost: 100, range: 215, damage: 34, interval: 0.9, jumps: 4, jumpRange: 100 },
    signal: { cost: 105, range: 215, damage: 18, interval: 1.45, slow: 3.5, mark: 4.5 },
    projector: { cost: 110, range: 235, damage: 32, interval: 0.75 },
    relay: { cost: 95, radius: 265, bonus: 0.4 }
};
TDCore.DAWN = {
    fractions: [0.16, 0.36, 0.56, 0.76, 0.96],
    maxCharge: 100, chargePerLantern: 20, pulseCost: 50, pulseDamage: 55,
    pulseMark: 5, pulseSlow: 4, auraRadius: 180, auraMultiplier: 1.15
};
TDCore.MODIFIER_IDS = ['lamp_focus', 'coil_fork', 'signal_echo', 'projector_lens', 'relay_circuit', 'cheap_refresh'];
TDCore.ENEMIES = {
    runner: { hp: 65, speed: 90, reward: 14, breach: 1 },
    wraith: { hp: 85, speed: 58, reward: 19, breach: 3 },
    moth: { hp: 48, speed: 110, reward: 5, breach: 2 },
    porter: { hp: 235, speed: 44, reward: 34, breach: 3 }
};
TDCore.MATCHUPS = {
    dawn: { runner: 1, wraith: 1, moth: 1, porter: 1 },
    lamp: { runner: 1, wraith: 1, moth: 0.05, porter: 1.35 },
    coil: { runner: 1, wraith: 0.8, moth: 1.9, porter: 0.2 },
    signal: { runner: 0.5, wraith: 2.5, moth: 0.1, porter: 0.2 },
    projector: { runner: 2.2, wraith: 0.75, moth: 0.8, porter: 0.8 }
};
