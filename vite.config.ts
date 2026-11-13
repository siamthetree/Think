import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig, type Plugin } from 'vite';

function suppressViteHmrPlugin(): Plugin {
  return {
    name: 'suppress-vite-hmr-client',
    apply: 'serve',
    transformIndexHtml: {
      order: 'pre',
      handler() {
        return [
          {
            tag: 'script',
            children: `
              (function() {
                var NativeWS = window.WebSocket;
                if (typeof NativeWS !== 'undefined') {
                  window.WebSocket = function(url, protocols) {
                    var urlStr = String(url || '');
                    var protoStr = String(protocols || '');
                    if (protoStr.indexOf('vite') !== -1 || urlStr.indexOf('token=') !== -1 || urlStr.indexOf('vite-') !== -1) {
                      var listeners = {};
                      var dummy = {
                        readyState: 1,
                        url: urlStr,
                        protocol: protocols,
                        send: function() {},
                        close: function() {},
                        addEventListener: function(type, fn) {
                          listeners[type] = listeners[type] || [];
                          listeners[type].push(fn);
                          if (type === 'open') {
                            setTimeout(function() {
                              try { fn({ type: 'open', target: dummy }); } catch(e) {}
                            }, 0);
                          }
                        },
                        removeEventListener: function(type, fn) {
                          if (listeners[type]) {
                            listeners[type] = listeners[type].filter(function(f) { return f !== fn; });
                          }
                        },
                        dispatchEvent: function() { return true; }
                      };
                      return dummy;
                    }
                    return new NativeWS(url, protocols);
                  };
                  window.WebSocket.prototype = NativeWS.prototype;
                  window.WebSocket.CONNECTING = 0;
                  window.WebSocket.OPEN = 1;
                  window.WebSocket.CLOSING = 2;
                  window.WebSocket.CLOSED = 3;
                }
                window.addEventListener('unhandledrejection', function(e) {
                  var r = e && (e.reason || e);
                  var m = r && (r.message || String(r));
                  if (m && (m.indexOf('WebSocket') !== -1 || m.indexOf('vite:ws') !== -1)) {
                    e.preventDefault();
                  }
                });
                window.addEventListener('error', function(e) {
                  var m = e && (e.message || String(e));
                  if (m && (m.indexOf('WebSocket') !== -1 || m.indexOf('vite:ws') !== -1)) {
                    e.preventDefault();
                  }
                });
              })();
            `,
            injectTo: 'head-prepend',
          },
        ];
      },
    },
  };
}

function productionCspPlugin(): Plugin {
  const csp =
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self' https:; frame-src 'none'; object-src 'none'; base-uri 'self'; form-action 'none'";

  return {
    name: 'production-csp',
    apply: 'build',
    transformIndexHtml(html: string) {
      const cspTag = `<meta http-equiv="Content-Security-Policy" content="${csp}" />`;
      return html.replace('</head>', `  ${cspTag}\n  </head>`);
    },
  };
}

export default defineConfig(() => {
  return {
    plugins: [suppressViteHmrPlugin(), productionCspPlugin(), react(), tailwindcss()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      },
    },
    server: {
      host: '0.0.0.0',
      port: 3000,
      allowedHosts: true as const,
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify: file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
