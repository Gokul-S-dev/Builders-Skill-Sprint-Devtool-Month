# Implementation Plan: Bookmark Manager

## Overview

Build a private, per-user bookmark collection from scratch on the AWS Blocks Level 1 platform. The implementation follows seven milestones: scaffold → authentication → bookmark table → typed API → frontend → security verification → persistence verification. All backend logic lives in a single `aws-blocks/index.ts` IFC file; the frontend consumes the typed `api` and `authApi` exports exclusively, with no `fetch()` calls.

---

## Tasks

- [ ] 1. Scaffold the project
  - [ ] 1.1 Run the AWS Blocks scaffold command and install dependencies
    - Execute `npm create @aws-blocks/blocks-app@latest . --template react` at the workspace root
    - Execute `npm install`
    - Execute `npm run dev` and verify the dev server starts at `http://localhost:3000`
    - Confirm `.bb-data/` directory is created after server start
    - _Requirements: 9.1 (DistributedTable-managed persistence layer must be present)_
  - [ ] 1.2 Remove sample code from the scaffold
    - Open `src/index.ts` (or `src/App.tsx` if that is where sample code lives)
    - Delete all sample todo/counter component code; leave only the React root mount and any Blocks import stubs
    - Verify the app still loads in the browser with no console errors after removal
    - _Requirements: 2.2 (signed-out state renders Authenticator and nothing else)_

- [ ] 2. Read AWS Blocks documentation
  - [ ] 2.1 Read the installed core and auth documentation before implementing any Block
    - Read `node_modules/@aws-blocks/blocks/docs/core.md`
    - Read `node_modules/@aws-blocks/blocks/docs/auth-common.md`
    - Read `node_modules/@aws-blocks/blocks/docs/bb-auth-basic.md`
    - Confirm the exact field name for user identity on the auth state object (`state.username` or equivalent) and the signature of `authApi.onAuthChange`
    - Confirm the correct import paths for `Authenticator`, `Scope`, `ApiNamespace`, and `isBlocksError`
    - _Requirements: 1.1, 10.1 (AuthBasic is the sole auth mechanism; all methods must be typed)_
  - [ ] 2.2 Read the DistributedTable documentation before implementing storage
    - Read `node_modules/@aws-blocks/blocks/docs/bb-distributed-table.md`
    - Confirm the exact signatures for `put()`, `get()`, `delete()`, and `query()` in the installed version
    - Confirm whether `Array.fromAsync()` is supported in the runtime (Node.js ≥ 22), or document the required `for await` fallback
    - _Requirements: 3.7, 4.4, 5.4, 9.1 (all DistributedTable operations must use the correct installed API)_

- [ ] 3. Implement the IFC layer skeleton in `aws-blocks/index.ts`
  - [ ] 3.1 Create `aws-blocks/index.ts` with Scope and AuthBasic
    - Import `Scope`, `ApiNamespace` from `@aws-blocks/blocks`
    - Import `AuthBasic` from `@aws-blocks/bb-auth-basic`
    - Import `DistributedTable` from `@aws-blocks/bb-distributed-table`
    - Import `z` from `zod`
    - Instantiate `new Scope('bookmark-manager')` — this identifier is **immutable after first deploy**
    - Instantiate `new AuthBasic(scope, 'auth')` — block ID `'auth'` is **immutable after first deploy**
    - Export `authApi` via `auth.createApi()`
    - _Requirements: 1.1, 1.3, 1.4 (AuthBasic provides session management for sign-up, sign-in, and sign-out)_
  - [ ] 3.2 Add the Zod bookmark schema and DistributedTable to `aws-blocks/index.ts`
    - Define `bookmarkSchema` with fields: `userId` (string), `bookmarkId` (string), `url` (string, `.url()`), `title` (string, `.min(1)`), `tag` (string, `.min(1)`), `createdAt` (string, `.datetime()`)
    - Derive the `Bookmark` TypeScript type via `z.infer<typeof bookmarkSchema>`
    - Instantiate `new DistributedTable(scope, 'bookmarks', { schema: bookmarkSchema, key: { partitionKey: 'userId', sortKey: 'bookmarkId' } })` — block ID `'bookmarks'` is **immutable after first deploy**
    - Verify `npm run dev` still starts without errors
    - _Requirements: 3.7, 3.8, 10.3 (Zod schema enforces all Bookmark fields before every write)_
  - [ ] 3.3 Write a unit test for the Zod schema
    - Test that `bookmarkSchema.parse(validBookmark)` succeeds for a well-formed record
    - Test that `bookmarkSchema.parse(invalidBookmark)` throws for a malformed URL, empty title, and empty tag
    - _Requirements: 3.8, 3.9_

