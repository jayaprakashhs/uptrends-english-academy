import React, { useEffect, useState } from 'react';

const SCRIPT_URL = 'https://widgets.sociablekit.com/google-reviews/widget.js';
const SCRIPT_SELECTOR = `script[src="${SCRIPT_URL}"]`;

let scriptLoadPromise: Promise<void> | null = null;

const loadWidgetScript = (): Promise<void> => {
  if (scriptLoadPromise) return scriptLoadPromise;

  const existingScript = document.querySelector<HTMLScriptElement>(SCRIPT_SELECTOR);
  if (existingScript) {
    scriptLoadPromise = Promise.resolve();
    return scriptLoadPromise;
  }

  const script = document.createElement('script');
  script.src = SCRIPT_URL;
  script.defer = true;
  script.dataset.sociablekitGoogleReviews = 'true';

  scriptLoadPromise = new Promise<void>((resolve, reject) => {
    script.addEventListener(
      'load',
      () => resolve(),
      { once: true },
    );
    script.addEventListener(
      'error',
      () => {
        script.remove();
        scriptLoadPromise = null;
        reject(new Error('Unable to load the Google Reviews widget.'));
      },
      { once: true },
    );
    document.body.appendChild(script);
  });

  return scriptLoadPromise;
};

interface SociableKitGoogleReviewsProps {
  className?: string;
}

export const SociableKitGoogleReviews: React.FC<SociableKitGoogleReviewsProps> = ({
  className = '',
}) => {
  const [loadState, setLoadState] = useState<'loading' | 'loaded' | 'error'>('loading');

  useEffect(() => {
    let isMounted = true;
    void loadWidgetScript().then(
      () => {
        if (isMounted) setLoadState('loaded');
      },
      () => {
        if (isMounted) setLoadState('error');
      },
    );

    return () => {
      isMounted = false;
    };
  }, []);

  const retryLoading = () => {
    setLoadState('loading');
    void loadWidgetScript().then(
      () => setLoadState('loaded'),
      () => setLoadState('error'),
    );
  };

  return (
    <div
      className={`min-w-0 w-full max-w-full overflow-hidden ${className}`.trim()}
    >
      {loadState === 'loading' && (
        <p role="status" className="mb-3 text-center text-sm text-slate-500">
          Loading Google reviews…
        </p>
      )}
      {loadState === 'error' && (
        <div role="alert" className="mb-3 text-center text-sm text-slate-600">
          <p>Google reviews could not be loaded.</p>
          <button
            type="button"
            onClick={retryLoading}
            className="mt-1 font-semibold text-emerald-700 underline underline-offset-2 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-700"
          >
            Try again
          </button>
        </div>
      )}
      <div
        className="sk-ww-google-reviews min-w-0 w-full max-w-full"
        data-embed-id="25725847"
      />
    </div>
  );
};
