#!/usr/bin/env python3
"""Dispatch the reviewed candidate replay and require its explicit success receipt."""
import argparse
import base64
import json
from pathlib import Path
import re
import subprocess


def success_receipt(payload, sha):
    receipts = []
    for message in payload.get('value', []):
        code = message.get('code', '')
        if code.endswith('/failed'):
            raise ValueError('Remote preflight reported failure')
        if code == 'ComponentStatus/StdOut/succeeded':
            stdout = message.get('message', '')
        elif code == 'ProvisioningState/succeeded':
            # Azure VM RunCommand wraps stdout/stderr in one successful transport
            # message. Provisioning success alone says nothing about replay.
            text = message.get('message', '')
            if text.count('[stdout]') != 1 or text.count('[stderr]') != 1:
                raise ValueError('Expected one bounded remote stdout/stderr envelope')
            _, body = text.split('[stdout]', 1)
            stdout, stderr = body.split('[stderr]', 1)
            # The reviewed runner captures child stderr and prints only its final
            # receipt. Permit explicit one-line warnings, never later exceptions.
            if any(line.strip() and not re.match(r'^(?:[A-Za-z]*Warning|WARNING): ', line.strip()) for line in stderr.splitlines()):
                raise ValueError('Remote preflight wrote unexpected stderr')
        elif code == 'ComponentStatus/StdErr/succeeded':
            if any(line.strip() and not re.match(r'^(?:[A-Za-z]*Warning|WARNING): ', line.strip()) for line in message.get('message', '').splitlines()):
                raise ValueError('Remote preflight wrote unexpected stderr')
            continue
        else:
            continue
        for line in stdout.splitlines():
            try:
                receipt = json.loads(line)
            except json.JSONDecodeError:
                continue
            if isinstance(receipt, dict) and receipt.get('buildSha') == sha:
                receipts.append(receipt)
    if len(receipts) != 1:
        raise ValueError('One exact candidate success receipt is required')
    receipt = receipts[0]
    if (receipt.get('passed') is not True or receipt.get('liveContainerUnchanged') is not True
            or receipt.get('businessSchema') != 7
            or not isinstance(receipt.get('verifiedRecords'), int) or isinstance(receipt.get('verifiedRecords'), bool) or receipt['verifiedRecords'] < 0
            or not re.fullmatch(r'[a-f0-9]{64}', str(receipt.get('evidenceSha256', '')))
            or not re.fullmatch(r'/srv/facio-kernel/recovery/candidate-' + sha[:12] + r'-[0-9T.Z]+/evidence\.json', str(receipt.get('evidenceFile', '')))
            or not isinstance(receipt.get('moneyEngine'), dict)
            or receipt['moneyEngine'].get('engine') != 'rust-wasm'
            or not re.fullmatch(r'[a-f0-9]{64}', str(receipt['moneyEngine'].get('wasmSha256', '')))):
        raise ValueError('Candidate did not prove the expected schema, Rust engine and retained evidence')
    return receipt


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--sha', required=True)
    args = parser.parse_args()
    if not re.fullmatch(r'[a-f0-9]{40}', args.sha):
        raise SystemExit('A full lowercase commit SHA is required')
    directory = Path(__file__).resolve().parent
    runner = base64.b64encode((directory / 'preflight.py').read_bytes()).decode()
    replay = base64.b64encode((directory / 'replay-business.mjs').read_bytes()).decode()
    # Only validated hexadecimal and base64 bytes are interpolated into shell code.
    script = (
        'set -eu\n'
        f"export KERNEL_PREFLIGHT_SHA='{args.sha}'\n"
        f"export KERNEL_PREFLIGHT_REPLAY='{replay}'\n"
        "python3 - <<'PY'\nimport base64\n"
        f"exec(compile(base64.b64decode('{runner}'), 'kernel-candidate-preflight', 'exec'))\nPY\n"
    )
    try:
        result = subprocess.run([
            'az', 'vm', 'run-command', 'invoke', '--resource-group', 'rg-facio-kernel-sandbox-weu',
            '--name', 'vm-kernel-sandbox', '--command-id', 'RunShellScript', '--scripts', script,
            '--output', 'json', '--only-show-errors',
        ], capture_output=True, text=True, timeout=600)
        if result.returncode:
            raise ValueError('Azure dispatch failed')
        receipt = success_receipt(json.loads(result.stdout), args.sha)
    except (ValueError, TypeError, AttributeError, subprocess.TimeoutExpired):
        raise SystemExit('Candidate replay did not return its exact success receipt; activation is blocked') from None
    print(json.dumps(receipt, indent=2))


if __name__ == '__main__':
    main()
