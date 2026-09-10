import '@/src/shared/lib/observability/sentry';
import { renderRoot } from '@/src/shared/app/renderRoot';
import AppClient from '@/src/surfaces/client/AppClient';

renderRoot(AppClient);
