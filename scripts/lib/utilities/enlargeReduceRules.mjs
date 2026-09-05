// T218 — Enlarge/Reduce decisions that need no Foundry globals.

const GROW = {tiny: 'sm', sm: 'med', med: 'lg', lg: 'huge', huge: 'grg'};
const SHRINK = {sm: 'tiny', med: 'sm', lg: 'med', huge: 'lg', grg: 'huge'};

/**
 * The size a target ends up at.
 * @param {object} args
 * @param {'enlarge'|'reduce'} args.selection
 * @param {string} args.size       the target's current size key
 * @param {boolean} args.hasRoom   whether the token has room to grow a square (only consulted when
 *                                 growing changes the footprint, i.e. from medium and up)
 */
export function resolveNewSize({selection, size, hasRoom}) {
    if (selection === 'enlarge') {
        const footprintGrows = size !== 'tiny' && size !== 'sm';
        if (footprintGrows && !hasRoom) return size;
        return GROW[size] ?? size;
    }
    return SHRINK[size] ?? size;
}

/**
 * Who gets asked whether the target is willing.
 *  - 'caster'   the caster's own creature: trivially willing, no prompt
 *  - 'friendly' a friendly-disposition token: its owner is asked
 *  - 'other'    neutral/hostile/secret: no offer, the save is rolled as usual
 * @param {object} args
 * @param {number} args.disposition   the target token's disposition
 * @param {number} args.friendly      CONST.TOKEN_DISPOSITIONS.FRIENDLY
 * @param {boolean} args.isCaster     the target actor IS the casting actor
 */
export function classifyWillingTarget({disposition, friendly, isCaster}) {
    if (isCaster) return 'caster';
    if (disposition === friendly) return 'friendly';
    return 'other';
}
