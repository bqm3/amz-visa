# License Flow

Tai lieu nay giai thich luong license cua project hien tai:

- tao code
- gan code vao dung `machineId`
- kich hoat app
- ky license
- xac thuc license
- tai sao code dung 1 lan
- cach client "giai ma" license

## 1. Tong quan

He thong nay co 2 phan:

1. **Client app**
   - File chinh lien quan:
     - [src/util/licenseManager.js](./src/util/licenseManager.js)
     - [src/ui/licenseDialog.js](./src/ui/licenseDialog.js)
     - [main.js](./main.js)
   - Nhiem vu:
     - hien thi hop nhap ma
     - lay `machineId`
     - goi API server de kich hoat
     - luu license vao may
     - kiem tra license moi lan mo app

2. **License server**
   - File chinh lien quan:
     - [license-server/vercel/api/admin/codes.js](./license-server/vercel/api/admin/codes.js)
     - [license-server/vercel/api/activate.js](./license-server/vercel/api/activate.js)
     - [license-server/vercel/api/public-key.js](./license-server/vercel/api/public-key.js)
     - [license-server/vercel/api/_lib.js](./license-server/vercel/api/_lib.js)
   - Nhiem vu:
     - tao code
     - gan code voi `machineId` neu co
     - danh dau code da dung
     - ky license bang private key
     - tra public key cho client de verify

## 2. Khai niem quan trong

### 2.1 Code kich hoat

`code` la ma ban gui cho nguoi dung, vi du:

```text
ABC123
```

Code co the duoc gan:

- thoi han
- ghi chu
- machineId muc tieu
- trang thai da dung/chua dung

### 2.2 Machine ID

`machineId` la gia tri bam (hash) tao tu thong tin may local:

- hostname
- platform
- arch
- release
- cpu
- total memory
- MAC address

No duoc tao bang:

- [src/util/licenseManager.js](./src/util/licenseManager.js)

Muc dich:

- roi may A khong dung cho may B
- neu copy exe sang may khac, license van khong hop le

### 2.3 Public key va private key

He thong dung RSA:

- **private key**: chi server giu, dung de **ky**
- **public key**: client lay tu API, dung de **verify**

Day khong phai ma hoa/de ma hoa theo nghia thong thuong, ma la:

- server ky du lieu license
- client kiem tra chu ky co dung khong

## 3. Luong tao code

### 3.1 Admin goi API tao code

API:

```http
POST /api/admin/codes
```

Body mau:

```json
{
  "code": "ABC123",
  "duration": "12h",
  "machineId": "d3aa4f0fa9d94f680e37e7bbba7f2ab4900c00399e01bbba987ba8dec5a56591",
  "note": "machine A"
}
```

`machineId` la optional, nhung neu co thi code do chi dung cho may nay.

### 3.2 Server luu vao MongoDB

Server luu 1 record vao collection `codes`:

```json
{
  "code": "ABC123",
  "appId": "amz-us-app",
  "durationMs": 43200000,
  "note": "machine A",
  "boundMachineId": "d3aa4f0f...",
  "createdAt": 1710000000000,
  "used": false,
  "usedAt": null,
  "usedBy": null,
  "activation": null
}
```

### 3.3 Code chi dung 1 lan

Sau khi code duoc activate:

- `used = true`
- `usedAt` co gia tri
- `usedBy` luu machineId cua may da kich hoat
- `activation` luu thoi diem bat dau va het han

## 4. Luong kich hoat app

### 4.1 App lay machineId

Khi mo hop kich hoat, app hien:

- machineId
- server URL
- o nhap code

Nguoi dung co the bam:

- **Copy Machine ID**

de gui cho admin tao code dung may.

### 4.2 App gui request kich hoat

Client goi:

```http
POST /api/activate
```

Body:

```json
{
  "appId": "amz-us-app",
  "code": "ABC123",
  "machineId": "d3aa4f0fa9d94f680e37e7bbba7f2ab4900c00399e01bbba987ba8dec5a56591",
  "hostname": "PC-A",
  "platform": "win32"
}
```

### 4.3 Server kiem tra

Server se check theo thu tu:

1. `appId` co dung khong
2. `code` co ton tai khong
3. `machineId` co dung voi code da gan san khong
4. `code` da bi dung chua
5. con han hay khong
6. private key co hop le khong

Neu hop le, server se:

- ky license
- tra ve `license.payloadB64`
- tra ve `license.signatureB64`

## 5. License duoc ky nhu the nao

License khong phai la file text vo nghia. No la 1 goi gom 2 phan:

### 5.1 Payload

Payload la JSON, vi du:

```json
{
  "appId": "amz-us-app",
  "codeId": "ABC123",
  "machineId": "d3aa4f0f...",
  "issuedAt": 1710000000000,
  "expiresAt": 1710004320000,
  "hostname": "PC-A",
  "platform": "win32"
}
```

Sau do payload nay duoc:

- stringify
- encode base64

