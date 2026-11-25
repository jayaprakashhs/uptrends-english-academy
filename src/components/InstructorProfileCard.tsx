import React from 'react';
import {
  BookOpen,
  BriefcaseBusiness,
  GraduationCap,
  Globe,
  Headphones,
  MessageCircle,
  Pencil,
  Presentation,
  UsersRound,
  type LucideIcon,
} from 'lucide-react';
import type { TeamMember } from '../types';
import type { InstructorSkillIcon } from '../types/instructors';

export const INSTRUCTOR_SKILL_ICONS: Record<InstructorSkillIcon, LucideIcon> = {
  'message-circle': MessageCircle,
  'book-open': BookOpen,
  'users-round': UsersRound,
  'briefcase-business': BriefcaseBusiness,
  presentation: Presentation,
  globe: Globe,
  pencil: Pencil,
  headphones: Headphones,
};

export const INSTRUCTOR_SKILL_ICON_OPTIONS: Array<{
  value: InstructorSkillIcon;
  label: string;
}> = [
  { value: 'message-circle', label: 'Conversation' },
  { value: 'book-open', label: 'Reading / Grammar' },
  { value: 'users-round', label: 'Speaking' },
  { value: 'briefcase-business', label: 'Business' },
  { value: 'presentation', label: 'IELTS / Presentation' },
  { value: 'globe', label: 'Communication' },
  { value: 'pencil', label: 'Writing' },
  { value: 'headphones', label: 'Listening' },
];

export const isInstructorSkillIcon = (value: unknown): value is InstructorSkillIcon =>
  typeof value === 'string' &&
  Object.prototype.hasOwnProperty.call(INSTRUCTOR_SKILL_ICONS, value);

export const normalizeInstructorSkills = (value: unknown): NonNullable<TeamMember['teaching_skills']> => {
  if (!Array.isArray(value)) return [];
  return value
    .filter((skill): skill is { label: string; icon: InstructorSkillIcon } =>
      typeof skill === 'object' &&
      skill !== null &&
      'label' in skill &&
      typeof skill.label === 'string' &&
      'icon' in skill &&
      isInstructorSkillIcon(skill.icon))
    .map((skill) => ({ label: skill.label.trim().slice(0, 32), icon: skill.icon }))
    .filter((skill) => skill.label.length > 0)
    .slice(0, 3);
};

interface InstructorProfileCardProps {
  member: TeamMember;
  accentIndex?: number;
}

export const InstructorProfileCard: React.FC<InstructorProfileCardProps> = ({
  member,
  accentIndex = 0,
}) => {
  const skills = normalizeInstructorSkills(member.teaching_skills);
  const accentClass = accentIndex % 2 === 0 ? 'border-t-[#FE8101]' : 'border-t-[#029522]';

  return (
    <article className={`grid min-w-0 grid-cols-[minmax(6.75rem,0.9fr)_minmax(0,1.1fr)] gap-x-4 gap-y-4 rounded-[20px] border border-slate-100 border-t-4 ${accentClass} bg-white p-3.5 shadow-[0_8px_24px_rgba(16,54,75,0.10)] sm:gap-x-5 sm:p-4`}>
      <div className="min-w-0">
        {member.photo_url ? (
          <img
            src={member.photo_url}
            alt={member.full_name}
            className="aspect-[0.8] w-full rounded-[18px] bg-[#FFF0DD] object-cover"
          />
        ) : (
          <div
            aria-hidden="true"
            className="flex aspect-[0.8] w-full items-center justify-center rounded-[18px] bg-[#FFF0DD] text-4xl font-bold text-[#029522]"
          >
            {member.full_name.charAt(0)}
          </div>
        )}
      </div>

      <div className="flex min-w-0 flex-col items-start pt-2">
        <h3 className="break-words text-[17px] font-bold leading-tight text-[#075B36] sm:text-xl">
          {member.full_name}
        </h3>
        <p className="mt-1 break-words text-[13px] font-semibold leading-snug text-slate-800 sm:text-sm">
          {member.designation}
        </p>
        <span aria-hidden="true" className="my-2.5 h-0.5 w-10 rounded-full bg-[#FE8101]" />
        {member.qualifications && (
          <span className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-[#8BD99A] bg-[#F0FFF2] px-2.5 py-1 text-[11px] font-medium leading-tight text-[#155B35] sm:text-xs">
            <GraduationCap className="h-4 w-4 shrink-0 fill-[#029522] text-[#029522]" />
            <span className="break-words">{member.qualifications}</span>
          </span>
        )}
        <p className="mt-3 line-clamp-4 break-words text-left text-[11px] leading-[1.45] text-slate-700 sm:text-xs">
          {member.bio}
        </p>
      </div>

      {skills.length > 0 && (
        <ul className="col-span-2 grid grid-cols-3 gap-2 border-t border-slate-50 pt-2">
          {skills.map((skill, index) => {
            const SkillIcon = INSTRUCTOR_SKILL_ICONS[skill.icon];
            return (
              <li key={`${skill.label}-${index}`} className="flex min-w-0 flex-col items-center gap-1 text-center">
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-[#E9F9EC] text-[#087A36]">
                  <SkillIcon aria-hidden="true" className="h-4 w-4" />
                </span>
                <span className="max-w-full break-words text-[10px] font-medium leading-tight text-slate-800 sm:text-[11px]">
                  {skill.label}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </article>
  );
};
