// The automation is entirely a transfer effect in packData (`flags.chris-premades.CR.charmed`,
// consumed by macros/mechanics/conditionResistance.js) — there is no handler to reuse, which is why
// this mirrors celestialResistance's shape rather than bootsOfElvenkind's re-export of a legacy pass.
//
// Registering it here is not cosmetic: `genericUtils.getCPRIdentifiers(name, 'modern')` builds its
// name -> identifier map from THIS registry alone, so without an entry a 2024-rules Fey Ancestry can
// never resolve to the cpr-species-features-2024 pack entry and falls through to the unautomated
// `dnd5e.origins24` copy. The 2014 registration in legacyMacros.js stays as it is.
//
// 2024 keeps only the Charmed clause; the "magic can't put you to sleep" half of the 2014 trait is
// now carried by the Sleep spell's own text, so it is deliberately not encoded here.
export let feyAncestry = {
    name: 'Fey Ancestry',
    version: '1.1.0',
    rules: 'modern'
};
