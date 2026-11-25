import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Header } from './components/Header';
import { AnnouncementBanner } from './components/AnnouncementBanner';
import { Footer } from './components/Footer';
import { CallbackModal } from './components/CallbackModal';
import { DemoClassBookingModal } from './components/DemoClassBookingModal';
import { VideoModal } from './components/VideoModal';

// Pages
import { Home } from './pages/Home';
import { AboutUs } from './pages/AboutUs';
import { Programs } from './pages/Programs';
import { ProgramDetails } from './pages/ProgramDetails';
import { MediaGallery } from './pages/MediaGallery';
import { FAQs } from './pages/FAQs';
import { ContactUs } from './pages/ContactUs';
import { ApplyNow } from './pages/ApplyNow';
import { AdminLogin } from './pages/AdminLogin';
import { AdminPortal } from './pages/AdminPortal';
import { NotFound } from './pages/NotFound';
import { fetchPublicJson, getPublicApiErrorMessage, PublicApiError } from './lib/publicApi';
import { supabase } from './lib/supabase';
import { restoreAdminSession } from './lib/adminAuth';
import {
  getAdminPageFromPath,
  getAdminPathForPage,
  getInitialPage,
  isAdminHostname,
  type AdminPage,
} from './lib/appRouting';

import { Program, MediaItem, FAQ, AdminProfile, SiteBranding } from './types';

type PublicResource = 'branding' | 'programs' | 'media' | 'faqs';
type PublicResourceStatus = { loading: boolean; error: string | null };
type PublicResourceStatuses = Record<PublicResource, PublicResourceStatus>;

