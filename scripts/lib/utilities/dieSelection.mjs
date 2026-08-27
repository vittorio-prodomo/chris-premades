/**
 * Which dice a die-selection dialog ended up choosing.
 *
 * ⚠️ `DialogApp.dialog` resolves to **null** when its timeout elapses, so every caller
 * that reads a property off the result must tolerate that. Reading `.buttons` off the
 * null is what crashed the Heroic Inspiration offer when it auto-declined mid-roll.
 *
 * @param {object|null|undefined} selection  The dialog result.
 * @returns {string[]|undefined}  The ticked die keys, or undefined when nothing was chosen.
 */
export function selectedDieKeys(selection) {
    if (!selection?.buttons) return undefined;
    let chosen = {...selection};
    delete chosen.buttons;
    return Object.entries(chosen).filter(([, value]) => value).map(([key]) => key);
}
