# Firestore Security Specification — Chinta Reader

## Phase 0: Core Data Invariants
- Every user-owned document stores `ownerId == request.auth.uid`.
- Only authenticated users with a verified email (`request.auth.token.email_verified == true`) can read or write their own data.
- Default-deny catch-all rule (`match /{document=**} { allow read, write: if false; }`) sits at the root of `match /databases/{database}/documents`.
- Subcollections (`/meta`, `/sources`, `/bookmarks`, `/readEntries`) enforce a **Master Gate**: single-doc writes/reads check `get(/databases/$(database)/documents/users/$(userId)).data.ownerId == request.auth.uid`, while `allow list:` queries check `isOwner(userId) && resource.data.ownerId == request.auth.uid` with ZERO `get()`/`exists()` calls (cost-optimized).
- All string fields enforce finite `.size() <= N` bounds matching `firebase-blueprint.json`.
- All list fields enforce `.size() <= N` and element-0 runtime type+length validation (Total Array Guarding).
- `createdAt == request.time` on `create`; `createdAt` and `ownerId` are immutable on `update` while `updatedAt == request.time`.
- Every `allow update:` begins with strict `isValid*(incoming())` validation plus explicit action-scoped `affectedKeys().hasOnly([...])` checks.
- Every document path uses safe ID regex `^[a-zA-Z0-9_\-]+$` (verified on `get`, `create`, `update`, `delete`).

## Phase 1: The Dirty Dozen Attack Scenarios (Must ALL Be Rejected)
1. **Unauthenticated read/write**: `{ auth: null }` reading `/users/alice` -> DENIED by `isVerifiedUser()`.
2. **Unverified email token**: `{ auth: { uid: 'alice', token: { email_verified: false } } }` writing `/users/alice` -> DENIED.
3. **Cross-tenant UID read/write**: User `bob` calling `get` or `list` on `/users/alice/sources` -> DENIED by `isOwner(userId)` + `ownerId == request.auth.uid`.
4. **UID Spoofing on create**: `bob` writing `/users/bob/sources/s1` with `{ ownerId: 'alice', ... }` -> DENIED (`ownerId == request.auth.uid`).
5. **Immutable `ownerId` hijack on update**: `alice` updating `/users/alice/sources/s1` setting `{ ownerId: 'bob' }` -> DENIED (`incoming().ownerId == existing().ownerId`).
6. **Client-faked timestamp (`createdAt` / `updatedAt`)**: Creating a bookmark with `{ createdAt: Timestamp(2020-01-01), updatedAt: Timestamp(2020-01-01) }` instead of `request.time` -> DENIED.
7. **Unparented orphan subcollection write**: Verified user writing `/users/alice/sources/s1` when `/users/alice` root document does not exist -> DENIED by Master Gate `get(...)`.
8. **Ghost / unwhitelisted field injection**: Adding `{ role: 'admin', isPro: true }` to `/users/alice/meta/state` -> DENIED by `keys().hasOnly(...)`.
9. **Oversized string DoS payload**: Creating a bookmark with a 50,000-character `title` -> DENIED (`title.size() <= 400`).
10. **Array type-smuggling / unbounded list**: Setting `defaultTags: [12345]` or 500 strings on `/users/alice/sources/s1` -> DENIED (`size() <= 20` & element-0 `is string && size() <= 64`).
11. **Invalid / path-traversal document ID**: Creating `/users/alice/sources/feed$bad` or 200-char ID -> DENIED by `isValidId(sourceId)`.
12. **Mutating `createdAt` on update**: Updating `meta/state` with altered `createdAt` -> DENIED (`incoming().createdAt == existing().createdAt`).