- [ ] 4. Implement the ApiNamespace with all three API methods
  - [ ] 4.1 Implement `createBookmark` in `aws-blocks/index.ts`
    - Declare `ApiNamespace` with block ID `'api'`
    - Implement `async createBookmark(input: { url: string; title: string; tag: string })`:
      - First line: `const user = await auth.requireAuth(context)` — throws `SessionExpiredException` if no valid session
      - Set `userId = user.username` (NEVER from `input`)
      - Generate `bookmarkId = crypto.randomUUID()` server-side
      - Generate `createdAt = new Date().toISOString()` server-side
      - Call `await bookmarks.put({ userId, bookmarkId, url: input.url, title: input.title, tag: input.tag, createdAt })`
      - Return the full Bookmark record
    - Export `api` from the `new ApiNamespace(...)` call
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 8.1, 8.2_
  - [ ] 4.2 Implement `listBookmarks` in `aws-blocks/index.ts`
    - Add `async listBookmarks(): Promise<Bookmark[]>` to the ApiNamespace callback:
      - First line: `const user = await auth.requireAuth(context)`
      - Set `userId = user.username`
      - Return `await Array.fromAsync(bookmarks.query({ where: { userId: { equals: userId } } }))` (or `for await` fallback if Node.js < 22)
      - Method accepts NO client-supplied parameters
    - _Requirements: 4.1, 4.2, 4.3, 4.4, 4.5, 8.1_
  - [ ] 4.3 Implement `deleteBookmark` in `aws-blocks/index.ts`
    - Add `async deleteBookmark(input: { bookmarkId: string }): Promise<void>` to the ApiNamespace callback:
      - First line: `const user = await auth.requireAuth(context)`
      - Set `userId = user.username` (NEVER from `input`)
      - Call `const item = await bookmarks.get({ userId, bookmarkId: input.bookmarkId })`
      - If `item` is null, throw `{ name: 'NotFoundError', message: 'Bookmark not found' }` — do NOT delete any record
      - Call `await bookmarks.delete({ userId, bookmarkId: input.bookmarkId })`
    - Export `auth` alongside `api` and `authApi`
    - _Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6, 8.1, 8.3_
  - [ ] 4.4 Write property test for unauthenticated request rejection (Property 2)
    - **Property 2: Unauthenticated requests are rejected before any data operation**
    - For each of `createBookmark`, `listBookmarks`, `deleteBookmark`: call the method without a valid session cookie and assert that an authorization error is thrown and no DistributedTable operation is performed
    - **Validates: Requirements 3.3, 4.3, 5.3**
  - [ ] 4.5 Write property test for userId server-derivation (Property 3)
    - **Property 3: Created bookmarks are stored under the authenticated user's partition**
    - For any authenticated user calling `createBookmark` with valid input, assert that the stored `userId === user.username` and a subsequent `listBookmarks` call returns the bookmark with matching fields
    - **Validates: Requirements 3.4, 3.5, 3.6, 3.7**
  - [ ] 4.6 Write property test for unique bookmark identifiers (Property 4)
    - **Property 4: Server generates unique bookmark identifiers**
    - For any two separate `createBookmark` calls, assert that the returned `bookmarkId` values are distinct
    - **Validates: Requirements 3.5**
  - [ ] 4.7 Write property test for invalid input rejection (Property 5)
    - **Property 5: Invalid bookmark inputs are rejected**
    - For inputs with malformed URL, empty title, or empty tag: assert that `createBookmark` throws a validation error and no record is written to the DistributedTable
    - **Validates: Requirements 3.8, 3.9**
  - [ ] 4.8 Write property test for list partition isolation (Property 6)
    - **Property 6: Bookmark list is scoped exclusively to the authenticated user's partition**
    - For two distinct users A and B where B has created bookmarks: assert that A's `listBookmarks` result contains no records with `userId === user_B.username`
    - **Validates: Requirements 4.4, 4.5, 8.1, 8.2**
  - [ ] 4.9 Write property test for cross-user delete prevention (Property 7)
    - **Property 7: Delete uses composite key preventing cross-user deletion**
    - For authenticated User B calling `deleteBookmark({ bookmarkId })` where the bookmark belongs to User A: assert that a not-found error is thrown and User A's bookmark remains in the DistributedTable
    - **Validates: Requirements 5.4, 5.5, 5.6, 8.3**
  - [ ] 4.10 Write property test for selective deletion (Property 8)
    - **Property 8: Deleting one bookmark leaves all other bookmarks intact**
    - For a user with two or more bookmarks, after deleting one: assert that `listBookmarks` returns all previously existing bookmarks minus the deleted one, with all fields unchanged
    - **Validates: Requirements 5.6**

