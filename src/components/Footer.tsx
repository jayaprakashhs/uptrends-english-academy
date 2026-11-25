import React from 'react';
import { Logo } from './Logo';
import { SocialIcons } from './Header';
import { MapPin, Phone, Mail, Clock, ArrowUpRight } from 'lucide-react';

import { SiteBranding } from '../types';

interface FooterProps {
  setCurrentPage: (page: string) => void;
  openCallbackModal: () => void;
  branding?: SiteBranding | null;
}

export const Footer: React.FC<FooterProps> = ({
  setCurrentPage,
  openCallbackModal,
  branding,
}) => {
  const whatsappMessage = [
    "Hello Uptrend's English Academy,",
    'I would like to know more about your English training programs.',
    'Please share the details. Thank you.',
  ].join('\n');

  const handleNav = (page: string) => {
    setCurrentPage(page);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <footer className="bg-slate-950 text-slate-300 pt-16 pb-12 border-t border-slate-800">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-12 mb-12">
          {/* Column 1: Brand & Purpose */}
          <div className="space-y-4">
            <div className="flex justify-start">
              <Logo
                variant="white"
              size="lg"
              logoUrl={branding?.footer_logo_url || branding?.logo_url}
                altText={branding?.main_logo_alt || branding?.logo_alt}
              />
            </div>
            <p className="text-sm text-slate-400 leading-relaxed pt-2">
              Davangere’s dedicated training center for spoken English, grammar fundamentals, and professional communication skills. 25+ years of empowering confident speakers.
            </p>
            <div className="pt-2">
              <button
                onClick={openCallbackModal}
                className="inline-flex items-center gap-2 text-xs font-semibold px-3 py-1.5 rounded-md bg-orange-600 hover:bg-orange-500 text-white transition-colors cursor-pointer"
              >
                <span>Request a Callback</span>
                <ArrowUpRight className="w-3.5 h-3.5" />
              </button>
            </div>
          </div>

          {/* Column 2: Navigation Links */}
          <div>
            <h4 className="text-white text-sm font-bold uppercase tracking-wider mb-4 border-l-2 border-orange-500 pl-2">
              Quick Links
            </h4>
            <ul className="space-y-2 text-sm">
              <li>
                <button
                  onClick={() => handleNav('home')}
                  className="hover:text-orange-400 transition-colors text-slate-400"
                >
                  Home
                </button>
              </li>
              <li>
                <button
                  onClick={() => handleNav('about')}
                  className="hover:text-orange-400 transition-colors text-slate-400"
                >
                  About Us & Philosophy
                </button>
              </li>
              <li>
                <button
                  onClick={() => handleNav('programs')}
                  className="hover:text-orange-400 transition-colors text-slate-400"
                >
                  English Programs
                </button>
              </li>
              <li>
                <button
                  onClick={() => handleNav('media')}
                  className="hover:text-orange-400 transition-colors text-slate-400"
                >
                  Media & Testimonials
                </button>
              </li>
              <li>
                <button
                  onClick={() => handleNav('faqs')}
                  className="hover:text-orange-400 transition-colors text-slate-400"
                >
                  FAQs
                </button>
              </li>
              <li>
                <button
                  onClick={() => handleNav('contact')}
                  className="hover:text-orange-400 transition-colors text-slate-400"
                >
                  Contact & Location
                </button>
              </li>
              <li>
                <button
                  onClick={() => handleNav('apply')}
                  className="text-emerald-400 font-semibold hover:text-emerald-300 transition-colors"
                >
                  Apply for Admission →
                </button>
              </li>
            </ul>
          </div>

          {/* Column 3: Contact Details */}
          <div>
            <h4 className="text-white text-sm font-bold uppercase tracking-wider mb-4 border-l-2 border-emerald-500 pl-2">
              Contact Academy
            </h4>
            <ul className="space-y-3 text-sm text-slate-400">
              <li className="flex items-start gap-3">
                <MapPin className="w-5 h-5 text-orange-400 shrink-0 mt-0.5" />
                <span className="leading-snug">
                  #259/1A1, Devi Building, 2nd Floor, Ram And Co Circle, opposite Ganesha Temple, above Sangeetha Mobiles, Prince Jayachamaraja Wodeyar, Davangere, Karnataka 577002, India
                </span>
              </li>
              <li className="flex items-center gap-3">
                <Phone className="w-4 h-4 text-emerald-400 shrink-0" />
                <a href="tel:+919008000211" className="hover:text-white transition-colors">
                  +91 900 8000 211
                </a>
              </li>
              <li className="flex items-center gap-3">
                <a
                  href={`https://wa.me/919008000211?text=${encodeURIComponent(whatsappMessage)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="Chat with Uptrend's English Academy on WhatsApp"
                  className="inline-flex min-h-11 items-center gap-3 rounded-md text-emerald-400 transition-colors hover:text-emerald-300 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-400"
                >
                  <svg
                    aria-hidden="true"
                    viewBox="0 0 24 24"
                    fill="none"
                    className="h-5 w-5 shrink-0"
                  >
                    <path
                      d="M20.1 11.8a8.1 8.1 0 0 1-12 7.1L3 20l1.2-5A8.1 8.1 0 1 1 20.1 11.8Z"
                      stroke="currentColor"
                      strokeWidth="1.8"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                    <path
                      d="M8.2 7.6c.2-.4.4-.4.7-.4h.5c.2 0 .4.1.5.4l.7 1.7c.1.2.1.4 0 .6l-.5.7c-.2.2-.2.4-.1.6.5.9 1.2 1.6 2.1 2.1.2.1.4.1.6-.1l.7-.5c.2-.1.4-.1.6 0l1.7.7c.3.1.4.3.4.5v.5c0 .3 0 .5-.4.7-.5.3-1.1.5-1.7.4-1.1-.2-2.4-.8-3.7-2.1-1.3-1.3-1.9-2.6-2.1-3.7-.1-.6.1-1.2.4-1.7Z"
                      fill="currentColor"
                    />
                  </svg>
                  <span className="text-sm">Chat with us on WhatsApp</span>
                </a>
              </li>
              <li className="flex items-center gap-3">
                <Mail className="w-4 h-4 text-orange-400 shrink-0" />
                <a href="mailto:uptrendsinstitute@gmail.com" className="hover:text-white transition-colors">
                  uptrendsinstitute@gmail.com
                </a>
              </li>
            </ul>
            <div className="mt-5">
              <h5 className="mb-2 text-xs font-bold uppercase tracking-wider text-slate-300">
                Follow Us
              </h5>
              <SocialIcons
                idPrefix="footer"
                navClassName="gap-2 sm:gap-3"
                linkSizeClassName="h-11 w-11"
                iconSizeClassName="h-6 w-6"
              />
            </div>
          </div>

          {/* Column 4: Regular Business Hours */}
          <div>
            <h4 className="text-white text-sm font-bold uppercase tracking-wider mb-4 border-l-2 border-orange-500 pl-2">
              Regular Hours
            </h4>
            <div className="bg-slate-900 p-4 rounded-xl border border-slate-800 text-xs space-y-2">
              <div className="flex items-center gap-2 text-slate-300 font-semibold mb-2">
                <Clock className="w-4 h-4 text-orange-400" />
                <span>Academy Schedule</span>
              </div>
              <div className="flex justify-between py-1 border-b border-slate-800">
                <span className="text-slate-400">Monday – Saturday</span>
                <span className="text-white font-medium">8:00 AM – 8:30 PM</span>
              </div>
              <div className="flex justify-between py-1">
                <span className="text-slate-400">Sunday</span>
                <span className="text-rose-400 font-semibold">Closed</span>
              </div>
              <p className="text-[11px] text-slate-500 pt-2 italic">
                *Supplied regular academy hours, subject to holiday schedules.
              </p>
            </div>

          </div>
        </div>

        {/* Bottom Bar */}
        <div className="pt-8 mt-8 border-t border-slate-800 flex flex-col sm:flex-row items-center justify-between text-xs text-slate-500 gap-4">
          <p>© {new Date().getFullYear()} Uptrend’s English Academy. All rights reserved. Davangere, Karnataka.</p>
          <div className="flex items-center gap-6">
            <span>English Language School & Spoken English Training Center</span>
            <span className="text-slate-700">|</span>
            <span className="flex items-center gap-1 text-slate-400">
              Built with excellence for Davangere
            </span>
          </div>
        </div>
      </div>
    </footer>
  );
};
