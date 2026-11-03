
import React, { useEffect, useRef, useState } from 'react';
import { Logo } from './Logo';
import {
  Menu,
  X,
  PhoneCall,
  ArrowRight,
  Phone,
} from 'lucide-react';
import { SiteBranding } from '../types';

interface HeaderProps {
  currentPage: string;
  setCurrentPage: (page: string) => void;
  openCallbackModal: (programName?: string) => void;
  branding?: SiteBranding | null;
}

export const Header: React.FC<HeaderProps> = ({
  currentPage,
  setCurrentPage,
  openCallbackModal,
  branding,
}) => {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [headerVisible, setHeaderVisible] = useState(true);
  const headerVisibleRef = useRef(true);

  const updateHeaderVisibility = (visible: boolean) => {
    if (headerVisibleRef.current === visible) return;
    headerVisibleRef.current = visible;
    setHeaderVisible(visible);
  };

  useEffect(() => {
    let previousScrollY = window.scrollY;
    let accumulatedScroll = 0;
    const scrollThreshold = 14;

    const handleScroll = () => {
      const currentScrollY = window.scrollY;
      const scrollDelta = currentScrollY - previousScrollY;
      previousScrollY = currentScrollY;

      if (currentScrollY <= 8 || mobileMenuOpen) {
        accumulatedScroll = 0;
        updateHeaderVisibility(true);
        return;
      }

      if (scrollDelta === 0) return;
      if (Math.sign(scrollDelta) !== Math.sign(accumulatedScroll)) {
        accumulatedScroll = 0;
      }
      accumulatedScroll += scrollDelta;

      if (accumulatedScroll >= scrollThreshold) {
        updateHeaderVisibility(false);
        accumulatedScroll = 0;
      } else if (accumulatedScroll <= -scrollThreshold) {
        updateHeaderVisibility(true);
        accumulatedScroll = 0;
      }
    };

    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, [mobileMenuOpen]);

  const navLinks = [
    { id: 'home', label: 'Home' },
    { id: 'about', label: 'About Us' },
    { id: 'programs', label: 'Programs' },
    { id: 'media', label: 'Media & Testimonials' },
    { id: 'faqs', label: 'FAQs' },
    { id: 'contact', label: 'Contact Us' },
  ];

  const handleNavigate = (page: string) => {
    setCurrentPage(page);
    setMobileMenuOpen(false);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <header
      onFocusCapture={() => updateHeaderVisibility(true)}
      className={`sticky top-0 z-40 border-b border-orange-100 bg-[#fff8ef] shadow-xs backdrop-blur-md transition-transform duration-300 ease-in-out motion-reduce:transition-none ${
        headerVisible ? 'translate-y-0' : '-translate-y-full'
      }`}
    >
      {/* Top contact bar — separate from the 80px main navigation */}
      <div className="hidden border-b border-orange-100 bg-[#f7ecdf] px-4 py-1.5 text-xs font-medium text-slate-700 lg:block">
        <div className="mx-auto flex max-w-[1600px] items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <span className="flex items-center gap-1.5 whitespace-nowrap">
              <span className="h-2 w-2 rounded-full bg-emerald-500" />
              Admissions Open in Davangere
            </span>

            <span className="text-slate-500">|</span>

            <a
              href="tel:+919008000211"
              className="flex items-center gap-1.5 whitespace-nowrap transition-colors hover:text-orange-700 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-700"
            >
              <Phone className="h-3.5 w-3.5 text-orange-400" />
              +91 900 8000 211
            </a>

            <span className="text-slate-500">|</span>

            <span className="whitespace-nowrap">
              Mon–Sat: 8:00 AM – 8:30 PM (Sun Closed)
            </span>
          </div>

        </div>
      </div>

      {/* Main navigation — exactly 80px high */}
      <div className="mx-auto max-w-[1600px] px-3 sm:px-5 2xl:px-8">
        <div className="flex h-20 items-center gap-4">
          {/* Main logo */}
          <button
            onClick={() => handleNavigate('home')}
            aria-label="Go to home page"
            className="flex shrink-0 items-center rounded-lg p-1 text-left focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900"
          >
            <Logo
              size="sm"
              logoUrl={branding?.logo_url}
              altText={branding?.main_logo_alt || branding?.logo_alt}
            />
          </button>

          {/* Desktop navigation: sequential horizontal links */}
          <nav
            aria-label="Main navigation"
            className="hidden min-w-0 flex-1 items-center justify-evenly gap-1 lg:flex"
          >
            {navLinks.map((link) => {
              const isActive = currentPage === link.id;

              return (
                <button
                  key={link.id}
                  type="button"
                  onClick={() => handleNavigate(link.id)}
                  className={`shrink-0 whitespace-nowrap rounded-lg px-2 py-2 text-sm font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-700 motion-reduce:transition-none 2xl:px-3 ${
                    isActive
                      ? 'bg-orange-50 text-orange-600'
                      : 'text-slate-700 hover:bg-slate-50 hover:text-orange-600'
                  }`}
                >
                  {link.label}
                </button>
              );
            })}
          </nav>

          {/* Desktop action buttons */}
          <div className="hidden shrink-0 items-center gap-2 xl:flex 2xl:gap-3">
            <button
              type="button"
              onClick={() => openCallbackModal()}
              className="inline-flex items-center gap-2 whitespace-nowrap rounded-lg border border-slate-300 bg-white/80 px-3 py-2 text-sm font-semibold text-slate-700 shadow-xs transition-all hover:border-orange-500 hover:text-orange-600 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-700 motion-reduce:transition-none"
            >
              <PhoneCall className="h-4 w-4 text-orange-600" />
              <span>Request a Call</span>
            </button>

            <button
              type="button"
              onClick={() => handleNavigate('apply')}
              className={`inline-flex items-center gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-bold shadow-sm transition-all focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-700 motion-reduce:transition-none 2xl:px-4 ${
                currentPage === 'apply'
                  ? 'bg-emerald-700 text-white ring-2 ring-emerald-500 ring-offset-2'
                  : 'bg-gradient-to-r from-orange-600 to-orange-500 text-white hover:from-orange-500 hover:to-orange-600 hover:shadow-md'
              }`}
            >
              <span>Join Now</span>
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>

          {/* Mobile and tablet menu button */}
          <div className="ml-auto flex shrink-0 items-center gap-2 lg:hidden">
            <button
              type="button"
              onClick={() => openCallbackModal()}
              className="rounded-lg border border-orange-200 p-2 text-orange-600 transition-colors hover:bg-orange-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-700 motion-reduce:transition-none md:hidden"
              aria-label="Request a call"
              title="Request a Call"
            >
              <PhoneCall className="h-5 w-5" />
            </button>

            <button
              type="button"
              onClick={() => setMobileMenuOpen((open) => !open)}
              className="rounded-lg p-2 text-slate-700 transition-colors hover:bg-orange-50 hover:text-orange-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-orange-600 motion-reduce:transition-none"
              aria-label={
                mobileMenuOpen
                  ? 'Close navigation menu'
                  : 'Open navigation menu'
              }
              aria-expanded={mobileMenuOpen}
            >
              {mobileMenuOpen ? (
                <X className="h-6 w-6" />
              ) : (
                <Menu className="h-6 w-6" />
              )}
            </button>
          </div>
        </div>
      </div>

      {/* Mobile and tablet navigation drawer */}
      {mobileMenuOpen && (
        <div className="border-b border-orange-100 bg-[#fff8ef] px-4 pb-6 pt-2 shadow-xl lg:hidden">
          <nav
            aria-label="Mobile navigation"
            className="grid grid-cols-1 gap-1"
          >
            {navLinks.map((link) => (
              <button
                key={link.id}
                type="button"
                onClick={() => handleNavigate(link.id)}
                className={`rounded-lg px-4 py-3 text-left text-base font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-orange-700 motion-reduce:transition-none ${
                  currentPage === link.id
                    ? 'border-l-4 border-orange-500 bg-orange-50 text-orange-600'
                    : 'text-slate-800 hover:bg-slate-50'
                }`}
              >
                {link.label}
              </button>
            ))}
          </nav>

          <div className="mt-4 flex flex-col gap-2.5 border-t border-slate-100 pt-4">
            <button
              type="button"
              onClick={() => {
                setMobileMenuOpen(false);
                openCallbackModal();
              }}
              className="flex w-full items-center justify-center gap-2 rounded-lg border border-slate-300 bg-slate-50 px-4 py-3 text-sm font-semibold text-slate-800"
            >
              <PhoneCall className="h-4 w-4 text-orange-600" />
              <span>Request a Call</span>
            </button>

            <button
              type="button"
              onClick={() => handleNavigate('apply')}
              className="flex w-full items-center justify-center gap-2 rounded-lg bg-orange-600 px-4 py-3 text-base font-bold text-white shadow-sm"
            >
              <span>Join Now</span>
              <ArrowRight className="h-4 w-4" />
            </button>

          </div>
        </div>
      )}
    </header>
  );
};
