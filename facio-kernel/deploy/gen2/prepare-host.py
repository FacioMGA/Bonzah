#!/usr/bin/env python3
"""Prepare the dedicated shared-MGA deployment; preserve existing identity secrets.

Run on the already-authorized Kernel sandbox VM. No secret values are printed.
Existing files are never regenerated during an ordinary upgrade.
"""
import json
import os
import secrets
from pathlib import Path

os.umask(0o077)
ROOT = Path('/srv/facio-platform')
PRIVATE = ROOT / 'secrets'
PRIVATE.mkdir(parents=True, exist_ok=True, mode=0o700)
os.chmod(PRIVATE, 0o700)
for name in ('postgres', 'redis'):
    directory = ROOT / 'data' / name
    directory.mkdir(parents=True, exist_ok=True)

def read_env(path):
    return dict(line.split('=', 1) for line in path.read_text().splitlines() if line.strip() and not line.startswith('#') and '=' in line)

def write_private(name, value):
    path = PRIVATE / name
    temporary = path.with_name(path.name + '.' + secrets.token_hex(6) + '.tmp')
    with temporary.open('x') as output:
        output.write(value)
        output.flush()
        os.fsync(output.fileno())
    temporary.chmod(0o600)
    temporary.replace(path)

legacy = read_env(Path('/srv/facio-kernel/secrets/hosted.env'))

def add_platform_capabilities(values, quote_secret=None):
    values.setdefault('KERNEL_OBSERVABILITY_MODE', 'structured_logs')
    if not values.get('QUOTE_TOKEN_SECRET'):
        values['QUOTE_TOKEN_SECRET'] = quote_secret or secrets.token_hex(48)
    for suffix in ('CLIENT_ID', 'CLIENT_SECRET', 'TENANT_ID'):
        target = 'KERNEL_ENTRA_' + suffix
        source = legacy.get(target) or legacy.get('KERNEL_OIDC_' + suffix)
        if source and not values.get(target): values[target] = source
    path = PRIVATE / 'entra-identities.json'
    if path.exists():
        bindings = json.loads(path.read_text())
        if not isinstance(bindings, list) or any(item.get('tenantId') != values.get('KERNEL_ENTRA_TENANT_ID') for item in bindings):
            raise SystemExit('Verified Entra identities do not match the configured organization; no credentials changed.')
        values['KERNEL_ENTRA_IDENTITY_BINDINGS'] = json.dumps(bindings, separators=(',', ':'))
    for value in values.values():
        if '\n' in value or '\r' in value: raise SystemExit('Invalid multiline environment value; no secret files written.')
    return values

if (PRIVATE / 'app.env').exists():
    for filename in ('migrate.env', 'postgres.env', 'redis.conf', 'roles.sql'):
        if not (PRIVATE / filename).is_file(): raise SystemExit('Incomplete existing Platform credentials; repair the missing private file before launch.')
    app = add_platform_capabilities(read_env(PRIVATE / 'app.env'))
    migration = add_platform_capabilities(read_env(PRIVATE / 'migrate.env'), app['QUOTE_TOKEN_SECRET'])
    for filename, values in (('app.env', app), ('migrate.env', migration)):
        write_private(filename, ''.join(f'{key}={value}\n' for key, value in values.items()))
    print('Preserved existing credentials; completed explicit logging, quote-signing and verified Entra configuration.')
    raise SystemExit(0)
for name in ('KERNEL_GOOGLE_CLIENT_ID', 'KERNEL_GOOGLE_CLIENT_SECRET'):
    if not legacy.get(name):
        raise SystemExit('Existing dedicated Google client is missing; no changes made.')
owner_password, app_password, redis_password = [secrets.token_hex(32) for _ in range(3)]
base = {
    'NODE_ENV': 'production', 'PORT': '3000', 'SERVICE_ROLE': 'facio-platform-api',
    'KERNEL_PLATFORM_MODE': 'true', 'KERNEL_PUBLIC_URL': 'https://platform.facio.io',
    'KERNEL_PUBLIC_BASE_URL': 'https://platform.facio.io', 'KERNEL_REGION': 'westeurope',
    'KERNEL_WORKSPACE_DOMAIN': 'facio.io', 'KERNEL_FROM_EMAIL': 'noreply@facio.io',
    'KERNEL_PASSWORD_LOGIN_ENABLED': 'false', 'KERNEL_EXTERNAL_DELIVERY_ENABLED': 'false',
    'KERNEL_BEHAVIOR_EMBEDDINGS_ENABLED': 'false',
    'KERNEL_OBSERVABILITY_MODE': 'structured_logs',
    'DATABASE_URL': f'postgresql://kernel_app:{app_password}@postgres:5432/facio_gen2?schema=public',
    'JWT_SECRET': secrets.token_hex(48), 'OTP_SECRET': secrets.token_hex(48),
    'QUOTE_TOKEN_SECRET': secrets.token_hex(48),
    'REDIS_HOST': 'redis', 'REDIS_PORT': '6379', 'REDIS_PASSWORD': redis_password,
    'STORAGE_PROVIDER': 'azure', 'KERNEL_STORAGE_ACCOUNT': 'stkernelsandbox294904',
    'STORAGE_CONTAINER_NAME': 'mga-documents', 'TEMPLATE_UPLOAD_MODE': 'storage',
    'CORS_ORIGIN': 'https://platform.facio.io', 'DB_INDEX_BOOTSTRAP': 'off',
    'QUEUE_WORKERS_ENABLED': 'true', 'WORKER_CONCURRENCY': '1', 'PDF_MAX_CONCURRENCY': '1',
    'NODE_OPTIONS': '--max-old-space-size=1400', 'PRISMA_CONNECTION_LIMIT': '12',
    'PUPPETEER_EXECUTABLE_PATH': '/usr/bin/chromium',
    **{name: legacy[name] for name in ('KERNEL_GOOGLE_CLIENT_ID', 'KERNEL_GOOGLE_CLIENT_SECRET')},
}
base = add_platform_capabilities(base)
for value in base.values():
    if '\n' in value or '\r' in value: raise SystemExit('Invalid multiline environment value; no secret files written.')
write_private('app.env', ''.join(f'{k}={v}\n' for k, v in base.items()))
write_private('postgres.env', f'POSTGRES_USER=kernel_owner\nPOSTGRES_PASSWORD={owner_password}\nPOSTGRES_DB=facio_gen2\n')
base['DATABASE_URL'] = f'postgresql://kernel_owner:{owner_password}@postgres:5432/facio_gen2?schema=public'
write_private('migrate.env', ''.join(f'{k}={v}\n' for k, v in base.items()))
write_private('roles.sql', f"""DO $$ BEGIN
IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='kernel_app') THEN
CREATE ROLE kernel_app LOGIN PASSWORD '{app_password}' NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
END IF;
END $$;
GRANT CONNECT ON DATABASE facio_gen2 TO kernel_app;
GRANT USAGE ON SCHEMA public TO kernel_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO kernel_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO kernel_app;
ALTER DEFAULT PRIVILEGES FOR ROLE kernel_owner IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO kernel_app;
ALTER DEFAULT PRIVILEGES FOR ROLE kernel_owner IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO kernel_app;
""")
write_private('redis.conf', f'bind 0.0.0.0\nprotected-mode yes\nrequirepass {redis_password}\nappendonly yes\ndir /data\nmaxmemory 128mb\nmaxmemory-policy noeviction\n')
# The upstream Redis image runs with uid/gid 999 after its root entrypoint.
os.chown(PRIVATE / 'redis.conf', 999, 999)
print('Prepared private PostgreSQL, Redis, application and Google identity configuration.')
