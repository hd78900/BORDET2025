(function() {
  if (typeof window === 'undefined') {
    return;
  }

  if (window.__BORDET_WIDGET_NAMESPACE__ && window.__BORDET_WIDGET_NAMESPACE__.loaded) {
    if (window.__BORDET_WIDGET_NAMESPACE__.cleanup) {
      window.__BORDET_WIDGET_NAMESPACE__.cleanup();
    }
  }

  window.__BORDET_WIDGET_NAMESPACE__ = window.__BORDET_WIDGET_NAMESPACE__ || {};
  window.__BORDET_WIDGET_NAMESPACE__.loaded = true;
  window.__BORDET_WIDGET_NAMESPACE__.version = '3.0.0';

  const WIDGET_CONFIG = {
    baseUrl: 'https://chatbordet.netlify.app',
    containerId: 'bordet-assistant-widget',
    expectedOrigin: 'https://chatbordet.netlify.app'
  };

  function validateOrigin(url) {
    try {
      var urlObj = new URL(url);
      return urlObj.origin === WIDGET_CONFIG.expectedOrigin;
    } catch (e) {
      return false;
    }
  }

  function createWidgetIframe() {
    var widgetUrl = WIDGET_CONFIG.baseUrl + '/widget/bot1';
    if (!validateOrigin(widgetUrl)) {
      return;
    }

    var existingWidget = document.getElementById(WIDGET_CONFIG.containerId);
    if (existingWidget) {
      existingWidget.remove();
    }

    var container = document.createElement('div');
    container.id = WIDGET_CONFIG.containerId;
    container.style.cssText = '\
      position: fixed !important;\
      bottom: 20px !important;\
      right: 20px !important;\
      z-index: 9999 !important;\
      width: 280px !important;\
      height: 270px !important;\
      border: none !important;\
      background: transparent !important;\
      pointer-events: auto !important;\
      font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif !important;\
      box-shadow: none !important;\
      outline: none !important;\
      transition: width 0.3s ease, height 0.3s ease !important;\
    ';

    var iframe = document.createElement('iframe');
    iframe.src = widgetUrl;
    iframe.style.cssText = '\
      width: 100% !important;\
      height: 100% !important;\
      border: none !important;\
      background: transparent !important;\
      border-radius: 0 !important;\
      box-shadow: none !important;\
      outline: none !important;\
      pointer-events: auto !important;\
    ';
    iframe.setAttribute('allowtransparency', 'true');
    iframe.setAttribute('frameborder', '0');
    iframe.setAttribute('scrolling', 'no');
    iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms');

    var messageHandler = function(event) {
      if (event.origin !== WIDGET_CONFIG.expectedOrigin) {
        return;
      }

      if (event.data.type === 'WIDGET_RESIZE') {
        var width = event.data.width;
        var height = event.data.height;
        container.style.width = width + 'px';
        container.style.height = height + 'px';
      }
    };

    window.addEventListener('message', messageHandler);
    window.__BORDET_WIDGET_NAMESPACE__.messageHandler = messageHandler;

    iframe.onerror = function() {
      container.innerHTML = '\
        <div style="\
          background: #f3f4f6;\
          border: 1px solid #d1d5db;\
          border-radius: 12px;\
          padding: 20px;\
          text-align: center;\
          color: #374151;\
          font-size: 14px;\
          pointer-events: auto;\
          box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);\
        ">\
          <p>Widget temporairement indisponible</p>\
          <p style="font-size: 12px; margin-top: 10px;">\
            <a href="' + WIDGET_CONFIG.expectedOrigin + '" target="_blank" style="color: #3b82f6;">\
              Ouvrir dans un nouvel onglet\
            </a>\
          </p>\
        </div>\
      ';
    };

    container.appendChild(iframe);
    document.body.appendChild(container);
  }

  window.__BORDET_WIDGET_NAMESPACE__.cleanup = function() {
    var container = document.getElementById(WIDGET_CONFIG.containerId);
    if (container) {
      container.remove();
    }
    if (window.__BORDET_WIDGET_NAMESPACE__.messageHandler) {
      window.removeEventListener('message', window.__BORDET_WIDGET_NAMESPACE__.messageHandler);
    }
    delete window.__BORDET_WIDGET_NAMESPACE__.loaded;
  };

  function init() {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', createWidgetIframe);
    } else {
      createWidgetIframe();
    }
  }

  try {
    init();
  } catch (error) {
    // Silent fail
  }
})();
