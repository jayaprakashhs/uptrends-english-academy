import type { AdminProfile } from '../types';
import { supabase } from './supabase';

export type AdminProfileLookup =
  | { status: 'active'; profile: AdminProfile }
  | { status: 'missing' }
  | { status: 'inactive' };

export const findAdminProfile = async (
  userId: string,
  accessToken: string,
): Promise<AdminProfileLookup> => {
  if (!supabase) {
    throw new Error('Supabase is not configured.');
  }

  const { data: profile, error } = await supabase
    .from('admin_profiles')
    .select('*')
    .eq('id', userId)
    .maybeSingle();

  if (error) throw error;
  if (!profile) return { status: 'missing' };
  if (!profile.is_active) return { status: 'inactive' };

  return {
    status: 'active',
    profile: { ...profile, accessToken },
  };
};

export const restoreAdminSession = async (): Promise<AdminProfile | null> => {
  if (!supabase) return null;

  const { data, error } = await supabase.auth.getSession();
  if (error) throw error;

  const session = data.session;
  if (!session) {
    sessionStorage.removeItem('uptrends_access_token');
    return null;
  }

  const result = await findAdminProfile(session.user.id, session.access_token);
  if (result.status !== 'active') {
    const { error: signOutError } = await supabase.auth.signOut();
    sessionStorage.removeItem('uptrends_access_token');
    if (signOutError) throw signOutError;
    return null;
  }

  sessionStorage.setItem('uptrends_access_token', session.access_token);
  return result.profile;
};