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

  // Configuration du widget avec limites de sécurité
  const WIDGET_CONFIG = {
    baseUrl: 'https://chatbordet.netlify.app',
    containerId: 'bordet-assistant-widget',
    expectedOrigin: 'https://chatbordet.netlify.app',
    // Limites de sécurité
    maxWidth: 500,
    maxHeight: 600,
    minWidth: 280,
    minHeight: 200
  };

  // Fonction de validation de l'origine
  function validateOrigin(url) {
    try {
      const urlObj = new URL(url);
      return urlObj.origin === WIDGET_CONFIG.expectedOrigin;
    } catch (e) {
      console.error('Bordet Widget: Invalid URL format');
      return false;
    }
  }

  // Fonction pour valider les dimensions
  function validateDimensions(width, height) {
    return (
      typeof width === 'number' && 
      typeof height === 'number' &&
      width >= WIDGET_CONFIG.minWidth && 
      width <= WIDGET_CONFIG.maxWidth &&
      height >= WIDGET_CONFIG.minHeight && 
      height <= WIDGET_CONFIG.maxHeight &&
      !isNaN(width) && 
      !isNaN(height)
    );
  }

  // Fonction pour vérifier les conflits avec des éléments critiques
  function checkForCriticalElements(container) {
    const criticalSelectors = [
      '[role="alert"]',
      '[role="dialog"]',
      '.modal',
      '.popup',
      '.notification',
      '.security-warning',
      '.cookie-banner',
      '.gdpr-notice',
      'button[type="submit"]',
      '.checkout-button',
      '.payment-button'
    ];
    
    const widgetRect = container.getBoundingClientRect();
    let hasConflict = false;
    
    criticalSelectors.forEach(selector => {
      const elements = document.querySelectorAll(selector);
      elements.forEach(el => {
        if (el.offsetParent !== null) { // Élément visible
          const rect = el.getBoundingClientRect();
          if (isOverlapping(widgetRect, rect)) {
            hasConflict = true;
            console.warn('Bordet Widget: Conflit détecté avec élément critique:', selector);
          }
        }
      });
    });
    
    // Déplacer le widget en cas de conflit
    if (hasConflict) {
      container.style.bottom = '50%';
      container.style.transform = 'translateY(50%)';
      container.style.right = '10px';
      console.log('Bordet Widget: Position ajustée pour éviter les conflits');
    }
    
    return hasConflict;
  }

  function isOverlapping(rect1, rect2) {
    return !(rect1.right < rect2.left || 
             rect1.left > rect2.right || 
             rect1.bottom < rect2.top || 
             rect1.top > rect2.bottom);
  }

  // Fonction pour créer l'iframe du widget
  function createWidgetIframe() {
    // Valider l'URL avant de créer l'iframe
    const widgetUrl = WIDGET_CONFIG.baseUrl + '/widget/bot1';
    if (!validateOrigin(widgetUrl)) {
      console.error('Bordet Widget: Origin validation failed');
      return;
    }

    // Supprimer le widget existant s'il y en a un
    const existingWidget = document.getElementById(WIDGET_CONFIG.containerId);
    if (existingWidget) {
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
      box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15) !important;
      border-radius: 12px !important;
      outline: none !important;
      transition: width 0.3s ease, height 0.3s ease, bottom 0.3s ease, transform 0.3s ease !important;
      max-width: ${WIDGET_CONFIG.maxWidth}px !important;
      max-height: ${WIDGET_CONFIG.maxHeight}px !important;
    `;

    const iframe = document.createElement('iframe');
    iframe.src = widgetUrl;
    iframe.style.cssText = `
      width: 100% !important;
      height: 100% !important;
      border: none !important;
      background: transparent !important;
      border-radius: 12px !important;
      box-shadow: none !important;
      outline: none !important;
      pointer-events: auto !important;
    `;
    iframe.setAttribute('allowtransparency', 'true');
    iframe.setAttribute('frameborder', '0');
    iframe.setAttribute('scrolling', 'no');
    
    // Sandbox restrictif - SANS clipboard-write
    iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-popups');
    
    // IMPORTANT: Pas de permission clipboard-write pour la sécurité
    // Si le clipboard est nécessaire, il faut le gérer côté iframe avec l'API moderne

    // Écouter les messages de l'iframe avec validation complète
    const messageHandler = function(event) {
      // Validation stricte de l'origine
      if (event.origin !== WIDGET_CONFIG.expectedOrigin) {
        console.warn('Bordet Widget: Message from unauthorized origin:', event.origin);
        return;
      }
      
      // Validation du format des données
      if (!event.data || typeof event.data !== 'object' || !event.data.type) {
        console.warn('Bordet Widget: Invalid message format');
        return;
      }
      
      // Traitement sécurisé des messages
      switch (event.data.type) {
        case 'WIDGET_RESIZE':
          const { width, height } = event.data;
          
          // Validation stricte des dimensions
          if (validateDimensions(width, height)) {
            container.style.width = width + 'px';
            container.style.height = height + 'px';
            
            // Vérifier les conflits après redimensionnement
            setTimeout(() => checkForCriticalElements(container), 100);
          } else {
            console.warn('Bordet Widget: Invalid dimensions received:', { width, height });
          }
          break;
          
        case 'WIDGET_HIDDEN':
          container.style.display = 'none';
          break;
          
        case 'WIDGET_SHOWN':
          container.style.display = 'block';
          checkForCriticalElements(container);
          break;
          
        case 'WIDGET_MINIMIZE':
          container.style.width = WIDGET_CONFIG.minWidth + 'px';
          container.style.height = WIDGET_CONFIG.minHeight + 'px';
          break;
          
        default:
          console.warn('Bordet Widget: Unknown message type:', event.data.type);
      }
    };

    window.addEventListener('message', messageHandler);
    
    // Stocker la référence pour nettoyage
    window.__BORDET_WIDGET_NAMESPACE__.messageHandler = messageHandler;

    // Gestion des erreurs de chargement avec timeout
    let loadTimeout = setTimeout(() => {
      console.error('Bordet Widget: Loading timeout');
      showErrorFallback();
    }, 10000);

    function showErrorFallback() {
      clearTimeout(loadTimeout);
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
          max-width: 100%;
          box-sizing: border-box;
        ">
          <p>🔒 Widget temporairement indisponible</p>
          <p style="font-size: 12px; margin-top: 10px;">
            <a href="${WIDGET_CONFIG.expectedOrigin}" target="_blank" rel="noopener noreferrer" style="color: #3b82f6; text-decoration: none;">
              Ouvrir dans un nouvel onglet →
            </a>
          </p>
        </div>
      `;
    }

    iframe.onerror = showErrorFallback;

    iframe.onload = function() {
      clearTimeout(loadTimeout);
      console.log('Bordet Widget: Loaded successfully');
      
      // Vérifier les conflits après chargement complet
      setTimeout(() => {
        checkForCriticalElements(container);
      }, 500);
    };

    container.appendChild(iframe);
    document.body.appendChild(container);

    // Vérification périodique des conflits (optionnel)
    const conflictCheckInterval = setInterval(() => {
      if (document.getElementById(WIDGET_CONFIG.containerId)) {
        checkForCriticalElements(container);
      } else {
        clearInterval(conflictCheckInterval);
      }
    }, 5000);

    // Stocker l'interval pour le cleanup
    window.__BORDET_WIDGET_NAMESPACE__.conflictCheckInterval = conflictCheckInterval;
  }

  // Fonction de nettoyage améliorée
  window.__BORDET_WIDGET_NAMESPACE__.cleanup = function() {
    const container = document.getElementById(WIDGET_CONFIG.containerId);
    if (container) {
      container.remove();
    }
    if (window.__BORDET_WIDGET_NAMESPACE__.messageHandler) {
      window.removeEventListener('message', window.__BORDET_WIDGET_NAMESPACE__.messageHandler);
      delete window.__BORDET_WIDGET_NAMESPACE__.messageHandler;
    }
    if (window.__BORDET_WIDGET_NAMESPACE__.conflictCheckInterval) {
      clearInterval(window.__BORDET_WIDGET_NAMESPACE__.conflictCheckInterval);
      delete window.__BORDET_WIDGET_NAMESPACE__.conflictCheckInterval;
    }
    delete window.__BORDET_WIDGET_NAMESPACE__.loaded;
    console.log('Bordet Widget: Cleanup completed');
  };

  // Cleanup automatique avant fermeture de page
  window.addEventListener('beforeunload', function() {
    if (window.__BORDET_WIDGET_NAMESPACE__ && window.__BORDET_WIDGET_NAMESPACE__.cleanup) {
      window.__BORDET_WIDGET_NAMESPACE__.cleanup();
    }
  });

  // Attendre que le DOM soit prêt
  function init() {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', createWidgetIframe);
    } else {
      createWidgetIframe();
    }
  }

  // Initialiser le widget avec gestion d'erreur robuste
  try {
    init();
  } catch (error) {
    console.error('Bordet Widget: Initialization failed', error);
    
    // Tentative de nettoyage en cas d'erreur
    if (window.__BORDET_WIDGET_NAMESPACE__ && window.__BORDET_WIDGET_NAMESPACE__.cleanup) {
      window.__BORDET_WIDGET_NAMESPACE__.cleanup();
    }
  }
})();