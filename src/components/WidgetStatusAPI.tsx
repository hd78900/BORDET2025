import React, { useEffect } from 'react';
import { useConfigStore } from '../store/configStore';

export default function WidgetStatusAPI() {
  const { widgetEnabled } = useConfigStore();

  useEffect(() => {
    // Retourner le statut du widget en JSON
    const response = {
      enabled: widgetEnabled,
      timestamp: new Date().toISOString()
    };

    // Envoyer la réponse
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({
        type: 'WIDGET_STATUS_RESPONSE',
        data: response
      }, '*');
    }

    // Pour les requêtes directes, on peut aussi utiliser fetch
    const handleFetch = (event: MessageEvent) => {
      if (event.data.type === 'WIDGET_STATUS_REQUEST') {
        event.source?.postMessage({
          type: 'WIDGET_STATUS_RESPONSE',
          data: response
        }, { targetOrigin: event.origin });
      }
    };

    window.addEventListener('message', handleFetch);
    return () => window.removeEventListener('message', handleFetch);
  }, [widgetEnabled]);

  // Retourner une réponse JSON pour les requêtes HTTP directes
  return (
    <div style={{ display: 'none' }}>
      {JSON.stringify({ enabled: widgetEnabled, timestamp: new Date().toISOString() })}
    </div>
  );
}