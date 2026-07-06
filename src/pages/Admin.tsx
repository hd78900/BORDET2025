import React, { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import { UserProfile } from '../types';
import { chatbots } from '../config/chatbots';
import { useAuthStore } from '../store/authStore';
import { useNavigate } from 'react-router-dom';
import { UserPlus, Users, AlertCircle, RefreshCw } from 'lucide-react';

export default function Admin() {
  const [users, setUsers] = useState<UserProfile[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [newUser, setNewUser] = useState({ email: '', password: '', is_admin: false });
  const [selectedBots, setSelectedBots] = useState<Record<string, string[]>>({});
  const [error, setError] = useState<string | null>(null);
  const { isAdmin } = useAuthStore();
  const navigate = useNavigate();

  useEffect(() => {
    if (!isAdmin) {
      navigate('/');
      return;
    }

    fetchUsers();
  }, [isAdmin, navigate]);

  const fetchUsers = async () => {
    try {
      setError(null);
      const { data: profiles, error: profilesError } = await supabase
        .from('user_profiles')
        .select('*')
        .order('created_at', { ascending: false });

      if (profilesError) throw profilesError;

      if (profiles) {
        setUsers(profiles);
        
        // Load bot access for each user
        const accessPromises = profiles.map(async (profile) => {
          const { data: access, error: accessError } = await supabase
            .from('user_bot_access')
            .select('bot_id')
            .eq('user_id', profile.id);
          
          if (accessError) throw accessError;
          
          setSelectedBots(prev => ({
            ...prev,
            [profile.id]: access?.map(a => a.bot_id) || []
          }));
        });

        await Promise.all(accessPromises);
      }
    } catch (error: any) {
      console.error('Error fetching users:', error);
      setError(error.message || 'Erreur lors du chargement des utilisateurs');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    await fetchUsers();
  };

  const handleCreateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      // 1. Create user with Supabase Auth
      const { data: authData, error: signUpError } = await supabase.auth.signUp({
        email: newUser.email,
        password: newUser.password,
        options: {
          emailRedirectTo: `${window.location.origin}/login`
        }
      });

      if (signUpError) throw signUpError;
      if (!authData.user) throw new Error("Erreur lors de la création de l'utilisateur");

      // 2. Create user profile
      const { error: profileError } = await supabase
        .from('user_profiles')
        .insert({
          id: authData.user.id,
          email: newUser.email,
          is_admin: newUser.is_admin
        });

      if (profileError) throw profileError;

      // 3. Reset form and refresh list
      setNewUser({ email: '', password: '', is_admin: false });
      await fetchUsers();
      setError(null);
    } catch (error: any) {
      console.error('Error creating user:', error);
      setError(error.message || "Erreur lors de la création de l'utilisateur");
    } finally {
      setLoading(false);
    }
  };

  const handleBotAccessChange = async (userId: string, botId: string, checked: boolean) => {
    try {
      setError(null);
      if (checked) {
        // First, check if access already exists
        const { data: existingAccess } = await supabase
          .from('user_bot_access')
          .select('*')
          .eq('user_id', userId)
          .eq('bot_id', botId)
          .single();

        if (!existingAccess) {
          const { error } = await supabase
            .from('user_bot_access')
            .insert([{ 
              user_id: userId, 
              bot_id: botId 
            }]);
          
          if (error) throw error;
        }
        
        setSelectedBots(prev => ({
          ...prev,
          [userId]: [...(prev[userId] || []), botId]
        }));
      } else {
        const { error } = await supabase
          .from('user_bot_access')
          .delete()
          .eq('user_id', userId)
          .eq('bot_id', botId);
        
        if (error) throw error;
        
        setSelectedBots(prev => ({
          ...prev,
          [userId]: prev[userId]?.filter(id => id !== botId) || []
        }));
      }

      // Refresh the user's bot access list
      const { data: access, error: accessError } = await supabase
        .from('user_bot_access')
        .select('bot_id')
        .eq('user_id', userId);
      
      if (accessError) throw accessError;
      
      setSelectedBots(prev => ({
        ...prev,
        [userId]: access?.map(a => a.bot_id) || []
      }));

    } catch (error: any) {
      console.error('Error updating bot access:', error);
      setError(error.message || "Erreur lors de la mise à jour des accès");
      
      // Revert the local state change on error
      const { data: access } = await supabase
        .from('user_bot_access')
        .select('bot_id')
        .eq('user_id', userId);
      
      setSelectedBots(prev => ({
        ...prev,
        [userId]: access?.map(a => a.bot_id) || []
      }));
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-2 border-red-950 border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
        {/* User Creation */}
        <div className="bg-white shadow rounded-lg p-6">
          <h2 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <UserPlus className="h-5 w-5" />
            Créer un nouvel utilisateur
          </h2>
          {error && (
            <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-md">
              <div className="flex items-center gap-2 text-red-800">
                <AlertCircle className="h-5 w-5" />
                <p>{error}</p>
              </div>
            </div>
          )}
          <form onSubmit={handleCreateUser} className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <input
                type="email"
                value={newUser.email}
                onChange={(e) => setNewUser(prev => ({ ...prev, email: e.target.value }))}
                placeholder="Email"
                required
                className="rounded-md border-gray-300 shadow-sm focus:border-red-950 focus:ring-red-950"
              />
              <input
                type="password"
                value={newUser.password}
                onChange={(e) => setNewUser(prev => ({ ...prev, password: e.target.value }))}
                placeholder="Mot de passe"
                required
                minLength={6}
                className="rounded-md border-gray-300 shadow-sm focus:border-red-950 focus:ring-red-950"
              />
              <div className="flex items-center space-x-3">
                <input
                  type="checkbox"
                  id="is_admin"
                  checked={newUser.is_admin}
                  onChange={(e) => setNewUser(prev => ({ ...prev, is_admin: e.target.checked }))}
                  className="rounded border-gray-300 text-red-800 focus:ring-red-950"
                />
                <label htmlFor="is_admin">Administrateur</label>
              </div>
            </div>
            <button
              type="submit"
              disabled={loading}
              className="bg-red-950 text-white px-4 py-2 rounded-md hover:bg-red-800 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
            >
              {loading ? (
                <>
                  <div className="animate-spin rounded-full h-4 w-4 border-2 border-white border-t-transparent" />
                  Création en cours...
                </>
              ) : (
                <>
                  <UserPlus className="h-4 w-4" />
                  Créer l'utilisateur
                </>
              )}
            </button>
          </form>
        </div>

        {/* User List */}
        <div className="bg-white shadow rounded-lg p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <Users className="h-5 w-5" />
              Utilisateurs ({users.length})
            </h2>
            <button
              onClick={handleRefresh}
              disabled={refreshing}
              className="flex items-center gap-2 text-gray-600 hover:text-gray-900"
            >
              <RefreshCw className={`h-4 w-4 ${refreshing ? 'animate-spin' : ''}`} />
              Actualiser
            </button>
          </div>
          <div className="space-y-4">
            {users.length === 0 ? (
              <p className="text-gray-500 text-center py-4">Aucun utilisateur trouvé</p>
            ) : (
              users.map((user) => (
                <div key={user.id} className="border rounded-lg p-4">
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <h3 className="font-medium">{user.email}</h3>
                      <p className="text-sm text-gray-500">
                        Créé le {new Date(user.created_at).toLocaleDateString()}
                      </p>
                    </div>
                    <div className="flex items-center space-x-3">
                      <span className={`px-2 py-1 text-xs rounded-full ${
                        user.is_admin ? 'bg-purple-100 text-purple-800' : 'bg-gray-100 text-gray-800'
                      }`}>
                        {user.is_admin ? 'Admin' : 'Utilisateur'}
                      </span>
                    </div>
                  </div>
                  {!user.is_admin && (
                    <div>
                      <h4 className="text-sm font-medium mb-2">Accès aux chatbots :</h4>
                      <div className="flex flex-wrap gap-4">
                        {chatbots.map((bot) => {
                          const Icon = bot.icon;
                          const isChecked = selectedBots[user.id]?.includes(bot.id);
                          return (
                            <label
                              key={bot.id}
                              className="flex items-center space-x-2 text-sm"
                            >
                              <input
                                type="checkbox"
                                checked={isChecked}
                                onChange={(e) => handleBotAccessChange(user.id, bot.id, e.target.checked)}
                                className="rounded border-gray-300 text-red-950 focus:ring-red-950"
                              />
                              <Icon className="h-4 w-4" />
                              <span>{bot.name}</span>
                            </label>
                          );
                        })}
                      </div>
                    </div>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      </div>
  );
}