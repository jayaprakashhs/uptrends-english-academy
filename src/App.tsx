import React, { useState, useEffect, useRef } from 'react';
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
  const [currentPage, setCurrentPage] = useState<string>('home');
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
  const adminExpiryHandled = useRef(false);

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
  }, []);

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
    setCurrentAdmin(profile);
    setCurrentPage('admin-portal');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleAdminLogout = () => {
    setCurrentAdmin(null);
    setCurrentPage('home');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleAdminSessionExpired = () => {
    if (adminExpiryHandled.current) return;
    adminExpiryHandled.current = true;
    sessionStorage.removeItem('uptrends_access_token');
    setCurrentAdmin(null);
    setCurrentPage('admin-login');
    window.scrollTo({ top: 0, behavior: 'smooth' });
    void supabase?.auth.signOut().then(({ error }) => {
      if (error) console.error('Unable to complete sign-out after admin session expiry.', error);
    }).catch((error: unknown) => {
      console.error('Unable to complete sign-out after admin session expiry.', error);
    });
  };

  // If in admin portal
  if (currentPage === 'admin' || currentPage === 'admin-portal') {
    if (!currentAdmin) {
      return (
        <AdminLogin
          onLoginSuccess={handleAdminLoginSuccess}
          setCurrentPage={setCurrentPage}
        />
      );
    }

    return (
      <AdminPortal
        currentAdmin={currentAdmin}
        onLogout={handleAdminLogout}
        onSessionExpired={handleAdminSessionExpired}
        setCurrentPage={setCurrentPage}
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
              setCurrentPage('apply');
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }}
            onOpenDemoClass={() => setDemoClassModalOpen(true)}
          />
        </div>

        {/* Main Navigation Header */}
        <Header
          currentPage={currentPage}
          setCurrentPage={setCurrentPage}
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
            setCurrentPage={setCurrentPage}
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
            setCurrentPage={setCurrentPage}
          />
        )}

        {currentPage === 'programs' && (
          <Programs
            programs={programs}
            setSelectedProgram={setSelectedProgram}
            setCurrentPage={setCurrentPage}
            openCallbackModal={openCallbackModal}
            openDemoClassModal={() => setDemoClassModalOpen(true)}
          />
        )}

        {currentPage === 'program-details' && (
          <ProgramDetails
            program={selectedProgram || programs[0]}
            setCurrentPage={setCurrentPage}
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
            setCurrentPage={setCurrentPage}
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
            setCurrentPage={setCurrentPage}
          />
        )}

        {currentPage === 'admin-login' && (
          <AdminLogin
            onLoginSuccess={handleAdminLoginSuccess}
            setCurrentPage={setCurrentPage}
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
          'admin-login',
          'admin-portal',
          'admin',
        ].includes(currentPage) && <NotFound setCurrentPage={setCurrentPage} />}
      </main>

      {/* Footer */}
      {currentPage !== 'apply' && (
        <Footer
          setCurrentPage={setCurrentPage}
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
