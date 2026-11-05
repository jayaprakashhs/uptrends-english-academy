import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFImage,
  type PDFPage,
} from 'pdf-lib';

export type OfficialFontFamily = 'Helvetica' | 'TimesRoman' | 'Courier';
export type OfficialPageSize = 'A4' | 'Letter';
export type OfficialSection = 'student' | 'course' | 'joining';

export interface OfficialDocumentSettings {
  academyName: string;
  address: string;
  phone: string;
  email: string;
  hours: string;
  heading: string;
  subtitle: string;
  approvalMessage: string;
  welcomeMessage: string;
  sectionHeadings: Record<OfficialSection, string>;
  footerText: string;
  motivationalTagline: string;
  joiningInstructions?: string[];
  logoObjectKey: string | null;
  graphicObjectKey: string | null;
  colors: {
    orange: string;
    green: string;
    navy: string;
    background: string;
  };
  typography: {
    fontFamily: OfficialFontFamily;
    titleSize: number;
    headingSize: number;
    bodySize: number;
  };
  layout: {
    pageSize: OfficialPageSize;
    spacing: number;
    showLogo: boolean;
    showStudentPhoto: boolean;
    showDecorations: boolean;
    showFooter: boolean;
    visibleSections: OfficialSection[];
    sectionOrder: OfficialSection[];
  };
}

export interface OfficialStudent {
  fullName: string;
  studentId: string;
  applicationNumber: string;
  qualificationCategory?: 'Student' | 'Graduate' | 'Working' | null;
  qualification: string;
  programName: string;
  email: string;
  mobile: string;
  parentEmail?: string | null;
  parentPhone?: string | null;
  dateOfBirth: string | null;
  address: string | null;
  schoolName?: string | null;
  collegeName?: string | null;
  occupation?: string | null;
  place?: string | null;
  city?: string | null;
}

export interface OfficialJoiningInformation {
  joiningDate: string;
  classSchedule: string;
  classTimings: string;
  venue: string;
}

export interface OfficialCourse {
  name: string;
  duration: string | null;
  mode?: string | null;
  level: string | null;
}

export interface OfficialDocumentAssets {
  logo?: { bytes: Uint8Array; mime: 'image/png' | 'image/jpeg' };
  graphic?: { bytes: Uint8Array; mime: 'image/png' | 'image/jpeg' };
  studentPhoto?: { bytes: Uint8Array; mime: 'image/png' | 'image/jpeg' };
}

export interface OfficialDocumentInput {
  settings: OfficialDocumentSettings;
  student: OfficialStudent;
  course: OfficialCourse | null;
  joiningInformation?: OfficialJoiningInformation;
  assets?: OfficialDocumentAssets;
  versionNumber?: number;
  previewOnly?: boolean;
}

export const DEFAULT_OFFICIAL_DOCUMENT_SETTINGS: OfficialDocumentSettings = {
  academyName: "Uptrend's English Academy",
  address: '#259/1A1, Devi Building, 2nd Floor, Ram And Co Circle, Davangere, Karnataka 577002',
  phone: '+91 900 8000 211',
  email: 'uptrendsinstitute@gmail.com',
  hours: 'Monday to Saturday, 8:00 AM - 8:30 PM (Sunday Closed)',
  heading: 'ADMISSION CONFIRMATION',
  subtitle: 'A confident beginning to your English-learning journey',
  approvalMessage: 'APPLICATION APPROVED',
  welcomeMessage: "We are pleased to welcome you to Uptrend's English Academy. Please keep this document for your records.",
  sectionHeadings: {
    student: 'STUDENT INFORMATION',
    course: 'SELECTED COURSE',
    joining: 'JOINING INFORMATION',
  },
  footerText: "Uptrend's English Academy - Davangere",
  motivationalTagline: 'Learn English • Build Confidence • Achieve More',
  joiningInstructions: [],
  logoObjectKey: null,
  graphicObjectKey: null,
  colors: {
    orange: '#f57400',
    green: '#176b48',
    navy: '#0b1f4d',
    background: '#ffffff',
  },
  typography: {
    fontFamily: 'Helvetica',
    titleSize: 17,
    headingSize: 10,
    bodySize: 9,
  },
  layout: {
    pageSize: 'A4',
    spacing: 1,
    showLogo: true,
    showStudentPhoto: true,
    showDecorations: true,
    showFooter: true,
    visibleSections: ['student', 'course', 'joining'],
    sectionOrder: ['student', 'course', 'joining'],
  },
};

