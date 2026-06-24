import React, { useState, useEffect } from 'react';
import { chatbots } from '../config/chatbots';
import { checkVectorDbStatus, checkMistralStatus } from '../lib/api';
import { RefreshCw, Save, CheckCircle2, Sliders, ExternalLink, Code, Copy, Check } from 'lucide-react';
import { useConfigStore } from '../store/configStore';
import PublicWidget from '../components/PublicWidget';
import { supabase } from '../lib/supabase';

export default function Settings() {
  const {
    model,
    temperature,
    systemPrompt,
    marketingPrompt,
    contextRules,
    widgetTitle,
    widgetWelcomeMessage
  } = useConfigStore();

  const [stats, setStats] = useState({
    apiStatus: 'Chargement...',
    vectorDbStatus: {} as Record<string, any>,
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
    marketingPrompt,
    contextRules,
    widgetTitle,
    widgetWelcomeMessage
  });
  const [savingWidget, setSavingWidget] = useState(false);
  const [prompts, setPrompts] = useState({ client_prompt: '', marketing_prompt: '' });
  const [savingPrompts, setSavingPrompts] = useState(false);
  const [promptsSaved, setPromptsSaved] = useState(false);

  useEffect(() => {
    setLocalConfig({
      temperature,
      systemPrompt,
      marketingPrompt,
      contextRules,
      widgetTitle,
      widgetWelcomeMessage
    });
  }, [temperature, systemPrompt, marketingPrompt, contextRules, widgetTitle, widgetWelcomeMessage]);

  useEffect(() => {
    supabase.from('widget_settings').select('client_prompt, marketing_prompt').eq('id', 1).maybeSingle()
      .then(({ data }) => {
        if (data) setPrompts({ client_prompt: data.client_prompt || '', marketing_prompt: data.marketing_prompt || '' });
      });
  }, []);

  const handleSaveConfig = () => {
    setIsSaving(true);
    try {
      useConfigStore.setState({ 
        model,
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
    script.src = '${window.location.origin}/widget.js?v=' + Date.now();
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

  const handleSaveWidgetSettings = async () => {
    setSavingWidget(true);
    try {
      const { error } = await supabase
        .from('widget_settings')
        .update({
          title: localConfig.widgetTitle,
          welcome_message: localConfig.widgetWelcomeMessage
        })
        .eq('id', 1);

      if (error) throw error;

      useConfigStore.setState({
        widgetTitle: localConfig.widgetTitle,
        widgetWelcomeMessage: localConfig.widgetWelcomeMessage
      });

      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 3000);
    } catch (error) {
      console.error('Erreur lors de la sauvegarde des paramètres du widget:', error);
    } finally {
      setSavingWidget(false);
    }
  };

  const handleSavePrompts = async () => {
    setSavingPrompts(true);
    try {
      const { error } = await supabase.from('widget_settings')
        .update({ client_prompt: prompts.client_prompt, marketing_prompt: prompts.marketing_prompt })
        .eq('id', 1);
      if (error) throw error;
      setPromptsSaved(true);
      setTimeout(() => setPromptsSaved(false), 3000);
    } catch (e) {
      console.error('Erreur sauvegarde prompts:', e);
    } finally {
      setSavingPrompts(false);
    }
  };

  const refreshStatus = async () => {
    setStats(prev => ({ ...prev, isRefreshing: true }));
    try {
      const mistralStatus = await checkMistralStatus();
      const vectorDbStatuses = await Promise.all(
        chatbots.map(async bot => {
          const status = await checkVectorDbStatus(bot.id);
          return {
            ...bot,
            status
          };
        })
      );

      setStats({
        apiStatus: mistralStatus.status,
        vectorDbStatus: vectorDbStatuses.reduce((acc, curr) => ({
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
            </div>
          </div>

          <div className="space-y-8">
            <div className="rounded-lg border border-gray-200 bg-gray-50 p-4 text-sm text-gray-600">
              Modèle automatique : <strong>mistral-small</strong> pour le chatbot (Vue client),
              <strong> mistral-large</strong> pour le mode « Contenu marketing ».
            </div>

            <div className="space-y-6">
              <div className="flex items-center gap-2">
                <Sliders className="h-5 w-5 text-gray-500" />
                <h4 className="font-medium">Paramètres avancés</h4>
              </div>

              <div className="space-y-6">
                <p className="text-sm text-gray-500">
                  Ces prompts pilotent réellement le chatbot (lus côté serveur à chaque réponse). Le contexte (produits/articles trouvés) est ajouté automatiquement après. Effet immédiat après enregistrement, sans redéploiement.
                </p>
                <div>
                  <label className="block text-lg font-medium text-gray-700 mb-2">
                    Prompt — Assistant client (chatbot &amp; widget)
                  </label>
                  <textarea
                    value={prompts.client_prompt}
                    onChange={(e) => setPrompts(p => ({ ...p, client_prompt: e.target.value }))}
                    className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 min-h-[220px] font-mono text-sm"
                    rows={14}
                  />
                </div>
                <div>
                  <label className="block text-lg font-medium text-gray-700 mb-2">
                    Prompt — Contenu marketing (mode admin)
                  </label>
                  <textarea
                    value={prompts.marketing_prompt}
                    onChange={(e) => setPrompts(p => ({ ...p, marketing_prompt: e.target.value }))}
                    className="w-full rounded-md border-gray-300 shadow-sm focus:border-blue-500 focus:ring-blue-500 min-h-[160px] font-mono text-sm"
                    rows={9}
                  />
                </div>
                <div className="flex items-center gap-3">
                  <button
                    onClick={handleSavePrompts}
                    disabled={savingPrompts}
                    className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
                  >
                    {savingPrompts ? (
                      <><RefreshCw className="h-4 w-4 animate-spin" /> Enregistrement...</>
                    ) : (
                      <><Save className="h-4 w-4" /> Enregistrer les prompts</>
                    )}
                  </button>
                  {promptsSaved && (
                    <span className="text-green-600 text-sm">Prompts enregistrés ✓ (effet immédiat)</span>
                  )}
                </div>
              </div>
            </div>

            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <h4 className="text-lg font-medium">Configuration du widget public</h4>
                </div>
                <button
                  onClick={() => setShowPreview(!showPreview)}
                  className="flex items-center gap-2 text-blue-600 hover:text-blue-700"
                >
                  <ExternalLink className="h-4 w-4" />
                  {showPreview ? 'Masquer la prévisualisation' : 'Prévisualiser le widget'}
                </button>
              </div>

              <div className="space-y-4">
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

                <div className="mt-4">
                  <button
                    onClick={handleSaveWidgetSettings}
                    disabled={savingWidget}
                    className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50"
                  >
                    {savingWidget ? (
                      <>
                        <RefreshCw className="h-4 w-4 animate-spin" />
                        Sauvegarde en cours...
                      </>
                    ) : (
                      <>
                        <Save className="h-4 w-4" />
                        Sauvegarder la personnalisation
                      </>
                    )}
                  </button>
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
    script.src = '${window.location.origin}/widget.js?v=' + Date.now();
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
                    <PublicWidget />
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="lg:col-span-1 space-y-6">
          <div className="bg-white p-6 rounded-lg shadow">
            <h3 className="text-lg font-semibold mb-4">Status API Mistral</h3>
            <div className="flex items-center space-x-2">
              <div className={`h-3 w-3 rounded-full ${
                stats.apiStatus === 'operational' ? 'bg-green-500' : 'bg-red-500'
              }`}></div>
              <span className="capitalize">{stats.apiStatus}</span>
            </div>
          </div>
          {(
            <div className="bg-white p-6 rounded-lg shadow">
              <h3 className="text-lg font-semibold mb-4">Status des Bases de connaissances</h3>
              <div className="space-y-4">
                {chatbots.map((bot) => {
                  const status = stats.vectorDbStatus[bot.id];
                  const Icon = bot.icon;
                  const vectorCount = status?.vectorCount;
                  return (
                    <div key={bot.id} className="p-4 border rounded space-y-3">
                      <div className="flex items-center gap-3">
                        <Icon className="h-6 w-5 flex-shrink-0" />
                        <div className="min-w-0">
                          <h4 className="font-medium">{bot.name}</h4>
                          <p className="text-sm text-gray-500">Bot: {bot.id}</p>
                        </div>
                      </div>
                      <div className="flex items-center justify-between gap-2">
                        {vectorCount > 0 ? (
                          <div className="whitespace-nowrap">
                            <span className="font-medium">{vectorCount.toLocaleString()}</span>
                            <span className="text-sm text-gray-500"> records</span>
                          </div>
                        ) : <span />}
                        <div className="flex items-center space-x-2 whitespace-nowrap">
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
          )}
        </div>
      </div>

      {(
        <div className="text-sm text-gray-500 text-center">
          Mise à jour automatique toutes les 30 secondes
        </div>
      )}
    </div>
  );
}