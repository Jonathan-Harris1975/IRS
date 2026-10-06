#!/usr/bin/env python3
"""Upload exact-run repository evidence to Cloudflare R2 using S3 SigV4."""
from __future__ import annotations

import argparse
import datetime as dt
import hashlib
import hmac
import json
import os
import pathlib
import urllib.parse
import urllib.request


def _hmac(key: bytes, msg: str) -> bytes:
    return hmac.new(key, msg.encode("utf-8"), hashlib.sha256).digest()


def _signing_key(secret: str, date: str, region: str, service: str) -> bytes:
    return _hmac(_hmac(_hmac(_hmac(("AWS4" + secret).encode(), date), region), service), "aws4_request")


def _request(method: str, *, account: str, bucket: str, key: str, access: str, secret: str, body: bytes = b"") -> int:
    region = "auto"
    service = "s3"
    host = f"{account}.r2.cloudflarestorage.com"
    encoded_key = "/".join(urllib.parse.quote(part, safe="-_.~") for part in key.split("/"))
    canonical_uri = f"/{urllib.parse.quote(bucket, safe='-_.~')}/{encoded_key}"
    now = dt.datetime.now(dt.timezone.utc)
    amz_date = now.strftime("%Y%m%dT%H%M%SZ")
    date_stamp = now.strftime("%Y%m%d")
    payload_hash = hashlib.sha256(body).hexdigest()
    canonical_headers = f"host:{host}\nx-amz-content-sha256:{payload_hash}\nx-amz-date:{amz_date}\n"
    signed_headers = "host;x-amz-content-sha256;x-amz-date"
    canonical_request = "\n".join([method, canonical_uri, "", canonical_headers, signed_headers, payload_hash])
    credential_scope = f"{date_stamp}/{region}/{service}/aws4_request"
    string_to_sign = "\n".join([
        "AWS4-HMAC-SHA256",
        amz_date,
        credential_scope,
        hashlib.sha256(canonical_request.encode()).hexdigest(),
    ])
    signature = hmac.new(
        _signing_key(secret, date_stamp, region, service),
        string_to_sign.encode(),
        hashlib.sha256,
    ).hexdigest()
    auth = (
        "AWS4-HMAC-SHA256 "
        f"Credential={access}/{credential_scope}, SignedHeaders={signed_headers}, Signature={signature}"
    )
    req = urllib.request.Request(
        f"https://{host}{canonical_uri}",
        data=body if method == "PUT" else None,
        method=method,
        headers={
            "Authorization": auth,
            "Host": host,
            "x-amz-content-sha256": payload_hash,
            "x-amz-date": amz_date,
        },
    )
    with urllib.request.urlopen(req, timeout=60) as response:
        return int(response.status)


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("path")
    parser.add_argument("key")
    parser.add_argument("--bucket", default="hive-repositories")
    args = parser.parse_args()

    account = os.environ["R2_ACCOUNT_ID"].strip()
    access = os.environ["R2_ACCESS_KEY_ID"].strip()
    secret = os.environ["R2_SECRET_ACCESS_KEY"].strip()
    if not all((account, access, secret)):
        raise SystemExit("R2_ACCOUNT_ID, R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY are required")

    path = pathlib.Path(args.path)
    body = path.read_bytes()
    digest = hashlib.sha256(body).hexdigest()
    status = _request("PUT", account=account, bucket=args.bucket, key=args.key, access=access, secret=secret, body=body)
    if status not in (200, 201):
        raise SystemExit(f"R2 PUT failed with HTTP {status}")
    head = _request("HEAD", account=account, bucket=args.bucket, key=args.key, access=access, secret=secret)
    if head != 200:
        raise SystemExit(f"R2 verification HEAD failed with HTTP {head}")
    print(json.dumps({"bucket": args.bucket, "key": args.key, "sha256": digest, "bytes": len(body)}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
