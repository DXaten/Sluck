// A single street pursuit. Every alley decision changes the wagon's path and
// the time left to catch Silas Rook. The rest of combat belongs to CrewRoulette.
class CrewChase extends CrewRoulette {
    constructor(level, options = {}) {
        super(level, options);
        this.villain = { ru: 'Сайлас Рук', en: 'Silas Rook' };
        this.chaseTime = this.route.total / level.speed +
            this.beaconPrepSeconds + this.beaconHoldSeconds + 20;
        this.routeChoices = [];
    }

    // Bend into the other lane of a city street, then rejoin the original
    // route. All waypoints stay within the wide road and its building clearance.
    // The bend is short enough to leave the next tactical stop on the route.
    _switchStreet(side) {
        const original = this.route;
        const start = this.distance;
        const end = Math.min(original.total - 70, start + 190);
        if (end - start < 70) return null;
        const point = distance => TDCore.pointAt(original, distance);
        const startPoint = point(start), endPoint = point(end);
        const shifted = distance => {
            const at = point(distance);
            const before = point(Math.max(0, distance - 5));
            const after = point(Math.min(original.total, distance + 5));
            const dx = after.x - before.x, dy = after.y - before.y;
            const length = Math.hypot(dx, dy) || 1;
            return [at.x - dy / length * side * 28,
                at.y + dx / length * side * 28];
        };
        const prefix = [original.points[0]];
        for (let i = 0; i < original.lengths.length; i++)
            if (original.lengths[i] < start - 0.001) prefix.push(original.points[i + 1]);
        const branch = [[startPoint.x, startPoint.y]];
        for (let d = start + 28; d < end - 15; d += 32) branch.push(shifted(d));
        branch.push([endPoint.x, endPoint.y]);
        const suffix = [];
        for (let i = 0; i < original.lengths.length; i++)
            if (original.lengths[i] > end + 0.001) suffix.push(original.points[i + 1]);
        this.route = TDCore.route([...prefix, ...branch, ...suffix]);
        const extra = this.route.total - original.total;
        // Lamps are physical objects on the street. Their trigger distances
        // shift by the length added before them, without moving their meshes.
        for (const lantern of this.lanterns)
            if (!lantern.lit && lantern.distance > start) lantern.distance += extra;
        for (const enemy of this.enemies) {
            if (enemy.entry)
                enemy.entry = TDCore.projectOnRoute(this.route, enemy.entry.x, enemy.entry.y);
            if (enemy.mode === 'route')
                enemy.routeDistance = TDCore.projectOnRoute(this.route, enemy.x, enemy.y).distance;
        }
        for (const rift of this.openRifts || [])
            rift.entry = TDCore.projectOnRoute(this.route, rift.entry.x, rift.entry.y);
        this._syncActiveCrew();
        return branch;
    }

    chooseRift(choice) {
        if (!super.chooseRift(choice)) return false;
        const stage = this.riftDecisions[this.riftDecisions.length - 1].stage;
        const branch = choice === 'both' ? null : this._switchStreet(choice === 'left' ? 1 : -1);
        // The left street carries a fresh trail; the right street offers a
        // little breathing room. Going straight exposes both enemy alleys.
        const seconds = choice === 'left' ? 8 : choice === 'right' ? 4 : -5;
        this.chaseTime = Math.max(1, this.chaseTime + seconds);
        const decision = { stage, choice, seconds, path: branch };
        this.routeChoices.push(decision);
        this._emitCrew({ kind: 'chase_route', ...decision });
        return true;
    }

    update(dt) {
        const before = this.time;
        super.update(dt);
        if (this.state === 'won' || this.state === 'lost') return;
        this.chaseTime = Math.max(0, this.chaseTime - (this.time - before));
        if (this.chaseTime === 0 && !this.finalBossDefeated) {
            this.state = 'lost';
            this.events.push({ kind: 'villain_escaped', villain: this.villain });
            this.events.push({ kind: 'lost' });
        }
    }
}
