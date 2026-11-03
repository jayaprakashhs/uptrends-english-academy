import React, { useState } from 'react';
import { Program } from '../types';
import { Users, Clock, Compass, PhoneCall, CalendarDays, Search, CheckCircle } from 'lucide-react';

interface ProgramsProps {
  programs: Program[];
  setSelectedProgram: (program: Program) => void;
  setCurrentPage: (page: string) => void;
  openCallbackModal: (programName?: string) => void;
  openDemoClassModal: () => void;
}

export const Programs: React.FC<ProgramsProps> = ({
  programs,
  setSelectedProgram,
  setCurrentPage,
  openCallbackModal,
  openDemoClassModal,
}) => {
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedLevel, setSelectedLevel] = useState<string>('all');

  const levels = ['all', 'Foundation', 'Intermediate', 'Advanced', 'Beginner'];

  const filteredPrograms = programs.filter((p) => {
    const matchesSearch =
      p.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.short_description.toLowerCase().includes(searchQuery.toLowerCase()) ||
      p.target_audience.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesLevel =
      selectedLevel === 'all' ||
      (p.level && p.level.toLowerCase().includes(selectedLevel.toLowerCase()));

    return matchesSearch && matchesLevel;
  });

  const handleViewDetails = (prog: Program) => {
    setSelectedProgram(prog);
    setCurrentPage('program-details');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  return (
    <div className="space-y-12 py-12">
      {/* Header */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="text-center max-w-3xl mx-auto space-y-4">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-orange-100 text-orange-800 text-xs font-bold uppercase tracking-wider">
            <Compass className="w-4 h-4 text-orange-600" />
            <span>Course Catalogue</span>
          </div>
          <h1 className="text-3xl sm:text-4xl lg:text-5xl font-extrabold text-slate-950 tracking-tight">
            English Communication Programs
          </h1>
          <p className="text-base text-slate-600 leading-relaxed">
            Focused training modules designed to meet the spoken English needs of students, graduates, job seekers, working professionals, and homemakers.
          </p>
        </div>

        {/* Search & Filter Bar */}
        <div className="mt-10 p-4 bg-white rounded-2xl border border-slate-200 shadow-xs flex flex-col md:flex-row gap-4 items-center justify-between">
          <div className="relative w-full md:max-w-md">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
            <input
              type="text"
              placeholder="Search programs by name or audience..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 text-sm rounded-xl border border-slate-200 focus:outline-hidden focus:ring-2 focus:ring-orange-500"
            />
          </div>

          <div className="flex items-center gap-1.5 overflow-x-auto w-full md:w-auto pb-1 md:pb-0">
            <span className="text-xs font-bold text-slate-500 uppercase mr-1 shrink-0">Level:</span>
            {levels.map((lvl) => (
              <button
                key={lvl}
                onClick={() => setSelectedLevel(lvl)}
                className={`px-3 py-1.5 rounded-lg text-xs font-semibold capitalize transition-all cursor-pointer ${
                  selectedLevel === lvl
                    ? 'bg-orange-600 text-white font-bold shadow-xs'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                }`}
              >
                {lvl}
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* Program Cards Grid */}
      <section className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {filteredPrograms.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
            {filteredPrograms.map((prog) => (
              <div
                key={prog.id}
                className="bg-white rounded-2xl border border-slate-200 shadow-xs hover:shadow-xl transition-all duration-300 flex flex-col overflow-hidden group"
              >
                <div className="relative aspect-16/10 overflow-hidden bg-slate-100">
                  <img
                    src={
                      prog.image_url ||
                      'https://images.unsplash.com/photo-1543269865-cbf427effbad?auto=format&fit=crop&w=800&q=80'
                    }
                    alt={prog.title}
                    className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                  />
                  {prog.level && (
                    <div className="absolute top-3 left-3 px-3 py-1 rounded-md bg-slate-950/85 backdrop-blur-xs text-white text-xs font-semibold shadow-xs">
                      {prog.level}
                    </div>
                  )}
                </div>

                <div className="p-6 flex-1 flex flex-col">
                  <h3 className="font-bold text-slate-950 text-xl leading-tight mb-2 group-hover:text-orange-600 transition-colors">
                    {prog.title}
                  </h3>
                  <p className="text-xs text-slate-600 line-clamp-3 mb-6 leading-relaxed">
                    {prog.short_description}
                  </p>

                  <div className="mt-auto space-y-2.5 pt-4 border-t border-slate-100 text-xs text-slate-600">
                    <div className="flex items-start gap-2">
                      <Users className="w-4 h-4 text-orange-500 shrink-0 mt-0.5" />
                      <span><strong>Target Audience:</strong> {prog.target_audience}</span>
                    </div>
                    {prog.duration && (
                      <div className="flex items-center gap-2">
                        <Clock className="w-4 h-4 text-emerald-600 shrink-0" />
                        <span><strong>Duration:</strong> {prog.duration}</span>
                      </div>
                    )}
                    {prog.age_range && (
                      <div className="p-2 rounded bg-amber-50 text-amber-800 text-[11px] font-medium border border-amber-200">
                        <strong>Note:</strong> {prog.age_range}
                      </div>
                    )}
                  </div>

                  <div className="pt-6 mt-4 flex flex-col gap-2">
                    <div className="grid grid-cols-2 gap-2">
                      <button
                        onClick={() => handleViewDetails(prog)}
                        className="py-2.5 px-3 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-900 text-xs font-bold text-center transition-colors cursor-pointer"
                      >
                        View Program
                      </button>
                      <button
                        onClick={() => openCallbackModal(prog.title)}
                        className="py-2.5 px-3 rounded-xl border border-orange-500 hover:bg-orange-50 text-orange-600 text-xs font-bold text-center transition-colors flex items-center justify-center gap-1 cursor-pointer"
                      >
                        <PhoneCall className="w-3.5 h-3.5" />
                        <span>Request Call</span>
                      </button>
                    </div>

                    <button
                      onClick={openDemoClassModal}
                      className="w-full py-2.5 px-4 rounded-xl bg-gradient-to-r from-orange-600 to-orange-500 hover:from-orange-500 hover:to-orange-600 text-white text-xs font-bold text-center transition-all shadow-xs flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      <CalendarDays className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>Book Your Free Demo Class</span>
                    </button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-16 bg-white rounded-2xl border border-slate-200 max-w-md mx-auto p-6">
            <p className="text-sm font-semibold text-slate-700">No programs match your search criteria.</p>
            <button
              onClick={() => {
                setSearchQuery('');
                setSelectedLevel('all');
              }}
              className="mt-3 text-xs font-bold text-orange-600 hover:underline cursor-pointer"
            >
              Reset filters
            </button>
          </div>
        )}
      </section>

      {/* Admission information */}
      <section className="max-w-4xl mx-auto px-4">
        <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 text-center text-xs text-slate-500 space-y-1">
          <p>
            *Admissions are subject to application review. Approved students receive an official admission document by email.
          </p>
        </div>
      </section>
    </div>
  );
};