const printable = (value: unknown): string =>
  String(value ?? '')
    .replace(/[’‘]/g, "'")
    .replace(/[–—]/g, '-')
    .replace(/[^\x20-\x7E\u2022\u00B7]/g, '?');

const colorFromHex = (value: string) => {
  const hex = value.replace('#', '');
  return rgb(
    Number.parseInt(hex.slice(0, 2), 16) / 255,
    Number.parseInt(hex.slice(2, 4), 16) / 255,
    Number.parseInt(hex.slice(4, 6), 16) / 255,
  );
};

const pageDimensions = (pageSize: OfficialPageSize): [number, number] =>
  pageSize === 'Letter' ? [612, 792] : [595.28, 841.89];

export async function generateOfficialPdf({
  settings,
  student,
  course,
  joiningInformation,
  assets,
  versionNumber,
  previewOnly = false,
}: OfficialDocumentInput): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const fontFamily = settings.typography.fontFamily;
  const regular = await pdf.embedFont(
    fontFamily === 'TimesRoman'
      ? StandardFonts.TimesRoman
      : fontFamily === 'Courier'
        ? StandardFonts.Courier
        : StandardFonts.Helvetica,
  );
  const bold = await pdf.embedFont(
    fontFamily === 'TimesRoman'
      ? StandardFonts.TimesRomanBold
      : fontFamily === 'Courier'
        ? StandardFonts.CourierBold
        : StandardFonts.HelveticaBold,
  );
  const colors = {
    orange: colorFromHex(settings.colors.orange),
    green: colorFromHex(settings.colors.green),
    navy: colorFromHex(settings.colors.navy),
    gold: rgb(0.96, 0.68, 0.08),
    background: colorFromHex(settings.colors.background),
    white: rgb(1, 1, 1),
    ink: rgb(0.13, 0.17, 0.23),
    muted: rgb(0.38, 0.42, 0.48),
    line: rgb(0.75, 0.83, 0.9),
    paleBlue: rgb(0.93, 0.97, 1),
    paleOrange: rgb(1, 0.95, 0.88),
    paleGreen: rgb(0.9, 0.98, 0.91),
  };
  const [pageWidth, pageHeight] = pageDimensions(settings.layout.pageSize);
  const margin = 38;
  const contentWidth = pageWidth - margin * 2;
  const spacing = Math.max(0.75, Math.min(settings.layout.spacing, 1.75));
  const bodySize = settings.typography.bodySize;
  const headingSize = settings.typography.headingSize;
  const pages: PDFPage[] = [];
  let page!: PDFPage;
  let y: number;
  let logoImage: PDFImage | null = null;
  let studentPhoto: PDFImage | null = null;
  let decorativeGraphic: PDFImage | null = null;

  if (assets?.logo) {
    logoImage = assets.logo.mime === 'image/png'
      ? await pdf.embedPng(assets.logo.bytes)
      : await pdf.embedJpg(assets.logo.bytes);
  }
  if (assets?.studentPhoto && settings.layout.showStudentPhoto) {
    studentPhoto = assets.studentPhoto.mime === 'image/png'
      ? await pdf.embedPng(assets.studentPhoto.bytes)
      : await pdf.embedJpg(assets.studentPhoto.bytes);
  }
  if (assets?.graphic && settings.layout.showDecorations) {
    decorativeGraphic = assets.graphic.mime === 'image/png'
      ? await pdf.embedPng(assets.graphic.bytes)
      : await pdf.embedJpg(assets.graphic.bytes);
  }

  const paintPage = (target: PDFPage) => {
    target.drawRectangle({
      x: 0,
      y: 0,
      width: pageWidth,
      height: pageHeight,
      color: colors.background,
    });
    if (settings.layout.showDecorations) {
      target.drawRectangle({ x: 0, y: pageHeight - 8, width: pageWidth, height: 8, color: colors.orange });
      target.drawRectangle({ x: 0, y: pageHeight - 11, width: pageWidth, height: 3, color: colors.gold });
    }
  };

  const addPage = (firstPage = false) => {
    page = pdf.addPage([pageWidth, pageHeight]);
    pages.push(page);
    paintPage(page);
    y = pageHeight - (firstPage ? 148 : 62);
    if (!firstPage) {
      page.drawText(printable(settings.academyName), {
        x: margin,
        y: pageHeight - 39,
        size: 9,
        font: bold,
        color: colors.navy,
        maxWidth: contentWidth,
      });
      page.drawLine({
        start: { x: margin, y: pageHeight - 48 },
        end: { x: pageWidth - margin, y: pageHeight - 48 },
        thickness: 0.8,
        color: colors.line,
      });
    }
  };

  const ensureRoom = (height: number) => {
    if (y - height < margin + 32) addPage();
  };

  const drawWrapped = (
    value: unknown,
    x = margin,
    options: { size?: number; font?: PDFFont; color?: ReturnType<typeof rgb>; maxWidth?: number; lineGap?: number } = {},
  ): number => {
    const font = options.font ?? regular;
    const size = options.size ?? bodySize;
    const maxWidth = options.maxWidth ?? pageWidth - margin - x;
    const lineGap = options.lineGap ?? size * 1.45 * spacing;
    const words = printable(value).split(/\s+/).filter(Boolean);
    let line = '';
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (font.widthOfTextAtSize(candidate, size) > maxWidth && line) {
        ensureRoom(lineGap);
        page.drawText(line, { x, y, size, font, color: options.color ?? colors.ink, maxWidth });
        y -= lineGap;
        line = word;
      } else {
        line = candidate;
      }
      if (font.widthOfTextAtSize(line, size) > maxWidth) {
        const characters = [...line];
        line = '';
        for (const character of characters) {
          const next = `${line}${character}`;
          if (font.widthOfTextAtSize(next, size) > maxWidth && line) {
            ensureRoom(lineGap);
            page.drawText(line, { x, y, size, font, color: options.color ?? colors.ink, maxWidth });
            y -= lineGap;
            line = character;
          } else {
            line = next;
          }
        }
      }
    }
    if (line) {
      ensureRoom(lineGap);
      page.drawText(line, { x, y, size, font, color: options.color ?? colors.ink, maxWidth });
      y -= lineGap;
    }
    return y;
  };

  const drawSectionTitle = (title: string) => {
    ensureRoom(36);
    y -= 4 * spacing;
    page.drawRectangle({
      x: margin,
      y: y - 21,
      width: contentWidth,
      height: 24,
      color: colors.navy,
    });
    page.drawCircle({ x: margin + 9, y: y - 9, size: 9, color: colors.navy });
    page.drawCircle({ x: pageWidth - margin - 9, y: y - 9, size: 9, color: colors.navy });
    page.drawText(printable(title), {
      x: margin + 14,
      y: y - 13,
      size: headingSize,
      font: bold,
      color: colors.white,
      maxWidth: contentWidth - 14,
    });
    y -= 31 * spacing;
  };

  const drawPair = (label: string, value: string, x: number, rowWidth: number) => {
    ensureRoom(19 * spacing);
    const labelWidth = Math.min(115, rowWidth * 0.42);
    page.drawText(printable(label), {
      x,
      y,
      size: bodySize - 0.5,
      font: bold,
      color: colors.muted,
      maxWidth: labelWidth,
    });
    drawWrapped(value || '-', x + labelWidth, {
      size: bodySize,
      maxWidth: rowWidth - labelWidth,
      lineGap: 12 * spacing,
    });
    y -= 3 * spacing;
  };

  addPage(true);
  const headerTop = pageHeight - 10;
  const headerBottom = pageHeight - 112;
  const contactX = pageWidth * 0.64;
  page.drawRectangle({ x: contactX, y: headerBottom, width: pageWidth - contactX, height: headerTop - headerBottom, color: colors.navy });
  page.drawLine({ start: { x: contactX - 18, y: headerBottom }, end: { x: contactX + 9, y: headerTop }, thickness: 8, color: colors.gold });
  page.drawLine({ start: { x: contactX - 26, y: headerBottom }, end: { x: contactX + 1, y: headerTop }, thickness: 5, color: colors.orange });

  if (logoImage && settings.layout.showLogo) {
    const scale = Math.min(70 / logoImage.width, 70 / logoImage.height);
    page.drawImage(logoImage, { x: margin + 4, y: pageHeight - 91, width: logoImage.width * scale, height: logoImage.height * scale });
  }
  const academyX = margin + (logoImage && settings.layout.showLogo ? 82 : 0);
  page.drawText(printable(settings.academyName), {
    x: academyX,
    y: pageHeight - 41,
    size: Math.min(settings.typography.titleSize + 2, 22),
    font: bold,
    color: colors.navy,
    maxWidth: contactX - academyX - 18,
  });
  page.drawText(printable(settings.motivationalTagline), {
    x: academyX,
    y: pageHeight - 60,
    size: 9,
    font: bold,
    color: colors.navy,
    maxWidth: contactX - academyX - 18,
  });
  page.drawText(printable(settings.phone), { x: contactX + 18, y: pageHeight - 36, size: 9, font: regular, color: colors.white, maxWidth: pageWidth - contactX - 28 });
  page.drawText(printable(settings.email), { x: contactX + 18, y: pageHeight - 57, size: 8, font: regular, color: colors.white, maxWidth: pageWidth - contactX - 28 });
  page.drawText(printable(settings.address), { x: contactX + 18, y: pageHeight - 82, size: 7, font: regular, color: colors.white, maxWidth: pageWidth - contactX - 28 });
  page.drawLine({ start: { x: 0, y: headerBottom - 5 }, end: { x: pageWidth, y: headerBottom - 5 }, thickness: 5, color: colors.orange });

  const bannerY = pageHeight - 135;
  page.drawRectangle({ x: margin, y: bannerY - 44, width: contentWidth, height: 44, color: colors.navy });
  page.drawCircle({ x: margin + 8, y: bannerY - 22, size: 8, color: colors.navy });
  page.drawCircle({ x: pageWidth - margin - 8, y: bannerY - 22, size: 8, color: colors.navy });
  page.drawCircle({ x: margin + 44, y: bannerY - 22, size: 29, color: colors.gold });
  page.drawCircle({ x: margin + 44, y: bannerY - 22, size: 22, color: colors.navy });
  page.drawLine({ start: { x: margin + 30, y: bannerY - 20 }, end: { x: margin + 58, y: bannerY - 20 }, thickness: 2, color: colors.gold });
  page.drawLine({ start: { x: margin + 31, y: bannerY - 20 }, end: { x: margin + 44, y: bannerY - 28 }, thickness: 2, color: colors.gold });
  page.drawLine({ start: { x: margin + 44, y: bannerY - 28 }, end: { x: margin + 57, y: bannerY - 20 }, thickness: 2, color: colors.gold });
  page.drawLine({ start: { x: margin + 56, y: bannerY - 20 }, end: { x: margin + 56, y: bannerY - 31 }, thickness: 1, color: colors.gold });
  page.drawText(printable(settings.heading), { x: margin + 82, y: bannerY - 27, size: settings.typography.titleSize, font: bold, color: colors.white, maxWidth: contentWidth - 98 });
  page.drawText(printable(settings.approvalMessage), { x: margin, y: bannerY - 61, size: 8, font: bold, color: colors.navy, maxWidth: 115 });
  page.drawText(printable(settings.subtitle), { x: margin + 120, y: bannerY - 61, size: bodySize, font: bold, color: colors.navy, maxWidth: contentWidth - 125 });
  if (previewOnly) {
    page.drawText('PREVIEW ONLY - NOT AN OFFICIAL STUDENT DOCUMENT', { x: margin, y: bannerY - 78, size: 7, font: bold, color: colors.orange, maxWidth: contentWidth });
  }
  if (versionNumber) {
    page.drawText(`Version ${versionNumber}`, { x: pageWidth - margin - bold.widthOfTextAtSize(`Version ${versionNumber}`, 7), y: bannerY - 78, size: 7, font: bold, color: colors.muted });
  }
  y = bannerY - (previewOnly || versionNumber ? 91 : 78);

  const drawStudent = () => {
    drawSectionTitle(settings.sectionHeadings.student);
    const photoWidth = settings.layout.showStudentPhoto ? 78 : 0;
    const photoHeight = studentPhoto && photoWidth
      ? Math.min(102, studentPhoto.height * (photoWidth / studentPhoto.width))
      : settings.layout.showStudentPhoto ? 98 : 0;
    ensureRoom(Math.max(132, photoHeight + 35));
    const blockTop = y;
    const tableX = margin + (photoWidth ? photoWidth + 16 : 0);
    const tableWidth = contentWidth - (photoWidth ? photoWidth + 16 : 0);
    const contactRows: Array<[string, string]> = student.qualificationCategory === 'Student'
      ? [
        ['Parent Phone Number', student.parentPhone || 'Not provided'],
        ['Parent Email ID', student.parentEmail || 'Not provided'],
      ]
      : [
        ['Mobile Number', student.mobile || 'Not provided'],
        ['Email ID', student.email || 'Not provided'],
      ];
    const rows: Array<[string, string]> = [
      ['Student Name', student.fullName],
      ['Qualification Category', student.qualificationCategory || 'Not provided'],
      ['Qualification', student.qualification || 'Not provided'],
      ...contactRows,
      ['Date of Birth', student.dateOfBirth || 'Not provided'],
      ['Address', student.address || 'Not provided'],
      ...(student.schoolName ? [['School', student.schoolName] as [string, string]] : []),
      ...(student.collegeName ? [['College', student.collegeName] as [string, string]] : []),
      ...(student.occupation ? [['Occupation', student.occupation] as [string, string]] : []),
      ...(student.place ? [['Place', student.place] as [string, string]] : []),
      ...(student.city ? [['City', student.city] as [string, string]] : []),
      ['Selected Program', student.programName || 'Not provided'],
    ];
    rows.forEach(([label, value], index) => {
      if (index % 2 === 0) page.drawRectangle({ x: tableX, y: y - 16, width: tableWidth, height: 16, color: colors.paleBlue });
      drawPair(label, value, tableX + 6, tableWidth - 12);
      y -= 2;
    });
    if (photoWidth) {
      const photoBottom = blockTop - photoHeight;
      if (studentPhoto) {
        page.drawImage(studentPhoto, { x: margin, y: photoBottom, width: photoWidth, height: photoHeight });
      } else {
        page.drawRectangle({ x: margin, y: photoBottom, width: photoWidth, height: photoHeight, color: colors.paleBlue });
        page.drawText('PHOTO', { x: margin + 20, y: photoBottom + photoHeight / 2, size: 9, font: bold, color: colors.muted });
      }
      page.drawRectangle({ x: margin, y: photoBottom, width: photoWidth, height: photoHeight, borderColor: colors.navy, borderWidth: 1.2 });
      page.drawRectangle({ x: margin - 4, y: photoBottom - 34, width: photoWidth + 8, height: 30, color: colors.navy });
      page.drawText('Application Reference', { x: margin + 2, y: photoBottom - 17, size: 6.5, font: regular, color: colors.white, maxWidth: photoWidth - 4 });
      page.drawText(printable(student.applicationNumber), { x: margin + 2, y: photoBottom - 29, size: 7, font: bold, color: colors.gold, maxWidth: photoWidth - 4 });
      y = Math.min(y, photoBottom - 42);
    }
    if (student.studentId) drawPair('Student ID', student.studentId, margin, contentWidth);
    y -= 8 * spacing;
  };

  const drawCourse = () => {
    drawSectionTitle(settings.sectionHeadings.course);
    if (!course) {
      drawWrapped('No selected course information is available for this application.');
      return;
    }
    page.drawRectangle({
      x: margin,
      y: y - 60,
      width: contentWidth,
      height: 60,
      color: colors.paleBlue,
      borderColor: colors.navy,
      borderWidth: 0.7,
    });
    page.drawText(printable(course.name), {
      x: margin + 12,
      y: y - 19,
      size: 12,
      font: bold,
      color: colors.navy,
      maxWidth: contentWidth - 24,
    });
    page.drawText(
      printable([`Duration: ${course.duration || 'Not configured'}`, `Course Mode: ${course.mode || 'Not configured'}`].join('  |  ')),
      {
        x: margin + 12,
        y: y - 39,
        size: bodySize,
        font: regular,
        color: colors.muted,
        maxWidth: contentWidth - 24,
      },
    );
    y -= 71 * spacing;
  };

  const drawJoining = () => {
    drawSectionTitle(settings.sectionHeadings.joining);
    const instructions = settings.joiningInstructions || [];
    if (instructions.length) {
      for (const [index, instruction] of instructions.entries()) {
        ensureRoom(18 * spacing);
        page.drawCircle({ x: margin + 9, y: y + 2, size: 7, color: colors.orange });
        page.drawText(`${index + 1}`, { x: margin + 6.5, y: y - 1, size: 7, font: bold, color: colors.white });
        y = drawWrapped(instruction, margin + 22, { maxWidth: contentWidth - 22 });
      }
    } else {
      drawWrapped('No joining instructions are configured.');
    }
    if (joiningInformation) {
      drawPair('Joining date', joiningInformation.joiningDate, margin, contentWidth);
      drawPair('Class schedule', joiningInformation.classSchedule, margin, contentWidth);
      drawPair('Class timings', joiningInformation.classTimings, margin, contentWidth);
      drawPair('Venue', joiningInformation.venue, margin, contentWidth);
    }
  };

  const wrapTextLines = (value: string, font: PDFFont, size: number, maxWidth: number): string[] => {
    const lines: string[] = [];
    let line = '';
    const words = printable(value).split(/\s+/).filter(Boolean);
    for (const word of words) {
      let parts = [word];
      if (font.widthOfTextAtSize(word, size) > maxWidth) {
        parts = [];
        let part = '';
        for (const character of word) {
          if (part && font.widthOfTextAtSize(`${part}${character}`, size) > maxWidth) {
            parts.push(part);
            part = character;
          } else {
            part += character;
          }
        }
        if (part) parts.push(part);
      }
      for (const part of parts) {
        const candidate = line ? `${line} ${part}` : part;
        if (line && font.widthOfTextAtSize(candidate, size) > maxWidth) {
          lines.push(line);
          line = part;
        } else {
          line = candidate;
        }
      }
    }
    if (line) lines.push(line);
    return lines.length ? lines : [''];
  };

  const sectionDrawers: Record<OfficialSection, () => void> = {
    student: drawStudent,
    course: drawCourse,
    joining: drawJoining,
  };
  const visibleOrder = settings.layout.sectionOrder.filter((section) =>
    settings.layout.visibleSections.includes(section),
  );
  for (let index = 0; index < visibleOrder.length; index += 1) {
    const section = visibleOrder[index];
    sectionDrawers[section]();
  }

  if (settings.welcomeMessage) {
    drawWrapped(settings.welcomeMessage, margin, { color: colors.muted, size: bodySize - 0.25 });
  }

  if (settings.layout.showFooter) {
    pages.forEach((currentPage, index) => {
      currentPage.drawRectangle({ x: 0, y: 0, width: pageWidth, height: 34, color: colors.navy });
      currentPage.drawRectangle({ x: 0, y: 34, width: pageWidth, height: 4, color: colors.orange });
      const footerY = 13;
      currentPage.drawText(printable(settings.footerText || settings.academyName), {
        x: margin,
        y: footerY,
        size: 7.5,
        font: regular,
        color: colors.white,
        maxWidth: contentWidth - 70,
      });
      const pageLabel = `${index + 1} / ${pages.length}`;
      currentPage.drawText(pageLabel, {
        x: pageWidth - margin - bold.widthOfTextAtSize(pageLabel, 7.5),
        y: footerY,
        size: 7.5,
        font: bold,
        color: colors.white,
      });
    });
    const finalPage = pages[pages.length - 1];
    if (finalPage) {
      finalPage.drawText('Best Wishes!', { x: margin, y: 53, size: 12, font: bold, color: colors.navy });
      finalPage.drawText(printable(settings.academyName), { x: margin, y: 40, size: 8, font: bold, color: colors.navy, maxWidth: contentWidth * 0.62 });
      finalPage.drawText(printable(settings.motivationalTagline), { x: margin, y: 27, size: 7, font: regular, color: colors.white, maxWidth: contentWidth - 80 });
      if (decorativeGraphic && settings.layout.showDecorations) {
        const scale = Math.min(74 / decorativeGraphic.width, 45 / decorativeGraphic.height);
        finalPage.drawImage(decorativeGraphic, {
          x: pageWidth - margin - decorativeGraphic.width * scale,
          y: 40,
          width: decorativeGraphic.width * scale,
          height: decorativeGraphic.height * scale,
        });
      }
    }
  }

  return pdf.save();
}

