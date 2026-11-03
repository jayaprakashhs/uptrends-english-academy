import React, { useEffect, useRef, useState } from 'react';
import { CheckCircle, Eye, ImagePlus, LoaderCircle, Pencil, RotateCcw, Trash2, Upload, UserRound, UsersRound } from 'lucide-react';
import type { AdminProfile, TeamMember } from '../types';
import { extractYouTubeId, getYouTubeThumbnail } from '../lib/youtube';
import { supabase } from '../lib/supabase';

const DEFAULT_VIDEO_URL = 'https://www.youtube.com/watch?v=ScMzIvxBSi4';
const MAX_IMAGE_SIZE = 5 * 1024 * 1024;
const IMAGE_TYPES: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

interface ManagedInstructor extends TeamMember {
  qualifications: string;
  photo_object_key: string | null;
  photo_content_type: string | null;
  photo_size_bytes: number | null;
  photo_display_url?: string | null;
}

interface InstructorDraft {
  id?: string;
  full_name: string;
  designation: string;
  qualifications: string;
  bio: string;
  photo_display_url: string | null;
  photo_object_key: string | null;
  photo_content_type: string | null;
  photo_size_bytes: number | null;
  is_published: boolean;
  display_order: number;
}

interface VideoDraft {
  youtube_url: string;
  poster_object_key: string | null;
  poster_content_type: string | null;
  poster_size_bytes: number | null;
  is_published: boolean;
}

const emptyInstructorDraft = (): InstructorDraft => ({
  full_name: '',
  designation: '',
  qualifications: '',
  bio: '',
  photo_display_url: null,
  photo_object_key: null,
  photo_content_type: null,
  photo_size_bytes: null,
  is_published: false,
  display_order: 0,
});

const errorMessage = (error: unknown): string =>
  error instanceof Error ? error.message : 'An unexpected error occurred.';

