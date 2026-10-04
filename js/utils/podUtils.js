/**
 * Pod utility functions
 */

/**
 * Convert a pod name to a pod code
 * Takes the first letter of the first word and the entire second word (if present)
 *
 * Examples:
 *   "Aspirant II" -> "A II"
 *   "Exemplar" -> "E"
 *   "Novice I" -> "N I"
 *
 * @param {string} podName - The full pod name (e.g., "Aspirant II")
 * @returns {string} The pod code (e.g., "A II")
 * @throws {Error} If the pod name has more than two words
 */
export function podNameToCode(podName) {
    if (!podName || typeof podName !== 'string') {
        throw new Error('Pod name must be a non-empty string');
    }

    const trimmed = podName.trim();
    if (trimmed === '') {
        throw new Error('Pod name cannot be empty');
    }

    const words = trimmed.split(/\s+/);

    if (words.length > 2) {
        throw new Error(`Pod name has too many words (${words.length}). Expected 1 or 2 words.`);
    }

    // First letter of first word
    const firstLetter = words[0].charAt(0).toUpperCase();

    // If there's a second word, add it with a space
    if (words.length === 2) {
        return `${firstLetter} ${words[1]}`;
    }

    // Just one word - return first letter
    return firstLetter;
}

/**
 * Convert a pod code into a human-readable pod name.
 *
 * The function maps the first character of the provided podCode (case-insensitive)
 * to a base name according to the following mapping:
 *   - 'N' → 'Novice'
 *   - 'A' → 'Aspirant'
 *   - 'C' → 'Contender'
 *   - 'E' → 'Exemplar'
 * It then concatenates this base name with the remainder of the podCode
 *
 * @param {string} podCode - The pod code to convert. Must be a non-empty string
 *                           whose first character is one of the recognized prefixes.
 * @returns {string} The human-readable pod name formed by concatenating the mapped
 *                   base name and the rest of the podCode.
 * @throws {Error} If podCode is not a valid non-empty string or if the first character
 *                 (after upper-casing) does not match one of the recognized prefixes.
 *
 * @example
 * podCodeToName('A II') // => 'Aspirant II'
 */
export function podCodeToName(podCode) {
    const map = {
        'N' : 'Novice',
        'A' : 'Aspirant',
        'C' : 'Contender',
        'E' : 'Exemplar'
    };

    const firstLetter = podCode.charAt(0).toUpperCase();

    const baseName = map[firstLetter];
    if (!baseName) {
        throw new Error(`Unknown pod code prefix: ${firstLetter}`);
    }

    return `${baseName}${podCode.slice(1)}`;
}