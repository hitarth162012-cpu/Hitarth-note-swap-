# NoteSwap Firestore Security Specification (Phase 0 TDD)

## Data Invariants
1. **PII Isolation**: User email addresses live only in `/users/{userId}` and are readable only by the owning UID or a verified Admin. Public display info lives in `/users_public/{userId}`.
2. **Non-Escalating Roles**: Standard users can only create `/users/{userId}` and `/users_public/{userId}` with `role == 'student'` and cannot mutate `role`, `uid`, `email`, or `createdAt` on update.
3. **Verified Identity & Admin Gate**: Admin privileges require `request.auth.token.email_verified == true` and either an `/admins/{uid}` entry or the bootstrapped verified admin email `hitz90541@gmail.com`.
4. **Strict Keys & Server Timestamps**: Every document validates exact required/allowed keys, bounded string sizes, and server `request.time` timestamps.

## Dirty Dozen Adversarial Payloads (Must Return PERMISSION_DENIED)
1. Unauthenticated read on `/users/usr123`
2. Authenticated non-owner read on `/users/other_uid` (PII leak check)
3. Spoofed admin write where `token.email == 'hitz90541@gmail.com'` but `token.email_verified == false`
4. Student create on `/users/uid` setting `role: 'admin'`
5. Student update on `/users/uid` adding shadow field `{ isVerified: true }`
6. Student update on `/users/uid` changing immutable `uid`, `email`, or `createdAt`
7. Student update on `/users_public/uid` changing `role` to `'admin'`
8. Document ID poisoning (`userId` > 128 chars or containing invalid symbols like `$` or `/`)
9. Resource exhaustion (`displayName` > 64 chars or `email` > 254 chars)
10. Client-forged `createdAt` or `updatedAt` timestamp != `request.time`
11. Unauthenticated or student list scan on `/users` collection
12. Student write to `/admins/{uid}` to self-grant admin permissions
