/**
 * Thread modal.
 *
 * Shows the copyable Discord "Guru Match Help" text for a match. Owns its
 * overlay, copy buttons and escape-key listener, and removes them on close.
 */
import { escapeHtml } from '../utils/domUtils.js';

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
            button.style.color = '#28a745';
            button.title = 'Copied!';
            setTimeout(() => {
                button.textContent = '📋';
                button.style.color = '#5865F2';
                button.title = defaultTitle;
            }, 2000);
        }).catch(err => {
            console.error('Failed to copy:', err);
            button.textContent = '✗';
            button.style.color = '#dc3545';
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
                <button class="close-thread-modal" style="background: none; border: none; font-size: 24px; cursor: pointer; color: #666;">&times;</button>
            </div>
            <div class="thread-modal-content">
                <p style="margin-bottom: 10px; color: #666; display: flex; align-items: center; justify-content: space-between;">
                    <span>Copy this text to create a <a href="https://discord.com/channels/1051702336113889330/1145460704724398181" target="_blank" style="display: inline-flex; align-items: center; gap: 4px;"><img src="images/Discord-Symbol-Blurple.svg" alt="Discord" style="width: 16px; height: 16px; vertical-align: middle;" />Guru Match Help post</a> for this match:</span>
                    <button class="copy-btn-icon copy-thread-btn" title="Copy to Clipboard">📋</button>
                </p>
                <textarea readonly class="thread-text-area" rows="${textareaRows}" style="width: 100%; font-family: monospace; padding: 12px; border: 1px solid #ddd; border-radius: 4px; resize: none;">${escapeHtml(threadText)}</textarea>
                <p style="margin-top: 16px; margin-bottom: 10px; color: #666; display: flex; align-items: center; justify-content: space-between;">
                    <span>Then run this command in the thread:</span>
                    <button class="copy-btn-icon copy-writeup-btn" title="Copy command to Clipboard">📋</button>
                </p>
                <div style="font-family: monospace; padding: 12px; border: 1px solid #ddd; border-radius: 4px; background-color: #f5f5f5;">${escapeHtml(writeupCommand)}</div>
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
