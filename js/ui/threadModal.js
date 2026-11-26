/**
 * Thread modal.
 *
 * Shows the copyable Discord "Guru Match Help" text for a match. Owns its
 * overlay, copy buttons and escape-key listener, and removes them on close.
 */
import { escapeHtml } from '../utils/domUtils.js';
import { logger } from '../utils/log.js';

function setupCopyButton(button, textToCopy, defaultTitle, textarea) {
    if (!button) {
        return;
    }
    button.addEventListener('click', () => {
        if (button.classList.contains('copy-thread-btn') && textarea) {
            textarea.select();
        }
        navigator.clipboard.writeText(textToCopy).then(() => {
            button.textContent = '✓';
            button.classList.remove('copy-failed');
            button.classList.add('copy-success');
            button.title = 'Copied!';
            setTimeout(() => {
                button.textContent = '📋';
                button.classList.remove('copy-success', 'copy-failed');
                button.title = defaultTitle;
            }, 2000);
        }).catch(err => {
            logger.error('Failed to copy:', err);
            button.textContent = '✗';
            button.classList.remove('copy-success');
            button.classList.add('copy-failed');
            button.title = 'Failed to copy';
        });
    });
}

export class ThreadModal {
    constructor() {
        this.overlay = null;
    }

    /**
     * @param {object} options
     * @param {string} options.titleText e.g. "Pod 3"
     * @param {string} options.threadText the copyable post body
     * @param {string} options.matchLink the deep link to the match
     * @param {string} options.writeupCommand
     */
    open({ titleText, threadText, writeupCommand }) {
        this.close();

        const overlay = document.createElement('div');
        overlay.className = 'thread-modal-overlay';

        const modal = document.createElement('div');
        modal.className = 'thread-modal';
        const textareaRows = (threadText.match(/\n/g) || []).length + 1;
        modal.innerHTML = `
            <div class="thread-modal-header">
                <h3>${escapeHtml(titleText)}</h3>
                <button class="copy-btn-icon copy-title-btn" title="Copy title to Clipboard">📋</button>
                <button class="close-thread-modal">&times;</button>
            </div>
            <div class="thread-modal-content">
                <p class="thread-modal-note">
                    <span>Copy this text to create a <a href="https://discord.com/channels/1051702336113889330/1145460704724398181" target="_blank" class="thread-modal-discord-link"><img src="images/Discord-Symbol-Blurple.svg" alt="Discord" class="thread-modal-discord-icon" />Guru Match Help post</a> for this match:</span>
                    <button class="copy-btn-icon copy-thread-btn" title="Copy to Clipboard">📋</button>
                </p>
                <textarea readonly class="thread-text-area" rows="${textareaRows}">${escapeHtml(threadText)}</textarea>
                <p class="thread-modal-note thread-modal-note-spaced">
                    <span>Then run this command in the thread:</span>
                    <button class="copy-btn-icon copy-writeup-btn" title="Copy command to Clipboard">📋</button>
                </p>
                <div class="writeup-command">${escapeHtml(writeupCommand)}</div>
            </div>
        `;

        overlay.appendChild(modal);
        document.body.appendChild(overlay);
        this.overlay = overlay;

        const textarea = modal.querySelector('.thread-text-area');
        textarea.select();

        setupCopyButton(modal.querySelector('.copy-title-btn'), titleText, 'Copy title to Clipboard');
        setupCopyButton(modal.querySelector('.copy-thread-btn'), threadText, 'Copy to Clipboard', textarea);
        setupCopyButton(modal.querySelector('.copy-writeup-btn'), writeupCommand, 'Copy command to Clipboard');

        this._onKeydown = (event) => {
            if (event.key === 'Escape') {
                this.close();
            }
        };
        document.addEventListener('keydown', this._onKeydown);
    }

    close() {
        if (this._onKeydown) {
            document.removeEventListener('keydown', this._onKeydown);
            this._onKeydown = null;
        }
        this.overlay?.remove();
        this.overlay = null;
    }

    destroy() {
        this.close();
    }
}
