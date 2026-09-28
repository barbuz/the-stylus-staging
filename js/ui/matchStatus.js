/**
 * Pure match-status descriptors and their markup.
 *
 * Used by the match table modal to show one status per row. Takes the row plus
 * the already-computed flags (result present, discrepancy, inverse suspected),
 * so it has no DOM, gapi or instance state.
 */
import { escapeHtml } from '../utils/domUtils.js';

/**
 * @param {object} options
 * @param {string} options.signature the current colour's signature on the row
 * @param {boolean} options.hasResult current colour has a non-blank analysis
 * @param {boolean} options.hasDiscrepancy
 * @param {boolean} options.hasThread
 * @param {boolean} options.inverseSuspected
 * @param {boolean} options.allMatching all three gurus agree
 * @returns {{key:string,label:string,type:'emoji'|'image',value:string}}
 */
export function describeMatchStatus({
    signature, hasResult, hasDiscrepancy, hasThread, inverseSuspected, allMatching
}) {
    if (!signature) {
        return { key: 'unclaimed', label: 'Unclaimed', type: 'emoji', value: '' };
    }

    if (!hasResult) {
        return { key: 'claimed', label: 'Claimed', type: 'emoji', value: '⏳' };
    }

    if (hasDiscrepancy && hasThread) {
        return { key: 'discrepancy_thread', label: 'Discrepancy (thread exists)', type: 'emoji', value: '⚠️' };
    }
    if (hasDiscrepancy) {
        return { key: 'discrepancy', label: 'Discrepancy', type: 'emoji', value: '❗' };
    }
    if (inverseSuspected) {
        return { key: 'inverse_error', label: 'Inverse error suspected', type: 'emoji', value: '↕️' };
    }

    if (allMatching) {
        return { key: 'complete', label: 'Complete', type: 'image', value: 'images/compleated.webp' };
    }

    return { key: 'solved', label: 'Solved', type: 'emoji', value: '✅' };
}

/** Rendered markup for a status descriptor. */
export function renderMatchStatus(status) {
    if (!status) {
        return '';
    }

    const label = escapeHtml(status.label || '');
    if (status.type === 'image' && status.value) {
        return `<img src="${escapeHtml(status.value)}" alt="${label}" title="${label}" class="match-status-icon match-status-image" loading="lazy" />`;
    }

    if (!status.value) {
        return `<span class="match-status-icon match-status-empty" aria-label="${label}" title="${label}"></span>`;
    }

    return `<span class="match-status-icon" aria-label="${label}" title="${label}">${status.value}</span>`;
}
