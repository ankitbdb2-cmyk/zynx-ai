/* PropMind Ghost — embeddable chat widget loader
 * ─────────────────────────────────────────────────────────────
 * Drop-in embed (works on WordPress, Wix, Squarespace, custom sites):
 *
 *   <script src="https://<host>/widget.js" data-agency="[slug]" defer></script>
 *
 * - Reads data-agency off its OWN <script> tag (no other markup needed).
 * - Creates its own container + iframe at runtime. The entire UI lives
 *   inside the iframe, so its CSS can never clash with the host site.
 * - Loads asynchronously and defers all DOM work so it never blocks paint.
 */
(function () {
    'use strict';

    if (window.__propmindWidgetInstalled) return;
    window.__propmindWidgetInstalled = true;

    var SCRIPT_SUFFIX = '/widget.js';

    function findScriptTag() {
        var tag = document.currentScript;
        if (tag && tag.src && tag.src.indexOf(SCRIPT_SUFFIX) !== -1) return tag;
        var scripts = document.getElementsByTagName('script');
        for (var i = 0; i < scripts.length; i++) {
            if (scripts[i].src && scripts[i].src.indexOf(SCRIPT_SUFFIX) !== -1) return scripts[i];
        }
        return null;
    }

    var scriptTag = findScriptTag();
    if (!scriptTag) return;

    // Base URL is derived from the script's own location, so it works on any
    // deployment domain, not just the hardcoded one.
    var BASE = scriptTag.src.slice(0, scriptTag.src.indexOf(SCRIPT_SUFFIX));
    var ORIGIN = (function () {
        try { return new URL(BASE).origin; } catch (e) { return window.location.origin; }
    })();
    var AGENCY = (scriptTag.getAttribute('data-agency') || '').trim();

    var installedId = 'propmind-widget-root';
    var container = null;
    var iframe = null;
    var isOpen = false;
    var created = false;

    function createWidget() {
        if (created) return;
        created = true;

        if (document.getElementById(installedId)) {
            container = document.getElementById(installedId);
            iframe = container.querySelector('iframe');
        } else {
            container = document.createElement('div');
            container.id = installedId;
            container.setAttribute('aria-live', 'polite');
            // Inline styles only — nothing that can collide with host CSS.
            container.style.position = 'fixed';
            container.style.right = '16px';
            container.style.bottom = '16px';
            container.style.width = '64px';
            container.style.height = '64px';
            container.style.zIndex = '2147483000';
            container.style.margin = '0';
            container.style.padding = '0';
            container.style.border = '0';
            container.style.outline = '0';

            iframe = document.createElement('iframe');
            iframe.setAttribute('title', 'Chat widget');
            iframe.setAttribute('allowtransparency', 'true');
            iframe.setAttribute('frameborder', '0');
            iframe.setAttribute('scrolling', 'no');
            iframe.style.width = '100%';
            iframe.style.height = '100%';
            iframe.style.border = '0';
            iframe.style.outline = '0';
            iframe.style.display = 'block';
            iframe.style.background = 'transparent';
            var qs = AGENCY ? '?agency=' + encodeURIComponent(AGENCY) : '';
            iframe.src = BASE + '/widget' + qs;

            container.appendChild(iframe);
            document.body.appendChild(container);
        }
    }

    function setSize(w, h) {
        if (!container) return;
        container.style.width = w + 'px';
        container.style.height = h + 'px';
    }

    function open() {
        if (!container) return;
        isOpen = true;
        // Responsive sizing based on the HOST viewport.
        var vw = window.innerWidth || document.documentElement.clientWidth || 0;
        var mobile = vw <= 480;
        var w = mobile ? Math.min(vw - 32, 370) : 370;
        var h = mobile ? Math.min((window.innerHeight || 600) - 96, 540) : 540;
        setSize(w, h);
        try {
            if (iframe && iframe.contentWindow) {
                iframe.contentWindow.focus();
                iframe.contentWindow.postMessage({ source: 'propmind-loader', type: 'opened' }, ORIGIN);
            }
        } catch (e) {}
    }

    function close() {
        if (!container) return;
        isOpen = false;
        setSize(64, 64);
    }

    function onMessage(event) {
        if (event.origin !== ORIGIN) return;
        var data = event.data;
        if (!data || data.source !== 'propmind-widget') return;
        if (event.source !== (iframe && iframe.contentWindow)) return;

        switch (data.type) {
            case 'open':
                open();
                break;
            case 'close':
                close();
                break;
            case 'ready':
                // Iframe finished loading — nothing to do yet; bubble is shown.
                break;
        }
    }

    // Expose a tiny public API for host pages that want programmatic control.
    function install() {
        try {
            if (window.addEventListener) {
                window.addEventListener('message', onMessage, false);
            } else if (window.attachEvent) {
                window.attachEvent('onmessage', onMessage);
            }
        } catch (e) {}

        createWidget();

        window.PropmindWidget = {
            agency: AGENCY,
            open: open,
            close: close,
            isOpen: function () { return isOpen; }
        };
    }

    // Non-blocking: defer until the browser is idle, else next tick.
    function ready(fn) {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', function () { ready(fn); });
            return;
        }
        if ('requestIdleCallback' in window) {
            window.requestIdleCallback(function () { fn(); }, { timeout: 2000 });
        } else {
            setTimeout(fn, 0);
        }
    }

    ready(install);
})();
