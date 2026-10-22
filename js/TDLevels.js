// Original districts and encounter layouts. Map coordinates are game data in ArcEngine pixels.
const TD_LEVELS = [
    {
        id: 'theater', name: { ru: 'Театральный квартал', en: 'Theater Quarter' },
        towerPool: ['lamp', 'coil', 'signal'], deckSize: 3,
        defaultDeck: ['lamp', 'coil', 'signal'],
        path: [[90, 735], [285, 735], [285, 525], [570, 525], [570, 300], [850, 300], [850, 165], [1110, 165]],
        spawns: [[140, 430], [430, 835], [700, 95], [1010, 445]],
        sites: [
            { id: 't1', x: 165, y: 620 }, { id: 't2', x: 390, y: 645 }, { id: 't3', x: 460, y: 425 },
            { id: 't4', x: 670, y: 415 }, { id: 't5', x: 755, y: 205 }, { id: 't6', x: 965, y: 270 }
        ],
        hp: 11, credits: 360, phaseBonus: 75, mothPack: 1, speed: 18, difficulty: 1,
        beaconPrepSeconds: 6, beaconHoldSeconds: 25,
        beaconWavePattern: ['runner', 'runner', 'moth', 'moth', 'porter', 'wraith',
            'runner', 'moth', 'wraith', 'porter', 'runner', 'moth'],
        waves: [
            { interval: 4.2, pattern: ['runner', 'moth', 'runner', 'moth'] },
            { interval: 3.8, mothPack: 2, pattern: ['moth', 'moth', 'wraith', 'porter'] },
            { interval: 3.5, mothPack: 2, pattern: ['wraith', 'runner', 'moth', 'wraith', 'porter'] }
        ]
    },
    {
        id: 'station', name: { ru: 'Станция Девятая', en: 'Ninth Station' },
        towerPool: ['lamp', 'coil', 'signal', 'projector'], deckSize: 4,
        defaultDeck: ['lamp', 'coil', 'signal', 'projector'],
        path: [[105, 150], [335, 150], [335, 375], [610, 375], [610, 690], [860, 690], [860, 465], [1100, 465]],
        spawns: [[145, 520], [510, 70], [700, 845], [1050, 185]],
        sites: [
            { id: 's1', x: 190, y: 265 }, { id: 's2', x: 440, y: 260 }, { id: 's3', x: 500, y: 510 },
            { id: 's4', x: 715, y: 575 }, { id: 's5', x: 740, y: 795 }, { id: 's6', x: 975, y: 575 },
            { id: 's7', x: 990, y: 355 }
        ],
        hp: 13, credits: 400, phaseBonus: 75, mothPack: 2, speed: 19, difficulty: 2,
        beaconPrepSeconds: 6, beaconHoldSeconds: 25,
        beaconWavePattern: ['runner', 'moth', 'moth', 'wraith', 'porter', 'runner', 'moth', 'wraith',
            'porter', 'moth', 'wraith', 'runner', 'moth', 'porter', 'wraith', 'moth'],
        waves: [
            { interval: 3.6, pattern: ['runner', 'wraith', 'moth', 'moth'] },
            { interval: 3.2, pattern: ['porter', 'wraith', 'moth', 'moth', 'runner'] },
            { interval: 2.9, pattern: ['wraith', 'moth', 'porter', 'wraith', 'moth'] }
        ]
    },
    {
        id: 'waterfront', name: { ru: 'Туманная набережная', en: 'Foggy Waterfront' },
        towerPool: ['lamp', 'coil', 'signal', 'projector', 'relay'], deckSize: 4,
        defaultDeck: ['lamp', 'coil', 'signal', 'relay'],
        path: [[95, 770], [295, 770], [295, 540], [500, 540], [500, 310], [760, 310], [760, 580], [995, 580], [995, 150], [1110, 150]],
        spawns: [[125, 365], [455, 85], [675, 835], [1120, 390]],
        sites: [
            { id: 'w1', x: 175, y: 650 }, { id: 'w2', x: 385, y: 655 }, { id: 'w3', x: 390, y: 415 },
            { id: 'w4', x: 615, y: 415 }, { id: 'w5', x: 650, y: 205 }, { id: 'w6', x: 865, y: 420 },
            { id: 'w7', x: 880, y: 690 }, { id: 'w8', x: 1085, y: 280 }
        ],
        hp: 16, credits: 400, phaseBonus: 75, mothPack: 2, speed: 20, difficulty: 3,
        beaconPrepSeconds: 6, beaconHoldSeconds: 25,
        beaconWavePattern: ['porter', 'moth', 'moth', 'wraith', 'runner', 'moth', 'wraith', 'porter',
            'moth', 'moth', 'runner', 'wraith', 'porter', 'moth', 'wraith', 'moth',
            'porter', 'runner', 'wraith', 'moth'],
        waves: [
            { interval: 3.2, pattern: ['wraith', 'moth', 'runner', 'moth'] },
            { interval: 2.9, mothPack: 3, pattern: ['porter', 'wraith', 'moth', 'porter', 'moth'] },
            { interval: 2.6, mothPack: 3, pattern: ['wraith', 'porter', 'moth', 'moth', 'wraith'] }
        ]
    }
];
