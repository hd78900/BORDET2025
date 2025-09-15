(function() {
  // Vérifier si nous sommes dans un navigateur
  if (typeof window === 'undefined') {
    return;
  }

  // Vérifier si le widget est déjà chargé
  if (window.__BORDET_WIDGET_LOADED__) {
    return;
  }
  
  window.__BORDET_WIDGET_LOADED__ = true;

  // Configuration du widget
  const WIDGET_CONFIG = {
    baseUrl: 'https://chatbordet.netlify.app',
    containerId: 'bordet-assistant-widget',
    statusUrl: 'https://chatbordet.netlify.app/api/widget-status'
  };

  // Fonction simple pour vérifier le statut
  async function checkWidgetStatus() {
    try {
      console.log('🔍 Widget: Checking status...');
      
      // Essayer d'abord l'API dédiée
      try {
        const response = await fetch(WIDGET_CONFIG.statusUrl, {
          method: 'GET',
          cache: 'no-cache'
        });
        
        if (response.ok) {
          const data = await response.json();
          console.log('✅ Widget: Status from API:', data);
          return data.enabled === true;
        }
      } catch (apiError) {
        console.log('⚠️ Widget: API not available, trying fallback');
      }
      
      // Fallback : vérifier via localStorage du site principal
      try {
        const response = await fetch(WIDGET_CONFIG.baseUrl, {
          method: 'GET',
          cache: 'no-cache'
        });
        
        if (response.ok) {
          const html = await response.text();
          
          // Chercher le statut dans le HTML
          const statusMatch = html.match(/window\.__WIDGET_STATUS__\s*=\s*({[^}]*})/);
          
          if (statusMatch) {
            const statusObj = JSON.parse(statusMatch[1]);
            console.log('✅ Widget: Status from HTML:', statusObj);
            return statusObj.enabled === true;
          }
        }
      } catch (htmlError) {
        console.log('⚠️ Widget: HTML check failed');
      }
      
      // Par défaut : activé (pour éviter les blocages)
      console.log('🔄 Widget: Using default status (enabled)');
      return true;
      
    } catch (error) {
      console.error('❌ Widget: Status check error:', error);
      return true; // Par défaut activé en cas d'erreur
    }
  }

  // Fonction pour créer le widget
  function createWidget() {
    console.log('🏗️ Widget: Creating widget');
    
    // Supprimer le widget existant
    const existing = document.getElementById(WIDGET_CONFIG.containerId);
    if (existing) {
      existing.remove();
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
      pointer-events: auto !important;
    `;

    const iframe = document.createElement('iframe');
    iframe.src = WIDGET_CONFIG.baseUrl + '/widget/bot1';
    iframe.style.cssText = `
      width: 100% !important;
      height: 100% !important;
      border: none !important;
      background: transparent !important;
    `;
    iframe.setAttribute('allowtransparency', 'true');
    iframe.setAttribute('frameborder', '0');

    // Gérer les messages de l'iframe
    window.addEventListener('message', function(event) {
      if (event.origin !== WIDGET_CONFIG.baseUrl) return;
      
      if (event.data.type === 'WIDGET_RESIZE') {
        container.style.width = event.data.width + 'px';
        container.style.height = event.data.height + 'px';
      }
      
      if (event.data.type === 'WIDGET_HIDDEN') {
        container.style.display = 'none';
      }
    });

    container.appendChild(iframe);
    document.body.appendChild(container);
    console.log('✅ Widget: Created successfully');
  }

  // Fonction pour supprimer le widget
  function removeWidget() {
    const existing = document.getElementById(WIDGET_CONFIG.containerId);
    if (existing) {
      existing.remove();
      console.log('🗑️ Widget: Removed successfully');
    }
  }

  // Fonction principale de gestion
  async function manageWidget() {
    const isEnabled = await checkWidgetStatus();
    const exists = document.getElementById(WIDGET_CONFIG.containerId);
    
    console.log('🎛️ Widget: Status =', isEnabled, ', Exists =', !!exists);
    
    if (isEnabled && !exists) {
      createWidget();
    } else if (!isEnabled && exists) {
      removeWidget();
    }
  }

  // Initialisation
  function init() {
    console.log('🚀 Widget: Initializing...');
    
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', manageWidget);
    } else {
      manageWidget();
    }
    
    // Vérification périodique toutes les 10 secondes
    setInterval(manageWidget, 10000);
  }

  // Démarrer
  init();
})();