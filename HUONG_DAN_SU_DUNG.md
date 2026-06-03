# Huong Dan Su Dung - Multi-Chrome Card Checker

## Tom Tat Luong Moi

Tool khong chia card theo tung Chrome nua. Tat ca Chrome dung chung 1 hang doi card.

Vi du chay 3 Chrome:

```text
Chrome 1 / Account 1 -> lay card 1
Chrome 2 / Account 2 -> lay card 2
Chrome 3 / Account 3 -> lay card 3

Account nao xu ly xong truoc -> lay card tiep theo:
Account 1 xong -> lay card 4
Account 2 xong -> lay card 5
Account 3 xong -> lay card 6
```

Moi lan lay card, tool se check `src/data/checkcard.txt`:

```text
Neu card chua co trong checkcard.txt:
  -> ghi card vao checkcard.txt
  -> tiep tuc add card vao Amazon

Neu card da co trong checkcard.txt:
  -> bo qua card do
  -> lay card tiep theo trong card.txt
```

## Cac File Can Chuan Bi

### 1. Account: `src/data/acc.txt`

Moi dong la 1 account:

```text
email1@example.com|password1|secret1|code1
email2@example.com|password2|secret2|code2
email3@example.com|password3|secret3|code3
```

Luu y:

- Nen co so account nhieu hon so Chrome.
- Account da bi lock se duoc bo qua neu da nam trong `locked_accounts.txt` hoac `data.json`.

### 2. Card: `src/data/card.txt`

Moi dong la 1 card:

```text
4482330146024500|02|27|104|John Doe
5534509997091354|12|27|373|Jane Smith
```

Dinh dang:

```text
card_number|month|year|cvc|name
```

Luu y:

- `name` co the bo trong, tool se dung ten mac dinh.
- Tool se chuan hoa card thanh `number|month|year|cvc` khi ghi vao `checkcard.txt`.
- Vi du `02|27` va `2|2027` se duoc hieu cung 1 card.

### 3. Proxy: `src/data/proxies.txt`

Moi dong la 1 proxy:

```text
host:port:user:pass
```

Luu y:

- So proxy nen >= so Chrome.
- Neu proxy loi, Chrome do se dong va chuyen sang account tiep theo neu con.

### 4. Card Da Claim: `src/data/checkcard.txt`

File nay dung de tranh nhap trung card.

- Card duoc ghi vao file nay ngay khi Chrome claim card.
- Neu dung tool lai, card da co trong file nay se bi bo qua.
- Muon chay lai tu dau thi xoa noi dung file nay truoc khi bam Scan Card.

### 5. Account Bi Lock: `src/data/locked_accounts.txt`

Khi phat hien account bi lock, tool se ghi vao file nay:

```text
2026-06-03T10:00:00.000Z: email@example.com - ACCOUNT_LOCKED - AUTO_DETECTED
```

Sau do tool se:

1. Dong browser hien tai.
2. Lay account tiep theo trong queue.
3. Login account moi.
4. Tiep tuc lay card tu queue chung.

## Cach Chay

### Buoc 1: Nhap so Chrome

Tren giao dien, nhap so Chrome muon chay vao o `Number of Chrome`.

Khuyen nghi:

| Chrome | Account nen co | Proxy nen co | Ghi chu |
|---|---:|---:|---|
| 1 | 2-3 | 1 | Test nhe |
| 3 | 5-10 | 3 | On dinh |
| 5 | 10-15 | 5 | Khuyen nghi |
| 10 | 15-25 | 10 | May khoe moi nen chay |

### Buoc 2: Bam Apply Config

Sau khi dien account, card, proxy va so Chrome, bam `Apply Config`.

Tool se load:

- Tong so account.
- Tong so card.
- So Chrome can mo.
- So card da co trong `checkcard.txt`.
- Account da lock de bo qua.

### Buoc 3: Bam Scan Card

Tool se:

1. Mo so Chrome theo cau hinh.
2. Moi Chrome lay 1 account tu queue chung.
3. Moi account claim 1 card tu queue card chung.
4. Ghi card vua claim vao `checkcard.txt`.
5. Add card vao Amazon.
6. Ghi ket qua LIVE/DIE.
7. Account nao xong truoc thi lay card tiep theo.

