import React, { useEffect, useState } from 'react';
import type { TeamMember } from '../types';
import { Target, Compass, Heart, Play, Clock, MapPin, Phone, Mail, Award, CheckCircle } from 'lucide-react';
import { getYouTubeThumbnail, extractYouTubeId } from '../lib/youtube';
import { supabase } from '../lib/supabase';

interface AboutUsProps {
  openVideoModal: (url: string, title: string) => void;
  openCallbackModal: () => void;
  setCurrentPage: (page: string) => void;
}

const DEFAULT_VIDEO_URL = 'https://www.youtube.com/watch?v=ScMzIvxBSi4';
const publicAboutUsAssetUrl = (objectKey: string) =>
  `/api/about-us/assets?key=${encodeURIComponent(objectKey)}`;

export const AboutUs: React.FC<AboutUsProps> = ({
  openVideoModal,
  openCallbackModal,
  setCurrentPage,
}) => {
  const [publishedTeam, setPublishedTeam] = useState<TeamMember[]>([]);
  const [instructorsLoading, setInstructorsLoading] = useState(true);
  const [instructorError, setInstructorError] = useState<string | null>(null);
  const [instructorAssetWarning, setInstructorAssetWarning] = useState<string | null>(null);
  const [videoLoading, setVideoLoading] = useState(true);
  const [videoError, setVideoError] = useState<string | null>(null);
  const [teamTalkUrl, setTeamTalkUrl] = useState(DEFAULT_VIDEO_URL);
  const [videoPosterUrl, setVideoPosterUrl] = useState<string | null>(null);
  const teamTalkVideoId = extractYouTubeId(teamTalkUrl);
  const teamTalkThumb = videoPosterUrl
    || getYouTubeThumbnail(teamTalkVideoId, 'maxresdefault');

  useEffect(() => {
    let active = true;
    const loadAboutContent = async () => {
      const client = supabase;
      if (!client) {
        setInstructorError('Instructor profiles could not be loaded.');
        setVideoError('The video configuration could not be loaded; the default introduction is shown.');
        setInstructorsLoading(false);
        setVideoLoading(false);
        return;
      }

      const [instructorResult, videoResult] = await Promise.all([
        client
          .from('team_members')
          .select('id, full_name, designation, qualifications, bio, photo_object_key, is_published, display_order')
          .eq('is_published', true)
          .order('display_order', { ascending: true })
          .order('created_at', { ascending: true }),
        client
          .from('about_us_video_configurations')
          .select('youtube_url, poster_object_key')
          .eq('id', true)
          .eq('is_published', true)
          .maybeSingle(),
      ]);

      if (!active) return;
      if (instructorResult.error) {
        setInstructorError('Instructor profiles could not be loaded.');
      } else {
        const instructors = (instructorResult.data || []) as Array<TeamMember & { photo_object_key?: string | null }>;
        setPublishedTeam(instructors.map((instructor) => ({
          ...instructor,
          photo_url: instructor.photo_object_key
            ? publicAboutUsAssetUrl(instructor.photo_object_key)
            : null,
        })));
        setInstructorError(null);
        setInstructorAssetWarning(null);
      }
      if (videoResult.error) {
        setVideoError('The video configuration could not be loaded; the default introduction is shown.');
      } else if (videoResult.data) {
        if (!extractYouTubeId(videoResult.data.youtube_url)) {
          setVideoError('The saved video URL is invalid; the default introduction is shown.');
        } else {
          setTeamTalkUrl(videoResult.data.youtube_url);
          setVideoPosterUrl(videoResult.data.poster_object_key
            ? publicAboutUsAssetUrl(videoResult.data.poster_object_key)
            : null);
          setVideoError(null);
        }
      } else {
        setVideoError(null);
      }
      setInstructorsLoading(false);
      setVideoLoading(false);
    };

    void loadAboutContent().catch((error: unknown) => {
      if (!active) return;
      console.error('Unable to load public About Us content.', error);
      setInstructorError('Instructor profiles could not be loaded.');
      setVideoError('The video configuration could not be loaded; the default introduction is shown.');
      setInstructorsLoading(false);
      setVideoLoading(false);
    });

    return () => {
      active = false;
    };
  }, []);

  return (
    <div className="space-y-16 py-12">
      {/* 1. Header Banner & About the Academy */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center max-w-3xl mx-auto space-y-4">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-orange-100 text-orange-800 text-xs font-bold uppercase tracking-wider">
            <span>About Uptrend’s English Academy</span>
          </div>
          <h1 className="text-3xl sm:text-4xl lg:text-5xl font-extrabold text-slate-950 tracking-tight">
            Building English Communication in Davangere
          </h1>
          <p className="text-base sm:text-lg text-slate-600 leading-relaxed">
            Uptrend’s English Academy was established to help people in Davangere overcome linguistic hesitation, build natural conversational fluency, and speak English with confidence and poise.
          </p>
        </div>
      </section>

      {/* 2. Meet Our Team (Admin managed, no invented staff) */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center max-w-2xl mx-auto mb-10">
          <span className="text-xs font-bold uppercase tracking-wider text-emerald-600">
            Academic Mentors
          </span>
          <h2 className="text-2xl sm:text-3xl font-extrabold text-slate-950 mt-1">
            Meet Our Instructors
          </h2>
          <p className="text-xs text-slate-600 mt-1">
            Experienced mentors dedicated to student progress and spoken English excellence.
          </p>
        </div>

        {instructorsLoading ? (
          <p role="status" className="text-center text-sm text-slate-500">Loading instructor profiles…</p>
        ) : instructorError ? (
          <p role="status" className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-center text-sm text-amber-800">{instructorError}</p>
        ) : publishedTeam.length > 0 ? (
          <>
            {instructorAssetWarning && (
              <p role="status" className="mb-4 text-center text-xs text-amber-700">{instructorAssetWarning}</p>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
              {publishedTeam.map((member) => (
                <div key={member.id} className="bg-white rounded-2xl border border-slate-200 p-6 text-center shadow-xs">
                  {member.photo_url ? (
                    <img
                      src={member.photo_url}
                      alt={member.full_name}
                      className="w-24 h-24 rounded-full mx-auto object-cover mb-4 border-2 border-orange-500"
                    />
                  ) : (
                    <div className="w-24 h-24 rounded-full bg-orange-100 text-orange-600 font-bold text-2xl flex items-center justify-center mx-auto mb-4 border-2 border-orange-300">
                      {member.full_name.charAt(0)}
                    </div>
                  )}
                  <h3 className="font-bold text-slate-900 text-lg">{member.full_name}</h3>
                  <p className="text-xs text-orange-600 font-semibold mb-3">{member.designation}</p>
                  {member.qualifications && (
                    <p className="text-xs text-slate-500 mb-2">{member.qualifications}</p>
                  )}
                  <p className="text-xs text-slate-600 leading-relaxed">{member.bio}</p>
                </div>
              ))}
            </div>
          </>
        ) : (
          <div className="bg-slate-50 border border-slate-200 rounded-2xl p-8 text-center max-w-xl mx-auto">
            <p className="text-sm font-semibold text-slate-700">
              Instructor profiles are managed through the secure academy portal.
            </p>
            <p className="text-xs text-slate-500 mt-1">
              Visit our center at Ram And Co Circle to meet our faculty in person.
            </p>
          </div>
        )}
      </section>

      {/* 3. Our Philosophy (Vision, Mission, Values) */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center max-w-2xl mx-auto mb-10">
          <span className="text-xs font-bold uppercase tracking-wider text-emerald-600">
            Educational Foundation
          </span>
          <h2 className="text-2xl sm:text-3xl font-extrabold text-slate-950 mt-1">
            Our Core Philosophy
          </h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
          {/* Vision */}
          <div className="bg-white p-8 rounded-2xl border border-slate-200/80 shadow-xs hover:shadow-lg transition-all flex flex-col justify-between border-t-4 border-t-orange-500">
            <div>
              <div className="w-12 h-12 rounded-xl bg-orange-100 text-orange-600 flex items-center justify-center mb-5">
                <Target className="w-6 h-6" />
              </div>
              <h3 className="text-xl font-bold text-slate-900 mb-3">Our Vision</h3>
              <p className="text-sm text-slate-600 leading-relaxed">
                To empower every learner in Davangere and surrounding regions with natural, articulate English communication skills, unlocking global opportunities and lifelong personal confidence.
              </p>
            </div>
            <div className="pt-6 mt-6 border-t border-slate-100 flex items-center gap-2 text-xs font-semibold text-orange-600">
              <CheckCircle className="w-4 h-4" />
              <span>Empowering Every Learner</span>
            </div>
          </div>

          {/* Mission */}
          <div className="bg-white p-8 rounded-2xl border border-slate-200/80 shadow-xs hover:shadow-lg transition-all flex flex-col justify-between border-t-4 border-t-emerald-500">
            <div>
              <div className="w-12 h-12 rounded-xl bg-emerald-100 text-emerald-600 flex items-center justify-center mb-5">
                <Compass className="w-6 h-6" />
              </div>
              <h3 className="text-xl font-bold text-slate-900 mb-3">Our Mission</h3>
              <p className="text-sm text-slate-600 leading-relaxed">
                To provide high-quality, practical spoken English and grammar training through interactive classroom sessions, supportive mentorship, and real-world conversation practice.
              </p>
            </div>
            <div className="pt-6 mt-6 border-t border-slate-100 flex items-center gap-2 text-xs font-semibold text-emerald-600">
              <CheckCircle className="w-4 h-4" />
              <span>Interactive & Practical Pedagogy</span>
            </div>
          </div>

          {/* Values */}
          <div className="bg-white p-8 rounded-2xl border border-slate-200/80 shadow-xs hover:shadow-lg transition-all flex flex-col justify-between border-t-4 border-t-amber-500">
            <div>
              <div className="w-12 h-12 rounded-xl bg-amber-100 text-amber-600 flex items-center justify-center mb-5">
                <Heart className="w-6 h-6" />
              </div>
              <h3 className="text-xl font-bold text-slate-900 mb-3">Our Values</h3>
              <p className="text-sm text-slate-600 leading-relaxed">
                Integrity, student-centric mentorship, continuous speaking practice, mutual respect, encouragement, and practical applicability in career and social settings.
              </p>
            </div>
            <div className="pt-6 mt-6 border-t border-slate-100 flex items-center gap-2 text-xs font-semibold text-amber-600">
              <CheckCircle className="w-4 h-4" />
              <span>Integrity & Encouragement</span>
            </div>
          </div>
        </div>
      </section>

      {/* 4. Our Journey (25+ years of dedicated training) */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="bg-slate-900 text-white rounded-3xl p-8 sm:p-12 border border-slate-800 shadow-xl">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-center">
            <div className="lg:col-span-8 space-y-4">
              <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-md bg-orange-600/20 text-orange-300 text-xs font-bold uppercase tracking-wider">
                <Award className="w-4 h-4 text-orange-400" />
                <span>Our Heritage in Davangere</span>
              </div>
              <h2 className="text-2xl sm:text-3xl font-extrabold tracking-tight">
                25+ Years of Building English-Speaking Confidence
              </h2>
              <p className="text-sm text-slate-300 leading-relaxed">
                With 25+ years of dedicated English language training in Davangere, Karnataka, Uptrend’s English Academy has continually evolved its methods to help learners break through language barriers.
              </p>
              <p className="text-sm text-slate-400 leading-relaxed">
                Located conveniently at Ram And Co Circle, Devi Building, we take pride in offering focused spoken training that respects the individual learning pace of students, graduates, working professionals, and homemakers alike.
              </p>
            </div>

            <div className="lg:col-span-4 flex flex-col items-center justify-center p-6 bg-slate-800/80 rounded-2xl border border-slate-700/60 text-center">
              <span className="text-5xl font-black text-transparent bg-clip-text bg-gradient-to-r from-orange-400 to-amber-300">
                25+
              </span>
              <span className="text-sm font-bold text-white mt-1 uppercase tracking-wider">
                Years of Training
              </span>
              <p className="text-xs text-slate-400 mt-2">
                Continual commitment to English communication excellence in Davangere.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* 5. Academy In Action video introduction */}
      <section className="mx-auto flex h-[calc(100svh-6rem)] w-full max-w-7xl flex-col px-4 py-2 sm:px-6 lg:h-[calc(100svh-8rem)] lg:px-8 lg:py-2">
        <div className="shrink-0 text-center">
          <span className="text-xs font-bold uppercase tracking-wider text-orange-600">
            Academy In Action
          </span>
          <h2 className="text-2xl sm:text-3xl font-extrabold text-slate-950 mt-1">
            Video Introductions
          </h2>
          <p className="text-xs text-slate-600 mt-1">
            Explore our training approach, spoken practice modules, and teaching philosophy.
          </p>
          {videoLoading && (
            <p role="status" className="mt-2 text-xs text-slate-500">Loading saved video configuration…</p>
          )}
          {videoError && (
            <p role="status" className="mt-2 text-xs text-amber-700">{videoError}</p>
          )}
        </div>

        <div className="mt-6 flex min-h-0 flex-1 items-center justify-center">
          <div
            className="relative aspect-video max-w-full overflow-hidden rounded-2xl border border-slate-200/80 bg-[#fff8ef] shadow-md"
            style={{ width: 'min(100%, calc((100svh - 10rem) * 16 / 9))' }}
          >
            <button
              type="button"
              className="group absolute inset-0 flex h-full w-full cursor-pointer items-center justify-center"
              onClick={() => openVideoModal(teamTalkUrl, 'Academy Introduction — Our Team Talk')}
              aria-label="Play Academy Introduction video"
            >
              <img
                src={teamTalkThumb}
                alt="Our Team Talk Video Cover"
                className="absolute inset-0 h-full w-full object-contain"
                onError={() => {
                  if (videoPosterUrl) setVideoPosterUrl(null);
                }}
              />
              <div className="absolute inset-0 bg-black/40 transition-colors group-hover:bg-black/25 flex items-center justify-center">
                <div className="w-16 h-16 rounded-full bg-orange-600 text-white flex items-center justify-center shadow-xl transition-transform group-hover:scale-110">
                  <Play className="w-6 h-6 fill-current ml-1" />
                </div>
              </div>
              <div className="absolute bottom-3 left-3 bg-black/70 px-2.5 py-1 rounded text-white text-xs font-semibold">
                Introduction Video
              </div>
            </button>
          </div>
        </div>
      </section>

      {/* 6. Contact Details & Business Hours */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="bg-white rounded-3xl border border-slate-200/80 p-8 sm:p-10 shadow-lg">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8 items-center">
            <div className="space-y-4">
              <span className="text-xs font-bold uppercase tracking-wider text-orange-600">
                Direct Contact
              </span>
              <h2 className="text-2xl sm:text-3xl font-extrabold text-slate-950">
                Visit or Call the Academy
              </h2>
              <div className="space-y-3 pt-2 text-sm text-slate-700">
                <div className="flex items-start gap-3">
                  <MapPin className="w-5 h-5 text-orange-600 shrink-0 mt-0.5" />
                  <span>
                    #259/1A1, Devi Building, 2nd Floor, Ram And Co Circle, opposite Ganesha Temple, above Sangeetha Mobiles, Prince Jayachamaraja Wodeyar, Davangere, Karnataka 577002, India
                  </span>
                </div>
                <div className="flex items-center gap-3">
                  <Phone className="w-5 h-5 text-emerald-600 shrink-0" />
                  <a href="tel:+919008000211" className="font-bold hover:text-orange-600">
                    +91 900 8000 211
                  </a>
                </div>
                <div className="flex items-center gap-3">
                  <Mail className="w-5 h-5 text-orange-600 shrink-0" />
                  <a href="mailto:uptrendsinstitute@gmail.com" className="hover:text-orange-600">
                    uptrendsinstitute@gmail.com
                  </a>
                </div>
              </div>
            </div>

            <div className="bg-slate-50 p-6 rounded-2xl border border-slate-200 space-y-4">
              <div className="flex items-center gap-2 text-slate-900 font-bold text-sm">
                <Clock className="w-5 h-5 text-orange-600" />
                <span>Regular Business Hours</span>
              </div>
              <div className="space-y-1.5 text-xs">
                <div className="flex justify-between py-1 border-b border-slate-200">
                  <span className="text-slate-600">Monday – Saturday</span>
                  <span className="font-semibold text-slate-900">8:00 AM – 8:30 PM</span>
                </div>
                <div className="flex justify-between py-1">
                  <span className="text-slate-600">Sunday</span>
                  <span className="font-semibold text-rose-600">Closed</span>
                </div>
              </div>
              <div className="pt-2 flex gap-3">
                <button
                  onClick={openCallbackModal}
                  className="w-full py-2.5 rounded-lg bg-orange-600 text-white font-bold text-xs hover:bg-orange-500 transition-colors cursor-pointer"
                >
                  Request a Call
                </button>
                <button
                  onClick={() => {
                    setCurrentPage('contact');
                    window.scrollTo({ top: 0, behavior: 'smooth' });
                  }}
                  className="w-full py-2.5 rounded-lg border border-slate-300 text-slate-700 font-bold text-xs hover:bg-slate-100 transition-colors cursor-pointer"
                >
                  View Map & Directions
                </button>
              </div>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
};
