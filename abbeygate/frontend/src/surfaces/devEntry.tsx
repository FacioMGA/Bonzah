import AppBo from '@/src/surfaces/bo/AppBo';
import AppClient from '@/src/surfaces/client/AppClient';
import AppPublic from '@/src/surfaces/public/AppPublic';
import { renderRoot } from '@/src/shared/app/renderRoot';

function resolveSurfaceApp(pathname: string) {
  const path = String(pathname || '/');
  if (
    path.startsWith('/quote') ||
    path.startsWith('/get-auto-quote') ||
    path.startsWith('/questionnaire') ||
    path.startsWith('/client/public') ||
    path.startsWith('/fnol') ||
    path.startsWith('/verify-email') ||
    path.startsWith('/auth/reset') ||
    path.startsWith('/summit-rentals') ||
    path.startsWith('/bonzah')
  ) {
    return AppPublic;
  }
  if (path.startsWith('/client')) {
    return AppClient;
  }
  return AppBo;
}

renderRoot(resolveSurfaceApp(window.location.pathname));