export const AboutUsManagement: React.FC<{ currentAdmin: AdminProfile }> = ({ currentAdmin }) => {
  const [instructors, setInstructors] = useState<ManagedInstructor[]>([]);
  const [videoDraft, setVideoDraft] = useState<VideoDraft>({
    youtube_url: DEFAULT_VIDEO_URL,
    poster_object_key: null,
    poster_content_type: null,
    poster_size_bytes: null,
    is_published: true,
  });
  const [instructorDraft, setInstructorDraft] = useState<InstructorDraft>(emptyInstructorDraft);
  const [selectedPhoto, setSelectedPhoto] = useState<File | null>(null);
  const [selectedPoster, setSelectedPoster] = useState<File | null>(null);
  const [removePhoto, setRemovePhoto] = useState(false);
  const [removePoster, setRemovePoster] = useState(false);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [posterPreview, setPosterPreview] = useState<string | null>(null);
  const [storedPosterPreview, setStoredPosterPreview] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingInstructor, setSavingInstructor] = useState(false);
  const [savingVideo, setSavingVideo] = useState(false);
  const [previewVideo, setPreviewVideo] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [instructorMessage, setInstructorMessage] = useState<{ type: 'success' | 'error' | 'warning'; text: string } | null>(null);
  const [videoMessage, setVideoMessage] = useState<{ type: 'success' | 'error' | 'warning'; text: string } | null>(null);
  const previewUrls = useRef(new Set<string>());

  useEffect(() => () => {
    previewUrls.current.forEach((url) => URL.revokeObjectURL(url));
    previewUrls.current.clear();
  }, []);

  const adminAssetRequest = async (url: string, init: RequestInit = {}) => {
    const token = currentAdmin.accessToken || sessionStorage.getItem('uptrends_access_token');
    if (!token) throw new Error('Your admin session has expired. Sign in again to manage About Us images.');
    const response = await fetch(url, {
      ...init,
      headers: {
        ...init.headers,
        Authorization: `Bearer ${token}`,
      },
    });
    if (!response.ok) {
      let message = `About Us image request failed (${response.status}).`;
      try {
        const body = await response.json() as { error?: string };
        if (body.error) message = body.error;
      } catch {
        // Keep the HTTP status message when the endpoint does not return JSON.
      }
      throw new Error(message);
    }
    return response;
  };

  const adminAssetUrl = (objectKey: string) =>
    `/api/admin/about-us/assets?key=${encodeURIComponent(objectKey)}`;

  const loadAdminAssetPreview = async (objectKey: string) => {
    const response = await adminAssetRequest(adminAssetUrl(objectKey));
    const url = URL.createObjectURL(await response.blob());
    previewUrls.current.add(url);
    return url;
  };

  const fileAsDataUrl = (file: File) => new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => typeof reader.result === 'string'
      ? resolve(reader.result)
      : reject(new Error('Unable to read the selected image.'));
    reader.onerror = () => reject(new Error('Unable to read the selected image.'));
    reader.readAsDataURL(file);
  });

  useEffect(() => {
    if (!selectedPhoto) {
      setPhotoPreview(null);
      return;
    }

    const previewUrl = URL.createObjectURL(selectedPhoto);
    setPhotoPreview(previewUrl);
    return () => URL.revokeObjectURL(previewUrl);
  }, [selectedPhoto]);

  useEffect(() => {
    if (!selectedPoster) {
      setPosterPreview(null);
      return;
    }

    const previewUrl = URL.createObjectURL(selectedPoster);
    setPosterPreview(previewUrl);
    return () => URL.revokeObjectURL(previewUrl);
  }, [selectedPoster]);

  const loadManagementData = async () => {
    const client = supabase;
    if (!client) {
      setLoadError('Supabase is not configured; About Us content cannot be managed.');
      setLoading(false);
      return;
    }

    setLoading(true);
    setLoadError(null);
    const [instructorResult, videoResult] = await Promise.all([
      client
        .from('team_members')
        .select('id, full_name, designation, qualifications, bio, photo_object_key, photo_content_type, photo_size_bytes, is_published, display_order')
        .order('display_order', { ascending: true })
        .order('created_at', { ascending: true }),
      client
        .from('about_us_video_configurations')
        .select('youtube_url, poster_object_key, poster_content_type, poster_size_bytes, is_published')
        .eq('id', true)
        .maybeSingle(),
    ]);

    const errors: string[] = [];
    if (instructorResult.error) {
      errors.push(`Instructor profiles: ${instructorResult.error.message}`);
    } else {
      const managedInstructors = (instructorResult.data || []) as ManagedInstructor[];
      const withPhotoUrls = await Promise.all(managedInstructors.map(async (instructor) => {
        if (!instructor.photo_object_key) {
          return { ...instructor, photo_display_url: null };
        }
        try {
          return { ...instructor, photo_display_url: await loadAdminAssetPreview(instructor.photo_object_key) };
        } catch (error) {
          errors.push(`Photo for ${instructor.full_name} could not be loaded: ${errorMessage(error)}`);
          return { ...instructor, photo_display_url: null };
        }
      }));
      setInstructors(withPhotoUrls);
    }

    if (videoResult.error) {
      errors.push(`Video configuration: ${videoResult.error.message}`);
    } else if (videoResult.data) {
      setVideoDraft({
        youtube_url: videoResult.data.youtube_url,
        poster_object_key: videoResult.data.poster_object_key,
        poster_content_type: videoResult.data.poster_content_type,
        poster_size_bytes: videoResult.data.poster_size_bytes,
        is_published: videoResult.data.is_published,
      });
      if (videoResult.data.poster_object_key) {
        try {
          setStoredPosterPreview(await loadAdminAssetPreview(videoResult.data.poster_object_key));
        } catch (error) {
          errors.push(`Video poster could not be loaded: ${errorMessage(error)}`);
          setStoredPosterPreview(null);
        }
      } else {
        setStoredPosterPreview(null);
      }
    } else {
      setStoredPosterPreview(null);
    }

    setLoadError(errors.length ? errors.join(' ') : null);
    setLoading(false);
  };

  useEffect(() => {
    void loadManagementData().catch((error: unknown) => {
      setLoadError(`Unable to load About Us management data: ${errorMessage(error)}`);
      setLoading(false);
    });
  }, []);

  const uploadImage = async (file: File, assetType: 'instructor' | 'poster') => {
    const extension = IMAGE_TYPES[file.type];
    if (!extension) throw new Error('Choose a JPG, PNG, or WebP image.');
    if (file.size > MAX_IMAGE_SIZE) throw new Error('Images must be 5 MB or smaller.');

    const response = await adminAssetRequest('/api/admin/about-us/assets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        asset_type: assetType,
        image_file_base64: await fileAsDataUrl(file),
      }),
    });
    const uploaded = await response.json() as {
      object_key: string;
      content_type: string;
      size_bytes: number;
    };
    return uploaded;
  };

  const removeStoredImage = async (objectKey: string | null) => {
    if (!objectKey) return;
    await adminAssetRequest(adminAssetUrl(objectKey), { method: 'DELETE' });
  };

  const resetInstructorEditor = () => {
    setInstructorDraft(emptyInstructorDraft());
    setSelectedPhoto(null);
    setRemovePhoto(false);
  };

  const editInstructor = (instructor: ManagedInstructor) => {
    setInstructorDraft({
      id: instructor.id,
      full_name: instructor.full_name,
      designation: instructor.designation,
      qualifications: instructor.qualifications || '',
      bio: instructor.bio,
      photo_display_url: instructor.photo_display_url || null,
      photo_object_key: instructor.photo_object_key || null,
      photo_content_type: instructor.photo_content_type || null,
      photo_size_bytes: instructor.photo_size_bytes || null,
      is_published: instructor.is_published,
      display_order: instructor.display_order,
    });
    setSelectedPhoto(null);
    setRemovePhoto(false);
    setInstructorMessage(null);
  };

  const saveInstructor = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!supabase) {
      setInstructorMessage({ type: 'error', text: 'Supabase is not configured.' });
      return;
    }
    if (!instructorDraft.full_name.trim() || !instructorDraft.designation.trim() || !instructorDraft.bio.trim()) {
      setInstructorMessage({ type: 'error', text: 'Name, designation, and biography are required.' });
      return;
    }

    setSavingInstructor(true);
    setInstructorMessage(null);
    let uploadedObjectKey: string | null = null;
    let photoWarning: string | null = null;
    let nextPhotoObjectKey = removePhoto ? null : instructorDraft.photo_object_key;
    let nextPhotoContentType = removePhoto ? null : instructorDraft.photo_content_type;
    let nextPhotoSizeBytes = removePhoto ? null : instructorDraft.photo_size_bytes;

    try {
      if (selectedPhoto) {
        const uploaded = await uploadImage(selectedPhoto, 'instructor');
        uploadedObjectKey = uploaded.object_key;
        nextPhotoObjectKey = uploaded.object_key;
        nextPhotoContentType = uploaded.content_type;
        nextPhotoSizeBytes = uploaded.size_bytes;
      }

      const payload = {
        full_name: instructorDraft.full_name.trim(),
        designation: instructorDraft.designation.trim(),
        qualifications: instructorDraft.qualifications.trim(),
        bio: instructorDraft.bio.trim(),
        photo_object_key: nextPhotoObjectKey,
        photo_content_type: nextPhotoContentType,
        photo_size_bytes: nextPhotoSizeBytes,
        is_published: instructorDraft.is_published,
        display_order: Math.trunc(Number(instructorDraft.display_order) || 0),
      };
      const result = instructorDraft.id
        ? await supabase.from('team_members').update(payload).eq('id', instructorDraft.id).select('*').single()
        : await supabase.from('team_members').insert(payload).select('*').single();

      if (result.error) throw new Error(`Unable to save instructor: ${result.error.message}`);
      const savedRecord = result.data as ManagedInstructor;
      let photoDisplayUrl: string | null = null;
      if (savedRecord.photo_object_key) {
        try {
          photoDisplayUrl = await loadAdminAssetPreview(savedRecord.photo_object_key);
        } catch (error) {
          photoWarning = `Instructor saved, but the photo could not be previewed: ${errorMessage(error)}`;
        }
      }
      const saved = { ...savedRecord, photo_display_url: photoDisplayUrl };
      setInstructors((current) => {
        const updated = instructorDraft.id
          ? current.map((instructor) => instructor.id === saved.id ? saved : instructor)
          : [...current, saved];
        return updated.sort((left, right) => left.display_order - right.display_order);
      });

      const oldObjectKey = instructorDraft.photo_object_key;
      if (oldObjectKey && oldObjectKey !== nextPhotoObjectKey) {
        try {
          await removeStoredImage(oldObjectKey);
        } catch (cleanupError) {
          setInstructorMessage({ type: 'warning', text: `${errorMessage(cleanupError)} The profile was saved, but the old image remains in R2.` });
          resetInstructorEditor();
          return;
        }
      }

      setInstructorMessage(photoWarning
        ? { type: 'warning', text: photoWarning }
        : { type: 'success', text: 'Instructor profile saved.' });
      resetInstructorEditor();
    } catch (error) {
      let message = errorMessage(error);
      if (uploadedObjectKey) {
        try {
          await removeStoredImage(uploadedObjectKey);
        } catch (cleanupError) {
          message = `${message} The newly uploaded image could not be removed from R2: ${errorMessage(cleanupError)}`;
        }
      }
      setInstructorMessage({ type: 'error', text: message });
    } finally {
      setSavingInstructor(false);
    }
  };

  const toggleInstructorPublication = async (instructor: ManagedInstructor) => {
    if (!supabase) {
      setInstructorMessage({ type: 'error', text: 'Supabase is not configured.' });
      return;
    }
    setInstructorMessage(null);
    const { data, error } = await supabase
      .from('team_members')
      .update({ is_published: !instructor.is_published })
      .eq('id', instructor.id)
      .select('*')
      .single();
    if (error) {
      setInstructorMessage({ type: 'error', text: `Unable to update publication status: ${error.message}` });
      return;
    }
    const updated = data as ManagedInstructor;
    setInstructors((current) => current.map((item) => item.id === updated.id
      ? { ...item, ...updated, photo_display_url: item.photo_display_url }
      : item));
    setInstructorMessage({
      type: 'success',
      text: `Instructor ${updated.is_published ? 'published' : 'unpublished'}.`,
    });
  };

  const deleteInstructor = async (instructor: ManagedInstructor) => {
    if (!supabase) {
      setInstructorMessage({ type: 'error', text: 'Supabase is not configured.' });
      return;
    }
    if (!window.confirm(`Delete ${instructor.full_name}'s instructor profile? This cannot be undone.`)) return;
    setInstructorMessage(null);
    const { error } = await supabase.from('team_members').delete().eq('id', instructor.id);
    if (error) {
      setInstructorMessage({ type: 'error', text: `Unable to delete instructor: ${error.message}` });
      return;
    }

    setInstructors((current) => current.filter((item) => item.id !== instructor.id));
    setInstructorMessage({ type: 'success', text: 'Instructor profile deleted.' });
    if (instructorDraft.id === instructor.id) resetInstructorEditor();
    if (instructor.photo_object_key) {
      try {
        await removeStoredImage(instructor.photo_object_key);
      } catch (cleanupError) {
        setInstructorMessage({ type: 'warning', text: `${errorMessage(cleanupError)} The instructor was deleted, but the photo remains in R2.` });
      }
    }
  };

  const saveVideoConfiguration = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!supabase) {
      setVideoMessage({ type: 'error', text: 'Supabase is not configured.' });
      return;
    }
    if (!extractYouTubeId(videoDraft.youtube_url.trim())) {
      setVideoMessage({ type: 'error', text: 'Enter a valid YouTube video URL.' });
      return;
    }

    setSavingVideo(true);
    setVideoMessage(null);
    setPreviewVideo(false);
    let uploadedObjectKey: string | null = null;
    let posterWarning: string | null = null;
    let nextPosterObjectKey = removePoster ? null : videoDraft.poster_object_key;
    let nextPosterContentType = removePoster ? null : videoDraft.poster_content_type;
    let nextPosterSizeBytes = removePoster ? null : videoDraft.poster_size_bytes;

    try {
      if (selectedPoster) {
        const uploaded = await uploadImage(selectedPoster, 'poster');
        uploadedObjectKey = uploaded.object_key;
        nextPosterObjectKey = uploaded.object_key;
        nextPosterContentType = uploaded.content_type;
        nextPosterSizeBytes = uploaded.size_bytes;
      }

      const payload = {
        id: true,
        youtube_url: videoDraft.youtube_url.trim(),
        poster_object_key: nextPosterObjectKey,
        poster_content_type: nextPosterContentType,
        poster_size_bytes: nextPosterSizeBytes,
        is_published: videoDraft.is_published,
      };
      const { data, error } = await supabase
        .from('about_us_video_configurations')
        .upsert(payload, { onConflict: 'id' })
        .select('youtube_url, poster_object_key, poster_content_type, poster_size_bytes, is_published')
        .single();
      if (error) throw new Error(`Unable to save video configuration: ${error.message}`);

      const previousObjectKey = videoDraft.poster_object_key;
      setVideoDraft({
        youtube_url: data.youtube_url,
        poster_object_key: data.poster_object_key,
        poster_content_type: data.poster_content_type,
        poster_size_bytes: data.poster_size_bytes,
        is_published: data.is_published,
      });
      setSelectedPoster(null);
      setRemovePoster(false);
      if (data.poster_object_key) {
        try {
          setStoredPosterPreview(await loadAdminAssetPreview(data.poster_object_key));
        } catch (error) {
          setStoredPosterPreview(null);
          posterWarning = `Video saved, but the poster could not be previewed: ${errorMessage(error)}`;
        }
      } else {
        setStoredPosterPreview(null);
      }

      if (previousObjectKey && previousObjectKey !== nextPosterObjectKey) {
        try {
          await removeStoredImage(previousObjectKey);
        } catch (cleanupError) {
          setVideoMessage({ type: 'warning', text: `${errorMessage(cleanupError)} The video was saved, but the old poster remains in R2.` });
          return;
        }
      }

      setVideoMessage(posterWarning
        ? { type: 'warning', text: posterWarning }
        : {
          type: 'success',
          text: videoDraft.is_published ? 'Video configuration saved and published.' : 'Video configuration saved as a draft.',
        });
    } catch (error) {
      let message = errorMessage(error);
      if (uploadedObjectKey) {
        try {
          await removeStoredImage(uploadedObjectKey);
        } catch (cleanupError) {
          message = `${message} The newly uploaded poster could not be removed from R2: ${errorMessage(cleanupError)}`;
        }
      }
      setVideoMessage({ type: 'error', text: message });
    } finally {
      setSavingVideo(false);
    }
  };

  const videoId = extractYouTubeId(videoDraft.youtube_url.trim());
  const posterUrl = posterPreview
    || (removePoster ? null : storedPosterPreview)
    || getYouTubeThumbnail(videoId, 'maxresdefault');
  const isAuthorized = currentAdmin.role === 'super_admin' && currentAdmin.is_active;

  if (!isAuthorized) {
    return (
      <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm font-semibold text-rose-800">
        Access denied. About Us Management is available only to active super administrators.
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-extrabold tracking-tight text-[#0B1F4D]">About Us Management</h1>
        <p className="mt-1 text-sm text-slate-600">Manage instructor profiles and the public video introduction.</p>
      </header>

      {loadError && (
        <div role="alert" className="rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
          {loadError}
        </div>
      )}
      {loading && (
        <p role="status" className="flex items-center gap-2 text-sm text-slate-600">
          <LoaderCircle className="h-4 w-4 animate-spin" /> Loading About Us content…
        </p>
      )}

      <div className="space-y-6">
        <section className="overflow-hidden rounded-2xl border border-sky-100 bg-white shadow-sm">
          <div className="px-5 pb-5 pt-6 sm:px-7">
            <div className="flex items-center gap-4">
              <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-orange-50 text-orange-600">
                <UsersRound className="h-7 w-7" />
              </span>
              <div>
                <h2 className="text-2xl font-bold tracking-tight text-[#0B1F4D] sm:text-3xl">
                  {instructorDraft.id ? 'Edit Instructor' : 'Add Instructor'}
                </h2>
                <p className="mt-1 text-sm text-slate-500">
                  {instructorDraft.id
                    ? 'Update this instructor profile for the About Us section'
                    : 'Create a new instructor profile for the About Us section'}
                </p>
              </div>
            </div>
            <div className="mt-5 h-px bg-orange-500" />
          </div>

          {instructorMessage && (
            <p role={instructorMessage.type === 'error' ? 'alert' : 'status'} className={`mx-5 mb-4 rounded-lg p-3 text-xs sm:mx-7 ${
              instructorMessage.type === 'success' ? 'bg-emerald-50 text-emerald-800' :
                instructorMessage.type === 'warning' ? 'bg-amber-50 text-amber-800' : 'bg-rose-50 text-rose-800'
            }`}>
              {instructorMessage.text}
            </p>
          )}

          <div className="grid items-stretch gap-5 px-5 pb-6 sm:px-7 lg:grid-cols-[minmax(0,1.62fr)_minmax(18rem,1fr)]">
            <form onSubmit={saveInstructor} className="min-w-0 space-y-5 rounded-xl border border-sky-100 bg-white p-4 sm:p-6">
              <h3 className="text-lg font-bold text-[#0B1F4D]">Instructor Details</h3>

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block space-y-1.5 text-sm font-semibold text-slate-700">
                  Instructor Name
                  <input
                    required
                    value={instructorDraft.full_name}
                    onChange={(event) => setInstructorDraft({ ...instructorDraft, full_name: event.target.value })}
                    className="w-full rounded-lg border border-sky-100 bg-white px-3.5 py-3 text-sm font-normal outline-none transition focus:border-orange-400 focus:ring-2 focus:ring-orange-100"
                    placeholder="Enter instructor name"
                  />
                </label>
                <label className="block space-y-1.5 text-sm font-semibold text-slate-700">
                  Designation
                  <input
                    required
                    value={instructorDraft.designation}
                    onChange={(event) => setInstructorDraft({ ...instructorDraft, designation: event.target.value })}
                    className="w-full rounded-lg border border-sky-100 bg-white px-3.5 py-3 text-sm font-normal outline-none transition focus:border-orange-400 focus:ring-2 focus:ring-orange-100"
                    placeholder="e.g. Spoken English Trainer"
                  />
                </label>
              </div>

              <label className="block space-y-1.5 text-sm font-semibold text-slate-700">
                Qualifications
                <input
                  value={instructorDraft.qualifications}
                  onChange={(event) => setInstructorDraft({ ...instructorDraft, qualifications: event.target.value })}
                  className="w-full rounded-lg border border-sky-100 bg-white px-3.5 py-3 text-sm font-normal outline-none transition focus:border-orange-400 focus:ring-2 focus:ring-orange-100"
                  placeholder="Enter qualifications"
                />
              </label>

              <label className="block space-y-1.5 text-sm font-semibold text-slate-700">
                Biography
                <textarea
                  required
                  rows={6}
                  maxLength={1000}
                  value={instructorDraft.bio}
                  onChange={(event) => setInstructorDraft({ ...instructorDraft, bio: event.target.value })}
                  className="w-full resize-y rounded-lg border border-sky-100 bg-white px-3.5 py-3 text-sm font-normal leading-relaxed outline-none transition focus:border-orange-400 focus:ring-2 focus:ring-orange-100"
                  placeholder="Write a short biography about the instructor..."
                />
                <span className="block text-right text-xs font-normal text-slate-400">{instructorDraft.bio.length} / 1000</span>
              </label>

              <div>
                <h4 className="mb-2 text-sm font-semibold text-slate-700">Profile Photo</h4>
                <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(10rem,0.8fr)]">
                  <div className="flex min-h-32 flex-col items-center justify-center rounded-lg border border-dashed border-sky-200 bg-slate-50/50 p-4 text-center">
                    <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-sky-100 bg-white px-4 py-2.5 text-sm font-semibold text-[#0B1F4D] transition hover:border-orange-300 hover:bg-orange-50">
                      <ImagePlus className="h-4 w-4 text-orange-600" />
                      {selectedPhoto ? 'Change Photo' : 'Upload Photo'}
                      <input
                        type="file"
                        accept="image/jpeg,image/png,image/webp"
                        className="sr-only"
                        onChange={(event) => {
                          const file = event.target.files?.[0] || null;
                          event.target.value = '';
                          setSelectedPhoto(file);
                          setRemovePhoto(false);
                        }}
                      />
                    </label>
                    <p className="mt-2 text-xs text-slate-400">JPG, PNG or WebP · Max 5 MB</p>
                    {(instructorDraft.photo_object_key || selectedPhoto) && (
                      <button
                        type="button"
                        onClick={() => {
                          if (removePhoto) {
                            setRemovePhoto(false);
                          } else {
                            setSelectedPhoto(null);
                            setRemovePhoto(true);
                          }
                        }}
                        className="mt-2 text-xs font-semibold text-rose-700 hover:underline"
                      >
                        {removePhoto ? 'Keep current photo' : 'Remove photo'}
                      </button>
                    )}
                  </div>
                  <div className="rounded-lg border border-sky-100 bg-[#F8FBFF] p-4">
                    <h5 className="text-sm font-bold text-[#0B1F4D]">Recommended Photo</h5>
                    <p className="mt-2 text-xs leading-relaxed text-slate-500">
                      Use a clear, professional headshot. Square images work best for the instructor profile.
                    </p>
                    <p className="mt-2 text-xs text-slate-400">Recommended: 400 × 400 px</p>
                  </div>
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <label className="block space-y-1.5 text-sm font-semibold text-slate-700">
                  Display Order
                  <input
                    type="number"
                    step="1"
                    value={instructorDraft.display_order}
                    onChange={(event) => setInstructorDraft({ ...instructorDraft, display_order: Number(event.target.value) })}
                    className="w-full rounded-lg border border-sky-100 bg-white px-3 py-2.5 text-sm font-normal outline-none focus:border-orange-400 focus:ring-2 focus:ring-orange-100"
                  />
                </label>
                <label className="flex items-center gap-2 self-end pb-3 text-sm font-medium text-slate-700">
                  <input
                    type="checkbox"
                    checked={instructorDraft.is_published}
                    onChange={(event) => setInstructorDraft({ ...instructorDraft, is_published: event.target.checked })}
                    className="h-4 w-4 accent-orange-600"
                  />
                  Published on the public page
                </label>
              </div>

              <div className="flex flex-wrap gap-3 border-t border-sky-50 pt-4">
                <button type="submit" disabled={savingInstructor} className="inline-flex min-w-40 items-center justify-center gap-2 rounded-lg bg-orange-600 px-5 py-3 text-sm font-bold text-white transition hover:bg-orange-700 disabled:opacity-60">
                  {savingInstructor ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <CheckCircle className="h-4 w-4" />}
                  {instructorDraft.id ? 'Save Changes' : 'Add Instructor'}
                </button>
                <button type="button" onClick={resetInstructorEditor} className="inline-flex items-center justify-center gap-2 rounded-lg border border-sky-200 bg-white px-5 py-3 text-sm font-semibold text-[#0B1F4D] transition hover:bg-slate-50">
                  <RotateCcw className="h-4 w-4" /> Reset
                </button>
              </div>
            </form>

            <aside className="flex min-w-0 flex-col overflow-hidden rounded-xl border border-sky-100 bg-white">
              <div className="flex items-center gap-2 bg-[#0B1F4D] px-5 py-4 text-white">
                <Eye className="h-5 w-5" />
                <h3 className="text-base font-bold">Preview</h3>
              </div>
              <div className="relative mx-5 mb-5 mt-16 flex min-h-[28rem] flex-1 flex-col items-center rounded-xl border border-sky-100 px-5 pb-8 pt-16 text-center sm:mx-7 sm:px-8">
                {(photoPreview || (!removePhoto && instructorDraft.photo_display_url)) ? (
                  <img
                    src={photoPreview || instructorDraft.photo_display_url || ''}
                    alt={instructorDraft.full_name ? `${instructorDraft.full_name} portrait preview` : 'Instructor portrait preview'}
                    className="absolute left-1/2 top-0 h-28 w-28 -translate-x-1/2 -translate-y-1/2 rounded-full border-4 border-white bg-white object-cover shadow-md"
                  />
                ) : (
                  <div className="absolute left-1/2 top-0 flex h-28 w-28 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-4 border-white bg-slate-100 text-slate-400 shadow-md">
                    <UserRound className="h-14 w-14" />
                  </div>
                )}
                <h4 className="mt-5 break-words text-2xl font-bold leading-tight text-[#0B1F4D]">
                  {instructorDraft.full_name.trim() || 'Instructor Name'}
                </h4>
                <p className="mt-2 break-words text-base font-semibold text-orange-600">
                  {instructorDraft.designation.trim() || 'Designation'}
                </p>
                <div className="my-5 h-0.5 w-16 bg-orange-500" />
                <p className="min-h-5 break-words text-sm italic text-slate-500">
                  {instructorDraft.qualifications.trim() || 'Qualifications'}
                </p>
                <p className="mt-6 w-full whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-600">
                  {instructorDraft.bio.trim() || 'The instructor biography will appear here.'}
                </p>
              </div>
            </aside>
          </div>

          <div className="space-y-3 border-t border-sky-50 px-5 py-5 sm:px-7">
            <h3 className="text-base font-bold text-[#0B1F4D]">Instructor Profiles</h3>
            <p className="text-xs text-slate-500">Only published profiles appear on the public About Us page.</p>
            {instructors.length === 0 && !loading && !loadError && (
              <p className="rounded-lg bg-slate-50 p-4 text-sm text-slate-600">No instructor profiles have been added.</p>
            )}
            {instructors.map((instructor) => (
              <article key={instructor.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-200 p-3">
                {instructor.photo_display_url ? (
                  <img src={instructor.photo_display_url} alt="" className="h-12 w-12 rounded-full object-cover" />
                ) : (
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-orange-100 font-bold text-orange-700">
                    {instructor.full_name.charAt(0)}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-bold text-slate-900">{instructor.full_name}</p>
                  <p className="truncate text-xs text-slate-600">{instructor.designation} · Order {instructor.display_order}</p>
                  <p className={`mt-1 text-[10px] font-bold uppercase ${instructor.is_published ? 'text-emerald-700' : 'text-slate-500'}`}>
                    {instructor.is_published ? 'Published' : 'Draft'}
                  </p>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <button type="button" onClick={() => editInstructor(instructor)} aria-label={`Edit ${instructor.full_name}`} className="rounded-md border border-slate-300 p-2 text-slate-700 hover:bg-slate-100">
                    <Pencil className="h-4 w-4" />
                  </button>
                  <button type="button" onClick={() => void toggleInstructorPublication(instructor)} className="rounded-md border border-slate-300 px-2 py-2 text-[10px] font-semibold text-slate-700 hover:bg-slate-100">
                    {instructor.is_published ? 'Unpublish' : 'Publish'}
                  </button>
                  <button type="button" onClick={() => void deleteInstructor(instructor)} aria-label={`Delete ${instructor.full_name}`} className="rounded-md border border-rose-200 p-2 text-rose-700 hover:bg-rose-50">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </article>
            ))}
          </div>
        </section>

        <section className="space-y-4 rounded-2xl border border-sky-100 bg-white p-4 shadow-sm sm:p-6">
          <div>
            <h2 className="text-lg font-bold text-slate-900">Video Introduction</h2>
            <p className="text-xs text-slate-500">Preview the YouTube video and poster before publishing.</p>
          </div>

          {videoMessage && (
            <p role={videoMessage.type === 'error' ? 'alert' : 'status'} className={`rounded-lg p-3 text-xs ${
              videoMessage.type === 'success' ? 'bg-emerald-50 text-emerald-800' :
                videoMessage.type === 'warning' ? 'bg-amber-50 text-amber-800' : 'bg-rose-50 text-rose-800'
            }`}>
              {videoMessage.text}
            </p>
          )}

          <form onSubmit={saveVideoConfiguration} className="space-y-4">
            <label className="block space-y-1 text-xs font-semibold text-slate-700">
              YouTube video URL
              <input
                type="url"
                required
                value={videoDraft.youtube_url}
                onChange={(event) => {
                  setVideoDraft({ ...videoDraft, youtube_url: event.target.value });
                  setPreviewVideo(false);
                }}
                className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
              />
            </label>
            <div className="flex flex-wrap items-center gap-3">
              <label className="inline-flex cursor-pointer items-center gap-2 rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700">
                <Upload className="h-4 w-4" />
                Upload / replace poster
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp"
                  className="sr-only"
                  onChange={(event) => {
                    const file = event.target.files?.[0] || null;
                    event.target.value = '';
                    setSelectedPoster(file);
                    setRemovePoster(false);
                  }}
                />
              </label>
              {(videoDraft.poster_object_key || selectedPoster) && (
                <button
                  type="button"
                  onClick={() => {
                    if (removePoster) {
                      setRemovePoster(false);
                    } else {
                      setSelectedPoster(null);
                      setRemovePoster(true);
                    }
                  }}
                  className="text-xs font-semibold text-rose-700 hover:underline"
                >
                  {removePoster ? 'Keep current poster' : 'Remove custom poster'}
                </button>
              )}
            </div>

            {posterUrl && (
              <div className="overflow-hidden rounded-xl border border-slate-200 bg-slate-900">
                {!previewVideo ? (
                  <div className="relative aspect-video">
                    <img src={posterUrl} alt="Video poster preview" className="absolute inset-0 h-full w-full object-contain" />
                  </div>
                ) : videoId ? (
                  <div className="relative aspect-video">
                    <iframe
                      src={`https://www.youtube-nocookie.com/embed/${videoId}?controls=1&rel=0`}
                      title="Video introduction preview"
                      className="absolute inset-0 h-full w-full border-0"
                      allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                      allowFullScreen
                    />
                  </div>
                ) : null}
              </div>
            )}
            {!videoId && <p role="alert" className="text-xs text-rose-700">Enter a valid YouTube URL to preview or publish.</p>}
            <button
              type="button"
              disabled={!videoId}
              onClick={() => setPreviewVideo(!previewVideo)}
              className="rounded-lg border border-slate-300 px-3 py-2 text-xs font-semibold text-slate-700 disabled:opacity-50"
            >
              {previewVideo ? 'Show poster preview' : 'Preview video'}
            </button>
            <label className="flex items-center gap-2 text-xs font-semibold text-slate-700">
              <input type="checkbox" checked={videoDraft.is_published} onChange={(event) => setVideoDraft({ ...videoDraft, is_published: event.target.checked })} className="accent-emerald-600" />
              Publish video configuration publicly
            </label>
            <button type="submit" disabled={savingVideo || !videoId} className="inline-flex items-center gap-2 rounded-lg bg-orange-600 px-4 py-2.5 text-xs font-bold text-white disabled:opacity-60">
              {savingVideo ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <CheckCircle className="h-4 w-4" />}
              {videoDraft.is_published ? 'Save & publish video' : 'Save video draft'}
            </button>
          </form>
        </section>
      </div>
    </div>
  );
};
