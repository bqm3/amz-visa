# License flow

This app now supports a one-time activation flow with a machine-bound license bundle.

## Client configuration

Set these environment variables before packaging or running the exe:

- `AMZ_LICENSE_SERVER_URL`: license server base URL, for example `https://licenses.example.com`

Optional:

- `LICENSE_SERVER_URL`: fallback alias for the server URL

## Expected server endpoint

The client calls:

`POST /api/activate`

Request body:

```json
{
  "appId": "amz-us-app",
  "code": "123Abc",
  "machineId": "sha256-fingerprint",
  "hostname": "PC-NAME",
  "platform": "win32"
}
```

Successful response can be either:

```json
{
  "license": {
    "payloadB64": "base64(json payload)",
    "signatureB64": "base64(rsa signature)"
  }
}
```

or:

```json
{
  "payloadB64": "base64(json payload)",
  "signatureB64": "base64(rsa signature)"
}
```

## Payload schema

The signed payload should contain at least:

- `appId`
- `codeId`
- `machineId`
- `issuedAt`
- `expiresAt`

Example:

```json
{
  "appId": "amz-us-app",
  "codeId": "123Abc",
  "machineId": "sha256-fingerprint",
  "issuedAt": 1710000000000,
  "expiresAt": 1710086400000
}
```

## Server rules

- Mark each code as redeemed after the first successful activation.
- Reject the same code on a different `machineId`.
- Set `expiresAt` based on the plan you want to sell, for example:
  - 12 hours
  - 1 day
  - 3 days
  - 1 month

## Local storage

The client stores the activated license at:

`%APPDATA%/AmzUS/license.json`

The file is signed, so copying it to another machine will not validate.

## Vercel deploy

If you deploy the sample server on Vercel, use the folder:

`license-server/vercel`

That version uses MongoDB Atlas for persistence, so you must set:

- `ADMIN_TOKEN`
- `LICENSE_PRIVATE_KEY_PEM`
- `LICENSE_PUBLIC_KEY_PEM`
- `MONGODB_URI`
- `MONGODB_DB_NAME` optional, defaults to `amz_license`
