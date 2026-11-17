
import React from 'react';

interface LogoProps {
  className?: string;
  variant?: 'full' | 'icon' | 'white';
  size?: 'sm' | 'md' | 'lg' | 'compact';
  logoUrl?: string | null;
  altText?: string;
}

const DEFAULT_LOGO_URL =
  "https://gpnfznwqwaokfzmozpxo.supabase.co/storage/v1/object/public/Uptrend's%20English%20Academy-photos/main_logo/UEA_main_02.png";

export const Logo: React.FC<LogoProps> = ({
  className = '',
  variant = 'full',
  size = 'md',
  logoUrl,
  altText = "Uptrend's English Academy Davangere Logo",
}) => {
  // Responsive logo dimensions.
  const customLogoSizes = {
    sm: 'w-[120px] h-[32px] sm:w-[140px] sm:h-[40px]',
    md: 'w-[140px] h-[40px] sm:w-[160px] sm:h-[46px] lg:w-[180px] lg:h-[52px]',
    lg: 'w-[160px] h-[46px] sm:w-[180px] sm:h-[52px] lg:w-[200px] lg:h-[58px]',
    compact: 'w-[calc(100vw_-_274px)] h-[27px] min-[360px]:h-[32px] min-[394px]:w-[120px] min-[640px]:w-[140px] min-[640px]:h-[40px]',
  };

  // The supplied logo URL takes priority over the default logo.
  const effectiveLogoUrl = logoUrl?.trim() || DEFAULT_LOGO_URL;

  return (
    <div className={`flex min-w-0 items-center gap-3 select-none ${className}`}>
      <div
        className={`relative flex shrink-0 items-center justify-center ${customLogoSizes[size]}`}
      >
        <img
          src={effectiveLogoUrl}
          alt={altText}
          width={200}
          height={58}
          className="block h-full w-full object-contain"
          loading="eager"
          onError={(event) => {
            event.currentTarget.style.visibility = 'hidden';
          }}
        />
      </div>
    </div>
  );
};
