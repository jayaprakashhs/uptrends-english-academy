
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

const socialLinks = [
  { name: 'WhatsApp', url: 'https://wa.me/919008000211?text=Hi%20Sir%2C%20I%20am%20interested%20in%20joining%20Uptrend%27s%20English%20Academy.%20I%20would%20like%20to%20know%20more%20about%20your%20Spoken%20English%20courses%2E', color: '#25D366' },
  { name: 'Instagram', url: 'https://www.instagram.com/uptrendsenglishacademy/', color: 'instagram' },
  { name: 'Facebook', url: 'https://www.facebook.com/UptrendEnglishAcademy', color: '#1877F2' },
  { name: 'YouTube', url: 'https://www.youtube.com/@SpeakEnglishConfidently123', color: '#FF0000' },
] as const;

interface SocialIconsProps {
  idPrefix: string;
  navClassName?: string;
  linkSizeClassName?: string;
  iconSizeClassName?: string;
}

const SocialIcons: React.FC<SocialIconsProps> = ({
  idPrefix,
  navClassName = '',
  linkSizeClassName = 'h-10 w-[30px] sm:w-10',
  iconSizeClassName = 'h-[22px] w-[22px]',
}) => (
  <nav
    aria-label="Social media"
    className={`flex shrink-0 items-center gap-0 ${navClassName}`}
  >
    {socialLinks.map((link) => (
      <a
        key={link.name}
        href={link.url}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`Visit us on ${link.name}`}
        className={`flex shrink-0 items-center justify-center rounded-full transition-transform hover:scale-110 active:scale-95 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-700 motion-reduce:transition-none ${linkSizeClassName}`}
      >
        <svg
          aria-hidden="true"
          viewBox="0 0 24 24"
          className={iconSizeClassName}
        >
          {link.name === 'WhatsApp' && (
            <path
              fill={link.color}
              d="M20.52 3.48A11.82 11.82 0 0 0 12.1 0C5.56 0 .23 5.32.23 11.86c0 2.09.55 4.13 1.59 5.93L.13 24l6.36-1.67a11.85 11.85 0 0 0 5.6 1.42h.01c6.54 0 11.87-5.32 11.87-11.86 0-3.17-1.23-6.15-3.45-8.41ZM12.1 21.73h-.01a9.86 9.86 0 0 1-5.02-1.37l-.36-.21-3.77.99 1.01-3.67-.24-.38a9.84 9.84 0 0 1-1.51-5.23c0-5.46 4.45-9.9 9.91-9.9a9.84 9.84 0 0 1 7.01 2.9 9.84 9.84 0 0 1 2.9 7c0 5.46-4.45 9.9-9.92 9.9Zm5.44-7.42c-.3-.15-1.77-.87-2.04-.97-.28-.1-.48-.15-.68.15-.2.3-.78.97-.96 1.17-.18.2-.35.22-.65.07-.3-.15-1.26-.46-2.4-1.47-.89-.79-1.49-1.77-1.67-2.07-.17-.3-.02-.46.13-.61.13-.13.3-.35.45-.53.15-.18.2-.3.3-.5.1-.2.05-.38-.03-.53-.07-.15-.67-1.62-.92-2.22-.24-.58-.49-.5-.67-.51h-.57c-.2 0-.53.08-.81.38-.28.3-1.06 1.03-1.06 2.5s1.08 2.9 1.23 3.1c.15.2 2.13 3.25 5.16 4.55.72.31 1.28.5 1.72.64.72.23 1.37.2 1.88.12.57-.08 1.77-.72 2.02-1.42.25-.7.25-1.3.18-1.42-.08-.13-.28-.2-.58-.35Z"
            />
          )}
          {link.name === 'Instagram' && (
            <>
              <defs>
                <linearGradient id={`instagram-icon-gradient-${idPrefix}`} x1="0%" y1="100%" x2="100%" y2="0%">
                  <stop offset="0%" stopColor="#FFDC80" />
                  <stop offset="50%" stopColor="#F56040" />
                  <stop offset="100%" stopColor="#C13584" />
                </linearGradient>
              </defs>
              <path
                fill={`url(#instagram-icon-gradient-${idPrefix})`}
                d="M7 2h10a5 5 0 0 1 5 5v10a5 5 0 0 1-5 5H7a5 5 0 0 1-5-5V7a5 5 0 0 1 5-5Zm0 2a3 3 0 0 0-3 3v10a3 3 0 0 0 3 3h10a3 3 0 0 0 3-3V7a3 3 0 0 0-3-3H7Zm5 3a5 5 0 1 1 0 10 5 5 0 0 1 0-10Zm0 2a3 3 0 1 0 0 6 3 3 0 0 0 0-6Zm5.25-3.25a1.25 1.25 0 1 1 0 2.5 1.25 1.25 0 0 1 0-2.5Z"
              />
            </>
          )}
          {link.name === 'Facebook' && (
            <path
              fill={link.color}
              d="M24 12a12 12 0 1 0-13.88 11.86v-8.39H7.08V12h3.04V9.35c0-3 1.79-4.66 4.53-4.66 1.31 0 2.68.23 2.68.23v2.95h-1.51c-1.49 0-1.96.93-1.96 1.88V12h3.34l-.53 3.47h-2.81v8.39A12 12 0 0 0 24 12Z"
            />
          )}
          {link.name === 'YouTube' && (
            <>
              <rect
                x="1"
                y="4"
                width="22"
                height="16"
                rx="5"
                fill={link.color}
              />
              <path fill="#fff" d="M10 8.5v7l6-3.5-6-3.5Z" />
            </>
          )}
        </svg>
      </a>
    ))}
  </nav>
);

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
      className={`relative z-40 border-b border-orange-100 bg-[#fff8ef] shadow-xs backdrop-blur-md transition-transform duration-300 ease-in-out motion-reduce:transition-none ${
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
          <SocialIcons
            idPrefix="desktop"
            navClassName="gap-1"
            linkSizeClassName="h-8 w-7"
            iconSizeClassName="h-5 w-5"
          />
        </div>
      </div>

      {/* Main navigation — 80px primary row */}
      <div className="mx-auto max-w-[1600px] px-1 sm:px-5 2xl:px-8">
        <div className="flex h-20 items-center gap-0 sm:gap-4">
          {/* Main logo */}
          <button
            onClick={() => handleNavigate('home')}
            aria-label="Go to home page"
            className="flex shrink-0 items-center rounded-lg p-0 text-left focus:outline-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-slate-900 sm:p-1"
          >
            <Logo
              size="compact"
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
          <div className="ml-auto flex shrink-0 items-center gap-1 lg:hidden">
            <SocialIcons idPrefix="mobile" navClassName="md:hidden" />
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
