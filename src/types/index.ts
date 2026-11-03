import type { ApplicationQualificationCategory } from '../../application-request';

export type AdminRole = 'staff' | 'admin' | 'super_admin';

export interface AdminProfile {
  id: string;
  email: string;
  full_name: string;
  role: AdminRole;
  is_active: boolean;
  accessToken?: string;
  last_login?: string | null;
}

export interface Program {
  id: string;
  title: string;
  slug: string;
  short_description: string;
  description: string;
  duration?: string | null;
  level?: string | null;
  target_audience: string;
  age_range?: string | null;
  image_url?: string;
  image_object_key?: string;
  is_published: boolean;
  display_order: number;
  created_at: string;
}

export type ApplicationStatus = 'Pending' | 'Accepted';

export interface StudentApplication {
  id: string;
  application_reference: string;
  student_id?: string | null;
  student_name: string;
  mobile: string;
  email: string;
  qualification: string;
  qualification_category?: ApplicationQualificationCategory | null;
  parent_phone?: string | null;
  parent_email?: string | null;
  school_name?: string | null;
  college_name?: string | null;
  occupation?: string | null;
  place?: string | null;
  city?: string | null;
  program_id?: string | null;
  program_name: string;
  date_of_birth?: string | null;
  address?: string | null;
  photo_object_key?: string;
  photo_data_url?: string;
  message?: string | null;
  status: ApplicationStatus;
  privacy_consent: boolean;
  approved_by_user_id?: string | null;
  approved_by_name?: string | null;
  approved_at?: string | null;
  archived_at?: string | null;
  archived_by?: string | null;
  created_at: string;
}

export type NotificationType = 'student_confirmation' | 'staff_notification' | 'student_approval' | 'student_payment_update';
export type NotificationStatus = 'Pending' | 'Sent' | 'Failed';

export interface ApplicationNotification {
  id: string;
  application_id: string;
  notification_type: NotificationType;
  recipient_email: string;
  status: NotificationStatus;
  provider_message_id?: string | null;
  error_message?: string | null;
  pdf_attached?: boolean;
  official_document_issuance_id?: string | null;
  sent_at?: string | null;
  created_at: string;
}

export interface CallbackRequest {
  id: string;
  full_name: string;
  mobile: string;
  email?: string | null;
  program_name: string;
  preferred_contact_time: 'Morning' | 'Afternoon' | 'Evening';
  message?: string | null;
  consent: boolean;
  status: 'Pending' | 'Contacted' | 'Completed';
  created_at: string;
}

export interface MediaItem {
  id: string;
  media_type: 'photo' | 'video';
  title: string;
  caption?: string | null;
  r2_object_key?: string | null;
  media_url?: string | null;
  youtube_url?: string | null;
  youtube_video_id?: string | null;
  cover_image_url?: string | null;
  alt_text?: string | null;
  is_published: boolean;
  display_order: number;
  created_at: string;
}

export interface Announcement {
  id: string;
  content: string;
  is_active: boolean;
  display_order: number;
  button_action?: 'application' | 'demo' | null;
}

export interface TeamMember {
  id: string;
  full_name: string;
  designation: string;
  qualifications?: string | null;
  bio: string;
  photo_url?: string | null;
  photo_object_key?: string | null;
  is_published: boolean;
  display_order: number;
}

export interface FAQ {
  id: string;
  question: string;
  answer: string;
  is_published: boolean;
  display_order: number;
}

export interface SiteBranding {
  id?: string;
  academy_name: string;
  tagline?: string;
  logo_url?: string;
  main_logo_alt?: string;
  logo_alt?: string;
  favicon_url?: string;
  footer_logo_url?: string;
  hero_photo_url?: string | null;
  primary_orange?: string;
  primary_green?: string;
  primary_color?: string;
  secondary_color?: string;
  updated_at?: string;
}
