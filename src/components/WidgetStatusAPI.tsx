import React from 'react';
import { useConfigStore } from '../store/configStore';

export default function WidgetStatusAPI() {
  const { widgetEnabled } = useConfigStore();

  // Injecter le statut dans le HTML
  React.useEffect(() => {
    // Supprimer les anciens scripts
    const existingScripts = document.head.querySelectorAll('script[data-widget-status]');
    existingScripts.forEach(script => script.remove());
    
    // Créer un nouveau script avec le statut
    const script = document.createElement('script');
    script.setAttribute('data-widget-status', 'true');
    script.textContent = `window.__WIDGET_STATUS__ = ${JSON.stringify({ 
      enabled: widgetEnabled, 
      timestamp: new Date().toISOString()
    })};`;
    document.head.appendChild(script);
    
    // Aussi stocker dans localStorage pour accès cross-origin
    try {
      localStorage.setItem('bordet_widget_status', JSON.stringify({
        enabled: widgetEnabled,
        timestamp: new Date().toISOString()
      }));
    } catch (e) {
      console.warn('Could not save to localStorage:', e);
    }
    
    console.log('WidgetStatusAPI: Status updated:', { enabled: widgetEnabled });

    return () => {
      const scripts = document.head.querySelectorAll('script[data-widget-status]');
      scripts.forEach(s => s.remove());
    };
  }, [widgetEnabled]);

  return null;
}