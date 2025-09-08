import React, { useState, useEffect } from 'react';
import { chatbots } from '../config/chatbots';
import { checkPineconeStatus, checkMistralStatus } from '../lib/api';
import { RefreshCw, Save, CheckCircle2, Sliders, ExternalLink, Code, Copy, Check } from 'lucide-react';
import { useConfigStore } from '../store/configStore';
import type { MistralModel } from '../types';
import PublicWidget from '../components/PublicWidget';

const MISTRAL_MODELS = [
  { id: 'mistral-tiny', name: 'Tiny', description: 'Rapide et économique' },
  { id: 'mistral-small', name: 'Small', description: 'Bon équilibre performance/coût' },
  { id: 'mistral-medium', name: 'Medium', description: 'Performances avancées' },
  { id: 'mistral-large-latest', name: 'Large', description: 'Meilleures performances' },
];

export default function Settings() {
  const { 
    model, 
    testMode,
    temperature,
    systemPrompt,
    contextRules,
    widgetEnabled,
    widgetTitle,
    widgetWelcomeMessage
  } = useConfigStore();

  const [stats, setStats] = useState({
    apiStatus: 'Chargement...',
    pineconeStatus: {},
    lastRefresh: new Date(),
    isRefreshing: false
  });
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [showPreview, setShowPreview] = useState(false);
  const [copiedCode, setCopiedCode] = useState(false);
  const [localConfig, setLocalConfig] = useState({
    temperature,
    systemPrompt,
    contextRules,
    widgetEnabled,
    widgetTitle,
    widgetWelcomeMessage
  });

  useEffect(() => {
    setLocalConfig({
      temperature,
      systemPrompt,
      contextRules,
      widgetEnabled,
      widgetTitle,
      widgetWelcomeMessage
    });
  }, [temperature, systemPrompt, contextRules, widgetEnabled, widgetTitle, widgetWelcomeMessage]);

  const handleSaveConfig = () => {
    setIsSaving(true);
    try {
      useConfigStore.setState({ 
        model,
        testMode,
        ...localConfig
      });
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } finally {
      setIsSaving(false);
    }
  };

  const handleCopyCode = async () => {
    const code = `<script>
  (function() {
    const script = document.createElement('script');
    script.src = '${window.location.origin}/widget.js';
    script.async = true;
    document.head.appendChild(script);
  })();
</script>`;
    
    try {
      await navigator.clipboard.writeText(code);
      setCopiedCode(true);
      setTimeout(() => setCopiedCode(false), 2000);
    } catch (err) {
      console.error('Failed to copy code:', err);
    }
  };

  const refreshStatus = async () => {
    setStats(prev => ({ ...prev, isRefreshing: true }));
    try {
      const mistralStatus = await checkMistralStatus();
      const pineconeStatuses = await Promise.all(
        chatbots.map(async bot => {
          const status = await checkPineconeStatus(bot.pineconeIndex);
          return {
            ...bot,
            status
          };
        })
      );

      setStats({
        apiStatus: mistralStatus.status,
        pineconeStatus: pineconeStatuses.reduce((acc, curr) => ({
          ...acc,
          [curr.id]: curr.status
        }), {}),
        lastRefresh: new Date(),
        isRefreshing: false
      });
    } catch (error) {
      console.error('Error refreshing status:', error);
      setStats(prev => ({
        ...prev,
        isRefreshing: false
      }));
    }
  };

  useEffect(() => {
    refreshStatus();
    const interval = setInterval(refreshStatus, 30000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="space-y-8">
      <div className="flex justify-between items-center">
        <h2 className="text-2xl font-bold">Tableau de bord</h2>
        <div className="flex items-center gap-4">
          <span className="text-sm text-gray-500">
            Dernier rafraîchissement : {stats.lastRefresh.toLocaleTimeString()}
          </span>
          <button
            onClick={refreshStatus}
            disabled={stats.isRefreshing}
            className="flex items-center gap-2 px-4 py-2 bg-red-950 text-white rounded-lg hover:bg-red-800 disabled:opacity-50"
          >
            <RefreshCw className={`h-4 w-4 ${stats.isRefreshing ? 'animate-spin' : ''}`} />
            Rafraîchir
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-5 gap-6">
        <div className="lg:col-span-4 bg-white p-6 rounded-lg shadow">
          <div className="flex justify-between items-center mb-6">
            <h3 className="text-lg font-semibold">Configuration de l'IA</h3>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                <button
                  onClick={handleSaveConfig}
                  disabled={isSaving}
                  className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
                >
                  {isSaving ? (
                    <>
                      <RefreshCw className="h-4 w-4 animate-spin" />
                      Enregistrement...
                    </>
                  ) : (
                    <>
                      <Save className="h-4 w-4" />
                      Enregistrer les modifications
                    </>
                  )}
                </button>
                {saveSuccess && (
                  <div className="flex items-center gap-2 text-green-600">
                    <CheckCircle2 className="h-5 w-5" />
                    <span>Modifications enregistrées</span>
                  </div>
                )}
              </div>
              <div className="flex items-center gap-3">
                <span className="text-sm text-gray-600">Mode test</span>
                <button
                  onClick={() => useConfigStore.setState({ testMode: !testMode })}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                    testMode ? 'bg-blue-500' : 'bg-gray-200'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                      testMode ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
              </div>
            </div>
          </div>

          <div className="space-y-8">
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
              {MISTRAL_MODELS.map((mistralModel) => (
                <button
                  key={mistralModel.id}
                  onClick={() => useConfigStore.setState({ model: mistralModel.id as MistralModel })}
                  className={`p-4 rounded-lg border-2 transition-all ${
                    model === mistralModel.id
                      ? 'border-blue-500 bg-blue-50'
                      : 'border-gray-200 hover:border-blue-200'
                  }`}
                >
                  <h4 className="font-semibold">{mistralModel.name}</h4>
                  <p className="text-sm text-gray-600">{mistralModel.description}</p>
                </button>
              ))}
            </div>

            <div className="space-y-6">
              <div className="flex items-center gap-2">
                <Sliders className="h-5 w-5 text-gray-500" />
                <h4 className="font-medium">Paramètres avancés</h4>
              </div>

              <div className="space-y-6">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Température ({localConfig.temperature})
                  </label>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.1"
                    value={localConfig.temperature}
                    onChange={(e) => setLocalConfig(prev => ({ ...prev, temperature: parseFloat(e.target.value) }))}
                    className="w-full"
                  />
                </div>

                <div>
                  <label className="block text-lg font-medium text-gray-700 mb-3">
                    Message système
                  </label>
                  <textarea
                    value={localConfig.systemPrompt}
                    onChange={(e) => setLocalConfig(prev => ({ ...prev, systemPrompt: e.target.value }))}
                    className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 min-h-[120px]"
                    rows={5}
                  />
                </div>

                {chatbots.map((bot) => (
                  <div key={bot.id}>
                    <label className="block text-lg font-medium text-gray-700 mb-3">
                      Règles contextuelles - {bot.name}
                    </label>
                    <textarea
                      value={localConfig.contextRules[bot.id] || ''}
                      onChange={(e) => setLocalConfig(prev => ({
                        ...prev,
                        contextRules: {
                          ...prev.contextRules,
                          [bot.id]: e.target.value
                        }
                      }))}
                      className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 min-h-[100px]"
                      rows={4}
                      placeholder="Règles spécifiques pour ce bot..."
                    />
                  </div>
                ))}
              </div>
            </div>

            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <h4 className="font-medium">Configuration du widget public</h4>
                  <button
                    onClick={() => setLocalConfig(prev => ({ ...prev, widgetEnabled: !prev.widgetEnabled }))}
                    className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                      localConfig.widgetEnabled ? 'bg-blue-500' : 'bg-gray-200'
                    }`}
                  >
                    <span
                      className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                        localConfig.widgetEnabled ? 'translate-x-6' : 'translate-x-1'
                      }`}
                    />
                  </button>
                </div>
                {localConfig.widgetEnabled && (
                  <button
                    onClick={() => setShowPreview(!showPreview)}
                    className="flex items-center gap-2 text-blue-600 hover:text-blue-700"
                  >
                    <ExternalLink className="h-4 w-4" />
                    {showPreview ? 'Masquer la prévisualisation' : 'Prévisualiser le widget'}
                  </button>
                )}
              </div>

              {localConfig.widgetEnabled && (
                <div className="space-y-4 pl-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Titre du widget
                    </label>
                    <input
                      type="text"
                      value={localConfig.widgetTitle}
                      onChange={(e) => setLocalConfig(prev => ({ ...prev, widgetTitle: e.target.value }))}
                      className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 h-12"
                    />
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-2">
                      Message de bienvenue
                    </label>
                    <input
                      type="text"
                      value={localConfig.widgetWelcomeMessage}
                      onChange={(e) => setLocalConfig(prev => ({ ...prev, widgetWelcomeMessage: e.target.value }))}
                      className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 h-12"
                    />
                  </div>

                  <div className="mt-6">
                    <div className="flex items-center gap-2 mb-4">
                      <Code className="h-5 w-5 text-gray-500" />
                      <h4 className="font-medium">Code d'intégration</h4>
                    </div>
                    <div className="relative">
                      <pre className="bg-gray-50 p-4 rounded-lg text-sm overflow-x-auto">
                        <code>{`<script>
  (function() {
    const script = document.createElement('script');
    script.src = '${window.location.origin}/widget.js';
    script.async = true;
    document.head.appendChild(script);
  })();
</script>`}</code>
                      </pre>
                      <button
                        onClick={handleCopyCode}
                        className="absolute top-2 right-2 p-2 text-gray-500 hover:text-gray-700 rounded-md hover:bg-gray-100"
                        title="Copier le code"
                      >
                        {copiedCode ? (
                          <Check className="h-5 w-5 text-green-500" />
                        ) : (
                          <Copy className="h-5 w-5" />
                        )}
                      </button>
                    </div>
                    <p className="mt-2 text-sm text-gray-500">
                      Ajoutez ce code juste avant la fermeture de la balise &lt;/body&gt; de votre site web.
                    </p>
                  </div>

                  {showPreview && (
                    <div className="mt-6 p-6 bg-gray-50 rounded-lg">
                      <h5 className="text-sm font-medium text-gray-700 mb-4">Prévisualisation du widget</h5>
                      <div className="relative">
                        <PublicWidget />
                        <div className="mt-4 p-3 bg-blue-50 border border-blue-200 rounded-lg">
                          <p className="text-sm text-blue-800">
                            <strong>Nouvelles fonctionnalités :</strong>
                          </p>
                          <ul className="text-sm text-blue-800 mt-2 space-y-1">
                            <li>• <strong>Bouton de masquage toujours visible</strong> : Accessible en permanence, sans survol nécessaire</li>
                            <li>• <strong>Masquage depuis l'assistant ouvert</strong> : Bouton dans la barre de titre</li>
                            <li>• <strong>Particulièrement utile sur mobile</strong> pour libérer l'espace de navigation</li>
                          </ul>
                          <p className="text-sm text-blue-800 mt-2">
                            <em>Le bouton de masquage est toujours visible sur le bouton Raymond, parfait pour une clientèle senior.</em>
                          </p>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="bg-white p-6 rounded-lg shadow">
          <h3 className="text-lg font-semibold mb-4">Status API Mistral</h3>
          <div className="flex items-center space-x-2">
            <div className={`h-3 w-3 rounded-full ${
              stats.apiStatus === 'operational' ? 'bg-green-500' : 'bg-red-500'
            }`}></div>
            <span className="capitalize">{stats.apiStatus}</span>
          </div>
        </div>
      </div>

      {!testMode && (
        <>
          <div className="bg-white p-6 rounded-lg shadow">
            <h3 className="text-lg font-semibold mb-4">Status des Bases de connaissances</h3>
            <div className="space-y-4">
              {chatbots.map((bot) => {
                const status = stats.pineconeStatus[bot.id];
                const Icon = bot.icon;
                const vectorCount = status?.vectorCount;
                return (
                  <div key={bot.id} className="flex items-center justify-between p-4 border rounded">
                    <div className="flex items-center gap-3">
                      <Icon className="h-6 w-5" />
                      <div>
                        <h4 className="font-medium">{bot.name}</h4>
                        <p className="text-sm text-gray-500">Index: {bot.pineconeIndex}</p>
                      </div>
                    </div>
                    <div className="flex items-center space-x-4">
                      {vectorCount > 0 && (
                        <div className="text-right">
                          <div className="font-medium">
                            {vectorCount.toLocaleString()}
                          </div>
                          <div className="text-sm text-gray-500">records</div>
                        </div>
                      )}
                      <div className="flex items-center space-x-2">
                        <div className={`h-3 w-3 rounded-full ${
                          status?.status === 'ready' ? 'bg-green-500' : 'bg-red-500'
                        }`}></div>
                        <span className="capitalize">{status?.status || 'Chargement...'}</span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          <div className="text-sm text-gray-500 text-center">
            Mise à jour automatique toutes les 30 secondes
          </div>
        </>
      )}
    </div>
  );
}