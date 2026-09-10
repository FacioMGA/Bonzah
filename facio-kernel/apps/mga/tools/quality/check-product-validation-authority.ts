import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  homeManifest,
  homeValidationProfile,
  motorManifest,
  motorValidationProfile,
  travelManifest,
  travelValidationProfile,
  type ProductManifest,
} from '../../packages/products/src/index.js';
import type { ValidationProfile } from '@facio/validation';

type ProductContract = {
  productCode: string;
  manifest: ProductManifest;
  profile: ValidationProfile;
};

const products: ProductContract[] = [
  { productCode: 'MOTOR', manifest: motorManifest, profile: motorValidationProfile },
  { productCode: 'HOME', manifest: homeManifest, profile: homeValidationProfile },
  { productCode: 'TRAVEL', manifest: travelManifest, profile: travelValidationProfile },
];

const violations: string[] = [];

for (const product of products) {
  const profileFields = new Set(Object.keys(product.profile.fields));
  for (const section of product.manifest.questionnaire.sections) {
    for (const field of section.fields) {
      if (field.required !== true && !field.requiredWhenKey) continue;
      if (!profileFields.has(field.path)) {
        violations.push(
          `${product.productCode}: manifest required field '${field.path}' (${section.id}) is missing from validation profile`,
        );
      }
    }
  }
}

const seedSource = readFileSync(resolve(process.cwd(), 'prisma/seed.ts'), 'utf8');
const jsonPathMatches = seedSource.matchAll(/jsonPath:\s*'quoteData\.([^']+)'/g);
const motorFields = new Set(Object.keys(motorValidationProfile.fields));
for (const match of jsonPathMatches) {
  const path = String(match[1] || '').trim();
  if (!path) continue;
  if (!motorFields.has(path)) {
    violations.push(`MOTOR MagicB jsonPath 'quoteData.${path}' is missing from motor validation profile`);
  }
}

if (violations.length > 0) {
  console.error('[product-validation-authority] drift detected');
  for (const violation of violations) console.error(` - ${violation}`);
  process.exit(1);
}

console.log('[product-validation-authority] ok');
