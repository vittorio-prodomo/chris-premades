import {bootsOfElvenkind as bootsOfElvenkindLegacy} from '../../../2014/items/trinket/bootsOfElvenkind.js';
// The automation is rules-agnostic (a Stealth-only, equipped-only advantage offer), so the 2024
// entry reuses the legacy skill pass verbatim; only the registry it lives in differs. Without a
// modern registration CPR's premade lookup can never match a 2024-rules pair of boots.
export let bootsOfElvenkind = {
    name: 'Boots of Elvenkind',
    version: '1.1.1',
    rules: 'modern',
    skill: bootsOfElvenkindLegacy.skill
};
