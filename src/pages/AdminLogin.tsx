import React, { useState } from 'react';
import { Logo } from '../components/Logo';
import { supabase, isSupabaseConfigured } from '../lib/supabase';
import { ShieldCheck, Lock, Mail, AlertCircle, ArrowLeft, ArrowRight, HelpCircle } from 'lucide-react';

interface AdminLoginProps {
  onLoginSuccess: (userProfile: any) => void;
  setCurrentPage: (page: string) => void;
}

export const AdminLogin: React.FC<AdminLoginProps> = ({ onLoginSuccess, setCurrentPage }) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showConfigHelp, setShowConfigHelp] = useState(false);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    if (!email.trim() || !password.trim()) {
      setError('Please provide your admin email and password.');
      return;
    }

    setLoading(true);

    try {
      if (isSupabaseConfigured && supabase) {
        // Authenticate via Supabase Auth
        const { data, error: authError } = await supabase.auth.signInWithPassword({
          email,
          password,
        });

        if (authError) {
          throw new Error(authError.message);
        }

        if (data.user) {
          // Fetch admin profile
          const { data: profile, error: profileErr } = await supabase
            .from('admin_profiles')
            .select('*')
            .eq('id', data.user.id)
            .single();

          if (profileErr || !profile) {
            // User exists in auth but has not been provisioned as admin profile
            throw new Error(
              'User authentication successful, but no authorized admin profile was found in public.admin_profiles. Please run the provisioning SQL migration in Supabase SQL Editor.'
            );
          }

          if (!profile.is_active) {
            throw new Error('This admin account has been deactivated. Contact Super Admin.');
          }

          if (data.session?.access_token) {
            profile.accessToken = data.session.access_token;
            sessionStorage.setItem('uptrends_access_token', data.session.access_token);
          }

          onLoginSuccess(profile);
          return;
        }
      } else {
        throw new Error(
          'Admin login is unavailable because Supabase is not configured. Please contact the site administrator.'
        );
      }
    } catch (err: any) {
      setError(err.message || 'Authentication failed. Please check your credentials.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="relative isolate flex min-h-[80vh] items-center justify-center overflow-hidden bg-[#fff8ef] py-12 px-4 sm:px-6 lg:px-8">
      <span aria-hidden="true" className="pointer-events-none absolute -left-12 top-24 h-40 w-40 rounded-full bg-sky-100/80" />
      <span aria-hidden="true" className="pointer-events-none absolute -right-10 bottom-8 h-52 w-52 rounded-full bg-orange-50/90" />
      <div className="relative z-10 max-w-md w-full">
        <button
          type="button"
          onClick={() => setCurrentPage('home')}
          className="mb-3 inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-500"
        >
          <ArrowLeft className="h-4 w-4" aria-hidden="true" />
          Back to Academy Website
        </button>
        <div className="w-full bg-white rounded-3xl border border-slate-200/80 shadow-2xl overflow-hidden">
        {/* Header Banner */}
        <div className="bg-slate-900 p-8 text-center text-white relative">
          <div className="flex justify-center mb-4">
            <Logo variant="white" size="md" />
          </div>
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-slate-800 text-orange-400 text-xs font-bold uppercase tracking-wider mb-2">
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>Authorized Personnel Only</span>
          </div>
          <h2 className="text-xl font-extrabold text-white">Academy Admin Portal</h2>
          <p className="text-xs text-slate-400 mt-1">
            Sign in to review applications, manage programs, and monitor email notifications.
          </p>
        </div>

        {/* Login Form */}
        <form onSubmit={handleLogin} className="p-8 space-y-6">
          {!isSupabaseConfigured && (
            <div role="alert" className="p-3.5 bg-amber-50 border border-amber-200 rounded-xl flex items-start gap-2 text-amber-800 text-xs">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>
                Admin login is unavailable because Supabase is not configured. Set <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code> in the local environment; keep service-role and R2 secrets server-side.
              </span>
            </div>
          )}

          {error && (
            <div className="p-3.5 bg-rose-50 border border-rose-200 rounded-xl flex items-start gap-2 text-rose-700 text-xs">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <div>
            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
              Admin Email Address
            </label>
            <div className="relative">
              <Mail className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="uptrendsinstitute@gmail.com"
                className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-300 text-sm focus:outline-hidden focus:ring-2 focus:ring-orange-500"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-slate-700 uppercase tracking-wider mb-1">
              Password
            </label>
            <div className="relative">
              <Lock className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
              <input
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••••••"
                className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-300 text-sm focus:outline-hidden focus:ring-2 focus:ring-orange-500"
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading || !isSupabaseConfigured}
            className="w-full py-3.5 px-4 rounded-xl bg-orange-600 hover:bg-orange-500 text-white font-bold text-sm shadow-md transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50"
          >
            {loading ? (
              <span>Authenticating...</span>
            ) : (
              <>
                <span>Sign In to Admin Portal</span>
                <ArrowRight className="w-4 h-4" />
              </>
            )}
          </button>

          <div className="pt-2 text-center">
            <button
              type="button"
              onClick={() => setShowConfigHelp(!showConfigHelp)}
              className="text-xs text-slate-400 hover:text-slate-600 inline-flex items-center gap-1"
            >
              <HelpCircle className="w-3.5 h-3.5" />
              <span>How are admins provisioned?</span>
            </button>
          </div>

          {showConfigHelp && (
            <div className="p-4 bg-slate-50 border border-slate-200 rounded-xl text-[11px] text-slate-600 space-y-2">
              <p className="font-bold text-slate-800">Admin Provisioning Security Policy:</p>
              <p>
                In compliance with security rules, public self-registration is strictly disabled. New staff or admins must be invited via the Supabase Auth Dashboard and granted a role in the <code>admin_profiles</code> database table.
              </p>
              <p>
                See <code>/supabase/README.md</code> for exact SQL steps.
              </p>
            </div>
          )}

        </form>
      </div>
      </div>
    </div>
  );
};