- [ ] 5. Checkpoint — Verify IFC layer compiles and API methods are reachable
  - Run `npx tsc --noEmit` and confirm 0 errors
  - Run `npm run dev`, open the browser console while signed in (after completing task 6.1), and verify:
    - `await api.createBookmark({ url: 'https://example.com', title: 'Test', tag: 'misc' })` returns a bookmark object
    - `await api.listBookmarks()` returns an array containing the created bookmark
    - `await api.deleteBookmark({ bookmarkId: '<id>' })` resolves without error
    - `await api.listBookmarks()` returns an empty array
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 6. Implement the frontend
  - [ ] 6.1 Create `src/types.ts` with shared TypeScript types
    - Export `Bookmark` type inferred from `bookmarkSchema` (or re-exported from the IFC layer)
    - Export `FormState` type: `'idle' | 'loading' | 'success' | 'error'`
    - Export `ListState` type: `{ status: 'idle' | 'loading' | 'success' | 'error'; items: Bookmark[]; error?: string }`
    - _Requirements: 10.1, 10.2 (all types must be explicit and consistent across the frontend)_
  - [ ] 6.2 Implement auth state observation in `src/index.ts`
    - Import `api`, `authApi` from `'aws-blocks'` — no `fetch()` anywhere in this file
    - Import `Authenticator` from `@aws-blocks/blocks/ui` (confirm exact import path from docs)
    - Use `useState<AuthState | null>(null)` to hold the auth state
    - Use `useEffect` with `return authApi.onAuthChange(state => { setAuthState(state); if (!state.isAuthenticated) { setBookmarks([]); } })` to observe auth events
    - When `authState === null` or `!authState.isAuthenticated`: render `<Authenticator authApi={authApi} />` only
    - When `authState.isAuthenticated`: render the signed-in view (UserHeader, BookmarkForm, BookmarkList)
    - _Requirements: 1.2, 2.1, 2.2, 2.3, 2.4_
  - [ ] 6.3 Implement `UserHeader.tsx`
    - Accept `username: string` and `onSignOut: () => void` (or equivalent auth API method) as props
    - Display the username string sourced from `authState`
    - Render a sign-out button that calls the `authApi` sign-out method
    - _Requirements: 1.5, 2.1, 2.2_
  - [ ] 6.4 Write a unit test for UserHeader rendering (Property 1 — partial)
    - **Property 1: Signed-in UI renders all required elements**
    - Assert that `<UserHeader />` renders the username and a sign-out control when given valid props
    - **Validates: Requirements 2.1, 2.2**
  - [ ] 6.5 Implement `BookmarkForm.tsx`
    - Controlled inputs for `url`, `title`, `tag` fields with per-field error state
    - Client-side validation before calling the API:
      - `url`: use `z.string().url()` — show "Please enter a valid URL" on failure
      - `title`: non-empty after `.trim()` — show "Title is required" on failure
      - `tag`: non-empty after `.trim()` — show "Tag is required" on failure
    - On validation failure: set field-level errors and return WITHOUT calling `api.createBookmark`
    - On validation success: set `formState = 'loading'`, call `await api.createBookmark({ url, title, tag })`
    - On success: set `formState = 'success'`, reset all fields to `''`, call the parent-supplied `onBookmarkCreated` callback to refresh the list
    - On error: set `formState = 'error'`, set `formError = err.message`
    - Accept `onBookmarkCreated: () => void` prop for list refresh coordination
    - NO `fetch()` calls; use `api` from `'aws-blocks'` exclusively
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 6.9_
  - [ ] 6.6 Write property test for client-side form validation (Property 9)
    - **Property 9: Client-side form validation rejects invalid submissions**
    - For each invalid input case (non-URL, empty title, empty tag): assert that field-level error messages are displayed and `api.createBookmark` is NOT called
    - **Validates: Requirements 6.2, 6.3, 6.4, 6.5**
  - [ ] 6.7 Implement `BookmarkList.tsx`
    - Define `loadBookmarks` function: sets `listState = { status: 'loading', items: [] }`, calls `await api.listBookmarks()`, then sets success or error state
    - Call `loadBookmarks` on mount via `useEffect`
    - Accept `reloadTrigger` or equivalent mechanism so parent can trigger a refresh after create/delete
    - Render four states:
      - `loading`: spinner or skeleton placeholder
      - `error`: error message + "Retry" button that calls `loadBookmarks()`
      - `success` with empty `items`: "No bookmarks yet. Add one above."
      - `success` with items: render `<BookmarkItem />` for each
    - Pass `onDeleted={() => loadBookmarks()}` to each `BookmarkItem`
    - NO `fetch()` calls; use `api` from `'aws-blocks'` exclusively
    - _Requirements: 7.1, 7.7_
  - [ ] 6.8 Implement `BookmarkItem.tsx`
    - Props: `bookmark: Bookmark`, `onDeleted: () => void`
    - Display: `title` as text, `url` as `<a href={url} target="_blank" rel="noopener noreferrer">`, `tag` as a badge/label, `createdAt` formatted via `new Date(createdAt).toLocaleDateString()`
    - Delete button: calls `await api.deleteBookmark({ bookmarkId: bookmark.bookmarkId })`
    - On success: call `onDeleted()` to refresh the list
    - On error: display `(err as Error).message`; do NOT modify the locally displayed list
    - Import `isBlocksError` from `@aws-blocks/blocks` for structured error checks
    - NO `fetch()` calls; use `api` from `'aws-blocks'` exclusively
    - _Requirements: 7.2, 7.3, 7.4, 7.5, 7.6, 7.7_
  - [ ] 6.9 Write property test for BookmarkItem rendering (Property 10)
    - **Property 10: Bookmark item rendering contains all required fields**
    - For any `Bookmark` object: assert that the rendered `BookmarkItem` includes the title, url, tag, createdAt values, and a delete control
    - **Validates: Requirements 7.2, 7.3**
  - [ ] 6.10 Wire all components into the signed-in view in `src/index.ts`
    - Render `<UserHeader username={authState.username} />`, `<BookmarkForm onBookmarkCreated={...} />`, and `<BookmarkList />` within the signed-in branch
    - Ensure that creating a bookmark triggers `BookmarkList` to reload
    - Ensure that signing out clears local bookmark list state
    - _Requirements: 2.3, 2.4, 8.4 (UI controls are not authorization; all data operations go through the API)_

