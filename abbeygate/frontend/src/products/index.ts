/**
 * Products bootstrap.
 *
 * Import this module once at app entry (AppBo / AppClient / AppPublic) to
 * register every product manifest and validation profile.
 *
 * Adding a new product:
 *   1. Create `frontend/src/products/{code}/manifest.ts`
 *   2. Add the manifest to `frontend/src/products/catalog.ts`
 *   3. Add a `register.ts` that wires the manifest and validation profile
 *   4. Import this module once at app boot.
 */
import './motor/register';
import './home/register';
import './travel/register';
import './health/register';
import './business/register';
import './open-market/register';
import './rental/register';

export { productCatalog } from './catalog';
