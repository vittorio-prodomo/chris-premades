import {ItemMedkit} from '../applications/medkit-item.js';
import {tours} from '../applications/tour.js';
import {troubleshooter} from '../applications/troubleshooter.js';
import {genericUtils} from '../utils.js';
import {buildRerollTooltip, formatRerollNote} from '../lib/utilities/rerollNotes.mjs';
async function createChatMessage(message, options, userId) {
    let buttonData = message.flags?.['chris-premades']?.button;
    if (!buttonData) return;
    await genericUtils.sleep(100);
    let messageElements = document.querySelectorAll('[data-message-id="' + message.id + '"]');
    if (!messageElements.length) return;
    messageElements.forEach(element => {
        switch (buttonData.type) {
            case 'updateItem': {
                let button = element.querySelector('.chris-update-item');
                if (!button) return;
                button.addEventListener('click', async () => {
                    let item = await fromUuid(buttonData.data.itemUuid);
                    if (!item) return;
                    await ItemMedkit.item(item);
                    await message.delete();
                });
                break;
            }
            case 'tour': {
                let button = element.querySelector('[type="button"]');
                if (button) button.addEventListener('click', tours.guidedTour);
                break;
            }
            case 'settings': {
                let settingButton = element.querySelector('.chris-settings');
                let ignoreSettingsButton = element.querySelector('.chris-ignoreSettings');
                settingButton.addEventListener('click', () => {
                    troubleshooter.fixSettings(message);
                });
                ignoreSettingsButton.addEventListener('click', () => {
                    troubleshooter.ignoreSettingsWarning(message);
                });
                break;
            }
            case 'moduleIssues': {
                let button = element.querySelector('[type="button"]');
                if (button) button.addEventListener('click', () => {
                    troubleshooter.ignoreModuleIssues(message);
                });
                break; 
            }
        }
    });
    
}
/**
 * Render reroll attribution notes into a midi chat card (T51, relocated by T52).
 *
 * Reads the array flag written by rollUtils.postRerollNote. Runs on EVERY render — including
 * scrollback and post-reload — which is why the data lives on the message rather than being
 * injected once at creation time. Idempotent: bails if either presentation is already present.
 *
 * T52 moved the notes off the bottom of the card and onto the DAMAGE title, as an ⓘ whose hover
 * tooltip carries them — mirroring the treatment MidiQoL already gives the ATTACK title when a
 * roll had advantage. The bottom-of-card block survives only as a fallback for cards with no
 * damage-roll title to hang the icon on, so a note is never silently lost.
 *
 * ⚠️ Timing: this runs on `dnd5e.renderChatMessage`, which dnd5e fires AFTER `_enrichChatCard`
 * (dnd5e.mjs:69147 then :69159) — and midi's roll masking, which does a blanket
 * `removeAll(html, '.midi-attribution-info')` (ChatMessageMidi.ts:514), lives inside that earlier
 * pass. So the icon cannot be stripped by it. Injecting any earlier would be fragile.
 *
 * @param {ChatMessage} message
 * @param {HTMLElement} element
 */
function renderRerollNotes(message, element) {
    let notes = message.flags?.['chris-premades']?.rerollNotes;
    if (!Array.isArray(notes) || !notes.length) return;
    // Match OUR icon, never midi's own attribution ⓘ on the attack title — a card carrying that
    // one must still get its reroll notes.
    if (element.querySelector('.chris-reroll-notes, .chris-reroll-info')) return;
    let lines = notes.map(note => {
        let template = genericUtils.translate(note?.forced ? 'CHRISPREMADES.RerollNote.LineForced' : 'CHRISPREMADES.RerollNote.Line');
        return '↻ ' + formatRerollNote(template, note);
    });
    let label = element.querySelector('.midi-qol-damage-roll .midi-roll-label');
    let tooltip = label ? buildRerollTooltip(genericUtils.translate('CHRISPREMADES.RerollNote.TooltipTitle'), lines) : '';
    if (tooltip) {
        let icon = document.createElement('span');
        // midi's own classes: its stylesheet is already loaded, so the icon matches the one
        // beside ADVANTAGE rather than looking bolted on.
        icon.classList.add('midi-attribution-info', 'chris-reroll-info');
        icon.setAttribute('data-tooltip-html', tooltip);
        icon.setAttribute('data-tooltip-direction', 'DOWN');
        let glyph = document.createElement('i');
        glyph.classList.add('fas', 'fa-info-circle');
        icon.appendChild(glyph);
        label.appendChild(icon);
        return;
    }
    let container = element.querySelector('.message-content');
    if (!container) return;
    let block = document.createElement('div');
    block.classList.add('chris-reroll-notes');
    for (let line of lines) {
        let entry = document.createElement('div');
        entry.classList.add('chris-reroll-note');
        entry.textContent = line;
        block.appendChild(entry);
    }
    container.appendChild(block);
}
/**
 * Re-render reroll notes into cards already sitting in the chat log before the
 * `dnd5e.renderChatMessage` hook attached (T51b).
 *
 * `registerHooks()` runs inside this module's `ready` handler, but Foundry's sidebar
 * (including the chat log's message backlog) renders earlier in the boot sequence
 * (`Game#setupGame` -> `initializeUI` -> `ui.sidebar.render`), well before `ready` fires.
 * Cards already in the DOM at that point never pass through the hook, so a message
 * carrying rerollNotes shows the line live but loses it after a reload or on scrollback.
 * Reuses renderRerollNotes (already idempotent - it bails if the block exists), so
 * running this alongside live hook renders can never duplicate a note. Purely cosmetic:
 * never throws. Same problem/fix shape as npc-name-veil's chat alias sweep.
 */
function sweepRenderedChatMessages() {
    try {
        for (let element of document.querySelectorAll('.chat-message[data-message-id]')) {
            let message = game.messages?.get(element.dataset.messageId);
            if (message) renderRerollNotes(message, element);
        }
    } catch (error) {
        genericUtils.log('warn', 'Failed to sweep reroll notes into the rendered chat log: ' + (error?.message ?? error));
    }
}
export let chat = {
    createChatMessage,
    renderRerollNotes,
    sweepRenderedChatMessages
};