- [ ] 7. Checkpoint — Verify full frontend happy path
  - Run `npx tsc --noEmit` and confirm 0 errors
  - Open the browser and run the complete happy path: sign in → create bookmark via form → see it in list → delete it → list shows "No bookmarks yet"
  - Test validation: submit form with empty title → field error shown, API not called; submit with non-URL → field error shown, API not called
  - Confirm loading state is visible on the list while `listBookmarks` is in flight
  - Ensure all tests pass, ask the user if questions arise.

- [ ] 8. Security verification
  - [ ] 8.1 Verify signed-out API access is rejected (Security Test 1)
    - In an incognito tab with no session, open the browser console
    - Run `await api.createBookmark({ url: 'https://evil.com', title: 'Hacked', tag: 'test' })`
    - Assert: the promise rejects with a `SessionExpiredException` or equivalent authentication error
    - Assert: no file is written under `.bb-data/`
    - _Requirements: 3.3, 4.3, 5.3_
  - [ ] 8.2 Verify User A cannot see User B's bookmarks (Security Test 2)
    - Sign up and sign in as User A; create a bookmark with title "User A Bookmark"
    - Sign out; sign up and sign in as User B
    - Run `await api.listBookmarks()` — assert the array does NOT contain "User A Bookmark"
    - _Requirements: 4.4, 4.5, 8.1, 8.2_
  - [ ] 8.3 Verify User B cannot delete User A's bookmark (Security Test 3)
    - Sign in as User A; create a bookmark; note the returned `bookmarkId`
    - Sign out; sign in as User B
    - Run `await api.deleteBookmark({ bookmarkId: '<bookmarkId_A>' })` — assert it rejects with `NotFoundError`
    - Sign out; sign in as User A; run `await api.listBookmarks()` — assert the bookmark is still present
    - _Requirements: 5.4, 5.5, 5.6, 8.3_
  - [ ] 8.4 Verify ownership is enforced on all three methods (Security Test 4)
    - Review `aws-blocks/index.ts` and confirm:
      - `createBookmark` has NO `userId` in its input parameter type; `userId = user.username`
      - `listBookmarks` has NO parameters at all; queries `{ equals: user.username }`
      - `deleteBookmark` has NO `userId` in its input parameter type; delete key uses `userId: user.username`
    - Run `npx tsc --noEmit` to confirm no method signature contains a `userId` parameter
    - _Requirements: 8.1, 8.2, 8.4_

