import React from 'react';
import { useConfigStore } from '../store/configStore';

export default function WidgetStatusAPI() {
  const { widgetEnabled } = useConfigStore();

  // Injecter le statut dans le HTML de la page avec plus de détails
  React.useEffect(() => {
    // Supprimer les anciens scripts de statut
    const existingScripts = document.head.querySelectorAll('script[data-widget-status]');
    existingScripts.forEach(script => script.remove());
    
    // Créer un nouveau script avec le statut
    const script = document.createElement('script');
    script.setAttribute('data-widget-status', 'true');
    script.textContent = `window.__WIDGET_STATUS__ = ${JSON.stringify({ 
      enabled: widgetEnabled, 
      timestamp: new Date().toISOString(),
      version: '1.0'
    })};`;
    document.head.appendChild(script);
    
    console.log('WidgetStatusAPI: Status updated:', { enabled: widgetEnabled });

    return () => {
      // Nettoyer le script lors du démontage
      const scripts = document.head.querySelectorAll('script[data-widget-status]');
      scripts.forEach(s => {
          s.remove();
      });
    };
  }, [widgetEnabled]);

  return null;
}