### 5.2 Signature

Server dung `LICENSE_PRIVATE_KEY_PEM` de ky chuoi `payloadB64`.

Ket qua la:

- `signatureB64`

Client khong tu tao duoc chu ky nay vi client **khong co private key**.

## 6. "Giai ma" license co nghia la gi

Trong flow nay, "giai ma" thuong co 2 nghia:

1. **Decode payload**
   - lay `payloadB64`
   - base64 decode
   - parse JSON

2. **Verify signature**
   - dung public key lay tu server
   - check chu ky co dung voi payload khong

Neu verify pass thi license duoc coi la hop le.

## 7. Client verify license nhu the nao

Client lam 4 buoc:

1. Doc license da luu local
2. Goi `GET /api/public-key`
3. Verify chu ky bang public key
4. Check them:
   - `appId`
   - `machineId`
   - `expiresAt`
   - clock skew

File lien quan:

- [src/util/licenseManager.js](./src/util/licenseManager.js)

## 8. Tai sao code co the dung 1 lan

Khi 1 code da kich hoat:

- server set `used = true`
- luu `usedBy.machineId`
- luu `activation`

Lan sau:

- neu cung `machineId` va code do da co license hop le, server co the tra lai license cho cung may
- neu machineId khac, server se chan

Neu ban muon rat chat:

- code tao ra co the chi cho phep dung dung 1 machineId ngay tu luc tao

## 9. Luong thuc te cua ban

Day la luong don gian nhat:

### Buoc 1
Ban bam **Copy Machine ID** trong app.

### Buoc 2
Ban tao code qua API admin, gan voi machineId do.

### Buoc 3
Nguoi dung mo app, nhap code.

### Buoc 4
Client goi server.

### Buoc 5
Server kiem tra:

- code co dung khong
- machineId co dung khong
- con han khong

Neu dung, server ky license va app login.

## 10. Cac API chinh

### 10.1 Lay public key

```http
GET /api/public-key
```

Tra ve:

```json
{
  "ok": true,
  "publicKey": "-----BEGIN PUBLIC KEY-----..."
}
```

### 10.2 Tao code

```http
POST /api/admin/codes
```

### 10.3 Kich hoat

```http
POST /api/activate
```

## 11. Cac file quan trong

- [main.js](./main.js)
- [src/ui/licenseDialog.js](./src/ui/licenseDialog.js)
- [src/util/licenseManager.js](./src/util/licenseManager.js)
- [license-server/vercel/api/_lib.js](./license-server/vercel/api/_lib.js)
- [license-server/vercel/api/admin/codes.js](./license-server/vercel/api/admin/codes.js)
- [license-server/vercel/api/activate.js](./license-server/vercel/api/activate.js)
- [license-server/vercel/api/public-key.js](./license-server/vercel/api/public-key.js)

## 12. Loi thuong gap

### 12.1 `Chua cau hinh AMZ_LICENSE_SERVER_URL`

Client chua co URL server.

Khac phuc:

- set `AMZ_LICENSE_SERVER_URL`
- hoac tao `.env`

### 12.2 `Ma nay da duoc su dung roi`

Code da bi consume.

Khac phuc:

- tao code moi
- hoac cho phep reissue cho cung machineId neu server da cau hinh nhu vay

### 12.3 `CODE_MACHINE_MISMATCH`

Code duoc tao cho machineId khac.

Khac phuc:

- tao code dung machineId cua may dang dung

### 12.4 `LICENSE_PRIVATE_KEY_PEM_INVALID_FORMAT`

Private key tren server bi dan sai format.

Khac phuc:

- phai dan PEM that
- giu nguyen:

```text
-----BEGIN PRIVATE KEY-----
...
-----END PRIVATE KEY-----
```

### 12.5 `PUBLIC_KEY_MISSING`

Client khong lay duoc public key tu server.

Khac phuc:

- kiem tra `/api/public-key`
- redeploy server
- kiem tra env `LICENSE_PUBLIC_KEY_PEM`

## 13. Phan biet "code", "license", "key"

- `code`: ma admin tao cho nguoi dung
- `license`: goi da ky tra ve cho client
- `private key`: key server giu de ky
- `public key`: key client dung de verify

## 14. Tom tat ngan

1. Admin tao code va gan `machineId` neu can.
2. App lay `machineId` tu may local.
3. Nguoi dung nhap code.
4. Client goi `/api/activate`.
5. Server kiem tra code + machineId + han dung.
6. Neu hop le, server ky license.
7. Client verify bang public key va luu license local.

## 15. Ghi chu quan trong

He thong nay chi an toan khi:

- private key chi nam tren server
- client chi nhan public key
- server la noi duy nhat quyet dinh code co hop le hay khong

Neu ban muon, minh co the viet them 1 file tai lieu nua ve:

- cach deploy Vercel
- cach set MongoDB Atlas
- cach tao code batch bang PowerShell
- cach doc response API de debug
