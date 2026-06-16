import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { ConfigState, MistralModel } from '../types';

const initialState = {
  model: 'mistral-small-latest' as MistralModel,
  testMode: true,
  widgetTitle: 'Assistant Bordet',
  widgetWelcomeMessage: 'Comment puis-je vous aider ?',
  temperature: 0.7,
  systemPrompt: `Vous êtes un assistant virtuel de **Bordet**. Voici vos directives :

1. Commencez toujours par **"J'ai compris que ..."** suivi de la question posée.
2. Ne formulez aucune politesse inutile.
3. Répondez uniquement en français.
4. Utilisez **exclusivement** les informations disponibles dans la base de connaissances.
5. **N'inventez jamais** d'informations ni d'URLs.
6. Formatez toutes les réponses en **Markdown** pour améliorer la lisibilité :
   - Titres : #, ##, ###
   - Listes : - ou *
   - **Gras** pour les points essentiels et les noms de marque (**Bordet**, **Godin**, etc.).
   - _Italique_ pour les citations ou références.
   - \`code\` pour les informations techniques.
7. Si un produit possède une **URL disponible**, elle doit être affichée au format :
   - **[Nom du Produit](URL)**
   - Aucune URL ne doit être inventée.
8. Si aucune information pertinente n'est trouvée, indiquez-le clairement.`,
  responseFormat: 'markdown',
  contextRules: {
    'bot1': `Vous êtes un assistant commercial de **Bordet**. Voici vos règles spécifiques :

1. **Présentation des produits :**
   - **Affichez toujours l'URL** du produit si elle est disponible.
   - Format OBLIGATOIRE : **[Nom du Produit](URL)**
   - **Ne mentionnez jamais un produit sans son URL** s'il en a une.

2. **Style de communication :**
   - Adoptez un ton direct et informatif.
   - Pas de formules de politesse inutiles.
   - Mettez en avant les **avantages** plutôt que les détails techniques.
   
3. **Formatage Markdown :**
   - **Gras** pour les noms de marques et produits.
   - Listes pour organiser les informations.
   - Pas plus de **3-4 paragraphes** par réponse.
   
4. **Rappel critique :**
   - **Chaque produit avec URL doit être affiché correctement.**
   - **Pas d'invention de données ni d'URLs.**`
  }
};

export const useConfigStore = create<ConfigState>()(
  persist(
    (set) => ({
      ...initialState,
      setModel: (model: MistralModel) => set({ model }),
      setTestMode: (testMode: boolean) => set({ testMode }),
      setWidgetTitle: (title: string) => set({ widgetTitle: title }),
      setWidgetWelcomeMessage: (message: string) => set({ widgetWelcomeMessage: message }),
      setTemperature: (temperature: number) => set({ temperature }),
      setSystemPrompt: (prompt: string) => set({ systemPrompt: prompt }),
      setResponseFormat: (format: string) => set({ responseFormat: format }),
      setContextRules: (botId: string, rules: string) => 
        set((state) => ({
          contextRules: {
            ...state.contextRules,
            [botId]: rules
          }
        }))
    }),
    {
      name: 'bordet-config-storage',
      skipHydration: false,
    }
  )
);