export const isValidOfficialDocumentSettings = (
  value: unknown,
): value is OfficialDocumentSettings => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const settings = value as Partial<OfficialDocumentSettings>;
  const isHexColor = (color: unknown): color is string =>
    typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color);
  const sections: OfficialSection[] = ['student', 'course', 'joining'];
  return typeof settings.academyName === 'string' &&
    typeof settings.address === 'string' &&
    typeof settings.phone === 'string' &&
    typeof settings.email === 'string' &&
    typeof settings.heading === 'string' &&
    typeof settings.subtitle === 'string' &&
    typeof settings.approvalMessage === 'string' &&
    typeof settings.welcomeMessage === 'string' &&
    typeof settings.footerText === 'string' &&
    typeof settings.motivationalTagline === 'string' &&
    Array.isArray(settings.joiningInstructions ?? []) &&
    (settings.joiningInstructions ?? []).every((instruction) => typeof instruction === 'string') &&
    settings.sectionHeadings !== undefined &&
    sections.every((section) => typeof settings.sectionHeadings?.[section] === 'string') &&
    settings.colors !== undefined &&
    isHexColor(settings.colors.orange) &&
    isHexColor(settings.colors.green) &&
    isHexColor(settings.colors.navy) &&
    isHexColor(settings.colors.background) &&
    settings.typography !== undefined &&
    ['Helvetica', 'TimesRoman', 'Courier'].includes(settings.typography.fontFamily) &&
    Number.isFinite(settings.typography.titleSize) &&
    Number.isFinite(settings.typography.headingSize) &&
    Number.isFinite(settings.typography.bodySize) &&
    settings.layout !== undefined &&
    ['A4', 'Letter'].includes(settings.layout.pageSize) &&
    Number.isFinite(settings.layout.spacing) &&
    typeof settings.layout.showLogo === 'boolean' &&
    typeof settings.layout.showStudentPhoto === 'boolean' &&
    typeof settings.layout.showDecorations === 'boolean' &&
    typeof settings.layout.showFooter === 'boolean' &&
    Array.isArray(settings.layout.visibleSections) &&
    settings.layout.visibleSections.every((section) => sections.includes(section)) &&
    Array.isArray(settings.layout.sectionOrder) &&
    settings.layout.sectionOrder.length === sections.length &&
    settings.layout.sectionOrder.every((section) => sections.includes(section)) &&
    (settings.logoObjectKey === null || typeof settings.logoObjectKey === 'string') &&
    (settings.graphicObjectKey === null || typeof settings.graphicObjectKey === 'string');
};

