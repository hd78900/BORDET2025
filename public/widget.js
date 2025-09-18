(function() {
  // Vérifier si nous sommes dans un navigateur
  if (typeof window === 'undefined') {
    return;
  }

  // Vérifier si le widget est déjà chargé
  if (window.__BORDET_WIDGET_NAMESPACE__ && window.__BORDET_WIDGET_NAMESPACE__.loaded) {
    console.log('🔄 Bordet Widget: Widget déjà chargé, nettoyage...');
    if (window.__BORDET_WIDGET_NAMESPACE__.cleanup) {
      window.__BORDET_WIDGET_NAMESPACE__.cleanup();
    }
  }
  
  // Créer un namespace isolé
  window.__BORDET_WIDGET_NAMESPACE__ = window.__BORDET_WIDGET_NAMESPACE__ || {};
  window.__BORDET_WIDGET_NAMESPACE__.loaded = true;
  window.__BORDET_WIDGET_NAMESPACE__.version = '2.0.2';
  
  console.log('🚀 Bordet Widget v2.0.2: Initialisation...');

  // Configuration du widget avec fallback
  const WIDGET_CONFIG = {
    baseUrl: 'https://chatbordet.netlify.app',
    statusUrl: 'https://yyzfuqebakvgecekfqcw.supabase.co/functions/v1/widget-status',
    containerId: 'bordet-assistant-widget',
    expectedOrigin: 'https://chatbordet.netlify.app',
    // Configuration par défaut si l'API échoue
    fallbackConfig: {
      enabled: false, // DÉSACTIVÉ par défaut pour permettre le contrôle
      title: 'Assistant Bordet',
      welcome_message: 'Comment puis-je vous aider ?'
    }
  };

  // Fonction de validation de l'origine
  function validateOrigin(url) {
    try {
      const urlObj = new URL(url);
      return urlObj.origin === WIDGET_CONFIG.expectedOrigin;
    } catch (e) {
      console.error('❌ Bordet Widget: Invalid URL format');
      return false;
    }
  }

  // Fonction pour vérifier le statut du widget avec fallback
  async function checkWidgetStatus() {
    try {
      console.log('🔍 Bordet Widget: Vérification du statut...', WIDGET_CONFIG.statusUrl);
      
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 5000); // Timeout 5s
      
      const response = await fetch(WIDGET_CONFIG.statusUrl, {
        signal: controller.signal,
        headers: {
          'Accept': 'application/json',
          'Content-Type': 'application/json'
        }
      });
      
      clearTimeout(timeoutId);
      console.log('🔍 Bordet Widget: Response status:', response.status);
      
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
      
      const data = await response.json();
      console.log('🔍 Bordet Widget: Statut reçu:', data);
      
      // Vérifier si la réponse contient les bonnes propriétés
      if (typeof data.enabled === 'boolean') {
        return {
          enabled: data.enabled,
          title: data.title || WIDGET_CONFIG.fallbackConfig.title,
          welcome_message: data.welcome_message || WIDGET_CONFIG.fallbackConfig.welcome_message,
          debug: data.debug || 'API Success'
        };
      } else {
        throw new Error('Invalid API response format');
      }
      
    } catch (error) {
      console.warn('⚠️ Bordet Widget: API indisponible, utilisation de la configuration par défaut:', error.message);
      
      // Retourner la configuration par défaut
      return {
        ...WIDGET_CONFIG.fallbackConfig,
        debug: `Fallback mode: ${error.message}`
      };
    }
  }

  // Fonction pour masquer/supprimer le widget
  function hideWidget() {
    const container = document.getElementById(WIDGET_CONFIG.containerId);
    if (container) {
      container.remove();
      console.log('🗑️ Bordet Widget: Widget supprimé du DOM');
    }
  }

  // Fonction pour créer l'iframe du widget
  async function createWidgetIframe() {
    // Vérifier d'abord le statut du widget
    const status = await checkWidgetStatus();
    
    console.log('✅ Bordet Widget: Status enabled:', status.enabled, 'Debug:', status.debug);
    
    if (!status.enabled) {
      console.log('🚫 Bordet Widget: Widget désactivé - suppression');
      hideWidget();
      return;
    }

    // Valider l'URL avant de créer l'iframe
    const widgetUrl = WIDGET_CONFIG.baseUrl + '/widget/bot1';
    if (!validateOrigin(widgetUrl)) {
      console.error('❌ Bordet Widget: Origin validation failed');
      return;
    }

    // Supprimer le widget existant s'il y en a un
    const existingWidget = document.getElementById(WIDGET_CONFIG.containerId);
    if (existingWidget) {
      existingWidget.remove();
      console.log('🔄 Bordet Widget: Widget existant supprimé');
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

    // Écouter les messages de l'iframe pour redimensionner le container
    const messageHandler = function(event) {
      // Validation stricte de l'origine
      if (event.origin !== WIDGET_CONFIG.expectedOrigin) {
        console.warn('⚠️ Bordet Widget: Message from unauthorized origin:', event.origin);
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
    
    // Stocker la référence pour nettoyage éventuel
    window.__BORDET_WIDGET_NAMESPACE__.messageHandler = messageHandler;

    // Gestion des erreurs de chargement de l'iframe
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
          <p style="font-size: 12px; margin-top: 10px;">
            <a href="${WIDGET_CONFIG.expectedOrigin}" target="_blank" style="color: #3b82f6;">
              Ouvrir dans un nouvel onglet
            </a>
          </p>
        </div>
      `;
    };

    container.appendChild(iframe);
    document.body.appendChild(container);

    console.log('✅ Bordet Widget: Iframe widget loaded successfully');
  }

  // Fonction pour vérifier périodiquement le statut (moins fréquent pour éviter le spam)
  function startStatusMonitoring() {
    console.log('🔄 Bordet Widget: Démarrage de la surveillance du statut (toutes les 30s)');
    
    // Vérifier toutes les 30 secondes (plus raisonnable)
    setInterval(async () => {
      const status = await checkWidgetStatus();
      console.log('🔄 Bordet Widget: Vérification périodique, enabled:', status.enabled, 'Debug:', status.debug);
      
      const currentWidget = document.getElementById(WIDGET_CONFIG.containerId);
      
      if (!status.enabled && currentWidget) {
        console.log('🚫 Bordet Widget: Widget désactivé - suppression en cours');
        hideWidget();
      } else if (status.enabled && !currentWidget) {
        console.log('✅ Bordet Widget: Widget activé - création en cours');
        await createWidgetIframe();
      }
    }, 30000); // 30 secondes
  }

  // Fonction de nettoyage
  window.__BORDET_WIDGET_NAMESPACE__.cleanup = function() {
    console.log('🧹 Bordet Widget: Nettoyage en cours...');
    const container = document.getElementById(WIDGET_CONFIG.containerId);
    if (container) {
      container.remove();
    }
    if (window.__BORDET_WIDGET_NAMESPACE__.messageHandler) {
      window.removeEventListener('message', window.__BORDET_WIDGET_NAMESPACE__.messageHandler);
    }
    delete window.__BORDET_WIDGET_NAMESPACE__.loaded;
  };

  // Attendre que le DOM soit prêt
  async function init() {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', createWidgetIframe);
    } else {
      await createWidgetIframe();
    }
    
    // Démarrer la surveillance du statut
    startStatusMonitoring();
  }

  // Initialiser le widget
  try {
    init();
  } catch (error) {
    console.error('❌ Bordet Widget: Initialization failed', error);
  }
})();