const applyBrandColorPalette = (name: 'orange' | 'emerald' | 'green', color?: string) => {
  if (!color || !/^#[0-9a-f]{6}$/i.test(color)) return;

  const root = document.documentElement;
  const shades: Array<[number, string]> = [
    [50, '8%'],
    [100, '14%'],
    [200, '28%'],
    [300, '44%'],
    [400, '62%'],
    [500, '82%'],
  ];

  for (const [shade, amount] of shades) {
    root.style.setProperty(
      `--color-${name}-${shade}`,
      `color-mix(in srgb, ${color} ${amount}, white)`,
    );
  }
  root.style.setProperty(`--color-${name}-600`, color);
  root.style.setProperty(`--color-${name}-700`, `color-mix(in srgb, ${color} 88%, black)`);
  root.style.setProperty(`--color-${name}-800`, `color-mix(in srgb, ${color} 72%, black)`);
  root.style.setProperty(`--color-${name}-900`, `color-mix(in srgb, ${color} 58%, black)`);
  root.style.setProperty(`--color-${name}-950`, `color-mix(in srgb, ${color} 42%, black)`);
};

const emptyPublicStatuses: PublicResourceStatuses = {
  branding: { loading: true, error: null },
  programs: { loading: true, error: null },
  media: { loading: true, error: null },
  faqs: { loading: true, error: null },
};

export function App() {
  const isAdminHost = isAdminHostname(window.location.hostname);
  const [currentPage, setCurrentPageState] = useState<string>(() =>
    getInitialPage(window.location.hostname, window.location.pathname),
  );
  const [selectedProgram, setSelectedProgram] = useState<Program | null>(null);

  // Global Callback Modal State
  const [callbackOpen, setCallbackOpen] = useState(false);
  const [callbackProgram, setCallbackProgram] = useState<string>('General English Training');
  const [demoClassModalOpen, setDemoClassModalOpen] = useState(false);

  // Global Video Modal State
  const [videoOpen, setVideoOpen] = useState(false);
  const [videoUrl, setVideoUrl] = useState<string | null>(null);
  const [videoTitle, setVideoTitle] = useState('');

  // Admin Session State
  const [currentAdmin, setCurrentAdmin] = useState<AdminProfile | null>(null);
  const [adminSessionRestoring, setAdminSessionRestoring] = useState(isAdminHost);
  const [adminSessionError, setAdminSessionError] = useState<string | null>(null);
  const [adminLogoutError, setAdminLogoutError] = useState<string | null>(null);
  const [adminRestoreRequest, setAdminRestoreRequest] = useState(0);
  const adminExpiryHandled = useRef(false);
  const manualLogoutInProgress = useRef(false);

  const navigateToPage = useCallback((page: string, replace = false) => {
    if (isAdminHost) {
      const adminPage: AdminPage =
        page === 'admin' || page === 'admin-portal' ? 'admin-portal' : 'admin-login';
      const pathname = getAdminPathForPage(adminPage);

      if (window.location.pathname !== pathname) {
        if (replace) {
          window.history.replaceState(null, '', pathname);
        } else {
          window.history.pushState(null, '', pathname);
        }
      }

      setCurrentPageState(adminPage);
      return;
    }

    setCurrentPageState(page);
  }, [isAdminHost]);

  // Data Collections
  const [programs, setPrograms] = useState<Program[]>([]);
  const [mediaItems, setMediaItems] = useState<MediaItem[]>([]);
  const [faqs, setFaqs] = useState<FAQ[]>([]);
  const [branding, setBranding] = useState<SiteBranding | null>(null);
  const [publicStatuses, setPublicStatuses] = useState<PublicResourceStatuses>(emptyPublicStatuses);

  const loadPublicResource = async (
    resource: PublicResource,
    signal?: AbortSignal,
  ): Promise<void> => {
    setPublicStatuses((statuses) => ({
      ...statuses,
      [resource]: { loading: true, error: null },
    }));

    try {
      const data: unknown = await fetchPublicJson(`/api/${resource}`, signal);
      if (resource === 'branding') {
        if (!data || typeof data !== 'object' || Array.isArray(data)) throw new PublicApiError('unexpected_response');
        const nextBranding = data as SiteBranding;
        setBranding(nextBranding);
      } else {
        if (!Array.isArray(data)) throw new PublicApiError('unexpected_response');
        if (resource === 'programs') setPrograms(data as Program[]);
        if (resource === 'media') setMediaItems(data as MediaItem[]);
        if (resource === 'faqs') setFaqs(data as FAQ[]);
      }
      setPublicStatuses((statuses) => ({
        ...statuses,
        [resource]: { loading: false, error: null },
      }));
    } catch (error) {
      if (signal?.aborted) return;
      setPublicStatuses((statuses) => ({
        ...statuses,
        [resource]: { loading: false, error: getPublicApiErrorMessage(error) },
      }));
    }
  };

  const refreshPublicCatalogue = async () => {
    await Promise.all(
      (['branding', 'programs', 'media', 'faqs'] as const).map((resource) =>
        loadPublicResource(resource),
      ),
    );
  };

  useEffect(() => {
    if (isAdminHost) return;
    const controller = new AbortController();
    void Promise.all(
      (['branding', 'programs', 'media', 'faqs'] as const).map((resource) =>
        loadPublicResource(resource, controller.signal),
      ),
    );
    window.addEventListener('admin-data-updated', refreshPublicCatalogue);
    return () => {
      controller.abort();
      window.removeEventListener('admin-data-updated', refreshPublicCatalogue);
    };
  }, [isAdminHost]);

  useEffect(() => {
    if (!isAdminHost) {
      setAdminSessionRestoring(false);
      return;
    }

    let active = true;
    setAdminSessionRestoring(true);

    void restoreAdminSession().then((profile) => {
      if (!active) return;
      setCurrentAdmin(profile);
      setAdminSessionError(null);
      if (profile) {
        setCurrentPageState('admin-portal');
        const path = getAdminPathForPage('admin-portal');
        if (window.location.pathname !== path) {
          window.history.replaceState(null, '', path);
        }
      } else if (
        window.location.pathname !== '/' &&
        window.location.pathname !== getAdminPathForPage('admin-login')
      ) {
        setCurrentPageState('admin-login');
        const path = getAdminPathForPage('admin-login');
        if (window.location.pathname !== path) {
          window.history.replaceState(null, '', path);
        }
      }
    }).catch((error: unknown) => {
      if (!active) return;
      console.error('Unable to restore the admin session.', error);
      setAdminSessionError('We could not verify your saved admin session. Please sign in again.');
      setCurrentAdmin(null);
      setCurrentPageState('admin-login');
      const path = getAdminPathForPage('admin-login');
      if (window.location.pathname !== path) {
        window.history.replaceState(null, '', path);
      }
    }).finally(() => {
      if (active) setAdminSessionRestoring(false);
    });

    return () => {
      active = false;
    };
  }, [isAdminHost, adminRestoreRequest]);

  useEffect(() => {
    if (!isAdminHost) return;
    document.title = currentPage === 'admin-portal'
      ? "Admin Portal | Uptrend's English Academy"
      : "Admin Login | Uptrend's English Academy";
  }, [isAdminHost, currentPage]);

  useEffect(() => {
    if (!isAdminHost) return;

    const handlePopState = () => {
      const page = getAdminPageFromPath(window.location.pathname);
      if (page === 'admin-portal' && !currentAdmin) {
        setAdminRestoreRequest((request) => request + 1);
      }
      navigateToPage(page, true);
    };

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, [isAdminHost, currentAdmin, navigateToPage]);

  useEffect(() => {
    if (!branding) return;

    if (branding.academy_name) {
      document.title = `${branding.academy_name} — English Training Center in Davangere`;
    }

    if (branding.tagline) {
      const description = document.querySelector<HTMLMetaElement>('meta[name="description"]');
      if (description) description.content = `${branding.academy_name || "Uptrend's English Academy"}. ${branding.tagline} in Davangere, Karnataka.`;
    }

    applyBrandColorPalette('orange', branding.primary_orange || branding.primary_color);
    applyBrandColorPalette('emerald', branding.primary_green || branding.secondary_color);
    applyBrandColorPalette('green', branding.primary_green || branding.secondary_color);

    if (branding.favicon_url) {
      let link = document.querySelector<HTMLLinkElement>("link[rel*='icon']");
      if (!link) {
        link = document.createElement('link');
        link.rel = 'shortcut icon';
        document.head.appendChild(link);
      }
      link.href = branding.favicon_url;
    }
  }, [branding]);

  const openCallbackModal = (progName?: string) => {
    setCallbackProgram(progName || 'General English Training');
    setCallbackOpen(true);
  };

  const openVideoModal = (url: string, title: string) => {
    setVideoUrl(url);
    setVideoTitle(title);
    setVideoOpen(true);
  };

  const handleAdminLoginSuccess = (profile: AdminProfile) => {
    adminExpiryHandled.current = false;
    setAdminSessionError(null);
    setCurrentAdmin(profile);
    navigateToPage('admin-portal');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleAdminLogout = async () => {
    manualLogoutInProgress.current = true;
    setAdminLogoutError(null);

    try {
      if (supabase) {
        const { error } = await supabase.auth.signOut();
        if (error) throw error;
      }

      sessionStorage.removeItem('uptrends_access_token');
      setCurrentAdmin(null);
      navigateToPage('admin-login');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (error) {
      console.error('Unable to sign out of the admin portal.', error);
      setAdminLogoutError('Unable to sign out safely. Please try again.');
    } finally {
      manualLogoutInProgress.current = false;
    }
  };

  const handleAdminSessionExpired = () => {
    if (manualLogoutInProgress.current) return;
    if (adminExpiryHandled.current) return;
    adminExpiryHandled.current = true;
    sessionStorage.removeItem('uptrends_access_token');
    setCurrentAdmin(null);
    setAdminSessionError('Your admin session has expired. Please sign in again.');
    navigateToPage('admin-login', true);
    window.scrollTo({ top: 0, behavior: 'smooth' });
    void supabase?.auth.signOut().then(({ error }) => {
      if (error) console.error('Unable to complete sign-out after admin session expiry.', error);
    }).catch((error: unknown) => {
      console.error('Unable to complete sign-out after admin session expiry.', error);
    });
  };

  if (isAdminHost) {
    if (adminSessionRestoring) {
      return (
        <main className="flex min-h-screen items-center justify-center bg-[#fff8ef] text-sm font-medium text-slate-600" role="status">
          Verifying admin session…
        </main>
      );
    }

    if (currentPage === 'admin-portal' && currentAdmin) {
      return (
        <AdminPortal
          currentAdmin={currentAdmin}
          onLogout={handleAdminLogout}
          onSessionExpired={handleAdminSessionExpired}
          logoutError={adminLogoutError}
        />
      );
    }

    return (
      <AdminLogin
        onLoginSuccess={handleAdminLoginSuccess}
        sessionRestoreError={adminSessionError}
      />
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-[#fff8ef] text-slate-900 antialiased selection:bg-orange-500 selection:text-white">
      <div data-apply-header-stack className="sticky top-0 z-50">
        {/* Moving Announcement Banner (Section 6.B - no close button, Supabase driven) */}
        <div className="relative z-50">
          <AnnouncementBanner
            onOpenApplication={() => {
              navigateToPage('apply');
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }}
            onOpenDemoClass={() => setDemoClassModalOpen(true)}
          />
        </div>

        {/* Main Navigation Header */}
        <Header
          currentPage={currentPage}
          setCurrentPage={navigateToPage}
          openCallbackModal={openCallbackModal}
          branding={branding}
        />
      </div>

      {Object.entries(publicStatuses).some(([, status]) => status.error) && (
        <div className="bg-amber-50 border-b border-amber-200 px-4 py-3 text-sm text-amber-900" role="status" aria-live="polite">
          <div className="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-3">
            <span>
              Some academy content could not be loaded:{' '}
              {Object.entries(publicStatuses)
                .filter(([, status]) => status.error)
                .map(([resource, status]) => `${resource}: ${status.error}`)
                .join(' · ')}
            </span>
            <button
              type="button"
              onClick={() => void refreshPublicCatalogue()}
              className="font-semibold underline underline-offset-2"
            >
              Retry
            </button>
          </div>
        </div>
      )}

      {/* Page Routing */}
      <main className="flex-1">
        <div
          aria-hidden={currentPage !== 'home'}
          inert={currentPage !== 'home'}
          className={
            currentPage === 'home'
              ? 'contents'
              : 'pointer-events-none invisible absolute left-[-10000px] top-0 w-full'
          }
        >
          <Home
            programs={programs}
            mediaItems={mediaItems}
            dataStatuses={publicStatuses}
            onRetryData={(resource) => void loadPublicResource(resource)}
            setCurrentPage={navigateToPage}
            setSelectedProgram={setSelectedProgram}
            openCallbackModal={openCallbackModal}
            openDemoClassModal={() => setDemoClassModalOpen(true)}
            openVideoModal={openVideoModal}
            branding={branding}
          />
        </div>

        {currentPage === 'about' && (
          <AboutUs
            openVideoModal={openVideoModal}
            openCallbackModal={openCallbackModal}
            setCurrentPage={navigateToPage}
          />
        )}

        {currentPage === 'programs' && (
          <Programs
            programs={programs}
            setSelectedProgram={setSelectedProgram}
            setCurrentPage={navigateToPage}
            openCallbackModal={openCallbackModal}
            openDemoClassModal={() => setDemoClassModalOpen(true)}
          />
        )}

        {currentPage === 'program-details' && (
          <ProgramDetails
            program={selectedProgram || programs[0]}
            setCurrentPage={navigateToPage}
            openCallbackModal={openCallbackModal}
          />
        )}

        {currentPage === 'media' && (
          <MediaGallery
            mediaItems={mediaItems}
            openVideoModal={openVideoModal}
            openDemoClassModal={() => setDemoClassModalOpen(true)}
            openCallbackModal={openCallbackModal}
          />
        )}

        {currentPage === 'faqs' && (
          <FAQs
            faqs={faqs}
            openCallbackModal={openCallbackModal}
            setCurrentPage={navigateToPage}
          />
        )}

        {currentPage === 'contact' && (
          <ContactUs
            openDemoClassModal={() => setDemoClassModalOpen(true)}
            openCallbackModal={openCallbackModal}
          />
        )}

        {currentPage === 'apply' && (
          <ApplyNow
            programs={programs}
            selectedProgram={selectedProgram}
            setCurrentPage={navigateToPage}
          />
        )}

        {![
          'home',
          'about',
          'programs',
          'program-details',
          'media',
          'faqs',
          'contact',
          'apply',
        ].includes(currentPage) && <NotFound setCurrentPage={navigateToPage} />}
      </main>

      {/* Footer */}
      {currentPage !== 'apply' && (
        <Footer
          setCurrentPage={navigateToPage}
          openCallbackModal={openCallbackModal}
          branding={branding}
        />
      )}

      {/* Global Modals */}
      <CallbackModal
        isOpen={callbackOpen}
        onClose={() => setCallbackOpen(false)}
        prefilledProgram={callbackProgram}
      />

      <DemoClassBookingModal
        isOpen={demoClassModalOpen}
        onClose={() => setDemoClassModalOpen(false)}
      />

      <VideoModal
        isOpen={videoOpen}
        onClose={() => setVideoOpen(false)}
        videoUrlOrId={videoUrl}
        title={videoTitle}
      />
    </div>
  );
}

export default App;
