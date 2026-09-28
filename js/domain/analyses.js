/**
 * Pure analysis helpers.
 *
 * No DOM, no gapi, no fetch, no instance state: every function takes the data
 * it needs as arguments. GuruAnalysisInterface keeps thin delegators so its
 * call sites are unchanged.
 */
import { GURU_COLORS, getCurrentColorAnalysis } from './guruColor.js';

/**
 * Resolve the match outcome from the guru analyses, one value per guru colour.
 *
 * Takes the analyses positionally (a value per entry in GURU_COLORS) so callers
 * spread a colour-ordered list. Comparison is on raw strings, so '1.0' and '1'
 * are a Discrepancy even though they are the same score. That is the documented
 * contract; see AGENTS.md.
 */
export function calculateOutcomeFromAnalyses(...guruAnalyses) {
    // Collect all guru analyses
    const analyses = [];

    for (const value of guruAnalyses) {
        if (value && value.trim() !== '') {
            analyses.push(value.trim());
        }
    }

    // If any guru's analysis is missing, it's incomplete
    const expectedAnalyses = GURU_COLORS.length;
    if (analyses.length < expectedAnalyses) {
        return 'Incomplete';
    }

    // Check if all analyses are the same
    const uniqueAnalyses = [...new Set(analyses)];
    if (uniqueAnalyses.length === 1) {
        // All analyses are the same, return that value
        return uniqueAnalyses[0];
    } else {
        // There are differences, it's a discrepancy
        return 'Discrepancy';
    }
}

/**
 * Normalise an analysis for equality checks by other helpers: numeric formats
 * collapse ('1.0' -> '1'), everything else is lower-cased. This is deliberately
 * not used by calculateOutcomeFromAnalyses.
 */
export function normalizeAnalysisForComparison(value) {
    if (value == null) {
        return '';
    }
    const str = value.toString().trim();
    if (!str) {
        return '';
    }
    const num = parseFloat(str);
    if (!isNaN(num)) {
        return num.toString();
    }
    return str.toLowerCase();
}

/** The three guru analysis slots of a row, always in Red/Blue/Green order. */
export function getGuruAnalysisValues(row) {
    if (!row) {
        return [];
    }
    return GURU_COLORS.map(colour => getCurrentColorAnalysis(row, colour));
}

/** Convert an analysis value to a single W/T/L letter. */
export function analysisToLetter(value) {
    const numValue = parseFloat(value);
    if (numValue === 1.0) return 'W';
    if (numValue === 0.5) return 'T';
    if (numValue === 0.0) return 'L';
    return '?';
}

/** CSS class name for a numeric analysis value. */
export function getAnalysisClass(value) {
    if (!value || value.trim() === '') return 'other';

    const numValue = parseFloat(value);
    if (!isNaN(numValue)) {
        if (numValue === 1.0) return 'win';
        if (numValue === 0.5) return 'tie';
        if (numValue === 0.0) return 'loss';
    }

    return 'other';
}

/** Human-readable analysis value for display. */
export function formatAnalysisValue(value) {
    if (!value || value.trim() === '') return 'Not set';

    const numValue = parseFloat(value);
    if (!isNaN(numValue)) {
        if (numValue === 1.0) return 'Win (1.0)';
        if (numValue === 0.5) return 'Tie (0.5)';
        if (numValue === 0.0) return 'Loss (0.0)';
        return `Custom (${numValue})`;
    }

    return value.toString();
}

/** Human-readable label for an analysis value (Win/Tie/Loss). */
export function getAnalysisLabel(value) {
    if (value === 1.0) return 'Win';
    if (value === 0.5) return 'Tie';
    if (value === 0.0) return 'Loss';
    return value.toString();
}

/**
 * The current outcome cell's text and CSS class, plus the numeric value when
 * the outcome parses as a number. Used by the analysis view to render the
 * scoring-value element.
 */
export function describeOutcome(outcomeValue) {
    if (!outcomeValue) {
        return { text: 'Not set', className: 'scoring-value', analysisValue: null };
    }

    const outcome = outcomeValue.toLowerCase().trim();

    if (outcome === 'discrepancy') {
        return { text: 'Discrepancy', className: 'scoring-value discrepancy', analysisValue: null };
    }
    if (outcome === 'incomplete') {
        return { text: 'Incomplete', className: 'scoring-value', analysisValue: null };
    }

    const numValue = parseFloat(outcomeValue);
    if (!isNaN(numValue)) {
        if (numValue === 1.0) return { text: 'Win (1.0)', className: 'scoring-value', analysisValue: numValue };
        if (numValue === 0.5) return { text: 'Tie (0.5)', className: 'scoring-value', analysisValue: numValue };
        if (numValue === 0.0) return { text: 'Loss (0.0)', className: 'scoring-value', analysisValue: numValue };
        return { text: `Custom (${numValue})`, className: 'scoring-value', analysisValue: numValue };
    }

    return { text: outcomeValue, className: 'scoring-value', analysisValue: null };
}

/** Human-readable label for an outcome value, including the text states. */
export function getOutcomeDisplayName(outcomeValue) {
    if (!outcomeValue || outcomeValue.trim() === '') return '';

    const value = outcomeValue.toLowerCase().trim();

    // Handle special outcome values
    if (value === 'discrepancy') return 'Discrepancy';
    if (value === 'incomplete') return 'Incomplete';

    // Try to parse as numeric value for consistent display
    const numValue = parseFloat(outcomeValue);
    if (!isNaN(numValue)) {
        if (numValue === 1.0) return 'Win';
        if (numValue === 0.5) return 'Tie';
        if (numValue === 0.0) return 'Loss';
        return `Custom (${numValue})`;
    }

    // Return the original value with proper capitalization
    return outcomeValue.charAt(0).toUpperCase() + outcomeValue.slice(1).toLowerCase();
}

/**
 * Build the W/T/L correction suffix shown in the Discord thread text, e.g.
 * "W/T -> L". Returns '' when the current guru agrees with everyone else.
 */
export function buildCorrectionString(row, currentAnalysis) {
    if (!currentAnalysis || currentAnalysis.trim() === '') {
        return '';
    }

    // Get all analyses (Red/Blue/Green order), dropping the empty slots
    const allAnalyses = getGuruAnalysisValues(row).filter(a => a && a.trim() !== '');

    // Get current guru analysis value
    const currentValue = parseFloat(currentAnalysis);

    // Filter out analyses equal to current guru's analysis and remove duplicates
    const differentAnalyses = [...new Set(allAnalyses.filter(a => parseFloat(a) !== currentValue))];

    // If all other analyses are the same as current, no correction needed
    if (differentAnalyses.length === 0) {
        return '';
    }

    // Build the correction string
    const otherLetters = differentAnalyses.map(analysisToLetter).join('/');
    const currentLetter = analysisToLetter(currentAnalysis);

    return `\n\n${otherLetters} -> ${currentLetter}`;
}
