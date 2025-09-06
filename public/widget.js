(function() {
  // Vérifier si le widget est déjà chargé
  if (window.BordetWidgetLoaded) {
    return;
  }
  window.BordetWidgetLoaded = true;

  // Configuration du widget
  const WIDGET_CONFIG = {
    baseUrl: 'https://chatbordet.netlify.app',
    containerId: 'bordet-assistant-widget'
  };

  // Fonction pour charger les styles
  function loadStyles() {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = WIDGET_CONFIG.baseUrl + '/assets/index-MfRSMsMv.css';
    link.onerror = function() {
      console.warn('Bordet Widget: Could not load styles');
    };
    document.head.appendChild(link);
  }

  // Fonction pour créer l'iframe du widget
  function createWidgetIframe() {
    const container = document.createElement('div');
    container.id = WIDGET_CONFIG.containerId;
    container.style.cssText = `
      position: fixed !important;
      bottom: 20px !important;
      right: 20px !important;
      z-index: 999999 !important;
      width: 400px !important;
      height: 600px !important;
      border: none !important;
      background: transparent !important;
      pointer-events: none !important;
    `;

    const iframe = document.createElement('iframe');
    iframe.src = WIDGET_CONFIG.baseUrl + '/widget/bot1';
    iframe.style.cssText = `
      width: 100% !important;
      height: 100% !important;
      border: none !important;
      background: transparent !important;
      pointer-events: auto !important;
    `;
    iframe.setAttribute('allowtransparency', 'true');
    iframe.setAttribute('frameborder', '0');

    container.appendChild(iframe);
    document.body.appendChild(container);
  }

  // Fonction pour charger le script React
  function loadReactScript() {
    const script = document.createElement('script');
    script.src = WIDGET_CONFIG.baseUrl + '/assets/index-BA265XoQ.js';
    script.async = true;
    script.type = 'module';
    
    script.onload = function() {
      console.log('Bordet Widget: Script loaded successfully');
      // Créer l'iframe comme fallback si le script React ne fonctionne pas
      setTimeout(createWidgetIframe, 1000);
    };
    
    script.onerror = function() {
      console.warn('Bordet Widget: Could not load React script, using iframe fallback');
      createWidgetIframe();
    };
    
    document.head.appendChild(script);
  }

  // Attendre que le DOM soit prêt
  function init() {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', function() {
        loadStyles();
        loadReactScript();
      });
    } else {
      loadStyles();
      loadReactScript();
    }
  }

  // Initialiser le widget
  init();
})();