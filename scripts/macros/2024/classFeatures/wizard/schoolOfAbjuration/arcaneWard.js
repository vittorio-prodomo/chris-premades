import {arcaneWard as arcaneWardLegacy} from '../../../../../legacyMacros.js';
// CPR ships Arcane Ward only under the legacy ruleset, so a 2024 (modern) Abjurer's feature never
// matched it (getMacro looks in the modern registry) — the midi sample automation won the import race
// instead. This modern alias re-exports the same automation with rules: 'modern' so it applies to 2024
// Abjurers (pickable in the Medkit, and wins the import swap). Same pattern as Flaming Sphere / Portent.
export let arcaneWard = {
    ...arcaneWardLegacy,
    rules: 'modern'
};
