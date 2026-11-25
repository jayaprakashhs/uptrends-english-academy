export const ADMIN_HOSTNAME = 'admin.uptrendsenglishacademy.in';
export const ADMIN_LOGIN_PATH = '/admin/login';
export const ADMIN_PORTAL_PATH = '/admin';

export type AdminPage = 'admin-login' | 'admin-portal';

export const isAdminHostname = (hostname: string): boolean =>
  hostname.toLowerCase() === ADMIN_HOSTNAME;

export const getAdminPageFromPath = (pathname: string): AdminPage => {
  const normalizedPath = pathname.replace(/\/+$/, '') || '/';
  return normalizedPath === ADMIN_PORTAL_PATH || normalizedPath === `${ADMIN_PORTAL_PATH}/dashboard`
    ? 'admin-portal'
    : 'admin-login';
};

export const getInitialPage = (hostname: string, pathname: string): string =>
  isAdminHostname(hostname) ? getAdminPageFromPath(pathname) : 'home';

export const getAdminPathForPage = (page: AdminPage): string =>
  page === 'admin-portal' ? ADMIN_PORTAL_PATH : ADMIN_LOGIN_PATH;