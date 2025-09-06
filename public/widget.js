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

  // Fonction pour créer l'iframe du widget (méthode principale)
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
      width: 400px !important;
      height: 600px !important;
      border: none !important;
      background: transparent !important;
      pointer-events: none !important;
      font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
    `;

    const iframe = document.createElement('iframe');
    iframe.src = WIDGET_CONFIG.baseUrl + '/widget/bot1';
    iframe.style.cssText = `
      width: 100% !important;
      height: 100% !important;
      border: none !important;
      background: transparent !important;
      pointer-events: auto !important;
      border-radius: 12px !important;
      box-shadow: 0 10px 25px rgba(0, 0, 0, 0.15) !important;
    `;
    iframe.setAttribute('allowtransparency', 'true');
    iframe.setAttribute('frameborder', '0');
    iframe.setAttribute('scrolling', 'no');
    iframe.setAttribute('allow', 'clipboard-write');

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