import {ItemMedkit} from '../applications/medkit-item.js';
import {tours} from '../applications/tour.js';
import {troubleshooter} from '../applications/troubleshooter.js';
import {genericUtils} from '../utils.js';
import {formatRerollNote} from '../lib/utilities/rerollNotes.mjs';
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
 * Render reroll attribution notes into a midi chat card (T51).
 *
 * Reads the array flag written by rollUtils.postRerollNote. Runs on EVERY render — including
 * scrollback and post-reload — which is why the data lives on the message rather than being
 * injected once at creation time. Idempotent: bails if the block is already present.
 *
 * @param {ChatMessage} message
 * @param {HTMLElement} element
 */
function renderChatMessageHTML(message, element) {
    let notes = message.flags?.['chris-premades']?.rerollNotes;
    if (!Array.isArray(notes) || !notes.length) return;
    if (element.querySelector('.chris-reroll-notes')) return;
    let container = element.querySelector('.message-content');
    if (!container) return;
    let template = genericUtils.translate('CHRISPREMADES.RerollNote.Line');
    let block = document.createElement('div');
    block.classList.add('chris-reroll-notes');
    for (let note of notes) {
        let line = document.createElement('div');
        line.classList.add('chris-reroll-note');
        line.textContent = '↻ ' + formatRerollNote(template, note);
        block.appendChild(line);
    }
    container.appendChild(block);
}
export let chat = {
    createChatMessage,
    renderChatMessageHTML
};