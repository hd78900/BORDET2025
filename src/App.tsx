import React, { useEffect, lazy, Suspense } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Dashboard from './pages/Dashboard';
import Settings from './pages/Settings';
import Admin from './pages/Admin';
// lazy : embarque pdf.js — chargé uniquement à l'ouverture de la page (hors bundle du widget public)
const Knowledge = lazy(() => import('./pages/Knowledge'));
// lazy : embarque recharts — même logique
const Analytics = lazy(() => import('./pages/Analytics'));
import FAQ from './pages/FAQ';
import Login from './pages/Login';
import Layout from './components/Layout';
import Widget from './components/Widget';
import { useAuthStore } from './store/authStore';
import { supabase } from './lib/supabase';

function PrivateRoute({ children, requireAdmin = false }: { children: React.ReactNode, requireAdmin?: boolean }) {
  const { user, isAdmin, initializing } = useAuthStore();

  // tant que la session n'est pas restaurée, on n'affiche NI redirect NI contenu (évite le
  // déloguage au rechargement : sans ça, user=null au 1er rendu -> redirect prématuré vers /login)
  if (initializing) {
    return <div className="min-h-screen flex items-center justify-center text-gray-400">Chargement…</div>;
  }
  if (!user) return <Navigate to="/login" />;
  if (requireAdmin && !isAdmin) return <Navigate to="/" />;

  return children;
}

function App() {
  const { setUser, setIsAdmin, setAccessibleBots, setInitializing } = useAuthStore();

  useEffect(() => {
    let mounted = true;

    // hydrate le store depuis une session Supabase (restaurée du localStorage au rechargement)
    const hydrate = async (session: import('@supabase/supabase-js').Session | null) => {
      if (!session?.user) {
        if (mounted) { setUser(null); setIsAdmin(false); setAccessibleBots([]); }
        return;
      }
      const { data: profile } = await supabase
        .from('user_profiles').select('*').eq('id', session.user.id).single();
      if (!mounted || !profile) return;
      setUser({ id: profile.id, email: profile.email, is_admin: profile.is_admin });
      setIsAdmin(profile.is_admin);
      if (profile.is_admin) {
        setAccessibleBots(['bot1']);
      } else {
        const { data: access } = await supabase
          .from('user_bot_access').select('bot_id').eq('user_id', profile.id);
        if (mounted) setAccessibleBots(access?.map(a => a.bot_id) || []);
      }
    };

    // 1) restauration au démarrage : on ne lève le flag qu'UNE FOIS la décision d'auth prise
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      await hydrate(session);
      if (mounted) setInitializing(false);
    });

    // 2) écoute des changements (déconnexion, refresh de token)
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event) => {
        if (event === 'SIGNED_OUT') {
          if (mounted) { setUser(null); setIsAdmin(false); setAccessibleBots([]); }
        }
      }
    );

    return () => {
      mounted = false;
      subscription.unsubscribe();
    };
  }, []);

  return (
    <Router>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route
          path="/widget/:botId"
          element={
            <Widget />
          }
        />
        <Route
          path="/"
          element={
            <PrivateRoute>
              <Layout />
            </PrivateRoute>
          }
        >
          <Route index element={<Dashboard />} />
          <Route 
            path="settings" 
            element={
              <PrivateRoute requireAdmin>
                <Settings />
              </PrivateRoute>
            } 
          />
          <Route path="admin" element={<Admin />} />
          <Route
            path="knowledge"
            element={
              <PrivateRoute requireAdmin>
                <Suspense fallback={<div className="p-8 text-gray-400">Chargement…</div>}>
                  <Knowledge />
                </Suspense>
              </PrivateRoute>
            }
          />
          <Route
            path="analytics"
            element={
              <PrivateRoute requireAdmin>
                <Suspense fallback={<div className="p-8 text-gray-400">Chargement…</div>}>
                  <Analytics />
                </Suspense>
              </PrivateRoute>
            }
          />
          <Route path="faq" element={<FAQ />} />
        </Route>
      </Routes>
    </Router>
  );
}

export default App;