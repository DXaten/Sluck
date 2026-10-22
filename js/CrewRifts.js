// The city's breaches become a tactical choice instead of places to build on.
// CrewRifts uses CrewCore for the moving party and TDCore for route combat.
class CrewRifts extends CrewCore {
    constructor(level, options = {}) {
        super(level, options);
        this.riftIndex = 0;
        this.riftPrompt = null;
        this.openRifts = null;
        this.riftDecisions = [];
        this.minibossSpawned = [false, false];
        this.finalBossSpawned = false;
        this.finalBossDefeated = false;
    }

    static get BREAKS() { return [0.31, 0.65]; }
    static get SEAL_COST() { return 20; }
    static get OPEN_BONUS() { return 30; }

    makeRiftPair(stage) {
        const ahead = Math.min(this.route.total, this.distance + 120);
        const before = TDCore.pointAt(this.route, Math.max(0, ahead - 8));
        const after = TDCore.pointAt(this.route, Math.min(this.route.total, ahead + 8));
        const dx = after.x - before.x, dy = after.y - before.y;
        const len = Math.hypot(dx, dy) || 1;
        const center = TDCore.pointAt(this.route, ahead);
        const names = stage === 0
            ? [
                { ru: 'Двор мотыльков', en: 'Moth courtyard', pattern: ['moth', 'runner'] },
                { ru: 'Каменная арка', en: 'Stone arch', pattern: ['porter', 'wraith'] }
            ]
            : [
                { ru: 'Туманный проход', en: 'Fog passage', pattern: ['wraith', 'moth'] },
                { ru: 'Складской проезд', en: 'Warehouse lane', pattern: ['runner', 'porter'] }
            ];
        return names.map((name, index) => {
            const side = index === 0 ? 1 : -1;
            const x = Math.max(55, Math.min(LOCATION_WIDTH - 55, center.x - dy / len * side * 112));
            const y = Math.max(55, Math.min(LOCATION_HEIGHT - 55, center.y + dx / len * side * 112));
            return { ...name, id: 'rift-' + stage + '-' + index, x, y,
                entry: TDCore.projectOnRoute(this.route, x, y) };
        });
    }

    chooseRift(choice) {
        if (!this.riftPrompt || !['left', 'right', 'both'].includes(choice)) return false;
        if (choice !== 'both' && this.dawnCharge < CrewRifts.SEAL_COST) return false;
        const { pair, stage } = this.riftPrompt;
        if (choice === 'left') {
            this.dawnCharge -= CrewRifts.SEAL_COST;
            this.openRifts = [pair[1]];
        } else if (choice === 'right') {
            this.dawnCharge -= CrewRifts.SEAL_COST;
            this.openRifts = [pair[0]];
        } else {
            this.openRifts = pair.slice();
            this.credits += CrewRifts.OPEN_BONUS;
        }
        const decision = { stage, choice, open: this.openRifts.map(rift => rift.id) };
        this.riftDecisions.push(decision);
        this.riftPrompt = null;
        this.state = 'playing';
        this._emitCrew({ kind: 'rift_choice', ...decision });
        this.spawnTimer = 0;
        return true;
    }

    spawnAtRift(rift, type, boss = '') {
        const spec = TDCore.ENEMIES[type];
        if (!spec) return null;
        const scale = 1 + (this.level.difficulty - 1) * 0.17 + (this.phase - 1) * 0.12;
        const wave = this.level.waves[Math.min(this.level.waves.length - 1, this.phase - 1)];
        const count = boss ? 1 : type === 'moth' ? (wave.mothPack || this.level.mothPack || 1) : 1;
        let first = null;
        for (let i = 0; i < count; i++) {
            const offset = i * 0.08;
            const hp = Math.round(spec.hp * scale * (boss === 'miniboss' ? 3 : boss ? 6 : 1));
            const enemy = {
                id: this.nextEnemyId++, type, boss,
                x: rift.x + (rift.entry.x - rift.x) * offset,
                y: rift.y + (rift.entry.y - rift.y) * offset,
                hp, maxHp: hp, speed: spec.speed * (boss ? 0.8 : 1), slow: 0, marked: 0,
                entry: rift.entry, routeDistance: rift.entry.distance, mode: 'alley',
                riftId: rift.id
            };
            this.enemies.push(enemy);
            this.spawnCount++;
            this.events.push({ kind: boss || 'spawn', enemy });
            if (!first) first = enemy;
        }
        return first;
    }

