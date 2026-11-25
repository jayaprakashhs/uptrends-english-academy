export type InstructorSkillIcon =
  | 'message-circle'
  | 'book-open'
  | 'users-round'
  | 'briefcase-business'
  | 'presentation'
  | 'globe'
  | 'pencil'
  | 'headphones';

export interface InstructorSkill {
  label: string;
  icon: InstructorSkillIcon;
}
