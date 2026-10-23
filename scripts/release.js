/**
 * Release identity for The Stylus.
 *
 * `APP_VERSION` in `sw.js` is a service-worker cache token, not a release name.
 * A release is named by the top heading in `CHANGELOG.md`, and this module is
 * the single place that reads it. It is deliberately pure: the release workflow
 * and the unit tests share one implementation, so the tag a human expects and
 * the tag CI pushes cannot drift apart.
 *
 * Versions are CalVer: `YYYY.MM`, or `YYYY.MM.PATCH` for a fix shipped between
 * monthly releases.
 *
 * This lives outside `js/` on purpose. Everything under `js/domain/` is
 * precached by the service worker and shipped to the browser; release tooling
 * must not be.
 */

import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';

const VERSION_PATTERN = /^\d{4}\.\d{2}(\.\d+)?$/;

/** Drop a leading `v` and surrounding whitespace. */
export function normalizeVersion(value) {
    return String(value ?? '').trim().replace(/^v/i, '');
}

/** True for CalVer `YYYY.MM` and `YYYY.MM.PATCH`. */
export function isValidVersion(value) {
    return VERSION_PATTERN.test(normalizeVersion(value));
}

/** The git tag for a version: `2026.10` -> `v2026.10`. */
export function tagName(version) {
    return `v${normalizeVersion(version)}`;
}

/**
 * The newest release in a changelog: the first `## [x.y] - date` heading whose
 * version is valid. Headings that are not versions (such as `[Unreleased]`) are
 * skipped, so a changelog may keep one. Returns null when there is none.
 */
export function parseLatestRelease(markdown) {
    for (const line of String(markdown ?? '').split(/\r?\n/)) {
        const match = line.match(/^##\s+\[([^\]]+)\]/);
        if (!match) continue;

        const version = normalizeVersion(match[1]);
        if (isValidVersion(version)) {
            return { version, tag: tagName(version) };
        }
    }

    return null;
}

/** Print the tag named by CHANGELOG.md, or nothing, when run as a script. */
function main() {
    const changelog = readFileSync(new URL('../CHANGELOG.md', import.meta.url), 'utf8');
    const release = parseLatestRelease(changelog);

    if (release) {
        process.stdout.write(release.tag);
    }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
    main();
}
