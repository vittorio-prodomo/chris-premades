// The automation is entirely a transfer effect in packData (`flags.chris-premades.CR.charmed`,
// consumed by macros/mechanics/conditionResistance.js) — there is no handler to reuse, which is why
// this mirrors celestialResistance's shape rather than bootsOfElvenkind's re-export of a legacy pass.
//
// Registering it here is not cosmetic: `genericUtils.getCPRIdentifiers(name, 'modern')` builds its
// name -> identifier map from THIS registry alone, so without an entry a 2024-rules Fey Ancestry can
// never resolve to the cpr-species-features-2024 pack entry and falls through to the unautomated
// `dnd5e.origins24` copy. The 2014 registration in legacyMacros.js stays as it is.
//
// 2024 keeps only the Charmed clause. The "magic can't put you to sleep" half of the 2014 trait
// moved to the Elf's separate TRANCE feature ("You don't need to sleep, and magic can't put you to
// sleep"), and the Sleep spell independently auto-succeeds creatures that don't sleep — so encoding
// any sleep immunity here would both misstate 2024 RAW and duplicate a rule two other things own.
// ⚠️ Trance is also where ddb-importer sources the actor's `traits.ci.custom` "Sleep" entry
// (_addSpecialAdditions matches that exact sentence); see queue T122.
export let feyAncestry = {
    name: 'Fey Ancestry',
    version: '1.1.0',
    rules: 'modern'
};