export const mergeOfficialDocumentSettings = (
  value: unknown,
): OfficialDocumentSettings | null => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const saved = value as Record<string, unknown>;
  const savedWithoutLegacyCourses = { ...saved };
  for (const legacyField of [
    'courses',
    'terms',
    'paymentInstructions',
    'paymentMethods',
    'bankDetails',
    'additionalPaymentNotes',
  ]) {
    delete savedWithoutLegacyCourses[legacyField];
  }
  const sectionHeadings = saved.sectionHeadings && typeof saved.sectionHeadings === 'object'
    ? saved.sectionHeadings as Record<string, unknown>
    : {};
  const savedLayout = saved.layout && typeof saved.layout === 'object'
    ? saved.layout as Record<string, unknown>
    : {};
  const sections: OfficialSection[] = ['student', 'course', 'joining'];
  const visibleSections = Array.isArray(savedLayout.visibleSections)
    ? savedLayout.visibleSections.filter((section): section is OfficialSection => sections.includes(section as OfficialSection))
    : DEFAULT_OFFICIAL_DOCUMENT_SETTINGS.layout.visibleSections;
  const orderedSections = Array.isArray(savedLayout.sectionOrder)
    ? savedLayout.sectionOrder.filter((section): section is OfficialSection => sections.includes(section as OfficialSection))
    : [];
  const sectionOrder = orderedSections.length === sections.length
    ? orderedSections
    : DEFAULT_OFFICIAL_DOCUMENT_SETTINGS.layout.sectionOrder;
  const merged: OfficialDocumentSettings = {
    ...DEFAULT_OFFICIAL_DOCUMENT_SETTINGS,
    ...savedWithoutLegacyCourses,
    sectionHeadings: {
      ...DEFAULT_OFFICIAL_DOCUMENT_SETTINGS.sectionHeadings,
      student: typeof sectionHeadings.student === 'string' ? sectionHeadings.student : DEFAULT_OFFICIAL_DOCUMENT_SETTINGS.sectionHeadings.student,
      course: typeof sectionHeadings.course === 'string' ? sectionHeadings.course : DEFAULT_OFFICIAL_DOCUMENT_SETTINGS.sectionHeadings.course,
      joining: typeof sectionHeadings.joining === 'string' ? sectionHeadings.joining : DEFAULT_OFFICIAL_DOCUMENT_SETTINGS.sectionHeadings.joining,
    },
    joiningInstructions: Array.isArray(saved.joiningInstructions)
      ? saved.joiningInstructions as string[]
      : [],
    colors: {
      ...DEFAULT_OFFICIAL_DOCUMENT_SETTINGS.colors,
      ...(saved.colors && typeof saved.colors === 'object' ? saved.colors : {}),
    },
    typography: {
      ...DEFAULT_OFFICIAL_DOCUMENT_SETTINGS.typography,
      ...(saved.typography && typeof saved.typography === 'object' ? saved.typography : {}),
    },
    layout: {
      ...DEFAULT_OFFICIAL_DOCUMENT_SETTINGS.layout,
      ...savedLayout,
      visibleSections,
      sectionOrder,
    },
    logoObjectKey: typeof saved.logoObjectKey === 'string' ? saved.logoObjectKey : null,
    graphicObjectKey: typeof saved.graphicObjectKey === 'string' ? saved.graphicObjectKey : null,
  };
  return isValidOfficialDocumentSettings(merged) ? merged : null;
};
