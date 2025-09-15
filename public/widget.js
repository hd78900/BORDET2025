(function() {
  // Vérifier si nous sommes dans un navigateur
  if (typeof window === 'undefined') {
    return;
  }

  // Vérifier si le widget est déjà chargé
  if (window.__BORDET_WIDGET_NAMESPACE__ && window.__BORDET_WIDGET_NAMESPACE__.loaded) {
    return;
  }
  
  // Créer un namespace isolé
  window.__BORDET_WIDGET_NAMESPACE__ = window.__BORDET_WIDGET_NAMESPACE__ || {};
  window.__BORDET_WIDGET_NAMESPACE__.loaded = true;

  // Configuration du widget
  const WIDGET_CONFIG = {
    baseUrl: 'https://chatbordet.netlify.app',
    containerId: 'bordet-assistant-widget',
    expectedOrigin: 'https://chatbordet.netlify.app'
  };

  // Fonction pour vérifier le statut du widget via API
  async function checkWidgetStatus() {
    try {
      console.log('🔍 Bordet Widget: Checking status...');
      
      // Faire une requête vers l'API de statut
      const response = await fetch(WIDGET_CONFIG.baseUrl + '/widget/bot1', {
        method: 'GET',
        headers: {
          'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
        },
        cache: 'no-cache'
      });
      
      if (!response.ok) {
        console.warn('🚨 Bordet Widget: Status check failed, response not ok');
        return false; // Par défaut désactivé si erreur
      }
      
      const html = await response.text();
      console.log('📄 Bordet Widget: HTML received, length:', html.length);
      
      // Chercher le statut dans le HTML
      const statusMatch = html.match(/window\.__WIDGET_STATUS__\s*=\s*({[^}]*})/);
      
      if (statusMatch) {
        try {
          const statusObj = JSON.parse(statusMatch[1]);
          console.log('✅ Bordet Widget: Status found:', statusObj);
          return statusObj.enabled === true;
        } catch (parseError) {
          console.error('❌ Bordet Widget: Failed to parse status:', parseError);
          return false;
        }
      } else {
        console.warn('⚠️ Bordet Widget: No status found in HTML');
        return false;
      }
    } catch (error) {
      console.error('❌ Bordet Widget: Status check error:', error);
      return false; // Par défaut désactivé si erreur
    }
  }

  // Fonction pour créer l'élément widget
  function createWidgetElement() {
    console.log('🏗️ Bordet Widget: Creating widget element');
    
    const widgetUrl = WIDGET_CONFIG.baseUrl + '/widget/bot1';

    // Supprimer le widget existant s'il y en a un
    const existingWidget = document.getElementById(WIDGET_CONFIG.containerId);
    if (existingWidget) {
      console.log('🗑️ Bordet Widget: Removing existing widget');
      existingWidget.remove();
    }

    const container = document.createElement('div');
    container.id = WIDGET_CONFIG.containerId;
    container.style.cssText = `
      position: fixed !important;
      bottom: 20px !important;
      right: 20px !important;
      z-index: 9999 !important;
      width: 280px !important;
      height: 270px !important;
      border: none !important;
      background: transparent !important;
      pointer-events: auto !important;
      font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
      box-shadow: none !important;
      outline: none !important;
      transition: width 0.3s ease, height 0.3s ease !important;
    `;

    const iframe = document.createElement('iframe');
    iframe.src = widgetUrl;
    iframe.style.cssText = `
      width: 100% !important;
      height: 100% !important;
      border: none !important;
      background: transparent !important;
      border-radius: 0 !important;
      box-shadow: none !important;
      outline: none !important;
      pointer-events: auto !important;
    `;
    iframe.setAttribute('allowtransparency', 'true');
    iframe.setAttribute('frameborder', '0');
    iframe.setAttribute('scrolling', 'no');
    iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms');

    // Écouter les messages de l'iframe
    const messageHandler = function(event) {
      if (event.origin !== WIDGET_CONFIG.expectedOrigin) {
        return;
      }
      
      if (event.data.type === 'WIDGET_RESIZE') {
        const { width, height } = event.data;
        container.style.width = width + 'px';
        container.style.height = height + 'px';
      }
      
      if (event.data.type === 'WIDGET_HIDDEN') {
        container.style.display = 'none';
      }
    };

    window.addEventListener('message', messageHandler);
    window.__BORDET_WIDGET_NAMESPACE__.messageHandler = messageHandler;

    iframe.onerror = function() {
      console.error('❌ Bordet Widget: Failed to load iframe');
      container.innerHTML = `
        <div style="
          background: #f3f4f6;
          border: 1px solid #d1d5db;
          border-radius: 12px;
          padding: 20px;
          text-align: center;
          color: #374151;
          font-size: 14px;
          pointer-events: auto;
          box-shadow: 0 4px 6px rgba(0, 0, 0, 0.1);
        ">
          <p>Widget temporairement indisponible</p>
        </div>
      `;
    };

    container.appendChild(iframe);
    document.body.appendChild(container);
    console.log('✅ Bordet Widget: Widget created successfully');
  }

  // Fonction pour supprimer le widget
  function removeWidget() {
    console.log('🗑️ Bordet Widget: Removing widget');
    const existingWidget = document.getElementById(WIDGET_CONFIG.containerId);
    if (existingWidget) {
      existingWidget.remove();
      console.log('✅ Bordet Widget: Widget removed successfully');
    }
  }

  // Fonction pour gérer l'état du widget
  async function manageWidget() {
    const isEnabled = await checkWidgetStatus();
    const existingWidget = document.getElementById(WIDGET_CONFIG.containerId);
    
    console.log('🎛️ Bordet Widget: Managing widget - Enabled:', isEnabled, 'Exists:', !!existingWidget);
    
    if (isEnabled && !existingWidget) {
      console.log('➕ Bordet Widget: Creating widget (enabled and not present)');
      createWidgetElement();
    } else if (!isEnabled && existingWidget) {
      console.log('➖ Bordet Widget: Removing widget (disabled but present)');
      removeWidget();
    } else {
      console.log('⏸️ Bordet Widget: No action needed');
    }
  }

  // Fonction de nettoyage
  window.__BORDET_WIDGET_NAMESPACE__.cleanup = function() {
    removeWidget();
    if (window.__BORDET_WIDGET_NAMESPACE__.messageHandler) {
      window.removeEventListener('message', window.__BORDET_WIDGET_NAMESPACE__.messageHandler);
    }
    if (window.__BORDET_WIDGET_NAMESPACE__.interval) {
      clearInterval(window.__BORDET_WIDGET_NAMESPACE__.interval);
    }
    delete window.__BORDET_WIDGET_NAMESPACE__.loaded;
  };

  // Fonction d'initialisation
  function init() {
    console.log('🚀 Bordet Widget: Initializing...');
    
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', manageWidget);
    } else {
      manageWidget();
    }
    
    // Démarrer la surveillance périodique
    window.__BORDET_WIDGET_NAMESPACE__.interval = setInterval(manageWidget, 5000);
    console.log('⏰ Bordet Widget: Status monitoring started (every 5s)');
  }

  // Initialiser le widget
  try {
    init();
  } catch (error) {
    console.error('❌ Bordet Widget: Initialization failed', error);
  }
})();