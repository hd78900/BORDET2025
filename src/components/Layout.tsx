import React from 'react';
import { Outlet, Link, useNavigate } from 'react-router-dom';
import { MessageSquare, Settings, Users, LogOut, HelpCircle, Code } from 'lucide-react';
import { useAuthStore } from '../store/authStore';
import { supabase } from '../lib/supabase';

export default function Layout() {
  const { user, isAdmin } = useAuthStore();
  const navigate = useNavigate();

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate('/login');
  };

  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-white shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            <div className="flex">
              <Link to="/" className="flex items-center px-2 py-2 text-gray-700 hover:text-gray-900">
                <MessageSquare className="h-6 w-6 mr-2" />
                <span className="font-semibold">Les assistants Bordet</span>
              </Link>
            </div>
            {user && (
              <div className="flex items-center space-x-4">
                <Link
                  to="/faq"
                  className="p-2 text-gray-600 hover:text-gray-900 rounded-full hover:bg-gray-100"
                  title="FAQ"
                >
                  <HelpCircle className="h-6 w-6" />
                </Link>
                {isAdmin && (
                  <>
                    <Link
                      to="/admin"
                      className="p-2 text-gray-600 hover:text-gray-900 rounded-full hover:bg-gray-100"
                      title="Administration"
                    >
                      <Users className="h-6 w-6" />
                    </Link>
                    <Link
                      to="/integrate"
                      className="p-2 text-gray-600 hover:text-gray-900 rounded-full hover:bg-gray-100"
                      title="Intégration widget"
                    >
                      <Code className="h-6 w-6" />
                    </Link>
                    <Link
                      to="/settings"
                      className="p-2 text-gray-600 hover:text-gray-900 rounded-full hover:bg-gray-100"
                      title="Paramètres"
                    >
                      <Settings className="h-6 w-6" />
                    </Link>
                  </>
                )}
                <button
                  onClick={handleLogout}
                  className="p-2 text-gray-600 hover:text-gray-900 rounded-full hover:bg-gray-100"
                  title="Déconnexion"
                >
                  <LogOut className="h-6 w-6" />
                </button>
              </div>
            )}
          </div>
        </div>
      </nav>
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Outlet />
      </main>
    </div>
  );
}