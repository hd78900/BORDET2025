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
    // Hash d'intégrité pour vérification future
    expectedOrigin: 'https://chatbordet.netlify.app'
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

  // Fonction pour créer l'iframe du widget
  function createWidgetIframe() {
    createIframe();
  }

  // Fonction pour vérifier le statut du widget
  async function checkWidgetStatus() {
    try {
      // Faire une requête vers une page qui contient le statut
      const response = await fetch(WIDGET_CONFIG.baseUrl + '/', {
        method: 'GET',
        headers: {
          'Content-Type': 'application/json'
        }
      });
      
      if (response.ok) {
        const html = await response.text();
        // Chercher le statut dans le HTML de la page
        const match = html.match(/window\.__WIDGET_STATUS__\s*=\s*({[^}]+})/);
        if (match) {
          const status = JSON.parse(match[1]);
          return status.enabled === true;
        }
      }
      return false; // Par défaut, masquer le widget si on ne peut pas vérifier
    } catch (error) {
      console.warn('Bordet Widget: Could not check widget status, defaulting to disabled');
      return false;
    }
  }

  // Fonction pour créer l'iframe
  function createIframe() {
    // Vérifier d'abord si le widget est activé
    checkWidgetStatus().then(isEnabled => {
      if (!isEnabled) {
        console.log('Bordet Widget: Widget disabled from dashboard');
        // Supprimer le widget existant s'il y en a un
        const existingWidget = document.getElementById(WIDGET_CONFIG.containerId);
        if (existingWidget) {
          existingWidget.remove();
        }
        return;
      }
      
      // Continuer avec la création du widget
      createWidgetElement();
    }).catch(() => {
      // En cas d'erreur de vérification, masquer le widget par sécurité
      console.warn('Bordet Widget: Could not verify status, hiding widget');
      const existingWidget = document.getElementById(WIDGET_CONFIG.containerId);
      if (existingWidget) {
        existingWidget.remove();
      }
    });
  }

  // Fonction pour créer l'élément widget
  function createWidgetElement() {
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
        console.warn('Bordet Widget: Message from unauthorized origin:', event.origin);
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
      console.error('Bordet Widget: Failed to load iframe');
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

    console.log('Bordet Widget: Iframe widget loaded successfully');
  }

  // Fonction pour vérifier périodiquement le statut
  function startStatusMonitoring() {
    setInterval(() => {
      const existingWidget = document.getElementById(WIDGET_CONFIG.containerId);
      
      checkWidgetStatus().then(isEnabled => {
        if (isEnabled && !existingWidget) {
          // Widget activé mais pas présent -> le créer
          createWidgetElement();
        } else if (!isEnabled && existingWidget) {
          // Widget désactivé mais présent -> le supprimer
          existingWidget.remove();
        }
      }).catch(() => {
        // En cas d'erreur, supprimer le widget par sécurité
        if (existingWidget) {
          existingWidget.remove();
        }
      });
    }, 5000); // Vérifier toutes les 5 secondes
  }

  // Fonction de nettoyage (pour usage futur)
  window.__BORDET_WIDGET_NAMESPACE__.cleanup = function() {
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
  function init() {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', createWidgetIframe);
    } else {
      createWidgetIframe();
    }
  }

  // Initialiser le widget
  try {
    init();
    // Démarrer la surveillance du statut
    startStatusMonitoring();
  } catch (error) {
    console.error('Bordet Widget: Initialization failed', error);
  }
})();