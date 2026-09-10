import fs from 'fs';
import path from 'path';

const FORBIDDEN_DIRS = [
    'frontend/src/domains',
    'frontend/src/products/features',
    'frontend/src/products/underwriting',
    'frontend/src/products/wizard',
];
const PRODUCTS_ROOT = path.resolve('frontend/src/products');
const ROOT_FORBIDDEN_NAMES = new Set([
    'components',
    'features',
    'internal',
    'lib',
    'helpers',
    'controller',
    'ui',
    'types',
]);
const DETAIL_FORBIDDEN_NAMES = new Set(['model', 'domain', 'actions', 'validation']);

let hasError = false;

FORBIDDEN_DIRS.forEach(dir => {
    const fullPath = path.resolve(dir);
    if (fs.existsSync(fullPath)) {
        const files = fs.readdirSync(fullPath);
        if (files.length > 0) {
            console.error(`🚨 ERROR: Competing domain directory found! '${dir}' should be permanently deleted. Found ${files.length} items inside.`);
            hasError = true;
        }
    }
});

if (fs.existsSync(PRODUCTS_ROOT)) {
    const productEntries = fs.readdirSync(PRODUCTS_ROOT, { withFileTypes: true });
    for (const entry of productEntries) {
        if (!entry.isDirectory()) continue;
        const productPath = path.join(PRODUCTS_ROOT, entry.name);
        const childEntries = fs.readdirSync(productPath, { withFileTypes: true });
        for (const child of childEntries) {
            if (!child.isDirectory()) continue;
            if (ROOT_FORBIDDEN_NAMES.has(child.name)) {
                console.error(`🚨 ERROR: Forbidden product-root directory found: 'frontend/src/products/${entry.name}/${child.name}'.`);
                hasError = true;
            }
        }

        const detailPath = path.join(productPath, 'detail');
        if (fs.existsSync(detailPath) && fs.statSync(detailPath).isDirectory()) {
            const detailEntries = fs.readdirSync(detailPath, { withFileTypes: true });
            for (const detailChild of detailEntries) {
                if (!detailChild.isDirectory()) continue;
                if (DETAIL_FORBIDDEN_NAMES.has(detailChild.name)) {
                    console.error(
                        `🚨 ERROR: Forbidden detail boundary directory found: 'frontend/src/products/${entry.name}/detail/${detailChild.name}'. ` +
                        `detail/ may only contain composition concerns.`,
                    );
                    hasError = true;
                }
            }
        }
    }
}

if (hasError) {
    process.exit(1);
} else {
    console.log('✅ Frontend domain-competition and product-root vocabulary guards passed.');
}
