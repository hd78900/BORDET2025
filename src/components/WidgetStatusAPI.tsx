import React from 'react';
import { useConfigStore } from '../store/configStore';

export default function WidgetStatusAPI() {
  const { widgetEnabled } = useConfigStore();

  // Injecter le statut dans le HTML de la page
  React.useEffect(() => {
    const script = document.createElement('script');
    script.textContent = `window.__WIDGET_STATUS__ = ${JSON.stringify({ 
      enabled: widgetEnabled, 
      timestamp: new Date().toISOString() 
    })};`;
    document.head.appendChild(script);

    return () => {
      // Nettoyer le script lors du démontage
      const scripts = document.head.querySelectorAll('script');
      scripts.forEach(s => {
        if (s.textContent?.includes('__WIDGET_STATUS__')) {
          s.remove();
        }
      });
    };
  }, [widgetEnabled]);

  return null;
}