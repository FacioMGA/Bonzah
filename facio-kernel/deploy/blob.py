#!/usr/bin/env python3
"""Read/write the dedicated private sandbox storage using the VM managed identity.

No account key, SAS or bearer token is written to disk or logged.
"""
import argparse
import json
import os
from pathlib import Path
import urllib.parse
import urllib.request

parser = argparse.ArgumentParser()
parser.add_argument('action', choices=['upload', 'download'])
parser.add_argument('container', choices=['backups', 'releases'])
parser.add_argument('blob')
parser.add_argument('file')
args = parser.parse_args()
account = os.environ['KERNEL_STORAGE_ACCOUNT']
if not account.isalnum() or any(part in ('', '.', '..') for part in args.blob.split('/')):
    raise SystemExit('Invalid storage target')
token_url = 'http://169.254.169.254/metadata/identity/oauth2/token?' + urllib.parse.urlencode({
    'api-version': '2018-02-01', 'resource': 'https://storage.azure.com/'})
request = urllib.request.Request(token_url, headers={'Metadata': 'true'})
with urllib.request.urlopen(request, timeout=15) as response:
    token = json.load(response)['access_token']
url = f'https://{account}.blob.core.windows.net/{args.container}/' + urllib.parse.quote(args.blob, safe='/')
headers = {'Authorization': 'Bearer ' + token, 'x-ms-version': '2023-11-03'}
path = Path(args.file)
if args.action == 'upload':
    headers['x-ms-blob-type'] = 'BlockBlob'
    headers['If-None-Match'] = '*'
    request = urllib.request.Request(url, data=path.read_bytes(), headers=headers, method='PUT')
    with urllib.request.urlopen(request, timeout=180) as response:
        if response.status != 201:
            raise SystemExit('Storage upload failed')
else:
    request = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(request, timeout=180) as response, path.open('wb') as output:
        while chunk := response.read(1024 * 1024):
            output.write(chunk)
print(f'{args.action}: {args.container}/{args.blob}')