    spawnEnemy() {
        if (!this.openRifts || !this.openRifts.length) {
            super.spawnEnemy();
            return;
        }
        for (const rift of this.openRifts) {
            const type = rift.pattern[this.phaseSpawnCount % rift.pattern.length];
            this.spawnAtRift(rift, type);
        }
        this.spawnGroupCount += this.openRifts.length;
        this.phaseSpawnCount++;
    }

    spawnBeaconWave() {
        super.spawnBeaconWave();
        const start = this.level.path[0];
        const hp = Math.round(750 * (1 + (this.level.difficulty - 1) * 0.25));
        const enemy = {
            id: this.nextEnemyId++, type: 'porter', boss: 'final',
            x: start[0], y: start[1], hp, maxHp: hp,
            speed: this.route.total / (this.beaconHoldSeconds * 0.56),
            slow: 0, marked: 0,
            entry: { x: start[0], y: start[1], distance: 0 },
            routeDistance: -65, mode: 'route', beaconWave: true
        };
        this.enemies.push(enemy);
        this.spawnCount++;
        this.finalBossSpawned = true;
        this.events.push({ kind: 'final_boss', enemy });
    }

    hurt(enemy, damage, attackType) {
        const alive = enemy.hp > 0;
        super.hurt(enemy, damage, attackType);
        if (alive && enemy.hp === 0 && enemy.boss) {
            this.credits += enemy.boss === 'final' ? 80 : 35;
            if (enemy.boss === 'final') this.finalBossDefeated = true;
            this.events.push({ kind: 'boss_defeated', boss: enemy.boss, x: enemy.x, y: enemy.y });
        }
    }

    update(dt) {
        if (this.state === 'playing' && !this.beaconActive &&
            this.riftIndex < CrewRifts.BREAKS.length) {
            const threshold = this.route.total * CrewRifts.BREAKS[this.riftIndex];
            if (this.distance <= threshold &&
                this.distance + this.level.speed * Math.max(0, Math.min(0.1, dt)) >= threshold) {
                const stage = this.riftIndex++;
                this.distance = threshold;
                Object.assign(this.convoy, TDCore.pointAt(this.route, threshold));
                this.riftPrompt = { stage, pair: this.makeRiftPair(stage),
                    cost: CrewRifts.SEAL_COST, bonus: CrewRifts.OPEN_BONUS };
                this.state = 'paused';
                this.events.length = 0;
                this.events.push({ kind: 'rift_prompt', ...this.riftPrompt });
                return;
            }
        }
        const finalBoss = this.enemies.find(enemy => enemy.boss === 'final' && enemy.hp > 0);
        super.update(dt);
        // TDCore marks an enemy as dead when it reaches the wagon. A boss that
        // breached must resolve the encounter, otherwise beaconHold repeatedly
        // expires while finalBossDefeated can never become true.
        if (finalBoss && finalBoss.hp === 0 && !this.finalBossDefeated) {
            const wasWon = this.state === 'won';
            const wasLost = this.state === 'lost';
            if (wasWon) this.score -= this.convoy.hp * 100;
            this.convoy.hp = 0;
            this.state = 'lost';
            this.events = this.events.filter(event => event.kind !== 'won');
            this.events.push({ kind: 'boss_breach', boss: 'final', x: finalBoss.x, y: finalBoss.y });
            if (!wasLost) this.events.push({ kind: 'lost' });
            return;
        }
        for (let stage = 0; stage < CrewRifts.BREAKS.length; stage++) {
            const trigger = this.route.total * (CrewRifts.BREAKS[stage] + 0.12);
            if (this.riftDecisions[stage] && !this.minibossSpawned[stage] &&
                this.distance >= trigger && this.state === 'playing' && !this.beaconActive) {
                this.minibossSpawned[stage] = true;
                const rift = this.openRifts?.[0] || this.makeRiftPair(stage)[0];
                this.spawnAtRift(rift, stage === 0 ? 'porter' : 'wraith', 'miniboss');
            }
        }
        if (this.state === 'won' && this.finalBossSpawned && !this.finalBossDefeated) {
            this.state = 'playing';
            this.beaconHold = 1;
            this.events = this.events.filter(event => event.kind !== 'won');
        }
    }
}
