#!/usr/bin/env python3
"""App Store Connect chores for the TestFlight workflow, using the API key.

    asc.py prepare  BUNDLE_ID NAME   register the bundle ID with iCloud and push,
                                     and check the app exists in App Store Connect
    asc.py testers  BUNDLE_ID        make sure an internal TestFlight group gets
                                     every build, with the team's users in it

Reads ASC_KEY_ID, ASC_ISSUER_ID and the key file at
~/private_keys/AuthKey_<ASC_KEY_ID>.p8. Standard library plus the openssl
command only, so the runner needs nothing installed.

Anything the API cannot do is reported in plain words as a GitHub error
annotation, saying exactly which page to open and what to press.
"""

import base64
import json
import os
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

API = "https://api.appstoreconnect.apple.com/v1"


def b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def der_to_raw(der: bytes) -> bytes:
    """openssl writes an ECDSA signature as DER; a JWT wants r||s, 32 bytes each."""
    def read_int(buf, i):
        assert buf[i] == 0x02, "expected INTEGER"
        length = buf[i + 1]
        value = buf[i + 2:i + 2 + length]
        return value.lstrip(b"\x00").rjust(32, b"\x00"), i + 2 + length

    assert der[0] == 0x30, "expected SEQUENCE"
    i = 2 if der[1] < 0x80 else 2 + (der[1] & 0x7F)
    r, i = read_int(der, i)
    s, _ = read_int(der, i)
    return r + s


def token() -> str:
    key_id = os.environ["ASC_KEY_ID"]
    issuer = os.environ["ASC_ISSUER_ID"]
    key_path = os.path.expanduser(f"~/private_keys/AuthKey_{key_id}.p8")
    header = {"alg": "ES256", "kid": key_id, "typ": "JWT"}
    now = int(time.time())
    payload = {"iss": issuer, "iat": now, "exp": now + 15 * 60, "aud": "appstoreconnect-v1"}
    signing_input = b64url(json.dumps(header).encode()) + "." + b64url(json.dumps(payload).encode())
    der = subprocess.run(
        ["openssl", "dgst", "-sha256", "-sign", key_path],
        input=signing_input.encode(), capture_output=True, check=True,
    ).stdout
    return signing_input + "." + b64url(der_to_raw(der))


def call(method: str, path: str, body=None, params=None):
    url = API + path
    if params:
        url += "?" + urllib.parse.urlencode(params)
    data = json.dumps(body).encode() if body is not None else None
    request = urllib.request.Request(url, data=data, method=method, headers={
        "Authorization": "Bearer " + token(),
        "Content-Type": "application/json",
    })
    try:
        with urllib.request.urlopen(request) as response:
            raw = response.read()
            return json.loads(raw) if raw else {}
    except urllib.error.HTTPError as error:
        detail = error.read().decode(errors="replace")
        raise RuntimeError(f"{method} {path} → HTTP {error.code}: {detail}") from None


def error(message: str):
    print(f"::error::{message}")


def warning(message: str):
    print(f"::warning::{message}")


def find_bundle(bundle_id: str):
    found = call("GET", "/bundleIds", params={"filter[identifier]": bundle_id, "limit": 200})
    for item in found.get("data", []):
        if item["attributes"]["identifier"] == bundle_id:
            return item
    return None


def prepare(bundle_id: str, name: str) -> int:
    bundle = find_bundle(bundle_id)
    if bundle is None:
        print(f"Registering the bundle ID {bundle_id}")
        bundle = call("POST", "/bundleIds", {"data": {
            "type": "bundleIds",
            "attributes": {"identifier": bundle_id, "name": name, "platform": "IOS"},
        }})["data"]
    else:
        print(f"Bundle ID {bundle_id} is registered")

    have = {c["attributes"]["capabilityType"]
            for c in call("GET", f"/bundleIds/{bundle['id']}/bundleIdCapabilities").get("data", [])}
    wanted = {
        "ICLOUD": [{"key": "ICLOUD_VERSION", "options": [{"key": "XCODE_6"}]}],
        "PUSH_NOTIFICATIONS": None,
    }
    for capability, settings in wanted.items():
        if capability in have:
            print(f"  {capability}: on")
            continue
        attributes = {"capabilityType": capability}
        if settings:
            attributes["settings"] = settings
        try:
            call("POST", "/bundleIdCapabilities", {"data": {
                "type": "bundleIdCapabilities",
                "attributes": attributes,
                "relationships": {"bundleId": {"data": {"type": "bundleIds", "id": bundle["id"]}}},
            }})
            print(f"  {capability}: switched on")
        except RuntimeError as problem:
            warning(f"Could not switch on {capability} for {bundle_id}: {problem}")

    apps = call("GET", "/apps", params={"filter[bundleId]": bundle_id}).get("data", [])
    if not apps:
        error(
            f"There is no app for {bundle_id} in App Store Connect yet, and Apple does not let "
            f"an API key create one. Once only: open https://appstoreconnect.apple.com/apps, "
            f"press + → New App, tick iOS, Name: {name}, Language: English, "
            f"Bundle ID: {bundle_id}, SKU: {bundle_id}, Full Access. Then run this workflow again."
        )
        return 1
    print(f"App Store Connect app: {apps[0]['attributes']['name']} (id {apps[0]['id']})")
    return 0


def testers(bundle_id: str) -> int:
    apps = call("GET", "/apps", params={"filter[bundleId]": bundle_id}).get("data", [])
    if not apps:
        return 0
    app_id = apps[0]["id"]

    groups = call("GET", f"/apps/{app_id}/betaGroups").get("data", [])
    internal = [g for g in groups if g["attributes"].get("isInternalGroup")]
    if internal:
        group = internal[0]
        print(f"Internal TestFlight group: {group['attributes']['name']}")
    else:
        group = call("POST", "/betaGroups", {"data": {
            "type": "betaGroups",
            "attributes": {"name": "Me", "isInternalGroup": True, "hasAccessToAllBuilds": True},
            "relationships": {"app": {"data": {"type": "apps", "id": app_id}}},
        }})["data"]
        print("Created the internal TestFlight group \"Me\", which receives every build")

    members = {t["attributes"].get("email", "").lower()
               for t in call("GET", f"/betaGroups/{group['id']}/betaTesters", params={"limit": 200}).get("data", [])}
    try:
        users = call("GET", "/users", params={"limit": 200}).get("data", [])
    except RuntimeError as problem:
        warning(f"Could not read the team's users to add them as testers: {problem}")
        return 0
    for user in users:
        attributes = user["attributes"]
        email = (attributes.get("username") or "").lower()
        if not email or email in members:
            continue
        try:
            call("POST", "/betaTesters", {"data": {
                "type": "betaTesters",
                "attributes": {"email": email,
                               "firstName": attributes.get("firstName", ""),
                               "lastName": attributes.get("lastName", "")},
                "relationships": {"betaGroups": {"data": [{"type": "betaGroups", "id": group["id"]}]}},
            }})
            print(f"  added {attributes.get('firstName', '')} {attributes.get('lastName', '')} as a tester")
        except RuntimeError as problem:
            warning(f"Could not add a tester: {problem}")
    return 0


def main() -> int:
    if len(sys.argv) < 3:
        print(__doc__)
        return 2
    command, bundle_id = sys.argv[1], sys.argv[2]
    try:
        if command == "prepare":
            return prepare(bundle_id, sys.argv[3] if len(sys.argv) > 3 else bundle_id)
        if command == "testers":
            return testers(bundle_id)
    except RuntimeError as problem:
        error(str(problem))
        return 1
    print(__doc__)
    return 2


if __name__ == "__main__":
    sys.exit(main())
