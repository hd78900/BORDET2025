(function() {
  // Vérifier si nous sommes dans un navigateur
  if (typeof window === 'undefined') {
    return;
  }

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

  // Fonction pour créer l'iframe du widget
  function createWidgetIframe() {
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
      z-index: 999999 !important;
      width: 259px !important;
      height: 247px !important;
      border: none !important;
      background: transparent !important;
      pointer-events: auto !important;
      font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
      box-shadow: none !important;
      outline: none !important;
      transition: width 0.3s ease, height 0.3s ease !important;
    `;

    const iframe = document.createElement('iframe');
    iframe.src = WIDGET_CONFIG.baseUrl + '/widget/bot1';
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
    iframe.setAttribute('allow', 'clipboard-write');

    // Écouter les messages de l'iframe pour redimensionner le container
    window.addEventListener('message', function(event) {
      if (event.origin !== WIDGET_CONFIG.baseUrl) return;
      
      if (event.data.type === 'WIDGET_RESIZE') {
        const { width, height } = event.data;
        container.style.width = width + 'px';
        container.style.height = height + 'px';
      }
    });

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
            <a href="${WIDGET_CONFIG.baseUrl}" target="_blank" style="color: #3b82f6;">
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
  } catch (error) {
    console.error('Bordet Widget: Initialization failed', error);
  }
})();