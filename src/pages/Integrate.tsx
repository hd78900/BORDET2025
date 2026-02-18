import { useState, useEffect } from 'react';
import { Copy, Check, Code, MessageSquare, Monitor, Smartphone, ExternalLink } from 'lucide-react';
import { supabase } from '../lib/supabase';
import WidgetCore from '../components/WidgetCore';

const WIDGET_ORIGIN = 'https://chatbordet.netlify.app';

const INTEGRATION_CODE = `<script>
  (function() {
    var s = document.createElement('script');
    s.src = '${WIDGET_ORIGIN}/widget.js?v=' + Date.now();
    s.async = true;
    document.head.appendChild(s);
  })();
</script>`;

export default function Integrate() {
  const [copied, setCopied] = useState(false);
  const [previewDevice, setPreviewDevice] = useState<'desktop' | 'mobile'>('desktop');
  const [widgetTitle, setWidgetTitle] = useState('Assistant Bordet');

  useEffect(() => {
    supabase
      .from('widget_settings')
      .select('title')
      .eq('id', 1)
      .maybeSingle()
      .then(({ data }) => {
        if (data?.title) setWidgetTitle(data.title);
      });
  }, []);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(INTEGRATION_CODE);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch (err) {
      console.error('Copy failed:', err);
    }
  };

  const steps = [
    { num: '1', title: 'Copiez le code', desc: 'Copiez le snippet ci-dessous.' },
    { num: '2', title: 'Collez dans votre site', desc: 'Ajoutez-le juste avant la balise fermante </body>.' },
    { num: '3', title: "C'est pret", desc: 'Le widget apparait en bas a droite de votre site.' }
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-red-950 rounded-xl flex items-center justify-center">
              <MessageSquare className="h-5 w-5 text-white" />
            </div>
            <div>
              <h1 className="text-2xl font-bold text-gray-900">Integrer {widgetTitle}</h1>
              <p className="text-sm text-gray-500 mt-0.5">
                Ajoutez l'assistant a votre site en quelques secondes
              </p>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-10 space-y-12">

        <section>
          <h2 className="text-lg font-semibold text-gray-900 mb-6">Installation en 3 etapes</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
            {steps.map((step) => (
              <div key={step.num} className="bg-white rounded-xl border border-gray-200 p-6 hover:shadow-md transition-shadow">
                <div className="w-8 h-8 bg-red-950 text-white rounded-lg flex items-center justify-center text-sm font-bold mb-4">
                  {step.num}
                </div>
                <h3 className="font-semibold text-gray-900 mb-1">{step.title}</h3>
                <p className="text-sm text-gray-600 leading-relaxed">{step.desc}</p>
              </div>
            ))}
          </div>
        </section>

        <section>
          <div className="flex items-center gap-2 mb-4">
            <Code className="h-5 w-5 text-gray-500" />
            <h2 className="text-lg font-semibold text-gray-900">Code d'integration</h2>
          </div>
          <div className="bg-gray-900 rounded-xl overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 bg-gray-800 border-b border-gray-700">
              <div className="flex items-center gap-2">
                <div className="w-3 h-3 rounded-full bg-red-500"></div>
                <div className="w-3 h-3 rounded-full bg-yellow-500"></div>
                <div className="w-3 h-3 rounded-full bg-green-500"></div>
                <span className="text-xs text-gray-400 ml-2 font-mono">index.html</span>
              </div>
              <button
                onClick={handleCopy}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-all ${
                  copied
                    ? 'bg-green-600 text-white'
                    : 'bg-gray-700 text-gray-300 hover:bg-gray-600 hover:text-white'
                }`}
              >
                {copied ? (
                  <>
                    <Check className="h-3.5 w-3.5" />
                    Copie !
                  </>
                ) : (
                  <>
                    <Copy className="h-3.5 w-3.5" />
                    Copier
                  </>
                )}
              </button>
            </div>
            <div className="p-5 overflow-x-auto">
              <pre className="text-sm leading-relaxed">
                <code>
                  <span className="text-gray-500">{'<!-- Placez ce code avant </body> -->'}</span>
                  {'\n'}
                  <span className="text-blue-400">{'<script>'}</span>
                  {'\n'}
                  <span className="text-gray-300">{'  (function() {'}</span>
                  {'\n'}
                  <span className="text-gray-300">{'    var s = document.createElement('}</span>
                  <span className="text-green-400">{"'script'"}</span>
                  <span className="text-gray-300">{');'}</span>
                  {'\n'}
                  <span className="text-gray-300">{"    s.src = '"}</span>
                  <span className="text-yellow-300">{WIDGET_ORIGIN}/widget.js?v=</span>
                  <span className="text-gray-300">{"' + Date.now();"}</span>
                  {'\n'}
                  <span className="text-gray-300">{'    s.async = '}</span>
                  <span className="text-orange-400">{'true'}</span>
                  <span className="text-gray-300">{';'}</span>
                  {'\n'}
                  <span className="text-gray-300">{'    document.head.appendChild(s);'}</span>
                  {'\n'}
                  <span className="text-gray-300">{'  })();'}</span>
                  {'\n'}
                  <span className="text-blue-400">{'</script>'}</span>
                </code>
              </pre>
            </div>
          </div>
          <div className="mt-3 p-3 bg-amber-50 border border-amber-200 rounded-lg">
            <p className="text-sm text-amber-800">
              <strong>Astuce :</strong> Le parametre <code className="bg-amber-100 px-1 rounded text-xs">?v=</code> empeche la mise en cache et garantit que vos visiteurs ont toujours la derniere version du widget.
            </p>
          </div>
        </section>

        <section>
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-900">Apercu en situation reelle</h2>
            <div className="flex items-center bg-gray-200 rounded-lg p-0.5">
              <button
                onClick={() => setPreviewDevice('desktop')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  previewDevice === 'desktop'
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                <Monitor className="h-3.5 w-3.5" />
                Desktop
              </button>
              <button
                onClick={() => setPreviewDevice('mobile')}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                  previewDevice === 'mobile'
                    ? 'bg-white text-gray-900 shadow-sm'
                    : 'text-gray-600 hover:text-gray-900'
                }`}
              >
                <Smartphone className="h-3.5 w-3.5" />
                Mobile
              </button>
            </div>
          </div>

          <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
            <div className="bg-gray-100 px-4 py-2 flex items-center gap-2 border-b border-gray-200">
              <div className="flex gap-1.5">
                <div className="w-2.5 h-2.5 rounded-full bg-red-400"></div>
                <div className="w-2.5 h-2.5 rounded-full bg-yellow-400"></div>
                <div className="w-2.5 h-2.5 rounded-full bg-green-400"></div>
              </div>
              <div className="flex-1 mx-8">
                <div className="bg-white rounded-md px-3 py-1 text-xs text-gray-400 text-center border border-gray-200">
                  votre-site.com
                </div>
              </div>
            </div>

            <div
              className={`relative transition-all duration-300 mx-auto ${
                previewDevice === 'desktop' ? 'w-full h-[550px]' : 'w-[375px] h-[667px]'
              }`}
            >
              <div className="absolute inset-0 bg-gradient-to-br from-gray-50 to-gray-100 p-8">
                <div className="space-y-3">
                  <div className="h-6 bg-gray-200 rounded w-3/4"></div>
                  <div className="h-4 bg-gray-200 rounded w-full"></div>
                  <div className="h-4 bg-gray-200 rounded w-5/6"></div>
                  <div className="h-4 bg-gray-200 rounded w-2/3"></div>
                  <div className="h-32 bg-gray-200 rounded w-full mt-4"></div>
                  <div className="h-4 bg-gray-200 rounded w-full mt-4"></div>
                  <div className="h-4 bg-gray-200 rounded w-4/5"></div>
                </div>
              </div>

              <div className="absolute bottom-0 right-0" style={{ width: '420px', height: '100%' }}>
                <WidgetCore botId="bot1" embedded />
              </div>
            </div>
          </div>
          <p className="text-xs text-gray-500 mt-2 text-center">
            Cliquez sur le widget pour interagir avec lui -- c'est une version fonctionnelle.
          </p>
        </section>

        <section>
          <h2 className="text-lg font-semibold text-gray-900 mb-4">Compatibilite</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            {[
              { name: 'WordPress', desc: 'Theme ou plugin' },
              { name: 'Shopify', desc: 'Theme.liquid' },
              { name: 'HTML / CSS', desc: 'Site statique' },
              { name: 'React / Vue / Angular', desc: 'SPA' },
              { name: 'Wix', desc: 'Code embed' },
              { name: 'Squarespace', desc: 'Injection de code' },
              { name: 'Webflow', desc: 'Custom code' },
              { name: 'Autre CMS', desc: 'Balise script' }
            ].map((platform) => (
              <div key={platform.name} className="bg-white rounded-lg border border-gray-200 p-4 text-center hover:border-gray-300 transition-colors">
                <p className="font-medium text-gray-900 text-sm">{platform.name}</p>
                <p className="text-xs text-gray-500 mt-0.5">{platform.desc}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="px-6 py-5 border-b border-gray-200">
            <h2 className="text-lg font-semibold text-gray-900">Exemple d'integration WordPress</h2>
            <p className="text-sm text-gray-500 mt-1">
              Ajoutez le code dans <strong>Apparence &gt; Editeur de theme &gt; footer.php</strong> ou via un plugin d'injection de scripts.
            </p>
          </div>
          <div className="bg-gray-900 p-5">
            <pre className="text-sm leading-relaxed overflow-x-auto">
              <code>
                <span className="text-gray-500">{'<?php // footer.php - Avant </body> ?>'}</span>
                {'\n\n'}
                <span className="text-blue-400">{'<script>'}</span>
                {'\n'}
                <span className="text-gray-300">{'  (function() {'}</span>
                {'\n'}
                <span className="text-gray-300">{"    var s = document.createElement('script');"}</span>
                {'\n'}
                <span className="text-gray-300">{"    s.src = '"}</span>
                <span className="text-yellow-300">{WIDGET_ORIGIN}/widget.js?v=</span>
                <span className="text-gray-300">{"' + Date.now();"}</span>
                {'\n'}
                <span className="text-gray-300">{'    s.async = true;'}</span>
                {'\n'}
                <span className="text-gray-300">{'    document.head.appendChild(s);'}</span>
                {'\n'}
                <span className="text-gray-300">{'  })();'}</span>
                {'\n'}
                <span className="text-blue-400">{'</script>'}</span>
                {'\n\n'}
                <span className="text-blue-400">{'</body>'}</span>
                {'\n'}
                <span className="text-blue-400">{'</html>'}</span>
              </code>
            </pre>
          </div>
        </section>

        <section className="bg-red-950 rounded-xl p-8 text-center">
          <h2 className="text-xl font-bold text-white mb-2">Besoin d'aide ?</h2>
          <p className="text-red-200 text-sm mb-5">
            Contactez l'equipe technique pour toute question concernant l'integration.
          </p>
          <a
            href="mailto:support@bordet.fr"
            className="inline-flex items-center gap-2 bg-white text-red-950 px-5 py-2.5 rounded-lg font-medium text-sm hover:bg-red-50 transition-colors"
          >
            <ExternalLink className="h-4 w-4" />
            Contacter le support
          </a>
        </section>

      </main>

      <footer className="border-t border-gray-200 bg-white mt-12">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <p className="text-xs text-gray-400 text-center">
            {widgetTitle} &mdash; Widget d'assistance intelligent
          </p>
        </div>
      </footer>
    </div>
  );
}
