import '@/src/shared/lib/observability/sentry';
import { renderRoot } from '@/src/shared/app/renderRoot';
import { PlatformEntry } from '@/src/surfaces/bo/PlatformEntry';

renderRoot(PlatformEntry);
