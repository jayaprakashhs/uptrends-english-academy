
import React from 'react';
import { Program, MediaItem, SiteBranding } from '../types';
import {
  ArrowRight,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  PhoneCall,
  Sparkles,
  CheckCircle2,
  Play,
  Layers,
  MessageCircle,
  Lightbulb,
  Wallet,
  Users,
  MessageSquareQuote,
  Compass,
  BookOpen,
  Clock,
  UsersRound,
  GraduationCap,
} from 'lucide-react';
import { extractYouTubeId, getYouTubeThumbnail } from '../lib/youtube';
import { ApplicationCTA } from '../components/ApplicationCTA';
import { SociableKitGoogleReviews } from '../components/SociableKitGoogleReviews';

// Free Google Business Profile links; replace with the exact listing URL when verified.
const GOOGLE_BUSINESS_URL =
  'https://www.google.com/maps/search/?api=1&query=Uptrend%27s%20English%20Academy%20Davangere';
const GOOGLE_WRITE_REVIEW_URL =
  `${GOOGLE_BUSINESS_URL}${GOOGLE_BUSINESS_URL.includes('?') ? '&' : '?'}action=writeReview`;
const HERO_PHOTO_FALLBACK_URL =
  "https://gpnfznwqwaokfzmozpxo.supabase.co/storage/v1/object/public/Uptrend's%20English%20Academy-photos/hero_photo/Smiling%20Student%20Duo%20with%20Backpacks%20and%20Books(1).png";
const LOCAL_HERO_PHOTO_FALLBACK_URL = '/assets/hero-students-reference.png';

const academyAdvantages = [
  {
    title: 'Level-Based Learning',
    description: 'We have Level 1, Level 2, and Level 3 tests. You learn at your own speed and progress step by step.',
    icon: Layers,
  },
  {
    title: 'Small Batches',
    description: 'Only 10–15 students per batch, so every student gets individual attention.',
    icon: Users,
  },
  {
    title: '100% Speaking Practice',
    description: 'No silent classrooms. You speak, practise, and participate in every class.',
    icon: MessageCircle,
  },
  {
    title: 'Simple Teaching Method',
    description: 'No complex rules. Learn English through simple explanations and everyday examples.',
    icon: Lightbulb,
  },
  {
    title: 'Flexible Timings',
    description: 'Choose from morning, afternoon, and evening batches to suit working people and students.',
    icon: Clock,
  },
  {
    title: 'Affordable Fees',
    description: 'Quality English education at a price every family can afford.',
    icon: Wallet,
  },
] as const;

interface HomeProps {
  programs: Program[];
  mediaItems: MediaItem[];
  dataStatuses: {
    programs: { loading: boolean; error: string | null };
    media: { loading: boolean; error: string | null };
  };
  onRetryData: (resource: 'programs' | 'media') => void;
  setCurrentPage: (page: string) => void;
  setSelectedProgram: (program: Program) => void;
  openCallbackModal: (programName?: string) => void;
  openDemoClassModal: () => void;
  openVideoModal: (url: string, title: string) => void;
  branding?: SiteBranding | null;
}