- [ ] 9. Persistence verification
  - [ ] 9.1 Verify bookmarks survive a browser page refresh (Persistence Test 1)
    - Sign in as a user; create a bookmark via the form; note the title
    - Press F5 / Cmd+R to refresh the page; sign in again if required
    - Assert: the bookmark is still visible in the list with the same title, url, tag, and createdAt
    - _Requirements: 9.1_
  - [ ] 9.2 Verify bookmarks survive a dev server restart (Persistence Test 2)
    - Sign in as a user; create a bookmark via the form; note the title
    - Stop the dev server (Ctrl+C); run `npm run dev` again; navigate to `http://localhost:3000`; sign in
    - Assert: the bookmark from before the restart is still present and the `.bb-data/` directory contents were preserved
    - _Requirements: 9.2_
  - [ ] 9.3 Verify bookmarks survive sign-out and re-login (Persistence Test 3)
    - Sign in as a user; create a bookmark via the form; note the title
    - Click "Sign out"; sign back in with the same credentials
    - Assert: the bookmark is visible in the list; `user.username` is the same stable identifier used as the partition key
    - _Requirements: 9.1, 9.3_

- [ ] 10. Final TypeScript compilation check
  - [ ] 10.1 Ensure the full project compiles without errors
    - Run `npx tsc --noEmit` — assert 0 errors
    - If errors exist, fix them before proceeding
    - _Requirements: 10.1, 10.4 (type errors caught at compile time)_

---

## Notes

- Tasks marked with `*` are optional and can be skipped for a faster MVP
- Read `node_modules/@aws-blocks/blocks/docs/` before each Block implementation — never assume APIs from older examples still exist
- Block IDs `'auth'`, `'bookmarks'`, and `'api'` and the Scope name `'bookmark-manager'` are **immutable once the dev server has started** — renaming them destroys all data
- `userId` must always come from `auth.requireAuth(context)` — never from client input; this is the single most important security invariant in the system
- If Node.js < 22, replace `Array.fromAsync(...)` with a `for await` loop collecting into an array
- The `isBlocksError` import path should be verified against the installed package; it may be `@aws-blocks/blocks` or a sub-path like `@aws-blocks/blocks/errors`
- The frontend must import `api` and `authApi` exclusively from `'aws-blocks'`; no `fetch()`, no `localStorage`, no direct `.bb-data/` access anywhere in `src/`
- Checkpoints at tasks 5 and 7 are integration gates — do not proceed to the next milestone until they pass

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "2.1", "2.2"] },
    { "id": 2, "tasks": ["3.1"] },
    { "id": 3, "tasks": ["3.2"] },
    { "id": 4, "tasks": ["3.3", "4.1"] },
    { "id": 5, "tasks": ["4.2", "4.3"] },
    { "id": 6, "tasks": ["4.4", "4.5", "4.6", "4.7", "4.8", "4.9", "4.10"] },
    { "id": 7, "tasks": ["6.1"] },
    { "id": 8, "tasks": ["6.2", "6.3"] },
    { "id": 9, "tasks": ["6.4", "6.5"] },
    { "id": 10, "tasks": ["6.6", "6.7"] },
    { "id": 11, "tasks": ["6.8", "6.9"] },
    { "id": 12, "tasks": ["6.10"] },
    { "id": 13, "tasks": ["8.1", "8.2", "8.3", "8.4", "9.1", "9.2", "9.3"] },
    { "id": 14, "tasks": ["10.1"] }
  ]
}
```
