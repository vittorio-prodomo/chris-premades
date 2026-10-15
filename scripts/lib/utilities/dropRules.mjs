/**
 * T249 — the two homebrew drop rules as pure arithmetic (notes/table-rules/*.md, agreed 2026-10-15).
 * Nothing here touches Foundry.
 */
const SIZES = ['tiny', 'sm', 'med', 'lg', 'huge', 'grg'];

export function dropHeight(fallerElevation, targetElevation) {
    let height = Number(fallerElevation) - Number(targetElevation);
    return Number.isFinite(height) && height > 0 ? height : null;
}
export function heightDC(height) {
    if (height <= 20) return 10;
    if (height <= 30) return 13;
    if (height <= 40) return 15;
    return 15 + 2 * Math.ceil((height - 40) / 10);
}
export function fallDiceCount(height) {
    return Math.floor(Math.max(0, height) / 10);
}
function twoThirds(total) {
    let faller = Math.floor(total / 3);
    return {target: total - faller, faller};
}
export function landingSplit(height, total) {
    return height <= 10 ? {target: 0, faller: 0} : twoThirds(total);
}
export function landingMissDamage(height, total) {
    return height <= 10 ? 0 : total;
}
export function plungeSplit(height, total) {
    return height <= 20 ? {target: total, faller: 0} : twoThirds(total);
}
export function sizeIndex(size) {
    let index = SIZES.indexOf(size);
    return index < 0 ? 2 : index;
}
export function aimMode(fallerSize, targetSize) {
    let diff = sizeIndex(targetSize) - sizeIndex(fallerSize);
    return diff >= 1 ? 'advantage' : diff <= -1 ? 'disadvantage' : 'normal';
}
export function knockedProne(fallerSize, targetSize) {
    return sizeIndex(targetSize) - sizeIndex(fallerSize) < 2;
}
export function landingOutcome({aimTotal, dc, undetected, dodgeSave}) {
    if (aimTotal < dc) return 'miss';
    if (undetected || dodgeSave === null || dodgeSave === undefined) return 'hit';
    return dodgeSave >= aimTotal ? 'dodged' : 'hit';
}
export function isAdjacent(a, b) {
    let overlapX = a.x < b.x + b.w && b.x < a.x + a.w;
    let overlapY = a.y < b.y + b.h && b.y < a.y + a.h;
    if (overlapX && overlapY) return false;
    let gapX = Math.max(b.x - (a.x + a.w), a.x - (b.x + b.w), 0);
    let gapY = Math.max(b.y - (a.y + a.h), a.y - (b.y + b.h), 0);
    return gapX === 0 && gapY === 0;
}
/** Whether any of `others` (grid-cell rects) overlaps the landing square. */
export function squareTaken(square, others) {
    return (others ?? []).some(o => square.x < o.x + o.w && o.x < square.x + square.w && square.y < o.y + o.h && o.y < square.y + square.h);
}
