import {
  PDFDocument,
  PDFName,
  PDFString,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFImage,
  type PDFPage,
} from 'pdf-lib';
import { SOCIAL_LINKS } from './src/lib/socialLinks';

export type OfficialFontFamily = 'Helvetica' | 'TimesRoman' | 'Courier';
export type OfficialPageSize = 'A4' | 'Letter';
export type OfficialSection = 'student' | 'course' | 'joining';

export interface OfficialTermAndCondition {
  id: string;
  title: string;
  description: string;
  displayOrder: number;
  isActive: boolean;
}

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
  termsAndConditions: OfficialTermAndCondition[];
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
  admissionDate?: string | null;
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
  termsAndConditions: [],
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
    orange: colorFromHex(settings.colors.orange),
    navy: colorFromHex(settings.colors.navy),
    background: rgb(1, 1, 1),
    white: rgb(1, 1, 1),
    ink: colorFromHex('#142B50'),
    muted: rgb(0.25, 0.32, 0.42),
    line: rgb(0.70, 0.76, 0.84),
    paleBlue: colorFromHex('#F4F7FC'),
    lightBlue: colorFromHex('#EAF3FF'),
  };
  const [pageWidth, pageHeight] = pageDimensions(settings.layout.pageSize);
  const margin = 28;
  const contentWidth = pageWidth - margin * 2;
  const footerHeight = settings.layout.showFooter ? 124 : 0;
  const spacing = Math.max(0.85, Math.min(settings.layout.spacing, 1.25));
  const bodySize = settings.typography.bodySize;
  const headingSize = settings.typography.headingSize;
  const pages: PDFPage[] = [];
  let page!: PDFPage;
  let y: number;
  let logoImage: PDFImage | null = null;
  let studentPhoto: PDFImage | null = null;
  let decorativeGraphic: PDFImage | null = null;

  if (assets?.logo && settings.layout.showLogo) {
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
      target.drawRectangle({ x: 0, y: pageHeight - 7, width: pageWidth, height: 7, color: colors.lightBlue });
      target.drawRectangle({ x: 0, y: pageHeight - 8.5, width: pageWidth, height: 1.5, color: colors.orange });
    }
  };

  const addPage = (firstPage = false) => {
    page = pdf.addPage([pageWidth, pageHeight]);
    pages.push(page);
    paintPage(page);
    y = pageHeight - (firstPage ? 153 : 72);
    if (!firstPage) {
      if (logoImage) {
        const scale = Math.min(34 / logoImage.width, 25 / logoImage.height);
        page.drawImage(logoImage, {
          x: margin,
          y: pageHeight - 43 + (25 - logoImage.height * scale) / 2,
          width: logoImage.width * scale,
          height: logoImage.height * scale,
        });
      }
      page.drawText(printable(settings.academyName), {
        x: margin + (logoImage ? 42 : 0),
        y: pageHeight - 31,
        size: 9.5,
        font: bold,
        color: colors.navy,
        maxWidth: contentWidth - 110,
      });
      page.drawText('OFFICIAL ADMISSION DOCUMENT', {
        x: pageWidth - margin - bold.widthOfTextAtSize('OFFICIAL ADMISSION DOCUMENT', 6.5),
        y: pageHeight - 31,
        size: 6.5,
        font: bold,
        color: colors.orange,
      });
      page.drawLine({
        start: { x: margin, y: pageHeight - 53 },
        end: { x: pageWidth - margin, y: pageHeight - 53 },
        thickness: 1.1,
        color: colors.orange,
      });
    }
  };

  const ensureRoom = (height: number) => {
    if (y - height < margin + (settings.layout.showFooter ? footerHeight + 8 : 10)) addPage();
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
    ensureRoom(32);
    page.drawRectangle({ x: margin, y: y - 15, width: 3, height: 17, color: colors.orange });
    page.drawText(printable(title), {
      x: margin + 11,
      y: y - 12,
      size: Math.max(headingSize, 10),
      font: bold,
      color: colors.navy,
      maxWidth: contentWidth - 22,
    });
    page.drawLine({
      start: { x: margin + 11, y: y - 19 },
      end: { x: pageWidth - margin, y: y - 19 },
      thickness: 0.6,
      color: colors.line,
    });
    y -= 22 * spacing;
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

  const drawRoundedRect = (
    target: PDFPage,
    x: number,
    bottom: number,
    width: number,
    height: number,
    radius: number,
    fill?: ReturnType<typeof rgb>,
    border?: ReturnType<typeof rgb>,
    borderWidth = 0.6,
  ) => {
    const r = Math.min(radius, width / 2, height / 2);
    const path = `M ${r} 0 H ${width - r} Q ${width} 0 ${width} ${r} V ${height - r} Q ${width} ${height} ${width - r} ${height} H ${r} Q 0 ${height} 0 ${height - r} V ${r} Q 0 0 ${r} 0 Z`;
    target.drawSvgPath(path, {
      x,
      y: bottom + height,
      ...(fill ? { color: fill } : {}),
      ...(border ? { borderColor: border, borderWidth } : {}),
    });
  };

  const drawIcon = (
    target: PDFPage,
    type: 'student' | 'course' | 'joining' | 'terms',
    x: number,
    y: number,
    size: number,
    color: ReturnType<typeof rgb>,
  ) => {
    const scale = size / 24;
    if (type === 'student') {
      target.drawSvgPath('M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8M4 22c0-4.4 3.6-8 8-8s8 3.6 8 8Z', {
        x,
        y: y + size,
        scale,
        color,
      });
    } else if (type === 'course') {
      target.drawSvgPath('M1 8 12 2 23 8 12 14Z M5 10 12 14 19 10V16C15 20 9 20 5 16Z', {
        x,
        y: y + size,
        scale,
        color,
      });
    } else if (type === 'joining') {
      drawRoundedRect(target, x + size * 0.17, y + size * 0.12, size * 0.66, size * 0.72, 2, undefined, color, 1);
      target.drawLine({
        start: { x: x + size * 0.18, y: y + size * 0.57 },
        end: { x: x + size * 0.82, y: y + size * 0.57 },
        thickness: 1,
        color,
      });
      [0.37, 0.57, 0.77].forEach((ratio) => target.drawLine({
        start: { x: x + size * ratio, y: y + size * 0.13 },
        end: { x: x + size * ratio, y: y + size * 0.27 },
        thickness: 1.2,
        color,
      }));
      [0.33, 0.5, 0.67].forEach((ratio) => target.drawCircle({
        x: x + size * ratio,
        y: y + size * 0.4,
        size: 0.7,
        color,
      }));
    } else {
      drawRoundedRect(target, x + size * 0.17, y + size * 0.08, size * 0.66, size * 0.82, 2, undefined, color, 1);
      [0.34, 0.52, 0.7].forEach((ratio) => target.drawLine({
        start: { x: x + size * 0.34, y: y + size * ratio },
        end: { x: x + size * 0.7, y: y + size * ratio },
        thickness: 1,
        color,
      }));
    }
  };

  const drawSectionBar = (
    target: PDFPage,
    top: number,
    title: string,
    icon: 'student' | 'course' | 'joining' | 'terms',
  ) => {
    const label = printable(title);
    const barHeight = 21;
    const barBottom = top - 17;
    const barWidth = Math.min(
      contentWidth * 0.58,
      Math.max(175, bold.widthOfTextAtSize(label, 9.5) + 52),
    );
    drawRoundedRect(target, margin, barBottom, barWidth, barHeight, 7, colors.navy);
    if (settings.layout.showDecorations) {
      target.drawSvgPath('M0 0H9C14 0 12 5 17 10C14 14 14 18 9 21H0C4 16 4 5 0 0Z', {
        x: margin + barWidth - 16,
        y: barBottom + barHeight,
        color: colors.orange,
      });
    }
    drawIcon(target, icon, margin + 7, barBottom + 3, 15, colors.white);
    target.drawText(label, {
      x: margin + 29,
      y: barBottom + 6.2,
      size: 9.5,
      font: bold,
      color: colors.white,
      maxWidth: barWidth - 40,
    });
  };

  const drawSectionFrame = (
    target: PDFPage,
    top: number,
    bottom: number,
    title: string,
    icon: 'student' | 'course' | 'joining' | 'terms',
  ) => {
    drawRoundedRect(target, margin, bottom, contentWidth, top - bottom, 7, undefined, colors.navy, 0.65);
    drawSectionBar(target, top, title, icon);
  };

  const addSocialLink = (target: PDFPage, x: number, y: number, size: number, url: string, label: string) => {
    const action = pdf.context.obj({
      Type: PDFName.of('Action'),
      S: PDFName.of('URI'),
      URI: PDFString.of(url),
      NewWindow: true,
    });
    const annotation = pdf.context.obj({
      Type: PDFName.of('Annot'),
      Subtype: PDFName.of('Link'),
      Rect: [x, y, x + size, y + size],
      Border: [0, 0, 0],
      F: 4,
      Contents: PDFString.of(label),
      A: action,
    });
    target.node.addAnnot(pdf.context.register(annotation));
  };

  const drawSocialIcon = (
    target: PDFPage,
    link: (typeof SOCIAL_LINKS)[number],
    x: number,
    y: number,
    size: number,
  ) => {
    const iconColor = link.color === 'instagram' ? colorFromHex('#C13584') : colorFromHex(link.color);
    const scale = size / 24;
    target.drawSvgPath(link.path, {
      x,
      y: y + size,
      scale,
      color: iconColor,
    });
    if (link.name === 'YouTube' && link.playPath) {
      target.drawSvgPath(link.playPath, {
        x,
        y: y + size,
        scale,
        color: colors.white,
      });
    }
    addSocialLink(target, x, y, size, link.url, `Visit us on ${link.name}`);
  };

  const drawInfoGridRow = (
    fields: Array<{ label: string; value: string }>,
    x = margin,
    rowWidth = contentWidth,
  ) => {
    const gap = 8;
    const cellWidth = fields.length === 1 ? rowWidth : (rowWidth - gap) / 2;
    const labelSize = 6.5;
    const valueSize = Math.max(8, bodySize);
    const lineGap = Math.max(9, valueSize * 1.17) * spacing;
    const cells = fields.map((field) => ({
      ...field,
      labelLines: wrapTextLines(field.label.toUpperCase(), bold, labelSize, cellWidth - 18),
      valueLines: wrapTextLines(field.value || '-', regular, valueSize, cellWidth - 18),
    }));
    const rowHeight = Math.max(
      31,
      ...cells.map((cell) => 13 + cell.labelLines.length * 6.5 + cell.valueLines.length * lineGap),
    );
    ensureRoom(rowHeight + 5);
    cells.forEach((cell, index) => {
      const cellX = x + index * (cellWidth + gap);
      page.drawRectangle({
        x: cellX,
        y: y - rowHeight,
        width: cellWidth,
        height: rowHeight,
        color: colors.paleBlue,
        borderColor: colors.line,
        borderWidth: 0.45,
      });
      cell.labelLines.forEach((line, lineIndex) => {
        page.drawText(line, {
          x: cellX + 9,
          y: y - 10 - lineIndex * 6.5,
          size: labelSize,
          font: bold,
          color: colors.muted,
        });
      });
      cell.valueLines.forEach((line, lineIndex) => {
        page.drawText(line, {
          x: cellX + 9,
          y: y - 20 - lineIndex * lineGap,
          size: valueSize,
          font: regular,
          color: colors.ink,
        });
      });
    });
    y -= rowHeight + 4;
  };

  addPage(true);
  const academyName = "Uptrend's English Academy";
  const graphicScale = 1.3;
  const graphicInset = 4 * graphicScale;
  const graphicWidth = decorativeGraphic ? 142 * graphicScale : 0;
  const graphicHeight = decorativeGraphic ? 78 * graphicScale : 0;
  const graphicX = pageWidth - margin - graphicWidth;
  const academyX = margin + (logoImage ? 108 : 0);
  const academyMaxWidth = Math.max(150, pageWidth - margin - academyX - graphicWidth - (decorativeGraphic ? 12 : 0));
  const academyNameFontSize = Math.min(
    18,
    18 * (academyMaxWidth - 1) / bold.widthOfTextAtSize(academyName, 18),
  );
  const academyNameY = pageHeight - 38;
  const academyNameTop = academyNameY + bold.heightAtSize(academyNameFontSize, { descender: false });
  // The configured academy logo has transparent padding above its visible artwork.
  const logoArtworkTopPadding = 7.56;
  const headerTextWidth = contentWidth - graphicWidth - (decorativeGraphic ? 12 : 0);
  if (logoImage) {
    const scale = Math.min(88 / logoImage.width, 60 / logoImage.height);
    const fittedWidth = logoImage.width * scale;
    const fittedHeight = logoImage.height * scale;
    page.drawImage(logoImage, {
      x: margin + (98 - fittedWidth) / 2,
      y: academyNameTop + logoArtworkTopPadding - fittedHeight,
      width: fittedWidth,
      height: fittedHeight,
    });
  }
  page.drawText(academyName, {
    x: academyX,
    y: academyNameY,
    size: academyNameFontSize,
    font: bold,
    color: colors.navy,
  });
  page.drawText(printable(settings.motivationalTagline), {
    x: academyX,
    y: pageHeight - 59,
    size: 8,
    font: bold,
    color: colors.orange,
    maxWidth: academyMaxWidth,
  });
  if (decorativeGraphic) {
    const scale = Math.min(
      (graphicWidth - graphicInset * 2) / decorativeGraphic.width,
      (graphicHeight - graphicInset * 2) / decorativeGraphic.height,
    );
    const fittedWidth = decorativeGraphic.width * scale;
    const fittedHeight = decorativeGraphic.height * scale;
    page.drawImage(decorativeGraphic, {
      x: graphicX + (graphicWidth - fittedWidth) / 2,
      y: pageHeight - 30 - graphicHeight + graphicInset + (graphicHeight - graphicInset * 2 - fittedHeight) / 2,
      width: fittedWidth,
      height: fittedHeight,
    });
  }
  const addressLines = wrapTextLines(settings.address, regular, 7.3, headerTextWidth);
  addressLines.slice(0, 2).forEach((line, index) => {
    page.drawText(line, {
      x: margin + 2,
      y: pageHeight - 105 - index * 9,
      size: 7.3,
      font: regular,
      color: colors.ink,
      maxWidth: headerTextWidth,
    });
  });
  const contactLine = [settings.phone, settings.email].filter(Boolean).join('   |   ');
  const contactY = pageHeight - (addressLines.length > 1 ? 128 : 119);
  page.drawText(printable(contactLine), {
    x: margin + 2,
    y: contactY,
    size: 7.2,
    font: bold,
    color: colors.navy,
    maxWidth: headerTextWidth,
  });
  page.drawText('https://uptrendsenglishacademy.in', {
    x: margin + 2,
    y: contactY - 9,
    size: 7.2,
    font: regular,
    color: colors.navy,
    maxWidth: headerTextWidth,
  });
  page.drawRectangle({
    x: margin,
    y: pageHeight - 141,
    width: contentWidth,
    height: 1.6,
    color: colors.orange,
  });

  const bannerY = pageHeight - 151;
  const bannerHeight = 42;
  const bannerBottom = bannerY - bannerHeight;
  drawRoundedRect(page, margin, bannerBottom, contentWidth, bannerHeight, 12, colors.navy);
  drawIcon(page, 'course', margin + 16, bannerBottom + 9, 25, colors.white);
  page.drawLine({
    start: { x: margin + 51, y: bannerBottom + 8 },
    end: { x: margin + 51, y: bannerBottom + bannerHeight - 8 },
    thickness: 1.2,
    color: colors.white,
  });
  const headingWidth = contentWidth - 176;
  const titleSize = Math.min(
    settings.typography.titleSize,
    headingWidth / Math.max(1, bold.widthOfTextAtSize(printable(settings.heading), settings.typography.titleSize)) *
      settings.typography.titleSize,
  );
  page.drawText(printable(settings.heading), {
    x: margin + 64,
    y: bannerBottom + 15,
    size: titleSize,
    font: bold,
    color: colors.white,
    maxWidth: headingWidth,
  });
  page.drawText(printable(settings.approvalMessage), {
    x: pageWidth - margin - bold.widthOfTextAtSize(printable(settings.approvalMessage), 6.5) - 12,
    y: bannerBottom + 16,
    size: 6.5,
    font: bold,
    color: colorFromHex('#FFB36B'),
  });
  const formattedAdmissionDate = (() => {
    if (!student.admissionDate) return '';
    const admissionDate = new Date(student.admissionDate);
    return Number.isNaN(admissionDate.getTime())
      ? printable(student.admissionDate)
      : new Intl.DateTimeFormat('en-IN', {
        day: '2-digit',
        month: 'long',
        year: 'numeric',
        timeZone: 'Asia/Kolkata',
      }).format(admissionDate);
  })();
  const metadataY = bannerBottom - 17;
  const leftMetadata = `APPLICATION REFERENCE: ${printable(student.applicationNumber || '-')}`;
  const rightMetadata = `ADMISSION DATE: ${formattedAdmissionDate || '-'}`;
  page.drawText(leftMetadata, {
    x: margin + 10,
    y: metadataY,
    size: 9.2,
    font: bold,
    color: colors.navy,
    maxWidth: (contentWidth - 36) / 2,
  });
  page.drawLine({
    start: { x: pageWidth / 2, y: metadataY - 1 },
    end: { x: pageWidth / 2, y: metadataY + 11 },
    thickness: 1.1,
    color: colors.orange,
  });
  page.drawText(rightMetadata, {
    x: pageWidth / 2 + 14,
    y: metadataY,
    size: 9.2,
    font: bold,
    color: colors.navy,
    maxWidth: (contentWidth - 36) / 2,
  });
  if (settings.subtitle) {
    page.drawText(printable(settings.subtitle), {
      x: margin + 10,
      y: metadataY - 13,
      size: 7,
      font: regular,
      color: colors.muted,
      maxWidth: contentWidth - 20,
    });
  }
  if (previewOnly) {
    page.drawText('PREVIEW ONLY - NOT AN OFFICIAL STUDENT DOCUMENT', {
      x: pageWidth - margin - bold.widthOfTextAtSize('PREVIEW ONLY - NOT AN OFFICIAL STUDENT DOCUMENT', 5.5),
      y: metadataY - 23,
      size: 5.5,
      font: bold,
      color: colors.orange,
    });
  }
  y = metadataY - (previewOnly ? 32 : 23);

  const drawStudent = () => {
    const photo = settings.layout.showStudentPhoto ? studentPhoto : null;
    const photoWidth = photo ? 82 : 0;
    const detailsX = margin + (photo ? photoWidth + 22 : 14);
    const detailsWidth = pageWidth - margin - detailsX - 12;
    const nameLines = wrapTextLines(student.fullName || '-', bold, 12, detailsWidth);
    const contactRows: Array<[string, string]> = student.qualificationCategory === 'Student'
      ? [
        ['Parent Phone', student.parentPhone || 'Not provided'],
        ['Parent Email', student.parentEmail || 'Not provided'],
      ]
      : [
        ['Mobile Number', student.mobile || 'Not provided'],
        ['Email ID', student.email || 'Not provided'],
      ];
    const fields: Array<{ label: string; value: string }> = [
      ...(student.studentId ? [{ label: 'Student ID', value: student.studentId }] : []),
      ...(student.qualificationCategory
        ? [{ label: 'Category', value: student.qualificationCategory }]
        : []),
      ...(student.qualification ? [{ label: 'Qualification', value: student.qualification }] : []),
      ...contactRows.map(([label, value]) => ({ label, value })),
      ...(student.dateOfBirth ? [{ label: 'Date of Birth', value: student.dateOfBirth }] : []),
      ...(student.schoolName ? [{ label: 'School', value: student.schoolName }] : []),
      ...(student.collegeName ? [{ label: 'College', value: student.collegeName }] : []),
      ...(student.occupation ? [{ label: 'Occupation', value: student.occupation }] : []),
      ...(student.place ? [{ label: 'Place', value: student.place }] : []),
      ...(student.city ? [{ label: 'City', value: student.city }] : []),
      ...(student.address ? [{ label: 'Address', value: student.address }] : []),
    ];
    const cellWidth = (detailsWidth - 18) / 2;
    const fieldRows: Array<Array<{
      label: string;
      value: string;
      valueLines: string[];
    }>> = [];
    for (let index = 0; index < fields.length; index += 2) {
      fieldRows.push(fields.slice(index, index + 2).map((field) => ({
        ...field,
        valueLines: wrapTextLines(field.value, regular, 7.2, cellWidth - 12),
      })));
    }
    const rowHeights = fieldRows.map((row) =>
      Math.max(23, ...row.map((field) => 11 + field.valueLines.length * 8)),
    );
    const detailsHeight = 12 + nameLines.length * 14 + rowHeights.reduce((sum, height) => sum + height, 0);
    const panelHeight = Math.max(photo ? 126 : 58, detailsHeight + 15);
    ensureRoom(panelHeight + 12);
    const panelTop = y;
    const panelBottom = panelTop - panelHeight;
    drawSectionFrame(page, panelTop, panelBottom, settings.sectionHeadings.student, 'student');
    let detailsY = panelTop - 34;
    if (photo) {
      const photoBoxX = margin + 12;
      const photoBoxY = panelBottom + 12;
      const photoBoxHeight = panelHeight - 39;
      drawRoundedRect(page, photoBoxX, photoBoxY, photoWidth, photoBoxHeight, 5, colors.lightBlue, colors.line, 0.7);
      const photoScale = Math.min((photoWidth - 8) / photo.width, (photoBoxHeight - 8) / photo.height);
      const fittedWidth = photo.width * photoScale;
      const fittedHeight = photo.height * photoScale;
      page.drawImage(photo, {
        x: photoBoxX + (photoWidth - fittedWidth) / 2,
        y: photoBoxY + (photoBoxHeight - fittedHeight) / 2,
        width: fittedWidth,
        height: fittedHeight,
      });
      page.drawLine({
        start: { x: margin + photoWidth + 17, y: panelBottom + 12 },
        end: { x: margin + photoWidth + 17, y: panelTop - 29 },
        thickness: 1.4,
        color: colors.orange,
      });
    }
    page.drawText(nameLines[0], {
      x: detailsX,
      y: detailsY,
      size: 12,
      font: bold,
      color: colors.navy,
      maxWidth: detailsWidth,
    });
    detailsY -= 13;
    nameLines.slice(1).forEach((line) => {
      page.drawText(line, { x: detailsX, y: detailsY, size: 12, font: bold, color: colors.navy });
      detailsY -= 13;
    });
    fieldRows.forEach((row, rowIndex) => {
      const rowHeight = rowHeights[rowIndex];
      row.forEach((field, columnIndex) => {
        const fieldX = detailsX + columnIndex * (cellWidth + 18);
        page.drawText(printable(field.label.toUpperCase()), {
          x: fieldX,
          y: detailsY - 1,
          size: 5.8,
          font: bold,
          color: colors.muted,
          maxWidth: cellWidth - 8,
        });
        field.valueLines.forEach((line, lineIndex) => {
          page.drawText(line, {
            x: fieldX,
            y: detailsY - 10 - lineIndex * 8,
            size: 7.2,
            font: regular,
            color: colors.ink,
            maxWidth: cellWidth - 8,
          });
        });
      });
      if (row.length === 2) {
        const dividerX = detailsX + cellWidth + 9;
        page.drawLine({
          start: { x: dividerX, y: detailsY + 1 },
          end: { x: dividerX, y: detailsY - rowHeight + 5 },
          thickness: 0.6,
          color: colors.orange,
        });
      }
      detailsY -= rowHeight;
    });
    y = panelBottom - 9 * spacing;
  };

  const drawCourse = () => {
    const courseName = course?.name?.trim() || student.programName.trim();
    const nameLines = wrapTextLines(courseName || 'Course information unavailable', bold, 11.5, contentWidth - 32);
    const details = [
      ...(course?.duration ? [{ label: 'DURATION', value: course.duration }] : []),
      ...(course?.mode ? [{ label: 'MODE', value: course.mode }] : []),
      ...(course?.level ? [{ label: 'LEVEL', value: course.level }] : []),
    ];
    const detailLines = details.map((detail) => wrapTextLines(detail.value, regular, 7.4, contentWidth / 3 - 25));
    const detailHeight = details.length ? 18 + Math.max(...detailLines.map((lines) => lines.length)) * 9 : 0;
    const panelHeight = 34 + nameLines.length * 14 + detailHeight;
    ensureRoom(panelHeight + 12);
    const panelTop = y;
    const panelBottom = panelTop - panelHeight;
    drawSectionFrame(page, panelTop, panelBottom, settings.sectionHeadings.course, 'course');
    let courseY = panelTop - 37;
    nameLines.forEach((line) => {
      page.drawText(line, {
        x: margin + 14,
        y: courseY,
        size: 11.5,
        font: bold,
        color: colors.navy,
        maxWidth: contentWidth - 28,
      });
      courseY -= 14;
    });
    if (details.length) {
      const cellWidth = contentWidth / details.length;
      details.forEach((detail, index) => {
        const cellX = margin + 14 + index * cellWidth;
        if (index > 0) {
          page.drawLine({
            start: { x: cellX - 8, y: panelBottom + 10 },
            end: { x: cellX - 8, y: courseY + 2 },
            thickness: 1,
            color: colors.orange,
          });
        }
        page.drawText(detail.label, {
          x: cellX,
          y: courseY,
          size: 5.8,
          font: bold,
          color: colors.muted,
        });
        detailLines[index].forEach((line, lineIndex) => {
          page.drawText(line, {
            x: cellX,
            y: courseY - 10 - lineIndex * 9,
            size: 7.4,
            font: regular,
            color: colors.ink,
            maxWidth: cellWidth - 24,
          });
        });
      });
    }
    y = panelBottom - 9 * spacing;
  };

  const drawJoining = () => {
    const joiningFields = joiningInformation
      ? [
        { label: 'JOINING DATE', value: joiningInformation.joiningDate },
        { label: 'CLASS SCHEDULE', value: joiningInformation.classSchedule },
        { label: 'CLASS TIMINGS', value: joiningInformation.classTimings },
        { label: 'VENUE', value: joiningInformation.venue },
      ]
      : [];
    const columnWidth = contentWidth / Math.max(joiningFields.length, 1);
    const valueLines = joiningFields.map((field) => wrapTextLines(field.value || '-', regular, 7.2, columnWidth - 24));
    const detailsHeight = joiningFields.length ? 18 + Math.max(...valueLines.map((lines) => lines.length)) * 9 : 0;
    const instructions = settings.joiningInstructions ?? [];
    const instructionLineGap = Math.max(8, bodySize * 1.3 * spacing);
    const instructionLines = instructions.map((instruction) =>
      wrapTextLines(instruction, regular, bodySize, contentWidth - 43),
    );
    const panelHeight = Math.max(49, 34 + detailsHeight);
    ensureRoom(panelHeight + 12);
    const panelTop = y;
    const panelBottom = panelTop - panelHeight;
    drawSectionFrame(page, panelTop, panelBottom, settings.sectionHeadings.joining, 'joining');
    if (joiningFields.length) {
      const rowTop = panelTop - 37;
      joiningFields.forEach((field, index) => {
        const cellX = margin + 13 + index * columnWidth;
        if (index > 0) {
          page.drawLine({
            start: { x: cellX - 7, y: rowTop + 1 },
            end: { x: cellX - 7, y: rowTop - detailsHeight + 5 },
            thickness: 1,
            color: colors.orange,
          });
        }
        page.drawText(field.label, {
          x: cellX,
          y: rowTop,
          size: 5.7,
          font: bold,
          color: colors.navy,
          maxWidth: columnWidth - 18,
        });
        valueLines[index].forEach((line, lineIndex) => {
          page.drawText(line, {
            x: cellX,
            y: rowTop - 11 - lineIndex * 9,
            size: 7.2,
            font: regular,
            color: colors.ink,
            maxWidth: columnWidth - 18,
          });
        });
      });
    }
    y = panelBottom - 9 * spacing;
    let instructionHeadingPage = -1;
    for (const [index, lines] of instructionLines.entries()) {
      const cardHeight = 17 + Math.max(1, lines.length) * instructionLineGap;
      const previousPageCount = pages.length;
      ensureRoom(cardHeight + 29);
      if (pages.length !== previousPageCount) {
        drawSectionBar(page, y, settings.sectionHeadings.joining, 'joining');
        y -= 31;
      }
      if (instructionHeadingPage !== pages.length) {
        page.drawText('JOINING INSTRUCTIONS', {
          x: margin + 2,
          y: y - 8,
          size: 6,
          font: bold,
          color: colors.navy,
        });
        y -= 18;
        instructionHeadingPage = pages.length;
      }
      drawRoundedRect(page, margin, y - cardHeight, contentWidth, cardHeight, 5, colors.paleBlue, colors.line, 0.5);
      page.drawCircle({ x: margin + 15, y: y - 12, size: 6, color: colors.navy });
      const number = String(index + 1);
      page.drawText(number, {
        x: margin + 15 - bold.widthOfTextAtSize(number, 5.5) / 2,
        y: y - 14,
        size: 5.5,
        font: bold,
        color: colors.white,
      });
      lines.forEach((line, lineIndex) => {
        page.drawText(line, {
          x: margin + 28,
          y: y - 13 - lineIndex * instructionLineGap,
          size: bodySize,
          font: regular,
          color: colors.ink,
          maxWidth: contentWidth - 40,
        });
      });
      y -= cardHeight + 5;
    }
  };

  const drawTermsAndConditions = () => {
    const activeTerms = settings.termsAndConditions
      .filter((term) => term.isActive)
      .sort((left, right) => left.displayOrder - right.displayOrder);
    if (!activeTerms.length) return;
    const minimumY = margin + footerHeight + 10;
    const lineGap = Math.max(9, bodySize * 1.35 * spacing);
    const sectionTitle = 'TERMS & CONDITIONS';
    addPage();
    const drawTermsHeading = () => {
      ensureRoom(37);
      drawSectionBar(page, y, sectionTitle, 'terms');
      y -= 31;
    };
    drawTermsHeading();
    activeTerms.forEach((term, termIndex) => {
      const lines: Array<{ text: string; title: boolean; gap: number }> = [];
      if (term.title.trim()) {
        wrapTextLines(term.title, bold, bodySize, contentWidth - 51)
          .forEach((text) => lines.push({ text, title: true, gap: lineGap }));
      }
      term.description.replace(/\r\n?/g, '\n').split('\n').forEach((paragraph, paragraphIndex) => {
        if (!paragraph.trim()) {
          lines.push({ text: '', title: false, gap: lineGap * 0.55 });
        } else {
          wrapTextLines(paragraph, regular, bodySize, contentWidth - 51)
            .forEach((text) => lines.push({ text, title: false, gap: lineGap }));
        }
        if (paragraphIndex < term.description.split(/\r\n?|\n/).length - 1 && paragraph.trim()) {
          lines.push({ text: '', title: false, gap: lineGap * 0.35 });
        }
      });
      if (!lines.length) return;
      let lineIndex = 0;
      while (lineIndex < lines.length) {
        const requiredMinimum = Math.min(42, lines[lineIndex].gap + 28);
        if (y - requiredMinimum < minimumY) {
          addPage();
          drawTermsHeading();
        }
        const availableLines = Math.max(1, Math.floor((y - minimumY - 22) / lineGap));
        const segment = lines.slice(lineIndex, lineIndex + availableLines);
        const segmentHeight = 19 + segment.reduce((sum, line) => sum + line.gap, 0);
        const cardTop = y;
        const cardBottom = cardTop - segmentHeight;
        drawRoundedRect(page, margin, cardBottom, contentWidth, segmentHeight, 6, colors.white, colors.line, 0.65);
        page.drawRectangle({
          x: margin + 1,
          y: cardBottom + 5,
          width: 2,
          height: Math.max(1, segmentHeight - 10),
          color: colors.orange,
        });
        page.drawCircle({ x: margin + 17, y: cardTop - 13, size: 7, color: colors.navy });
        const number = String(termIndex + 1);
        page.drawText(number, {
          x: margin + 17 - bold.widthOfTextAtSize(number, 6) / 2,
          y: cardTop - 15,
          size: 6,
          font: bold,
          color: colors.white,
        });
        let textY = cardTop - 13;
        segment.forEach((line) => {
          if (line.text) {
            page.drawText(printable(line.text), {
              x: margin + 31,
              y: textY,
              size: bodySize,
              font: line.title ? bold : regular,
              color: line.title ? colors.navy : colors.ink,
              maxWidth: contentWidth - 44,
            });
          }
          textY -= line.gap;
        });
        y = cardBottom - 5;
        lineIndex += segment.length;
        if (lineIndex < lines.length) {
          addPage();
          drawTermsHeading();
        }
      }
      y -= 3;
    });
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
    drawSectionTitle('A NOTE FROM THE ACADEMY');
    y -= 4 * spacing;
    const academyNoteParagraphs = [
      settings.welcomeMessage,
      "At Uptrend's English Academy, we support learners in strengthening practical English communication skills and building confidence in speaking and everyday conversations.",
      'Regular practice, consistent learning, and active participation help you make the most of each session. Attend regularly, ask questions, and try new expressions.',
      'Our team guides you through your learning journey. Apply what you practise in real-life situations and keep learning.',
    ];
    academyNoteParagraphs.forEach((paragraph, index) => {
      drawWrapped(paragraph, margin + 1, {
        color: colors.muted,
        size: bodySize - 0.25,
        lineGap: (bodySize - 0.25) * 1.45 * spacing,
      });
      if (index < academyNoteParagraphs.length - 1) y -= 5 * spacing;
    });
    y -= 6 * spacing;
  }
  drawTermsAndConditions();

  if (settings.layout.showFooter) {
    pages.forEach((currentPage, index) => {
      currentPage.drawRectangle({
        x: 0,
        y: 0,
        width: pageWidth,
        height: footerHeight,
        color: colors.paleBlue,
      });
      if (settings.layout.showDecorations) {
        currentPage.drawSvgPath(
          `M 0 0 H ${pageWidth} V 30 C ${pageWidth * 0.72} 49 ${pageWidth * 0.55} 23 ${pageWidth * 0.34} 37 C ${pageWidth * 0.18} 48 ${pageWidth * 0.1} 22 0 39 Z`,
          { x: 0, y: 0, color: colors.navy },
        );
        currentPage.drawSvgPath(
          `M 0 0 H ${pageWidth} V 7 C ${pageWidth * 0.72} 20 ${pageWidth * 0.55} 4 ${pageWidth * 0.34} 14 C ${pageWidth * 0.18} 23 ${pageWidth * 0.1} 6 0 17 Z`,
          { x: 0, y: 27, color: colors.orange },
        );
      } else {
        currentPage.drawRectangle({ x: 0, y: 57, width: pageWidth, height: 2, color: colors.navy });
      }
      const taglineLines = wrapTextLines(settings.motivationalTagline, bold, 7.2, 146);
      taglineLines.slice(0, 4).forEach((line, lineIndex) => {
        currentPage.drawText(line, {
          x: margin,
          y: 105 - lineIndex * 8.5,
          size: 7.2,
          font: bold,
          color: colors.navy,
        });
      });
      currentPage.drawText(printable(settings.academyName), {
        x: margin,
        y: Math.max(70, 105 - taglineLines.slice(0, 4).length * 8.5 - 5),
        size: 6.5,
        font: bold,
        color: colors.orange,
        maxWidth: 146,
      });
      const contactX = margin + 158;
      currentPage.drawText(printable(settings.phone), {
        x: contactX,
        y: 104,
        size: 6.5,
        font: bold,
        color: colors.navy,
        maxWidth: 145,
      });
      currentPage.drawText(printable(settings.email), {
        x: contactX,
        y: 92,
        size: 6.2,
        font: regular,
        color: colors.ink,
        maxWidth: 145,
      });
      const footerAddress = wrapTextLines(settings.address, regular, 5.7, 145);
      footerAddress.slice(0, 2).forEach((line, lineIndex) => {
        currentPage.drawText(line, {
          x: contactX,
          y: 81 - lineIndex * 8,
          size: 5.7,
          font: regular,
          color: colors.muted,
          maxWidth: 145,
        });
      });
      currentPage.drawText(printable(settings.hours), {
        x: contactX,
        y: 63,
        size: 5.4,
        font: regular,
        color: colors.muted,
        maxWidth: 145,
      });
      const socialSize = 17;
      const socialGap = 5;
      const socialWidth = SOCIAL_LINKS.length * socialSize + (SOCIAL_LINKS.length - 1) * socialGap;
      const socialX = pageWidth - margin - socialWidth;
      currentPage.drawText('CONNECT WITH US', {
        x: socialX,
        y: 104,
        size: 5.5,
        font: bold,
        color: colors.navy,
      });
      SOCIAL_LINKS.forEach((link, socialIndex) => {
        drawSocialIcon(
          currentPage,
          link,
          socialX + socialIndex * (socialSize + socialGap),
          78,
          socialSize,
        );
      });
      const pageLabel = `Page ${index + 1} of ${pages.length}`;
      currentPage.drawText(pageLabel, {
        x: pageWidth - margin - bold.widthOfTextAtSize(pageLabel, 7),
        y: 9,
        size: 7,
        font: bold,
        color: colors.white,
      });
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
  const terms = Array.isArray(settings.termsAndConditions) ? settings.termsAndConditions : [];
  const termIds = terms.map((term) => term?.id);
  const termOrders = terms.map((term) => term?.displayOrder);
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
    Array.isArray(settings.termsAndConditions) &&
    settings.termsAndConditions.every((term) =>
      term !== null &&
      term !== undefined &&
      typeof term === 'object' &&
      typeof term.id === 'string' &&
      typeof term.title === 'string' &&
      typeof term.description === 'string' &&
      Boolean(term.description.trim()) &&
      Number.isInteger(term.displayOrder) &&
      typeof term.isActive === 'boolean',
    ) &&
    new Set(termIds).size === termIds.length &&
    new Set(termOrders).size === termOrders.length &&
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
  if (Object.prototype.hasOwnProperty.call(saved, 'termsAndConditions') &&
    !Array.isArray(saved.termsAndConditions)) {
    return null;
  }
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
    termsAndConditions: Array.isArray(saved.termsAndConditions)
      ? saved.termsAndConditions as OfficialTermAndCondition[]
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
