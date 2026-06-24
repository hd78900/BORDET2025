import React, { useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Dashboard from './pages/Dashboard';
import Settings from './pages/Settings';
import Playground from './pages/Playground';
import Admin from './pages/Admin';
import FAQ from './pages/FAQ';
import Login from './pages/Login';
import Layout from './components/Layout';
import Widget from './components/Widget';
import { useAuthStore } from './store/authStore';
import { supabase } from './lib/supabase';

function PrivateRoute({ children, requireAdmin = false }: { children: React.ReactNode, requireAdmin?: boolean }) {
  const { user, isAdmin } = useAuthStore();
  
  if (!user) return <Navigate to="/login" />;
  if (requireAdmin && !isAdmin) return <Navigate to="/" />;
  
  return children;
}

function App() {
  const { setUser, setIsAdmin, setAccessibleBots } = useAuthStore();

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session?.user) {
        supabase
          .from('user_profiles')
          .select('*')
          .eq('id', session.user.id)
          .single()
          .then(({ data: profile }) => {
            if (profile) {
              setUser({
                id: profile.id,
                email: profile.email,
                is_admin: profile.is_admin,
              });
              setIsAdmin(profile.is_admin);

              if (profile.is_admin) {
                setAccessibleBots(['bot1']);
              } else {
                supabase
                  .from('user_bot_access')
                  .select('bot_id')
                  .eq('user_id', profile.id)
                  .then(({ data: access }) => {
                    setAccessibleBots(access?.map(a => a.bot_id) || []);
                  });
              }
            }
          });
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (event === 'SIGNED_OUT') {
          setUser(null);
          setIsAdmin(false);
          setAccessibleBots([]);
        }
      }
    );

    return () => {
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
          <Route
            path="playground"
            element={
              <PrivateRoute requireAdmin>
                <Playground />
              </PrivateRoute>
            }
          />
          <Route path="admin" element={<Admin />} />
          <Route path="faq" element={<FAQ />} />
        </Route>
      </Routes>
    </Router>
  );
}

export default App;