export const Home: React.FC<HomeProps> = ({
  programs,
  mediaItems,
  dataStatuses,
  onRetryData,
  setCurrentPage,
  setSelectedProgram,
  openCallbackModal,
  openDemoClassModal,
  openVideoModal,
  branding,
}) => {
  const publishedPrograms = programs
    .filter((program) => program.is_published);
  const programCarouselRef = React.useRef<HTMLDivElement | null>(null);
  const [activeProgramIndex, setActiveProgramIndex] = React.useState(0);
  const [heroPhotoSource, setHeroPhotoSource] = React.useState<string | null>(
    branding?.hero_photo_url || HERO_PHOTO_FALLBACK_URL,
  );
  const currentProgramIndex = Math.min(
    activeProgramIndex,
    Math.max(0, publishedPrograms.length - 1),
  );

  React.useEffect(() => {
    setHeroPhotoSource(branding?.hero_photo_url || HERO_PHOTO_FALLBACK_URL);
  }, [branding?.hero_photo_url]);

  const handleHeroPhotoError = () => {
    setHeroPhotoSource((currentSource) => {
      if (currentSource === HERO_PHOTO_FALLBACK_URL) return LOCAL_HERO_PHOTO_FALLBACK_URL;
      if (currentSource === LOCAL_HERO_PHOTO_FALLBACK_URL) return null;
      return HERO_PHOTO_FALLBACK_URL;
    });
  };

  const previewMedia = mediaItems
    .filter((item) => item.is_published)
    .sort((first, second) => first.display_order - second.display_order)
    .slice(0, 3);

  const handleProgramCarouselScroll = (event: React.UIEvent<HTMLDivElement>) => {
    const slides = event.currentTarget.querySelectorAll<HTMLElement>(
      '[data-program-slide]',
    );
    let closestIndex = 0;
    let closestDistance = Number.POSITIVE_INFINITY;

    slides.forEach((slide, index) => {
      const distance = Math.abs(slide.offsetLeft - event.currentTarget.scrollLeft);
      if (distance < closestDistance) {
        closestDistance = distance;
        closestIndex = index;
      }
    });

    setActiveProgramIndex(closestIndex);
  };

  const scrollToProgram = (index: number) => {
    const carousel = programCarouselRef.current;
    const slide = carousel?.querySelectorAll<HTMLElement>('[data-program-slide]')[index];
    if (!carousel || !slide) return;

    setActiveProgramIndex(index);
    carousel.scrollTo({ left: slide.offsetLeft, behavior: 'auto' });
  };

  const renderResourceState = (
    resource: 'programs' | 'media'
  ) => {
    const status = dataStatuses[resource];

    if (status.loading) {
      return (
        <p className="py-6 text-center text-sm text-slate-500" role="status">
          Loading {resource}…
        </p>
      );
    }

    if (!status.error) return null;

    return (
      <div
        className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900"
        role="alert"
      >
        <p>{status.error}</p>
        <button
          type="button"
          onClick={() => onRetryData(resource)}
          className="mt-2 font-semibold underline underline-offset-2"
        >
          Retry loading {resource}
        </button>
      </div>
    );
  };

  const handleProgramClick = (program: Program) => {
    setSelectedProgram(program);
    setCurrentPage('program-details');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const whySectionRef = React.useRef<HTMLElement | null>(null);
  const [whySectionVisible, setWhySectionVisible] = React.useState(false);

  React.useEffect(() => {
    const section = whySectionRef.current;
    if (!section) return;

    if (
      window.matchMedia('(prefers-reduced-motion: reduce)').matches ||
      !('IntersectionObserver' in window)
    ) {
      setWhySectionVisible(true);
      return;
    }

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setWhySectionVisible(true);
          observer.unobserve(entry.target);
        }
      },
      { rootMargin: '0px 0px -64px 0px', threshold: 0.1 },
    );

    observer.observe(section);
    return () => observer.disconnect();
  }, []);

  return (
    <div className="space-y-20 pb-16">
      {/* HERO SECTION */}
      <section className="relative isolate border-b border-orange-100 bg-[#fff8ef] py-6 max-[639px]:py-3 sm:py-8 min-[1100px]:!pt-0 min-[1100px]:!pb-0 min-[1100px]:min-h-[calc(100svh-164px)]">
        <div aria-hidden="true" className="pointer-events-none absolute -left-20 bottom-[-8rem] h-64 w-64 rounded-full border-[2.5rem] border-orange-100/70 sm:h-80 sm:w-80" />
        <div aria-hidden="true" className="pointer-events-none absolute right-[39%] top-12 hidden h-10 w-10 rotate-45 border border-amber-200 sm:block" />
        <div className="relative mx-auto max-w-[1360px] px-4 sm:px-6 lg:px-8">
          <div className="grid min-w-0 grid-cols-1 items-center gap-8 max-[639px]:gap-0 min-[1100px]:h-[calc(100svh-164px)] min-[1100px]:mb-0 min-[1100px]:pb-0 min-[1100px]:grid-cols-[minmax(0,1.16fr)_minmax(0,0.84fr)] min-[1100px]:items-stretch min-[1100px]:gap-4">
            <div className="relative z-10 flex min-w-0 flex-col justify-center gap-4 py-2 max-[639px]:order-2 max-[639px]:gap-2 max-[639px]:py-0 min-[1100px]:py-5">
              <div className="inline-flex items-center gap-2 rounded-full bg-transparent px-0 py-1 text-[11px] font-bold uppercase tracking-[0.16em] text-orange-700 max-[639px]:mx-auto max-[639px]:pt-0 max-[639px]:justify-center max-[639px]:text-center sm:text-xs">
                <Sparkles className="h-4 w-4 text-orange-600" />
                <span>WELCOME TO UPTREND'S ENGLISH ACADEMY</span>
              </div>

              <h1 className="w-full max-w-none text-[clamp(3rem,8vw,3.75rem)] font-bold leading-[0.98] tracking-tight text-slate-950 max-[639px]:text-[clamp(2.25rem,10vw,2.75rem)] max-[639px]:text-center sm:text-[clamp(3.5rem,5.5vw,4.25rem)] min-[1100px]:!text-[clamp(3.375rem,4.75vw,4.25rem)]" style={{ fontFamily: 'Outfit, sans-serif' }}>
                <span className="block">Speak English</span>
                <span className="block min-[640px]:whitespace-nowrap">Fluently and <span className="text-orange-600">Confidently</span></span>
                <span className="block">in Davangere</span>
              </h1>

              <p className="max-w-[38rem] text-base leading-relaxed text-slate-600 max-[639px]:mx-auto max-[639px]:text-center max-[639px]:text-sm max-[639px]:leading-snug sm:text-lg">
                Uptrend's English Academy offers simple, level-based Spoken English,
                Grammar, and Kids English classes. Small batches. More speaking
                practice. Faster results.
              </p>

              <div className="flex flex-col items-stretch gap-3 pt-1 max-[639px]:w-full max-[639px]:items-center max-[639px]:gap-2 max-[639px]:pt-0 min-[640px]:flex-row min-[640px]:flex-wrap min-[640px]:items-center min-[1100px]:flex-nowrap">
                <button
                  type="button"
                  onClick={() => {
                    setCurrentPage('programs');
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                  }}
                  className="inline-flex min-h-12 items-center justify-center gap-2 rounded-lg bg-orange-600 px-5 py-3 text-sm font-bold text-white shadow-md shadow-orange-600/20 transition hover:bg-orange-500 hover:shadow-lg focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-700 motion-reduce:transition-none max-[639px]:w-full max-[639px]:max-w-[22rem] sm:px-6 sm:text-base"
                >
                  Explore Courses
                  <ArrowRight className="h-5 w-5" />
                </button>

                <button
                  type="button"
                  onClick={openDemoClassModal}
                  className="inline-flex min-h-12 items-center justify-center gap-2 rounded-lg border border-orange-400 bg-white px-5 py-3 text-sm font-bold text-orange-700 shadow-sm transition hover:border-orange-500 hover:bg-orange-600 hover:text-white hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-700 motion-reduce:transition-none max-[639px]:w-full max-[639px]:max-w-[22rem] sm:px-6 sm:text-base"
                >
                  <CalendarDays className="h-4 w-4 shrink-0" aria-hidden="true" />
                  <span>Book Your FREE Demo Class</span>
                </button>
              </div>

              <div className="grid grid-cols-1 gap-3 border-t border-orange-200 pt-4 text-[11px] font-medium leading-snug text-slate-600 max-[639px]:grid-cols-2 max-[639px]:justify-items-center max-[639px]:gap-2 max-[639px]:pt-3 max-[639px]:text-center min-[640px]:grid-cols-2 min-[1100px]:grid-cols-2 min-[1100px]:gap-3">
                <div className="flex min-w-0 items-center gap-2 max-[639px]:justify-center">
                  <UsersRound className="h-4 w-4 shrink-0 text-emerald-600" />
                  <span>Trusted by 20,000+ Students in Karnataka</span>
                </div>
                <div className="flex min-w-0 items-center gap-2 max-[639px]:justify-center">
                  <GraduationCap className="h-4 w-4 shrink-0 text-emerald-600" />
                  <span>Beginner to Advanced Levels</span>
                </div>
              </div>
            </div>

            {/* HERO IMAGE: aligned to the navigation edge and hero bottom on desktop */}
            <div className="relative min-h-[320px] min-w-0 w-full overflow-visible max-[639px]:order-1 max-[639px]:h-[clamp(10rem,55vw,14rem)] max-[639px]:min-h-0 min-[1100px]:h-full min-[1100px]:min-h-0">
              <img
                src={heroPhotoSource || undefined}
                alt="Two smiling college students holding books against a warm cream background"
                onError={handleHeroPhotoError}
                className="block h-full w-full bg-transparent object-contain object-bottom max-[639px]:!h-full min-[1100px]:absolute min-[1100px]:bottom-0 min-[1100px]:!left-auto min-[1100px]:right-0 min-[1100px]:!h-[620px] min-[1100px]:!w-auto min-[1100px]:!max-w-none min-[1100px]:origin-bottom-right min-[1100px]:translate-x-[8%] min-[1100px]:object-right-bottom min-[1280px]:!h-[500px] min-[1280px]:!translate-x-[12%] min-[1440px]:!h-[600px] min-[1440px]:!translate-x-[16%] min-[1600px]:!h-[650px] min-[1600px]:!translate-x-[20%]"
              />
            </div>
          </div>
        </div>
      </section>

      {/* FEATURED PROGRAMS */}
      <section className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="mb-10 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <div>
            <div className="mb-2 inline-flex items-center gap-1.5 text-xs font-bold uppercase tracking-wider text-orange-600">
              <Compass className="h-4 w-4" />
              <span>Academy Offerings</span>
            </div>
            <h2 id="featured-programs-heading" className="text-3xl font-extrabold tracking-tight text-slate-950">
              Featured English Programs
            </h2>
            <p className="mt-1 max-w-xl text-sm text-slate-600">
              Structured courses designed to enhance everyday vocabulary,
              correct pronunciation, grammatical accuracy, and professional
              speaking.
            </p>
          </div>

          <button
            type="button"
            onClick={() => {
              setCurrentPage('programs');
              window.scrollTo({ top: 0, behavior: 'smooth' });
            }}
            className="inline-flex cursor-pointer items-center gap-1.5 text-sm font-bold text-orange-600 hover:text-orange-700"
          >
            View All Programs
            <ArrowRight className="h-4 w-4" />
          </button>
        </div>

        {renderResourceState('programs') ||
          (publishedPrograms.length === 0 ? (
            <p className="py-6 text-center text-sm text-slate-500">
              No published programs are currently available.
            </p>
          ) : (
            <div
              role="region"
              aria-labelledby="featured-programs-heading"
              aria-roledescription="carousel"
            >
              <div className="mb-3 flex items-center justify-between sm:hidden">
                <button
                  type="button"
                  aria-label="Previous programs"
                  onClick={() => scrollToProgram(Math.max(0, currentProgramIndex - 1))}
                  disabled={currentProgramIndex === 0}
                  className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-slate-900 text-white shadow-sm transition-colors hover:bg-orange-600 hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-500 disabled:opacity-40 motion-reduce:transition-none"
                >
                  <ChevronLeft className="h-5 w-5" aria-hidden="true" />
                </button>
                <span
                  className="text-xs font-semibold tabular-nums text-slate-600"
                  aria-live="polite"
                  aria-atomic="true"
                >
                  {currentProgramIndex + 1} / {publishedPrograms.length}
                </span>
                <button
                  type="button"
                  aria-label="Next programs"
                  onClick={() =>
                    scrollToProgram(
                      Math.min(publishedPrograms.length - 1, currentProgramIndex + 1),
                    )
                  }
                  disabled={currentProgramIndex >= publishedPrograms.length - 1}
                  className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-slate-900 text-white shadow-sm transition-colors hover:bg-orange-600 hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-500 disabled:opacity-40 motion-reduce:transition-none"
                >
                  <ChevronRight className="h-5 w-5" aria-hidden="true" />
                </button>
              </div>

              <div
                ref={programCarouselRef}
                onScroll={handleProgramCarouselScroll}
                className="relative flex snap-x snap-mandatory gap-4 overflow-x-auto overscroll-x-contain scroll-smooth pb-1 motion-reduce:scroll-auto sm:grid sm:grid-cols-2 sm:gap-6 sm:overflow-visible sm:pb-0 lg:grid-cols-4"
              >
                {publishedPrograms.map((program, index) => (
                  <article
                    key={program.id}
                    data-program-slide
                    aria-roledescription="slide"
                    aria-label={`${index + 1} of ${publishedPrograms.length}: ${program.title}`}
                    className={`group flex min-w-0 flex-[0_0_100%] shrink-0 snap-start flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-md transition-all duration-300 hover:shadow-lg sm:flex-auto ${
                      index >= 4 ? 'sm:hidden' : ''
                    }`}
                  >
                    <div className="relative aspect-[16/10] overflow-hidden bg-slate-100">
                      <img
                        src={
                          program.image_url ||
                          'https://images.unsplash.com/photo-1543269865-cbf427effbad?auto=format&fit=crop&w=800&q=80'
                        }
                        alt={program.title}
                        className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                      />
                      {program.level && (
                        <div className="absolute left-3 top-3 rounded-md bg-slate-950/80 px-2.5 py-1 text-[11px] font-semibold text-white backdrop-blur-sm">
                          {program.level}
                        </div>
                      )}
                    </div>

                    <div className="flex flex-1 flex-col p-5">
                      <h3 className="mb-2 text-lg font-bold leading-snug text-slate-900 transition-colors group-hover:text-orange-600">
                        {program.title}
                      </h3>
                      <p className="mb-4 line-clamp-2 text-xs leading-relaxed text-slate-600">
                        {program.short_description}
                      </p>

                      <div className="mt-auto space-y-2 border-t border-slate-100 pt-3 text-xs text-slate-600">
                        <div className="flex min-w-0 items-center gap-2">
                          <Users className="h-3.5 w-3.5 shrink-0 text-orange-500" />
                          <span className="min-w-0 truncate">
                            <strong>Audience:</strong> {program.target_audience}
                          </span>
                        </div>

                        {program.duration && (
                          <div className="flex items-center gap-2">
                            <Clock className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
                            <span>
                              <strong>Duration:</strong> {program.duration}
                            </span>
                          </div>
                        )}
                      </div>

                      <div className="mt-4 flex flex-col gap-2 border-t border-slate-100 pt-4">
                        <button
                          type="button"
                          onClick={() => handleProgramClick(program)}
                          className="flex min-h-12 w-full min-w-0 items-center justify-center rounded-xl bg-slate-900 px-4 py-3 text-center text-sm font-bold leading-snug text-white shadow-sm transition-colors transition-shadow duration-200 hover:bg-orange-600 hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-500 motion-reduce:transition-none"
                        >
                          View Program
                        </button>
                        <button
                          type="button"
                          onClick={openDemoClassModal}
                          className="flex min-h-12 w-full min-w-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-xl border border-orange-500 bg-white px-3 py-3 text-center text-xs font-bold leading-tight text-orange-600 transition-colors transition-shadow duration-200 hover:bg-orange-600 hover:text-white hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-orange-500 motion-reduce:transition-none"
                        >
                          <CalendarDays className="h-4 w-4 shrink-0" aria-hidden="true" />
                          <span className="whitespace-nowrap">Book Your Free Demo Class</span>
                        </button>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            </div>
          ))}
      </section>

      {/* WHY CHOOSE US */}
      <section
        ref={whySectionRef}
        className={`why-benefits-section border-y border-orange-100 bg-[#fbfaf7] py-4 transition-[opacity,transform] duration-700 ease-out motion-reduce:translate-y-0 motion-reduce:opacity-100 motion-reduce:transition-none sm:py-6 lg:py-8 ${
          whySectionVisible ? 'translate-y-0 opacity-100' : 'translate-y-5 opacity-0'
        }`}
      >
        <div className="mx-auto max-w-7xl px-3 sm:px-6 lg:px-8">
          <div className="why-benefits-header mx-auto mb-4 max-w-3xl text-center sm:mb-5">
            <span className="inline-flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.16em] text-orange-700 sm:text-xs sm:tracking-[0.18em]">
              <span className="h-px w-7 bg-emerald-600" aria-hidden="true" />
              The Uptrend’s Advantage
              <span className="h-px w-7 bg-emerald-600" aria-hidden="true" />
            </span>
            <h2 className="mt-1.5 text-xl font-extrabold leading-tight tracking-tight text-slate-950 sm:mt-2 sm:text-2xl lg:text-3xl">
              Why Learn English with Us?
            </h2>
            <p className="mx-auto mt-1.5 max-w-2xl text-xs leading-4 text-slate-600 sm:mt-2 sm:text-sm sm:leading-snug">
              Our training methodology focuses on practical speaking habituation rather than rote memorization.
            </p>
          </div>

          <div className="why-benefits-grid grid min-w-0 auto-rows-fr grid-cols-2 gap-2 sm:grid-cols-3 sm:gap-3 lg:gap-4">
            {academyAdvantages.map(({ title, description, icon: Icon }, index) => {
              const isOrange = index % 2 === 0;
              return (
                <article
                  key={title}
                  className={`why-benefits-card group flex min-w-0 flex-col items-center rounded-xl border bg-white p-2.5 text-center shadow-sm transition-shadow duration-200 hover:shadow-md sm:p-3 lg:p-4 ${
                    isOrange
                      ? 'border-orange-200/80 hover:border-orange-300'
                      : 'border-emerald-200/80 hover:border-emerald-300'
                  }`}
                >
                  <span
                    className={`why-benefits-icon mb-2 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-colors sm:h-9 sm:w-9 ${
                      isOrange
                        ? 'bg-orange-50 text-orange-700 group-hover:bg-orange-100'
                        : 'bg-emerald-50 text-emerald-700 group-hover:bg-emerald-100'
                    }`}
                  >
                    <Icon className="h-4 w-4 sm:h-5 sm:w-5" aria-hidden="true" />
                  </span>
                  <h3 className="why-benefits-title text-[clamp(0.75rem,2.4vw,0.95rem)] font-bold leading-tight text-slate-950 sm:text-base lg:text-lg">
                    {title}
                  </h3>
                  <p className="why-benefits-description mt-1.5 text-[11px] leading-[1.35] text-slate-600 sm:mt-2 sm:text-xs sm:leading-snug lg:text-sm">
                    {description}
                  </p>
                </article>
              );
            })}
          </div>
        </div>
      </section>

      {/* ABOUT PREVIEW */}
      <section className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="relative overflow-hidden rounded-3xl bg-gradient-to-br from-emerald-900 to-slate-900 p-8 text-white shadow-xl sm:p-12">
          <div className="relative z-10 max-w-2xl space-y-4">
            <span className="text-xs font-bold uppercase tracking-wider text-emerald-400">
              About Uptrend’s English Academy
            </span>
            <h2 className="text-2xl font-extrabold tracking-tight sm:text-3xl">
              25+ Years of Building English-Speaking Confidence
            </h2>
            <p className="text-sm leading-relaxed text-emerald-100/90">
              Founded in Davangere, Karnataka, Uptrend’s English Academy has
              guided learners across generations. Our mission is to ensure
              every student, professional, and homemaker can express thoughts
              clearly and confidently in English.
            </p>
            <button
              type="button"
              onClick={() => {
                setCurrentPage('about');
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }}
              className="inline-flex cursor-pointer items-center gap-2 rounded-xl bg-white px-5 py-3 text-xs font-bold text-slate-900 transition-colors hover:bg-emerald-50"
            >
              Read Full About Us &amp; Philosophy
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </section>

      {/* GOOGLE REVIEWS WIDGET */}
      <section className="relative mx-auto w-full max-w-[1600px] px-4 py-2 sm:px-8 lg:px-20">
        <div className="mx-auto max-w-7xl">
          <div className="mb-8 text-center">
            <div className="mb-2 inline-flex items-center justify-center gap-1.5 text-xs font-bold uppercase tracking-wider text-emerald-600">
              <MessageSquareQuote className="h-4 w-4" />
              <span>Google Reviews</span>
            </div>
            <h2 className="text-2xl font-extrabold text-slate-950 sm:text-3xl">
              What Our Customers Say on Google
            </h2>
            <p className="mt-2 text-sm text-slate-600">
              Read reviews shared on our Google Business Profile.
            </p>
          </div>

          <div className="min-w-0 rounded-2xl border border-slate-200 bg-white p-3 shadow-sm sm:p-5">
            <SociableKitGoogleReviews />
          </div>

        </div>
      </section>

      {/* GOOGLE REVIEWS LINKS */}
      <section className="mx-auto w-full max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="overflow-hidden rounded-3xl border border-slate-200 bg-gradient-to-br from-orange-50 via-white to-emerald-50 p-7 text-center shadow-sm sm:p-10">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-white text-amber-500 shadow-sm ring-1 ring-slate-200">
            <span className="text-2xl font-black" aria-hidden="true">★</span>
          </div>
          <p className="text-xs font-bold uppercase tracking-[0.18em] text-emerald-700">
            Find Us on Google
          </p>
          <h2 className="mt-2 text-2xl font-extrabold tracking-tight text-slate-950 sm:text-3xl">
            Your Feedback Matters
          </h2>
          <p className="mx-auto mt-3 max-w-2xl text-sm leading-relaxed text-slate-600 sm:text-base">
            See what learners are saying about Uptrend’s English Academy, or
            share your own experience on Google.
          </p>

          <div className="mt-6 flex flex-col justify-center gap-3 sm:flex-row">
            <a
              href={GOOGLE_BUSINESS_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-orange-600 px-6 py-3 text-sm font-bold text-white shadow-lg shadow-orange-600/20 transition hover:bg-orange-500 focus:outline-none focus:ring-2 focus:ring-orange-500 focus:ring-offset-2"
            >
              Read Google Reviews
              <ArrowRight className="h-4 w-4" />
            </a>
            <a
              href={GOOGLE_WRITE_REVIEW_URL}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex min-h-12 items-center justify-center rounded-xl border border-slate-300 bg-white px-6 py-3 text-sm font-bold text-slate-800 transition hover:border-emerald-500 hover:bg-emerald-50 focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-2"
            >
              Write a Google Review
            </a>
          </div>

          <p className="mt-4 text-xs text-slate-500">
            Opens Google in a new tab. Sign in to Google to post a review.
          </p>
        </div>
      </section>

      {/* MEDIA GALLERY PREVIEW */}
      {(previewMedia.length > 0 ||
        dataStatuses.media.loading ||
        dataStatuses.media.error) && (
        <section className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          <div className="mb-8 flex items-center justify-between gap-4">
            <div>
              <span className="text-xs font-bold uppercase tracking-wider text-orange-600">
                Academy Highlights
              </span>
              <h2 className="mt-1 text-2xl font-extrabold text-slate-950 sm:text-3xl">
                Media &amp; Testimonials
              </h2>
            </div>
            <button
              type="button"
              onClick={() => {
                setCurrentPage('media');
                window.scrollTo({ top: 0, behavior: 'smooth' });
              }}
              className="flex cursor-pointer items-center gap-1 text-xs font-bold text-orange-600 hover:text-orange-700"
            >
              Explore Gallery
              <ArrowRight className="h-3.5 w-3.5" />
            </button>
          </div>

          {renderResourceState('media') ||
            (previewMedia.length === 0 ? (
              <p className="py-6 text-center text-sm text-slate-500">
                No published media is currently available.
              </p>
            ) : (
              <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
                {previewMedia.map((item) => {
                  const isVideo = item.media_type === 'video';
                  const youtubeId = isVideo
                    ? extractYouTubeId(
                        item.youtube_url || item.youtube_video_id
                      )
                    : null;
                  const coverSrc =
                    item.cover_image_url || getYouTubeThumbnail(youtubeId);

                  return (
                    <button
                      key={item.id}
                      type="button"
                      aria-label={`Open ${item.title}`}
                      className="group relative aspect-[16/10] cursor-pointer overflow-hidden rounded-2xl border border-slate-200 bg-slate-900 text-left shadow-md"
                      onClick={() => {
                        if (isVideo && item.youtube_url) {
                          openVideoModal(item.youtube_url, item.title);
                        } else {
                          setCurrentPage('media');
                          window.scrollTo({ top: 0, behavior: 'smooth' });
                        }
                      }}
                    >
                      <img
                        src={coverSrc}
                        alt={item.alt_text || item.title}
                        className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                      />
                      <div className="absolute inset-0 flex flex-col justify-end bg-gradient-to-t from-slate-950/80 via-transparent to-transparent p-4 text-white">
                        <p className="truncate text-xs font-bold">
                          {item.title}
                        </p>
                        {item.caption && (
                          <p className="mt-0.5 truncate text-[11px] text-slate-300">
                            {item.caption}
                          </p>
                        )}
                      </div>

                      {isVideo && (
                        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
                          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-orange-600/90 text-white shadow-lg transition-all group-hover:scale-110 group-hover:bg-orange-500">
                            <Play className="ml-0.5 h-5 w-5 fill-current" />
                          </div>
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            ))}
        </section>
      )}

      <ApplicationCTA
        openDemoClassModal={openDemoClassModal}
        openCallbackModal={openCallbackModal}
      />
    </div>
  );
};
