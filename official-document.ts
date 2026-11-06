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
    orange: '#FF6B00',
    green: '#123B78',
    navy: '#123B78',
    background: '#FFFFFF',
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
    orange: colorFromHex('#FF6B00'),
    navy: colorFromHex('#123B78'),
    background: rgb(1, 1, 1),
    white: rgb(1, 1, 1),
    ink: colorFromHex('#142B50'),
    muted: rgb(0.2, 0.27, 0.36),
    line: rgb(0.85, 0.89, 0.94),
    paleBlue: colorFromHex('#F4F7FC'),
    lightBlue: colorFromHex('#EAF3FF'),
  };
  const [pageWidth, pageHeight] = pageDimensions(settings.layout.pageSize);
  const margin = 38;
  const contentWidth = pageWidth - margin * 2;
  const spacing = Math.max(0.85, Math.min(settings.layout.spacing, 1.25));
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
      target.drawRectangle({ x: 0, y: pageHeight - 5, width: pageWidth, height: 5, color: colors.navy });
      target.drawRectangle({ x: 0, y: pageHeight - 8, width: pageWidth, height: 3, color: colors.orange });
    }
  };

  const addPage = (firstPage = false) => {
    page = pdf.addPage([pageWidth, pageHeight]);
    pages.push(page);
    paintPage(page);
    y = pageHeight - (firstPage ? 139 : 67);
    if (!firstPage) {
      page.drawText(printable(settings.academyName), {
        x: margin,
        y: pageHeight - 32,
        size: 8.5,
        font: bold,
        color: colors.navy,
        maxWidth: contentWidth,
      });
      page.drawLine({
        start: { x: margin, y: pageHeight - 41 },
        end: { x: pageWidth - margin, y: pageHeight - 41 },
        thickness: 0.8,
        color: colors.line,
      });
    }
  };

  const ensureRoom = (height: number) => {
    if (y - height < margin + 47) addPage();
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
    ensureRoom(34);
    y -= 3 * spacing;
    page.drawRectangle({
      x: margin,
      y: y - 19,
      width: contentWidth,
      height: 22,
      color: colors.paleBlue,
    });
    page.drawRectangle({ x: margin, y: y - 19, width: 3, height: 22, color: colors.orange });
    page.drawText(printable(title), {
      x: margin + 11,
      y: y - 13,
      size: headingSize,
      font: bold,
      color: colors.navy,
      maxWidth: contentWidth - 22,
    });
    y -= 27 * spacing;
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

  const drawPair = (label: string, value: string, x: number, rowWidth: number, shaded = false) => {
    const labelWidth = Math.min(126, rowWidth * 0.38);
    const labelSize = Math.max(8, bodySize - 0.5);
    const valueX = x + labelWidth;
    const valueWidth = rowWidth - labelWidth - 8;
    const labelLines = wrapTextLines(label, bold, labelSize, labelWidth - 8);
    const valueLines = wrapTextLines(value || '-', regular, bodySize, valueWidth);
    const lineGap = Math.max(11, bodySize * 1.35) * spacing;
    const rowHeight = Math.max(labelLines.length, valueLines.length) * lineGap + 7;
    ensureRoom(rowHeight + 2);
    if (shaded) {
      page.drawRectangle({
        x,
        y: y - rowHeight + 3,
        width: rowWidth,
        height: rowHeight,
        color: colors.paleBlue,
      });
    }
    labelLines.forEach((line, index) => {
      page.drawText(line, {
        x: x + 5,
        y: y - 2 - index * lineGap,
        size: labelSize,
        font: bold,
        color: colors.muted,
      });
    });
    valueLines.forEach((line, index) => {
      page.drawText(line, {
        x: valueX,
        y: y - 2 - index * lineGap,
        size: bodySize,
        font: regular,
        color: colors.ink,
      });
    });
    y -= rowHeight + 2;
  };

  addPage(true);
  const headerBottom = pageHeight - 94;
  if (logoImage) {
    const scale = Math.min(66 / logoImage.width, 58 / logoImage.height);
    page.drawImage(logoImage, {
      x: margin + 4,
      y: pageHeight - 78 + (58 - logoImage.height * scale) / 2,
      width: logoImage.width * scale,
      height: logoImage.height * scale,
    });
  }
  const academyX = margin + (logoImage ? 80 : 0);
  page.drawText(printable(settings.academyName), {
    x: academyX,
    y: pageHeight - 39,
    size: Math.min(settings.typography.titleSize + 1, 21),
    font: bold,
    color: colors.navy,
    maxWidth: pageWidth - margin - academyX,
  });
  page.drawText(printable(settings.motivationalTagline), {
    x: academyX,
    y: pageHeight - 55,
    size: 8.5,
    font: bold,
    color: colors.orange,
    maxWidth: pageWidth - margin - academyX,
  });
  page.drawText('DAVANGERE - KARNATAKA', {
    x: academyX,
    y: pageHeight - 71,
    size: 8,
    font: regular,
    color: colors.muted,
    maxWidth: pageWidth - margin - academyX,
  });
  page.drawRectangle({
    x: margin,
    y: headerBottom + 1,
    width: contentWidth,
    height: 2,
    color: colors.lightBlue,
  });
  page.drawRectangle({
    x: margin,
    y: headerBottom,
    width: contentWidth,
    height: 1,
    color: colors.orange,
  });

  const bannerY = pageHeight - 108;
  page.drawRectangle({ x: margin, y: bannerY - 37, width: contentWidth, height: 37, color: colors.navy });
  page.drawRectangle({ x: margin, y: bannerY - 37, width: 4, height: 37, color: colors.orange });
  page.drawText(printable(settings.heading), {
    x: margin + 14,
    y: bannerY - 16,
    size: settings.typography.titleSize,
    font: bold,
    color: colors.white,
    maxWidth: contentWidth - 28,
  });
  page.drawText(printable(settings.approvalMessage), {
    x: margin + 14,
    y: bannerY - 30,
    size: 7.5,
    font: bold,
    color: colors.white,
    maxWidth: contentWidth - 28,
  });
  page.drawText(printable(settings.subtitle), {
    x: margin,
    y: bannerY - 52,
    size: Math.min(bodySize, 9),
    font: regular,
    color: colors.muted,
    maxWidth: contentWidth,
  });
  if (previewOnly) {
    page.drawText('PREVIEW ONLY - NOT AN OFFICIAL STUDENT DOCUMENT', {
      x: margin,
      y: bannerY - 66,
      size: 7,
      font: bold,
      color: colors.orange,
      maxWidth: contentWidth,
    });
  }
  y = bannerY - (previewOnly ? 79 : 65);

  const drawStudent = () => {
    drawSectionTitle(settings.sectionHeadings.student);
    const studentPage = page;
    const photo = settings.layout.showStudentPhoto ? studentPhoto : null;
    const photoWidth = photo ? 74 : 0;
    const photoHeight = photo ? 96 : 0;
    ensureRoom(photoWidth ? photoHeight + 24 : 38);
    const blockTop = y;
    const tableX = margin + (photoWidth ? photoWidth + 14 : 0);
    const tableWidth = contentWidth - (photoWidth ? photoWidth + 14 : 0);
    const photoBottom = photoWidth ? blockTop - photoHeight : 0;
    if (photo) {
      const photoScale = Math.min(photoWidth / photo.width, photoHeight / photo.height);
      const fittedWidth = photo.width * photoScale;
      const fittedHeight = photo.height * photoScale;
      page.drawImage(photo, {
        x: margin + (photoWidth - fittedWidth) / 2,
        y: photoBottom + (photoHeight - fittedHeight) / 2,
        width: fittedWidth,
        height: fittedHeight,
      });
      page.drawRectangle({ x: margin, y: photoBottom, width: photoWidth, height: photoHeight, borderColor: colors.navy, borderWidth: 1.2 });
    }
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
      ['Application Reference', student.applicationNumber],
      ...(student.studentId ? [['Student ID', student.studentId] as [string, string]] : []),
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
      drawPair(label, value, tableX, tableWidth, index % 2 === 0);
    });
    if (photoWidth) {
      if (page === studentPage) y = Math.min(y, photoBottom - 8);
    }
    y -= 8 * spacing;
  };

  const drawCourse = () => {
    drawSectionTitle(settings.sectionHeadings.course);
    if (!course) {
      drawWrapped('No selected course information is available for this application.');
      return;
    }
    const courseNameLines = wrapTextLines(course.name, bold, 12, contentWidth - 24);
    const courseDetails = [
      `Duration: ${course.duration || 'Not configured'}`,
      `Course Mode: ${course.mode || 'Not configured'}`,
      `Level: ${course.level || 'Not configured'}`,
    ].join('  |  ');
    const detailLines = wrapTextLines(courseDetails, regular, bodySize, contentWidth - 24);
    const cardHeight = 24 + courseNameLines.length * 15 + detailLines.length * 13;
    ensureRoom(cardHeight + 8);
    page.drawRectangle({
      x: margin,
      y: y - cardHeight,
      width: contentWidth,
      height: cardHeight,
      color: colors.paleBlue,
    });
    page.drawRectangle({ x: margin, y: y - cardHeight, width: 3, height: cardHeight, color: colors.orange });
    let courseY = y - 17;
    courseNameLines.forEach((line) => {
      page.drawText(line, {
        x: margin + 12,
        y: courseY,
        size: 12,
        font: bold,
        color: colors.navy,
      });
      courseY -= 15;
    });
    detailLines.forEach((line) => {
      page.drawText(line, {
        x: margin + 12,
        y: courseY,
        size: bodySize,
        font: regular,
        color: colors.muted,
      });
      courseY -= 13;
    });
    y -= cardHeight + 10 * spacing;
  };

  const drawJoining = () => {
    drawSectionTitle(settings.sectionHeadings.joining);
    const instructions = settings.joiningInstructions || [];
    if (instructions.length) {
      for (const [index, instruction] of instructions.entries()) {
        const lines = wrapTextLines(instruction, regular, bodySize, contentWidth - 22);
        const lineGap = bodySize * 1.45 * spacing;
        const instructionHeight = lines.length * lineGap;
        ensureRoom(Math.min(instructionHeight, pageHeight - margin * 2) + 4);
        page.drawCircle({ x: margin + 9, y: y + 1, size: 7, color: colors.orange });
        page.drawText(`${index + 1}`, { x: margin + 6.5, y: y - 2, size: 7, font: bold, color: colors.white });
        lines.forEach((line) => {
          ensureRoom(lineGap);
          page.drawText(line, {
            x: margin + 22,
            y,
            size: bodySize,
            font: regular,
            color: colors.ink,
          });
          y -= lineGap;
        });
        y -= 3 * spacing;
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
      currentPage.drawRectangle({ x: 0, y: 0, width: pageWidth, height: 43, color: colors.paleBlue });
      currentPage.drawRectangle({ x: 0, y: 43, width: pageWidth, height: 2, color: colors.navy });
      currentPage.drawRectangle({ x: 0, y: 40, width: pageWidth, height: 2, color: colors.orange });
      currentPage.drawText(printable(settings.academyName), {
        x: margin,
        y: 30,
        size: 8,
        font: bold,
        color: colors.navy,
        maxWidth: contentWidth - 64,
      });
      currentPage.drawText(printable(settings.motivationalTagline), {
        x: margin,
        y: 18,
        size: 7,
        font: regular,
        color: colors.orange,
        maxWidth: contentWidth - 100,
      });
      currentPage.drawText(`${printable(settings.footerText || 'Davangere, Karnataka')}  |  https://uptrendsenglishacademy.in`, {
        x: margin,
        y: 6,
        size: 6.5,
        font: regular,
        color: colors.muted,
        maxWidth: contentWidth - 82,
      });
      const pageLabel = `Page ${index + 1} of ${pages.length}`;
      currentPage.drawText(pageLabel, {
        x: pageWidth - margin - bold.widthOfTextAtSize(pageLabel, 7.5),
        y: 7,
        size: 7.5,
        font: bold,
        color: colors.navy,
      });
      if (decorativeGraphic && settings.layout.showDecorations) {
        const scale = Math.min(40 / decorativeGraphic.width, 22 / decorativeGraphic.height);
        currentPage.drawImage(decorativeGraphic, {
          x: pageWidth - margin - 52 - decorativeGraphic.width * scale,
          y: 16,
          width: decorativeGraphic.width * scale,
          height: decorativeGraphic.height * scale,
        });
      }
    });
  } else {
    pages.forEach((currentPage, index) => {
      const pageLabel = `Page ${index + 1} of ${pages.length}`;
      currentPage.drawText(pageLabel, {
        x: pageWidth - margin - bold.widthOfTextAtSize(pageLabel, 7.5),
        y: margin / 2,
        size: 7.5,
        font: bold,
        color: colors.navy,
      });
    });
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
