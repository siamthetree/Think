/**
 * Early bootstrap script for Chinta reader.
 * Handles splash screen dismissal and suppresses development WebSocket errors
 * in Capacitor iOS WebViews without inline script tags in index.html.
 */

if (typeof window !== 'undefined') {
  // 1. Hide pre-splash placeholder as soon as root element has children
  const root = document.getElementById('root');
  const pre = document.getElementById('pre-splash');

  if (root && pre) {
    if (root.children.length > 0) {
      pre.classList.add('hidden');
      setTimeout(() => {
        pre.style.display = 'none';
      }, 200);
    } else {
      const observer = new MutationObserver(() => {
        if (root.children.length > 0) {
          pre.classList.add('hidden');
          setTimeout(() => {
            pre.style.display = 'none';
          }, 200);
          observer.disconnect();
        }
      });
      observer.observe(root, { childList: true });
    }
  }

  // 2. Suppress benign WebSocket reconnection errors in native iOS WebViews
  window.addEventListener('unhandledrejection', (e) => {
    const reason = (e && (e.reason || e)) as any;
    const msg = (reason && (reason.message || String(reason))) || '';
    if (msg.includes('WebSocket') || msg.includes('vite:ws')) {
      e.preventDefault();
    }
  });

  window.addEventListener('error', (e) => {
    const msg = (e && (e.message || String(e))) || '';
    if (msg.includes('WebSocket') || msg.includes('vite:ws')) {
      e.preventDefault();
    }
  });
}