## Luong Cap Card Dung

Vi du co 3 account dang chay song song va `card.txt` co 10 card:

```text
Lan dau:
Account 1 -> card 1
Account 2 -> card 2
Account 3 -> card 3

Neu Account 1 xong truoc:
Account 1 -> card 4

Neu Account 3 xong tiep:
Account 3 -> card 5

Neu Account 2 xong tiep:
Account 2 -> card 6
```

Khong co kieu:

```text
Chrome 1 -> card 1, 4, 7
Chrome 2 -> card 2, 5, 8
Chrome 3 -> card 3, 6, 9
```

Va cung khong co kieu:

```text
Chrome 1 -> 20 card rieng
Chrome 2 -> 20 card rieng
Chrome 3 -> 20 card rieng
```

Tat ca deu lay tu 1 queue chung.

## Xu Ly Account Bi Lock

Tool co the phat hien lock o nhieu thoi diem:

- Luc login.
- Sau khi vao trang `account-status.amazon.com`.
- Khi dang add card.
- Khi retry add card.
- Khi reload/check wallet.

Khi bi lock:

```text
Account A bi lock
-> ghi Account A vao locked_accounts.txt
-> ghi Account A vao data.json
-> dong browser cua Account A
-> lay Account tiep theo
-> login lai
-> tiep tuc queue card chung
```

Neu khong con account:

```text
Chrome do se dung
Card chua claim van con trong queue
Chrome khac van tiep tuc neu con dang chay
```

## Ket Qua Dau Ra

### `output/YYYY-MM-DD/live.txt`

Luu card LIVE.

### `output/YYYY-MM-DD/die.txt`

Luu card DIE.

### `src/data/checkcard.txt`

Luu card da claim, dung de tranh trung.

### `src/data/locked_accounts.txt`

Luu account bi lock.

### `remaining_cards.txt`

Luu danh sach card con lai chua duoc claim tu queue.

## Loi Thuong Gap

### 1. Nhieu account cung nhap 1 card

Kiem tra:

- `src/data/checkcard.txt` co ghi card sau khi claim khong.
- Card trong `card.txt` co bi lap san khong.
- Da dung ban code moi chua.

Tool moi se ghi card vao `checkcard.txt` truoc khi add, nen Chrome khac se bo qua card do.

### 2. Account lock nhung khong thay ghi file

Kiem tra file:

```text
src/data/locked_accounts.txt
```

Neu account bi lock trong luc login/add card/check wallet, tool se ghi vao file nay roi chuyen account khac.

### 3. Muon chay lai tu dau

Xoa noi dung cac file sau neu muon reset:

```text
src/data/checkcard.txt
src/data/locked_accounts.txt
```

Khong xoa `card.txt` va `acc.txt` neu van muon dung lai danh sach cu.

### 4. Het account

Them account vao:

```text
src/data/acc.txt
```

Sau do Apply Config va Scan Card lai.

### 5. Chrome mo cham hoac may lag

Giam so Chrome. Moi Chrome co the ton khoang 500MB-1GB RAM tuy tinh huong.

## Luu Y Quan Trong

- Khong can chia card thu cong cho tung Chrome.
- Khong can chia moi luong 20 card.
- Chi can dua tat ca card vao `src/data/card.txt`.
- `checkcard.txt` la file khoa trung card.
- `locked_accounts.txt` la file luu account bi lock.
- So Chrome cang cao thi can proxy va RAM cang nhieu.

## Flow Tong Quat

```text
1. Load account tu acc.txt
2. Bo qua account da lock
3. Load card tu card.txt
4. Load card da claim tu checkcard.txt
5. Mo N Chrome
6. Moi Chrome lay 1 account
7. Account claim 1 card tiep theo trong queue chung
8. Ghi card vao checkcard.txt
9. Add card va ghi LIVE/DIE
10. Account nao xong truoc quay lai buoc 7
11. Neu account lock -> ghi locked_accounts.txt -> login account khac
12. Het card hoac het account thi dung
```
