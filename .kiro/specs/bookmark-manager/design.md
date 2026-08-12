# Design Document — Bookmark Manager

## Overview

The Bookmark Manager is a private, per-user bookmark collection built on the **AWS Blocks Level 1** platform. The workspace is scaffolded entirely from scratch. Authenticated users can sign up, sign in, sign out, create bookmarks, list their own bookmarks, and delete their own bookmarks. Every user's bookmark collection is fully isolated from every other user's collection.

The system uses four AWS Blocks primitives:

| Primitive | Role |
|---|---|
| `Scope` | Application-level namespace; all Blocks are registered under one scope |
| `AuthBasic` | Username/password authentication with JWT session cookies |
| `DistributedTable` | DynamoDB-backed structured storage for Bookmark records |
| `ApiNamespace` | Type-safe RPC bridge from browser to backend Lambda handlers |

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│  Browser (React)                                                   │
│                                                                    │
│  src/index.ts                                                      │
│  ┌───────────────────────────────────────────────────────────┐    │
│  │  Signed-out state            Signed-in state              │    │
│  │  ┌──────────────────┐        ┌────────────────────────┐   │    │
│  │  │  <Authenticator  │        │  <UserHeader />         │   │    │
│  │  │   authApi={...}/>│        │  <BookmarkForm />       │   │    │
│  │  └──────────────────┘        │  <BookmarkList />       │   │    │
│  │                              └────────────────────────┘   │    │
│  └───────────────────────────────────────────────────────────┘    │
│       │ import { api, authApi } from 'aws-blocks'                 │
└───────┼──────────────────────────────────────────────────────────┘
        │ ApiNamespace (local HTTP server / API Gateway + Lambda)
┌───────▼──────────────────────────────────────────────────────────┐
│  aws-blocks/index.ts  (IFC Layer)                                  │
│                                                                    │
│  new Scope('bookmark-manager')                                     │
│  new AuthBasic(scope, 'auth')       → export authApi               │
│  new DistributedTable(scope, 'bookmarks', { schema, key })         │
│  new ApiNamespace(scope, 'api', (context) => {                     │
│      createBookmark(input)  → requireAuth → put()                  │
│      listBookmarks()        → requireAuth → query()                │
│      deleteBookmark(input)  → requireAuth → get() + delete()       │
│  })                         → export api                           │
└──────────────────────────────────┬───────────────────────────────┘
                                   │
               ┌───────────────────▼───────────────────┐
               │  .bb-data/ (Block-managed local store)  │
               │  .bb-data/bookmark-manager/bookmarks/   │
               └───────────────────────────────────────┘
```

**Data flow — createBookmark:**
1. Browser calls `api.createBookmark({ url, title, tag })` via typed export
2. ApiNamespace routes to the handler (local HTTP server or Lambda)
3. Handler calls `auth.requireAuth(context)` → throws `SessionExpiredException` if no valid session cookie; returns `{ username, ... }` otherwise
4. Handler sets `userId = user.username`, generates `bookmarkId = crypto.randomUUID()`, `createdAt = new Date().toISOString()`
5. Handler calls `bookmarks.put({ userId, bookmarkId, url, title, tag, createdAt })`
6. DistributedTable runs Zod validation internally before writing
7. Handler returns `{ bookmarkId, url, title, tag, createdAt }` to the browser

**Data flow — listBookmarks:**
1. Browser calls `api.listBookmarks()`
2. Handler calls `auth.requireAuth(context)` → gets `user.username`
3. Handler queries `bookmarks.query({ where: { userId: { equals: user.username } } })` — scoped to one DynamoDB partition
4. Returns array of Bookmark records belonging only to this user

**Data flow — deleteBookmark:**
1. Browser calls `api.deleteBookmark({ bookmarkId })`
2. Handler calls `auth.requireAuth(context)` → gets `user.username`
3. Handler calls `bookmarks.get({ userId: user.username, bookmarkId })` — returns null if not found (or belongs to different user)
4. If null, throws NotFoundError; otherwise calls `bookmarks.delete({ userId: user.username, bookmarkId })`

---

## Data Models

### Zod Schema

```typescript
const bookmarkSchema = z.object({
  userId:     z.string(),
  bookmarkId: z.string(),
  url:        z.string().url(),
  title:      z.string().min(1),
  tag:        z.string().min(1),
  createdAt:  z.string().datetime(),
});

type Bookmark = z.infer<typeof bookmarkSchema>;
```

### Field Reference

| Field | Type | Source | Purpose |
|---|---|---|---|
| `userId` | `string` | `user.username` from `auth.requireAuth(context)` | Partition key; user identity; data isolation boundary |
| `bookmarkId` | `string` | `crypto.randomUUID()` server-side | Sort key; unique record identifier |
| `url` | `string` (URL) | Client input; Zod `.url()` validates | The bookmarked URL |
| `title` | `string` (min 1) | Client input; Zod `.min(1)` validates | Human-readable label |
| `tag` | `string` (min 1) | Client input; Zod `.min(1)` validates | Single categorisation string |
| `createdAt` | `string` (ISO 8601) | `new Date().toISOString()` server-side | Record creation timestamp |

### Critical Design Decisions

**Why `userId = user.username` and NOT a client-supplied value:**
`user.username` is returned by `auth.requireAuth(context)` — a server-side call that verifies the JWT session cookie. The browser cannot forge or influence this value. Accepting `userId` as input would allow any caller to read or write any user's data.

**Why `bookmarkId = crypto.randomUUID()` server-side:**
Generating the bookmarkId server-side prevents clients from choosing a sort key that might collide with another user's data or that could be guessed to overwrite an existing bookmark via a `put()` upsert.

**Why `createdAt = new Date().toISOString()` server-side:**
Server-generated timestamps are trustworthy and consistent regardless of client clock skew or manipulation.

**Why partition key = `userId`:**
DynamoDB partitions are fully isolated — a query with `partitionKey = 'alice'` physically cannot return records stored under `partitionKey = 'bob'`. This is the data isolation mechanism.

**Why sort key = `bookmarkId`:**
A `(userId, bookmarkId)` composite key allows O(1) single-item get and delete without a full partition scan. It also makes cross-user deletion structurally impossible: `delete({ userId: 'alice', bookmarkId: 'xyz' })` will not find a record if that bookmark belongs to `'bob'`.

---

## Components and Interfaces

### Block Configuration

#### Scope

```typescript
// aws-blocks/index.ts
import { Scope, ApiNamespace } from '@aws-blocks/blocks';
import { AuthBasic } from '@aws-blocks/bb-auth-basic';
import { DistributedTable } from '@aws-blocks/bb-distributed-table';
import { z } from 'zod';

const scope = new Scope('bookmark-manager');
```

The string `'bookmark-manager'` is the **stable application identifier**. Renaming it would recreate all AWS resources (new DynamoDB tables, new Cognito user pool). Never rename this after first deploy.

#### AuthBasic

```typescript
const auth = new AuthBasic(scope, 'auth');
export const authApi = auth.createApi();
```

- Block ID `'auth'` is **immutable once deployed** — renaming destroys all user accounts
- `auth.createApi()` returns the state-machine API consumed by the frontend's `Authenticator` component and `onAuthChange` listener
- Default session duration: 86 400 s (24 hours)
- Session is an `HttpOnly` JWT cookie — never accessible to JavaScript
- No `codeDelivery` callback → sign-up is immediate, no email confirmation step

#### DistributedTable

```typescript
const bookmarks = new DistributedTable(scope, 'bookmarks', {
  schema: bookmarkSchema,
  key: { partitionKey: 'userId', sortKey: 'bookmarkId' },
});
```

- Block ID `'bookmarks'` is **immutable once deployed** — renaming destroys all bookmark data
- Partition key `userId` ensures every DynamoDB partition holds only one user's data
- Sort key `bookmarkId` enables O(1) single-item get and delete without a scan
- No GSIs required for v1 access patterns (list all, get one, delete one)

#### ApiNamespace

```typescript
export const api = new ApiNamespace(scope, 'api', (context) => ({
  async createBookmark(input: CreateBookmarkInput) { /* see Backend API Design */ },
  async listBookmarks(): Promise<Bookmark[]>       { /* see Backend API Design */ },
  async deleteBookmark(input: { bookmarkId: string }): Promise<void> { /* see Backend API Design */ },
}));

export { auth };
```

- The `api` export name drives the client import: `import { api } from 'aws-blocks'`
- Locally routes through a local HTTP server; in production routes through API Gateway → Lambda
- TypeScript types flow from method signatures to the browser — no codegen required

### Frontend Component Tree

```
App (src/index.ts)
├── (signed-out)  <Authenticator authApi={authApi} />
└── (signed-in)   <SignedInView>
                    ├── <UserHeader username={...} />
                    │     └── username display + sign-out button
                    ├── <BookmarkForm />
                    │     └── url field + title field + tag field + submit button
                    │         + field-level error messages + FormState indicator
                    └── <BookmarkList />
                          └── <BookmarkItem /> × n
                                └── title + url (link) + tag + createdAt + delete button
```

### State Management

**Auth state** (in App / src/index.ts):
```typescript
const [authState, setAuthState] = useState<AuthState | null>(null);

useEffect(() => {
  return authApi.onAuthChange((state) => {
    setAuthState(state);
    if (!state.isAuthenticated) {
      setBookmarks([]); // clear on sign-out
    }
  });
}, []);
```

**Form state machine** (in BookmarkForm):
```typescript
type FormState = 'idle' | 'loading' | 'success' | 'error';
const [formState, setFormState] = useState<FormState>('idle');
const [formError, setFormError] = useState<string | null>(null);
```

**Bookmark list state** (in BookmarkList):
```typescript
type ListState = {
  status: 'idle' | 'loading' | 'success' | 'error';
  items: Bookmark[];
  error?: string;
};
const [listState, setListState] = useState<ListState>({ status: 'idle', items: [] });
```

### BookmarkForm

**Fields**: url, title, tag (all controlled inputs)

**Client-side validation** (before calling API):
- `url`: must pass `z.string().url()` — display "Please enter a valid URL" on failure
- `title`: must be non-empty after trim — display "Title is required" on failure
- `tag`: must be non-empty after trim — display "Tag is required" on failure

**Submit flow**:
1. Run validation; if any field fails, set field-level errors and return (do NOT call API)
2. Set `formState = 'loading'`
3. Call `await api.createBookmark({ url, title, tag })`
4. On success: set `formState = 'success'`, reset all fields to `''`, call `loadBookmarks()`
5. On error: set `formState = 'error'`, set `formError = err.message`

### BookmarkList

**loadBookmarks()** — called on mount and after create/delete:
```typescript
async function loadBookmarks() {
  setListState({ status: 'loading', items: [] });
  try {
    const items = await api.listBookmarks();
    setListState({ status: 'success', items });
  } catch (err) {
    setListState({ status: 'error', items: [], error: (err as Error).message });
  }
}
```

**Rendering states:**
- `loading`: display a spinner or skeleton placeholder
- `error`: display error message with a "Retry" button that calls `loadBookmarks()`
- `success` with empty items: display "No bookmarks yet. Add one above."
- `success` with items: render `<BookmarkItem />` for each bookmark

### BookmarkItem

Displays: title (as text), url (as `<a href={url} target="_blank">`), tag (as a badge/label), createdAt (formatted as locale date string), and a "Delete" button.

**Delete flow**:
1. Call `await api.deleteBookmark({ bookmarkId })`
2. On success: call `loadBookmarks()` to refresh the list
3. On error: display the error message to the user; do NOT modify the locally displayed list

### UserHeader

Displays the authenticated user's username sourced from auth state. Contains a "Sign out" button that calls the authApi sign-out method.

---

## Error Handling

### Backend Error Patterns

**Unauthenticated access**: Every protected method calls `auth.requireAuth(context)` as its first line. If no valid session cookie is present, `requireAuth` throws `SessionExpiredException`. No data operation is performed.

**Not-found / cross-user delete**: When `deleteBookmark` is called with a `bookmarkId` that does not exist under the authenticated user's partition, the ownership `get()` returns `null`. The handler throws a named `NotFoundError`:

```typescript
const err = new Error('Bookmark not found');
err.name = 'NotFoundError';
throw err;
```

This prevents leaking whether the bookmarkId exists under a different user.

**Validation errors**: Zod validation runs inside `DistributedTable.put()` before any write. Invalid bookmark fields (malformed URL, empty title, empty tag) cause `put()` to throw before touching the database.

### Frontend Error Handling

Use `isBlocksError` for structured error checks on the client:

```typescript
import { isBlocksError } from '@aws-blocks/blocks';

try {
  await api.deleteBookmark({ bookmarkId });
} catch (err) {
  if (isBlocksError(err, 'NotFoundError')) {
    // bookmark not found — already deleted or belongs to another user
  }
  setError((err as Error).message);
}
```

**Form errors**: Field-level validation errors are shown inline before any API call is made. API-level errors set `formState = 'error'` and display `formError`.

**List errors**: If `listBookmarks()` throws, `ListState.status` transitions to `'error'` and an error message with a "Retry" button is rendered.

**Sign-out state cleanup**: When `isAuthenticated` transitions to `false`, the bookmark list is cleared from local React state to prevent data leakage if another user signs in on the same browser tab.

---

## Testing Strategy

### Startup Verification

```bash
npm run dev
# Expected: "Server running at http://localhost:3000" (or similar)
# Open http://localhost:3000 in browser
# Expected: Authenticator component renders, no console errors
```

### Per-Milestone Verification

**Milestone 1**: Browser shows blank page (or minimal scaffold) with no console errors.

**Milestone 2**:
- Visit app → see Authenticator
- Sign up with username "testuser" + password → signed-in state renders, username "testuser" visible
- Click sign out → Authenticator reappears
- Sign in with the same account → signed-in state renders again

**Milestone 3**:
- `npm run dev` → no TypeScript or runtime errors in terminal
- `.bb-data/` directory exists after server start
- Confirm `bookmarkSchema.parse(validBookmark)` succeeds and `bookmarkSchema.parse(invalidBookmark)` throws

**Milestone 4**:
- `npx tsc --noEmit` → 0 errors
- Open browser console while signed in
- Run `await api.createBookmark({ url: 'https://example.com', title: 'Test', tag: 'misc' })` → returns bookmark object
- Run `await api.listBookmarks()` → returns array containing the created bookmark
- Run `await api.deleteBookmark({ bookmarkId: '<id from above>' })` → resolves without error
- Run `await api.listBookmarks()` → returns empty array

**Milestone 5**:
- Happy path: create bookmark via form → appears in list → delete → list shows empty state
- Validation: submit form with empty title → field error appears, API not called
- Validation: submit form with non-URL in url field → field error appears, API not called
- Loading state: briefly visible on slow connections (or with network throttle)
- Error state: if API throws, error message appears

### Security Test Cases

#### Test 1 — Signed-out API access

**Setup**: Clear all session cookies (or use a fresh incognito browser tab). Do not sign in.

**Action**: In the browser console, run:
```javascript
await api.createBookmark({ url: 'https://evil.com', title: 'Hacked', tag: 'test' });
```

**Expected**: Promise rejects with an authentication error (SessionExpiredException or similar). No bookmark is created. No data is written to `.bb-data/`.

#### Test 2 — User A cannot see User B's bookmarks

**Setup**:
1. Sign up and sign in as User A
2. Create a bookmark: `{ url: 'https://user-a.com', title: 'User A Bookmark', tag: 'private' }`
3. Sign out

**Action**:
1. Sign up and sign in as User B (different username)
2. Run `await api.listBookmarks()`

**Expected**: The returned array does NOT contain "User A Bookmark" or any bookmark with User A's data. User B's list is empty (or contains only User B's own bookmarks).

#### Test 3 — User B cannot delete User A's bookmark

**Setup**:
1. Sign in as User A; create a bookmark; note the returned `bookmarkId` (call it `bookmarkId_A`)
2. Sign out; sign in as User B

**Action**:
```javascript
await api.deleteBookmark({ bookmarkId: bookmarkId_A });
```

**Expected**: Promise rejects with `NotFoundError`. Sign out; sign in as User A; call `api.listBookmarks()` — the bookmark is still present.

#### Test 4 — Ownership enforced on all three methods

**Verification**: Review `aws-blocks/index.ts`. Confirm:
- `createBookmark`: `userId` is set to `user.username` (NOT from `input`)
- `listBookmarks`: query uses `{ equals: user.username }` (NOT a parameter)
- `deleteBookmark`: delete key uses `userId: user.username` (NOT from `input`)

No method signature contains a `userId` parameter.

### Persistence Test Cases

#### Test 1 — Browser refresh

**Steps**:
1. Sign in as a user
2. Create a bookmark via the form; note the title
3. Refresh the browser page (`F5` or `Cmd+R`)
4. Sign in again (if required by session cookie behavior)

**Expected**: The bookmark list loads and the bookmark from step 2 is still present with the same title, url, tag, and createdAt.

#### Test 2 — Server restart

**Steps**:
1. Sign in as a user
2. Create a bookmark via the form; note the title
3. In the terminal, stop the dev server (`Ctrl+C`)
4. Run `npm run dev` again
5. Navigate to `http://localhost:3000`
6. Sign in

**Expected**: The bookmark from step 2 is still present. The `.bb-data/` directory contents were preserved across the restart.

#### Test 3 — Sign-out and re-login

**Steps**:
1. Sign in as a user
2. Create a bookmark via the form; note the title
3. Click "Sign out"
4. Sign back in with the same credentials

**Expected**: The bookmark from step 2 is visible in the list. `user.username` is the same stable identifier used as the partition key, so the same data is returned by `listBookmarks()`.

---

## 1. Project Overview

The Bookmark Manager is a private, per-user bookmark collection built on the **AWS Blocks Level 1** platform. The workspace is scaffolded entirely from scratch. Authenticated users can sign up, sign in, sign out, create bookmarks, list their own bookmarks, and delete their own bookmarks. Every user's bookmark collection is fully isolated from every other user's collection.

The system uses four AWS Blocks primitives:

| Primitive | Role |
|---|---|
| `Scope` | Application-level namespace; all Blocks are registered under one scope |
| `AuthBasic` | Username/password authentication with JWT session cookies |
| `DistributedTable` | DynamoDB-backed structured storage for Bookmark records |
| `ApiNamespace` | Type-safe RPC bridge from browser to backend Lambda handlers |

---

## 2. Existing Scaffold Analysis

The workspace is **empty**. Only `.gitignore` and `.kiro/` exist. The entire project structure — `package.json`, `aws-blocks/index.ts`, `src/index.ts`, `index.html` — must be created from scratch using:

```bash
npm create @aws-blocks/blocks-app@latest . --template react
npm install
npm run dev   # starts http://localhost:3000
```

After scaffolding, remove any sample todo code from `src/index.ts` before beginning implementation.

---

## 3. AWS Blocks Version / API Analysis

- **Package**: `@aws-blocks/blocks` (Preview, June 2026)
- **Scaffold CLI**: `npm create @aws-blocks/blocks-app@latest . --template react`
- **IFC entry point**: `aws-blocks/index.ts` — instantiate Blocks, export `api` and `authApi`
- **Frontend import**: `import { api, authApi } from 'aws-blocks'` — no URL configuration, no codegen step; types flow end-to-end
- **User identity**: `user.username` is the stable user identifier returned by `auth.requireAuth(context)`. **NOT** `user.id`.
- **Query API**: `Array.fromAsync(bookmarks.query({ where: { userId: { equals: value } } }))` — collects AsyncIterable into an array
- **Local persistence**: `.bb-data/` directory at project root — managed by Blocks, never accessed directly
- **Error handling**: `isBlocksError(err, 'ErrorName')` imported from `@aws-blocks/blocks` for structured frontend error checks
- **No code generation**: TypeScript types flow end-to-end through `ApiNamespace` without any codegen step

---

## 4. Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│  Browser (React)                                                   │
│                                                                    │
│  src/index.ts                                                      │
│  ┌───────────────────────────────────────────────────────────┐    │
│  │  Signed-out state            Signed-in state              │    │
│  │  ┌──────────────────┐        ┌────────────────────────┐   │    │
│  │  │  <Authenticator  │        │  <UserHeader />         │   │    │
│  │  │   authApi={...}/>│        │  <BookmarkForm />       │   │    │
│  │  └──────────────────┘        │  <BookmarkList />       │   │    │
│  │                              └────────────────────────┘   │    │
│  └───────────────────────────────────────────────────────────┘    │
│       │ import { api, authApi } from 'aws-blocks'                 │
└───────┼──────────────────────────────────────────────────────────┘
        │ ApiNamespace (local HTTP server / API Gateway + Lambda)
┌───────▼──────────────────────────────────────────────────────────┐
│  aws-blocks/index.ts  (IFC Layer)                                  │
│                                                                    │
│  new Scope('bookmark-manager')                                     │
│  new AuthBasic(scope, 'auth')       → export authApi               │
│  new DistributedTable(scope, 'bookmarks', { schema, key })         │
│  new ApiNamespace(scope, 'api', (context) => {                     │
│      createBookmark(input)  → requireAuth → put()                  │
│      listBookmarks()        → requireAuth → query()                │
│      deleteBookmark(input)  → requireAuth → get() + delete()       │
│  })                         → export api                           │
└──────────────────────────────────┬───────────────────────────────┘
                                   │
               ┌───────────────────▼───────────────────┐
               │  .bb-data/ (Block-managed local store)  │
               │  .bb-data/bookmark-manager/bookmarks/   │
               └───────────────────────────────────────┘
```

**Data flow — createBookmark:**
1. Browser calls `api.createBookmark({ url, title, tag })` via typed export
2. ApiNamespace routes to the handler (local HTTP server or Lambda)
3. Handler calls `auth.requireAuth(context)` → throws `SessionExpiredException` if no valid session cookie; returns `{ username, ... }` otherwise
4. Handler sets `userId = user.username`, generates `bookmarkId = crypto.randomUUID()`, `createdAt = new Date().toISOString()`
5. Handler calls `bookmarks.put({ userId, bookmarkId, url, title, tag, createdAt })`
6. DistributedTable runs Zod validation internally before writing
7. Handler returns `{ bookmarkId, url, title, tag, createdAt }` to the browser

**Data flow — listBookmarks:**
1. Browser calls `api.listBookmarks()`
2. Handler calls `auth.requireAuth(context)` → gets `user.username`
3. Handler queries `bookmarks.query({ where: { userId: { equals: user.username } } })` — scoped to one DynamoDB partition
4. Returns array of Bookmark records belonging only to this user

**Data flow — deleteBookmark:**
1. Browser calls `api.deleteBookmark({ bookmarkId })`
2. Handler calls `auth.requireAuth(context)` → gets `user.username`
3. Handler calls `bookmarks.get({ userId: user.username, bookmarkId })` — returns null if not found (or belongs to different user)
4. If null, throws NotFoundError; otherwise calls `bookmarks.delete({ userId: user.username, bookmarkId })`

---

## 5. Block Configuration

### 5.1 Scope

```typescript
// aws-blocks/index.ts
import { Scope, ApiNamespace } from '@aws-blocks/blocks';
import { AuthBasic } from '@aws-blocks/bb-auth-basic';
import { DistributedTable } from '@aws-blocks/bb-distributed-table';
import { z } from 'zod';

const scope = new Scope('bookmark-manager');
```

The string `'bookmark-manager'` is the **stable application identifier**. Renaming it would recreate all AWS resources (new DynamoDB tables, new Cognito user pool). Never rename this after first deploy.

### 5.2 AuthBasic

```typescript
const auth = new AuthBasic(scope, 'auth');
export const authApi = auth.createApi();
```

- Block ID `'auth'` is **immutable once deployed** — renaming destroys all user accounts
- `auth.createApi()` returns the state-machine API consumed by the frontend's `Authenticator` component and `onAuthChange` listener
- Default session duration: 86 400 s (24 hours)
- Session is an `HttpOnly` JWT cookie — never accessible to JavaScript
- No `codeDelivery` callback → sign-up is immediate, no email confirmation step

### 5.3 DistributedTable

```typescript
const bookmarkSchema = z.object({
  userId:     z.string(),
  bookmarkId: z.string(),
  url:        z.string().url(),
  title:      z.string().min(1),
  tag:        z.string().min(1),
  createdAt:  z.string().datetime(),
});

const bookmarks = new DistributedTable(scope, 'bookmarks', {
  schema: bookmarkSchema,
  key: { partitionKey: 'userId', sortKey: 'bookmarkId' },
});
```

- Block ID `'bookmarks'` is **immutable once deployed** — renaming destroys all bookmark data
- Partition key `userId` ensures every DynamoDB partition holds only one user's data
- Sort key `bookmarkId` enables O(1) single-item get and delete without a scan
- No GSIs required for v1 access patterns (list all, get one, delete one)

### 5.4 ApiNamespace

```typescript
export const api = new ApiNamespace(scope, 'api', (context) => ({
  async createBookmark(input: CreateBookmarkInput) { /* see §8 */ },
  async listBookmarks(): Promise<Bookmark[]>       { /* see §8 */ },
  async deleteBookmark(input: { bookmarkId: string }): Promise<void> { /* see §8 */ },
}));

export { auth };
```

- The `api` export name drives the client import: `import { api } from 'aws-blocks'`
- Locally routes through a local HTTP server; in production routes through API Gateway → Lambda
- TypeScript types flow from method signatures to the browser — no codegen required

---

## 6. Data Model

### Zod Schema

```typescript
const bookmarkSchema = z.object({
  userId:     z.string(),
  bookmarkId: z.string(),
  url:        z.string().url(),
  title:      z.string().min(1),
  tag:        z.string().min(1),
  createdAt:  z.string().datetime(),
});

type Bookmark = z.infer<typeof bookmarkSchema>;
```

### Field Reference

| Field | Type | Source | Purpose |
|---|---|---|---|
| `userId` | `string` | `user.username` from `auth.requireAuth(context)` | Partition key; user identity; data isolation boundary |
| `bookmarkId` | `string` | `crypto.randomUUID()` server-side | Sort key; unique record identifier |
| `url` | `string` (URL) | Client input; Zod `.url()` validates | The bookmarked URL |
| `title` | `string` (min 1) | Client input; Zod `.min(1)` validates | Human-readable label |
| `tag` | `string` (min 1) | Client input; Zod `.min(1)` validates | Single categorisation string |
| `createdAt` | `string` (ISO 8601) | `new Date().toISOString()` server-side | Record creation timestamp |

### Critical Design Decisions

**Why `userId = user.username` and NOT a client-supplied value:**
`user.username` is returned by `auth.requireAuth(context)` — a server-side call that verifies the JWT session cookie. The browser cannot forge or influence this value. Accepting `userId` as input would allow any caller to read or write any user's data.

**Why `bookmarkId = crypto.randomUUID()` server-side:**
Generating the bookmarkId server-side prevents clients from choosing a sort key that might collide with another user's data or that could be guessed to overwrite an existing bookmark via a `put()` upsert.

**Why `createdAt = new Date().toISOString()` server-side:**
Server-generated timestamps are trustworthy and consistent regardless of client clock skew or manipulation.

**Why partition key = `userId`:**
DynamoDB partitions are fully isolated — a query with `partitionKey = 'alice'` physically cannot return records stored under `partitionKey = 'bob'`. This is the data isolation mechanism.

**Why sort key = `bookmarkId`:**
A `(userId, bookmarkId)` composite key allows O(1) single-item get and delete without a full partition scan. It also makes cross-user deletion structurally impossible: `delete({ userId: 'alice', bookmarkId: 'xyz' })` will not find a record if that bookmark belongs to `'bob'`.

---

## 7. Authentication Design

Authentication is handled exclusively by `AuthBasic`. The frontend never touches passwords or tokens directly.

**Step-by-step flow:**

1. **IFC layer** (`aws-blocks/index.ts`): `const auth = new AuthBasic(scope, 'auth')` instantiates the auth block. `export const authApi = auth.createApi()` exports the state-machine API.

2. **Frontend import**: `import { authApi } from 'aws-blocks'` — the same `authApi` object, fully typed.

3. **Initial state observation**: In `src/index.ts`, call `authApi.onAuthChange(state => { ... })` inside a `useEffect`. Store the state in `useState`. This fires on page load with the current session state and on every subsequent auth event.

4. **Signed-out rendering**: When `state.isAuthenticated === false`, render `<Authenticator authApi={authApi} />` and nothing else. The Authenticator component handles both sign-up and sign-in UI internally.

5. **Signed-in rendering**: When `state.isAuthenticated === true`, render the full application UI — `<UserHeader />`, `<BookmarkForm />`, `<BookmarkList />`. The username is available as `state.username` (or equivalent field from the auth state object).

6. **Sign-out**: The `<UserHeader />` component calls the sign-out method on `authApi`. After sign-out, `onAuthChange` fires with `isAuthenticated: false`, triggering the UI to return to the Authenticator.

7. **Local component state cleanup on sign-out**: When `isAuthenticated` transitions to `false`, clear the bookmark list from local React state to prevent data leakage if another user signs in on the same browser tab.

8. **Backend enforcement**: Every protected API method (`createBookmark`, `listBookmarks`, `deleteBookmark`) calls `await auth.requireAuth(context)` as its **first line**. This is the authoritative authentication check — UI state is irrelevant to the server.

```typescript
// Signed-out → show only Authenticator
if (!state.isAuthenticated) {
  return <Authenticator authApi={authApi} />;
}

// Signed-in → show full app
return (
  <div>
    <UserHeader username={state.username} />
    <BookmarkForm />
    <BookmarkList />
  </div>
);
```

---

## 8. Backend API Design

All three methods live inside the `ApiNamespace` callback in `aws-blocks/index.ts`. Every method calls `auth.requireAuth(context)` first.

### createBookmark

**Signature**: `async createBookmark(input: { url: string; title: string; tag: string }): Promise<Bookmark>`

| Step | Code | Reason |
|---|---|---|
| 1 | `const user = await auth.requireAuth(context)` | Throws `SessionExpiredException` if no valid session; returns `{ username, ... }` |
| 2 | `const userId = user.username` | Server-derived identity; never from `input` |
| 3 | `const bookmarkId = crypto.randomUUID()` | Unique sort key; server-generated |
| 4 | `const createdAt = new Date().toISOString()` | Trustworthy timestamp; server-generated |
| 5 | `await bookmarks.put({ userId, bookmarkId, url: input.url, title: input.title, tag: input.tag, createdAt })` | Zod validation runs inside `put()` before write |
| 6 | `return { userId, bookmarkId, url: input.url, title: input.title, tag: input.tag, createdAt }` | Return full record to client |

```typescript
async createBookmark(input: { url: string; title: string; tag: string }) {
  const user = await auth.requireAuth(context);
  const userId = user.username;
  const bookmarkId = crypto.randomUUID();
  const createdAt = new Date().toISOString();
  await bookmarks.put({ userId, bookmarkId, url: input.url, title: input.title, tag: input.tag, createdAt });
  return { userId, bookmarkId, url: input.url, title: input.title, tag: input.tag, createdAt };
},
```

### listBookmarks

**Signature**: `async listBookmarks(): Promise<Bookmark[]>`

| Step | Code | Reason |
|---|---|---|
| 1 | `const user = await auth.requireAuth(context)` | Rejects unauthenticated callers |
| 2 | `const userId = user.username` | Partition key for the query |
| 3 | `return await Array.fromAsync(bookmarks.query({ where: { userId: { equals: userId } } }))` | Scoped to ONE partition; never reads another user's data |

```typescript
async listBookmarks() {
  const user = await auth.requireAuth(context);
  const userId = user.username;
  return await Array.fromAsync(bookmarks.query({ where: { userId: { equals: userId } } }));
},
```

The `query()` call is scoped to a single DynamoDB partition key. It is structurally impossible for this query to return records belonging to a different user.

### deleteBookmark

**Signature**: `async deleteBookmark(input: { bookmarkId: string }): Promise<void>`

| Step | Code | Reason |
|---|---|---|
| 1 | `const user = await auth.requireAuth(context)` | Rejects unauthenticated callers |
| 2 | `const userId = user.username` | Server-derived; not from input |
| 3 | `const item = await bookmarks.get({ userId, bookmarkId: input.bookmarkId })` | Ownership check: returns `null` if key doesn't exist under this userId |
| 4 | `if (!item) { throw notFoundError() }` | Prevents leaking whether the bookmarkId exists under a different user |
| 5 | `await bookmarks.delete({ userId, bookmarkId: input.bookmarkId })` | Composite key makes cross-user deletion structurally impossible |

```typescript
async deleteBookmark(input: { bookmarkId: string }) {
  const user = await auth.requireAuth(context);
  const userId = user.username;
  const item = await bookmarks.get({ userId, bookmarkId: input.bookmarkId });
  if (!item) {
    const err = new Error('Bookmark not found');
    err.name = 'NotFoundError';
    throw err;
  }
  await bookmarks.delete({ userId, bookmarkId: input.bookmarkId });
},
```

If User B calls `deleteBookmark({ bookmarkId: 'xyz' })` where `'xyz'` was created by User A, `bookmarks.get({ userId: user_B.username, bookmarkId: 'xyz' })` returns `null` — the composite key does not exist under User B's partition. The method throws `NotFoundError` without touching User A's data.

---

## 9. ApiNamespace Design

Full `aws-blocks/index.ts` with all three methods:

```typescript
// aws-blocks/index.ts
import { Scope, ApiNamespace } from '@aws-blocks/blocks';
import { AuthBasic } from '@aws-blocks/bb-auth-basic';
import { DistributedTable } from '@aws-blocks/bb-distributed-table';
import { z } from 'zod';

const scope = new Scope('bookmark-manager');

const auth = new AuthBasic(scope, 'auth');
export const authApi = auth.createApi();

const bookmarkSchema = z.object({
  userId:     z.string(),
  bookmarkId: z.string(),
  url:        z.string().url(),
  title:      z.string().min(1),
  tag:        z.string().min(1),
  createdAt:  z.string().datetime(),
});

const bookmarks = new DistributedTable(scope, 'bookmarks', {
  schema: bookmarkSchema,
  key: { partitionKey: 'userId', sortKey: 'bookmarkId' },
});

export const api = new ApiNamespace(scope, 'api', (context) => ({
  async createBookmark(input: { url: string; title: string; tag: string }) {
    const user = await auth.requireAuth(context);
    const userId = user.username;
    const bookmarkId = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    await bookmarks.put({ userId, bookmarkId, url: input.url, title: input.title, tag: input.tag, createdAt });
    return { userId, bookmarkId, url: input.url, title: input.title, tag: input.tag, createdAt };
  },

  async listBookmarks() {
    const user = await auth.requireAuth(context);
    const userId = user.username;
    return await Array.fromAsync(bookmarks.query({ where: { userId: { equals: userId } } }));
  },

  async deleteBookmark(input: { bookmarkId: string }) {
    const user = await auth.requireAuth(context);
    const userId = user.username;
    const item = await bookmarks.get({ userId, bookmarkId: input.bookmarkId });
    if (!item) {
      const err = new Error('Bookmark not found');
      err.name = 'NotFoundError';
      throw err;
    }
    await bookmarks.delete({ userId, bookmarkId: input.bookmarkId });
  },
}));

export { auth };
```

**Exports summary:**
- `api` — typed RPC client; imported by frontend as `import { api } from 'aws-blocks'`
- `authApi` — auth state machine; imported by frontend as `import { authApi } from 'aws-blocks'`
- `auth` — exported for `requireAuth` usage inside the namespace callback (available via closure)

**Why no `fetch()`:**
ApiNamespace routes locally through a local HTTP server during development and through API Gateway → Lambda in production. The frontend never needs to know the URL or construct HTTP requests manually. Using `fetch()` directly would bypass type safety and session cookie handling.

---

## 10. Frontend Design

### Component Tree

```
App (src/index.ts)
├── (signed-out)  <Authenticator authApi={authApi} />
└── (signed-in)   <SignedInView>
                    ├── <UserHeader username={...} />
                    │     └── username display + sign-out button
                    ├── <BookmarkForm />
                    │     └── url field + title field + tag field + submit button
                    │         + field-level error messages + FormState indicator
                    └── <BookmarkList />
                          └── <BookmarkItem /> × n
                                └── title + url (link) + tag + createdAt + delete button
```

### State Management

**Auth state** (in App / src/index.ts):
```typescript
const [authState, setAuthState] = useState<AuthState | null>(null);

useEffect(() => {
  return authApi.onAuthChange((state) => {
    setAuthState(state);
    if (!state.isAuthenticated) {
      setBookmarks([]); // clear on sign-out
    }
  });
}, []);
```

**Form state machine** (in BookmarkForm):
```typescript
type FormState = 'idle' | 'loading' | 'success' | 'error';
const [formState, setFormState] = useState<FormState>('idle');
const [formError, setFormError] = useState<string | null>(null);
```

**Bookmark list state** (in BookmarkList):
```typescript
type ListState = {
  status: 'idle' | 'loading' | 'success' | 'error';
  items: Bookmark[];
  error?: string;
};
const [listState, setListState] = useState<ListState>({ status: 'idle', items: [] });
```

### BookmarkForm

**Fields**: url, title, tag (all controlled inputs)

**Client-side validation** (before calling API):
- `url`: must pass `z.string().url()` — display "Please enter a valid URL" on failure
- `title`: must be non-empty after trim — display "Title is required" on failure
- `tag`: must be non-empty after trim — display "Tag is required" on failure

**Submit flow**:
1. Run validation; if any field fails, set field-level errors and return (do NOT call API)
2. Set `formState = 'loading'`
3. Call `await api.createBookmark({ url, title, tag })`
4. On success: set `formState = 'success'`, reset all fields to `''`, call `loadBookmarks()`
5. On error: set `formState = 'error'`, set `formError = err.message`

### BookmarkList

**loadBookmarks()** — called on mount and after create/delete:
```typescript
async function loadBookmarks() {
  setListState({ status: 'loading', items: [] });
  try {
    const items = await api.listBookmarks();
    setListState({ status: 'success', items });
  } catch (err) {
    setListState({ status: 'error', items: [], error: (err as Error).message });
  }
}
```

**Rendering states:**
- `loading`: display a spinner or skeleton placeholder
- `error`: display error message with a "Retry" button that calls `loadBookmarks()`
- `success` with empty items: display "No bookmarks yet. Add one above."
- `success` with items: render `<BookmarkItem />` for each bookmark

### BookmarkItem

Displays: title (as text), url (as `<a href={url} target="_blank">`), tag (as a badge/label), createdAt (formatted as locale date string), and a "Delete" button.

**Delete flow**:
1. Call `await api.deleteBookmark({ bookmarkId })`
2. On success: call `loadBookmarks()` to refresh the list
3. On error: display the error message to the user; do NOT modify the locally displayed list

### UserHeader

Displays the authenticated user's username sourced from auth state. Contains a "Sign out" button that calls the authApi sign-out method.

### Error handling on frontend

```typescript
import { isBlocksError } from '@aws-blocks/blocks';

try {
  await api.deleteBookmark({ bookmarkId });
} catch (err) {
  if (isBlocksError(err, 'NotFoundError')) {
    // bookmark not found — already deleted or belongs to another user
  }
  setError((err as Error).message);
}
```

---

## 11. Authorization and Data Isolation

### The Security Chain

```
Browser
   │
   │  import { api } from 'aws-blocks'  (typed, no fetch(), no URL config)
   ↓
ApiNamespace handler
   │
   │  await auth.requireAuth(context)
   │  → throws SessionExpiredException if no valid session cookie
   │  → returns { username: string, ... } if valid
   ↓
user.username                           (stable, server-derived, never client-provided)
   │
   │  bookmarks.put/query/delete({ userId: user.username, ... })
   ↓
DistributedTable partition scoped to user.username
   (DynamoDB partition key = userId; physically isolated per user)
```

### INSECURE pattern (never do this)

```typescript
// INSECURE — client controls userId
async createBookmark(input: { userId: string; url: string; title: string; tag: string }) {
  await bookmarks.put({ userId: input.userId, ... });
  // Any caller can supply any userId → read or write any user's data
}
```

### CORRECT pattern (what this system does)

```typescript
// CORRECT — server derives userId from authenticated session
async createBookmark(input: { url: string; title: string; tag: string }) {
  const user = await auth.requireAuth(context); // verified JWT cookie
  const userId = user.username;                 // immutable, verified by AuthBasic
  await bookmarks.put({ userId, ... });
}
```

### Why each layer is necessary

**DistributedTable partition isolation**: A query with `where: { userId: { equals: 'alice' } }` physically addresses a single DynamoDB partition. It cannot return records stored under `userId = 'bob'`. This is enforced by the storage engine, not by application logic.

**Delete composite key**: `bookmarks.delete({ userId: 'alice', bookmarkId: 'xyz' })` addresses exactly one cell in the partition+sort key space. If User B calls `deleteBookmark({ bookmarkId: 'xyz' })`, the handler uses `userId = user_B.username`. The key `(user_B.username, 'xyz')` does not exist — the record lives under `(user_A.username, 'xyz')`. The `get()` ownership check returns `null`, and `NotFoundError` is thrown without touching User A's data.

**UI controls are NOT authorization**: Hiding a delete button prevents accidental clicks; it does not prevent a determined caller from invoking `api.deleteBookmark(...)` directly from the browser console. Every mutating method enforces ownership server-side.

**No client-supplied userId**: The `createBookmark`, `listBookmarks`, and `deleteBookmark` method signatures contain no `userId` parameter. TypeScript enforces this at compile time for callers using the typed `api` export.

---

## 12. Persistence Design

### How local persistence works

`DistributedTable` stores all data in the **`.bb-data/` directory** at the project root. This directory is managed entirely by the AWS Blocks runtime — application code must never read from or write to it directly.

Local path: `.bb-data/bookmark-manager/bookmarks/`

### Survival guarantees

| Event | Data survives? | Why |
|---|---|---|
| Browser page refresh | Yes | Data is in `.bb-data/`, not in browser memory or localStorage |
| Server restart (`npm run dev`) | Yes | `.bb-data/` is on the filesystem; it persists between process restarts |
| Sign-out + re-login | Yes | `user.username` is stable; the same partition key is queried on re-login |
| New browser tab | Yes | Session cookie + `.bb-data/` are both persistent |

### What is NOT used for persistence

- `localStorage` — not used
- `sessionStorage` — not used
- SQLite — not used
- Custom JSON files / CSV files — not used
- In-memory JavaScript arrays — used only as React state (ephemeral UI layer)

### Reset procedure (development only)

To wipe all local data and start fresh:

```bash
rm -rf .bb-data
```

This destroys all user accounts and all bookmark records. Do not run in production.

### `.gitignore` recommendation

```
.bb-data/
```

The `.bb-data/` directory should be gitignored — it contains local state that should not be committed.

---

## 13. Project / File Structure

```
bookmark-manager/
├── aws-blocks/
│   └── index.ts              ← IFC layer: Scope, AuthBasic, DistributedTable,
│                               ApiNamespace, all 3 API methods, all exports
├── src/
│   ├── index.ts              ← App entry: auth state observation via onAuthChange,
│   │                           signed-out (Authenticator) / signed-in (full app) routing
│   ├── components/
│   │   ├── BookmarkForm.tsx  ← Create form: url/title/tag fields, client-side validation,
│   │   │                       FormState machine (idle→loading→success/error),
│   │   │                       calls api.createBookmark(), resets form on success
│   │   ├── BookmarkList.tsx  ← List container: calls api.listBookmarks() on mount,
│   │   │                       loading/empty/error/success states, exposes reload fn
│   │   ├── BookmarkItem.tsx  ← Single row: title, url (link), tag, createdAt (formatted),
│   │   │                       delete button → api.deleteBookmark() → reload list
│   │   └── UserHeader.tsx    ← Username display from auth state + sign-out button
│   └── types.ts              ← Shared TypeScript types: Bookmark (inferred from Zod),
│                               FormState ('idle'|'loading'|'success'|'error'),
│                               ListState ({ status, items, error? })
├── index.html                ← Entry HTML; references src/index.ts
├── package.json              ← Dependencies: @aws-blocks/blocks, @aws-blocks/bb-auth-basic,
│                               @aws-blocks/bb-distributed-table, react, react-dom, zod, typescript
└── .bb-data/                 ← Block-managed local persistence (gitignored)
```

**Key constraint**: `aws-blocks/index.ts` is the **only backend file**. There are no other server files, no Express routes, no database connection files. All backend logic lives in the ApiNamespace callback within this single file.

---

## 14. Implementation Milestones

### Milestone 1 — Scaffold

1. Run: `npm create @aws-blocks/blocks-app@latest . --template react`
2. Run: `npm install`
3. Run: `npm run dev` — verify the dev server starts at `http://localhost:3000`
4. Open the browser; verify the scaffold sample UI renders
5. Remove all sample todo/counter code from `src/index.ts`
6. Verify the blank app still loads without errors

### Milestone 2 — Authentication

1. Add `AuthBasic` to `aws-blocks/index.ts`; export `authApi`
2. In `src/index.ts`, import `authApi`; set up `onAuthChange` listener in `useEffect`
3. Render `<Authenticator authApi={authApi} />` when not signed in
4. Add `<UserHeader />` with username display and sign-out button for signed-in state
5. **Verify**: sign up a new account → session is established → username appears
6. **Verify**: sign out → Authenticator reappears
7. **Verify**: sign in with the same account → session is established

### Milestone 3 — Bookmark Table

1. Add `bookmarkSchema` (Zod) to `aws-blocks/index.ts`
2. Add `DistributedTable` instance with correct `key` config
3. **Verify**: `npm run dev` still starts without errors
4. **Verify**: `.bb-data/` directory is created after starting the server
5. **Verify**: Zod schema rejects an invalid bookmark object (test in isolation)

### Milestone 4 — Typed API

1. Add `ApiNamespace` with all three methods to `aws-blocks/index.ts`
2. Implement `createBookmark`: requireAuth → userId=user.username → generate ids → put()
3. Implement `listBookmarks`: requireAuth → userId=user.username → query() → Array.fromAsync()
4. Implement `deleteBookmark`: requireAuth → userId=user.username → get() ownership check → delete()
5. **Verify**: all TypeScript types compile without errors (`npm run build` or `tsc --noEmit`)

### Milestone 5 — Frontend

1. Create `src/types.ts` with `Bookmark`, `FormState`, `ListState` types
2. Implement `BookmarkForm.tsx` with validation and all FormState transitions
3. Implement `BookmarkList.tsx` with all four rendering states (loading/error/empty/success)
4. Implement `BookmarkItem.tsx` with title, url, tag, createdAt display and delete button
5. Wire `BookmarkForm` and `BookmarkList` into the signed-in view in `src/index.ts`
6. **Verify**: complete happy path — sign in → create bookmark → see it in list → delete it → list refreshes

### Milestone 6 — Security Testing

Run the manual security test cases from §16 and verify all pass.

### Milestone 7 — Persistence Testing

Run the manual persistence test cases from §17 and verify all pass.

---

## 15. Verification Strategy

### Startup verification

```bash
npm run dev
# Expected: "Server running at http://localhost:3000" (or similar)
# Open http://localhost:3000 in browser
# Expected: Authenticator component renders, no console errors
```

### Per-milestone verification

**Milestone 1**: Browser shows blank page (or minimal scaffold) with no console errors.

**Milestone 2**:
- Visit app → see Authenticator
- Sign up with username "testuser" + password → signed-in state renders, username "testuser" visible
- Click sign out → Authenticator reappears
- Sign in as "testuser" → signed-in state renders again

**Milestone 3**:
- `npm run dev` → no TypeScript or runtime errors in terminal
- `.bb-data/` directory exists after server start
- Confirm `bookmarkSchema.parse(validBookmark)` succeeds and `bookmarkSchema.parse(invalidBookmark)` throws

**Milestone 4**:
- `npx tsc --noEmit` → 0 errors
- Open browser console while signed in
- Run `await api.createBookmark({ url: 'https://example.com', title: 'Test', tag: 'misc' })` → returns bookmark object
- Run `await api.listBookmarks()` → returns array containing the created bookmark
- Run `await api.deleteBookmark({ bookmarkId: '<id from above>' })` → resolves without error
- Run `await api.listBookmarks()` → returns empty array

**Milestone 5**:
- Happy path: create bookmark via form → appears in list → delete → list shows empty state
- Validation: submit form with empty title → field error appears, API not called
- Validation: submit form with non-URL in url field → field error appears, API not called
- Loading state: briefly visible on slow connections (or with network throttle)
- Error state: if API throws, error message appears

**Milestone 6**: See §16

**Milestone 7**: See §17

---

## 16. Security Test Cases

### Test 1 — Signed-out API access

**Setup**: Clear all session cookies (or use a fresh incognito browser tab). Do not sign in.

**Action**: In the browser console, run:
```javascript
await api.createBookmark({ url: 'https://evil.com', title: 'Hacked', tag: 'test' });
```

**Expected**: Promise rejects with an authentication error (SessionExpiredException or similar). No bookmark is created. No data is written to `.bb-data/`.

### Test 2 — User A cannot see User B's bookmarks

**Setup**:
1. Sign up and sign in as User A
2. Create a bookmark: `{ url: 'https://user-a.com', title: 'User A Bookmark', tag: 'private' }`
3. Sign out

**Action**:
1. Sign up and sign in as User B (different username)
2. Run `await api.listBookmarks()`

**Expected**: The returned array does NOT contain "User A Bookmark" or any bookmark with User A's data. User B's list is empty (or contains only User B's own bookmarks).

### Test 3 — User B cannot delete User A's bookmark

**Setup**:
1. Sign in as User A; create a bookmark; note the returned `bookmarkId` (call it `bookmarkId_A`)
2. Sign out; sign in as User B

**Action**:
```javascript
await api.deleteBookmark({ bookmarkId: bookmarkId_A });
```

**Expected**: Promise rejects with `NotFoundError`. Sign out; sign in as User A; call `api.listBookmarks()` — the bookmark is still present.

### Test 4 — Ownership enforced on all three methods

**Verification**: Review `aws-blocks/index.ts`. Confirm:
- `createBookmark`: `userId` is set to `user.username` (NOT from `input`)
- `listBookmarks`: query uses `{ equals: user.username }` (NOT a parameter)
- `deleteBookmark`: delete key uses `userId: user.username` (NOT from `input`)

No method signature contains a `userId` parameter.

---

## 17. Persistence Test Cases

### Test 1 — Browser refresh

**Steps**:
1. Sign in as a user
2. Create a bookmark via the form; note the title
3. Refresh the browser page (`F5` or `Cmd+R`)
4. Sign in again (if required by session cookie behavior)

**Expected**: The bookmark list loads and the bookmark from step 2 is still present with the same title, url, tag, and createdAt.

### Test 2 — Server restart

**Steps**:
1. Sign in as a user
2. Create a bookmark via the form; note the title
3. In the terminal, stop the dev server (`Ctrl+C`)
4. Run `npm run dev` again
5. Navigate to `http://localhost:3000`
6. Sign in

**Expected**: The bookmark from step 2 is still present. The `.bb-data/` directory contents were preserved across the restart.

### Test 3 — Sign-out and re-login

**Steps**:
1. Sign in as a user
2. Create a bookmark via the form; note the title
3. Click "Sign out"
4. Sign back in with the same credentials

**Expected**: The bookmark from step 2 is visible in the list. `user.username` is the same stable identifier used as the partition key, so the same data is returned by `listBookmarks()`.

---

## 18. Definition of Done

- [ ] Sign-up creates a new account and establishes an authenticated session
- [ ] Sign-in establishes an authenticated session for an existing account
- [ ] Sign-out terminates the session and returns the UI to the signed-out (Authenticator) state
- [ ] `<Authenticator authApi={authApi} />` renders correctly when not signed in
- [ ] The signed-in UI shows username, sign-out control, bookmark creation form, and bookmark list
- [ ] Bookmark schema is validated with Zod (userId, bookmarkId, url, title, tag, createdAt)
- [ ] DistributedTable stores bookmark records with `userId` as partition key and `bookmarkId` as sort key
- [ ] `userId` is always derived from `user.username` returned by `auth.requireAuth(context)` — never from client input
- [ ] `bookmarkId` is always generated server-side via `crypto.randomUUID()`
- [ ] `createdAt` is always generated server-side via `new Date().toISOString()`
- [ ] `createBookmark` is declared and typed via ApiNamespace with explicit input/output types
- [ ] `listBookmarks` is declared and typed via ApiNamespace with explicit output type
- [ ] `deleteBookmark` is declared and typed via ApiNamespace with explicit input type
- [ ] Every protected API method calls `auth.requireAuth(context)` as its first operation
- [ ] `listBookmarks` queries only the authenticated user's partition (`userId = user.username`)
- [ ] `deleteBookmark` uses the composite key `{ userId: user.username, bookmarkId }` — no userId from input
- [ ] Frontend imports `api` and `authApi` from `'aws-blocks'` only
- [ ] Frontend uses NO `fetch()` calls for any bookmark or auth operations
- [ ] Bookmark form validates URL, title, and tag client-side before calling the API
- [ ] Field-level error messages are shown for invalid form submissions
- [ ] FormState machine transitions correctly: idle → loading → success/error
- [ ] BookmarkList renders all four states: loading, empty, error, success with items
- [ ] Each bookmark item displays title, url (as link), tag, createdAt, and a delete button
- [ ] Data survives browser page refresh
- [ ] Data survives local dev server restart (`npm run dev`)
- [ ] User A cannot see User B's bookmarks (partition isolation verified)
- [ ] User A cannot delete User B's bookmarks (composite key + ownership check verified)
- [ ] `.bb-data/` is never read from or written to directly by application code
- [ ] No custom persistence layer: no localStorage, sessionStorage, SQLite, or custom data files
- [ ] `npx tsc --noEmit` produces 0 errors

---

## 19. Potential AWS Blocks Version / API Risks

- **AuthBasic is Preview-stage**: Session cookie behavior, the shape of the auth state object, and the exact field name for user identity (`user.username`) should be verified against the installed `@aws-blocks/bb-auth-basic` package version before trusting the design assumptions above.

- **`Array.fromAsync()` requires Node.js 22+**: Verify the runtime version with `node --version`. If Node.js < 22, use a polyfill or replace with:
  ```typescript
  const results: Bookmark[] = [];
  for await (const item of bookmarks.query(...)) results.push(item);
  return results;
  ```

- **DistributedTable local persistence durability**: The `.bb-data/`-backed local implementation should be tested explicitly with a server restart before treating persistence as confirmed. In-memory state may be the default with `.bb-data/` as a checkpoint, not a live write-through store.

- **Block ID immutability**: The block IDs `'auth'`, `'bookmarks'`, and `'api'` are stable identifiers. Renaming any of them after first use causes AWS Blocks to treat it as a new resource, destroying existing data. Never rename block IDs.

- **`isBlocksError()` import path**: Verify that `isBlocksError` is exported from `@aws-blocks/blocks` top-level. If not found, check `@aws-blocks/blocks/errors` or the block-specific package.

- **Scope name immutability**: The scope name `'bookmark-manager'` is the stable application identifier. It must remain unchanged between runs and deployments. Changing it recreates all AWS resources (new DynamoDB tables, new Cognito user pool, new Lambda functions).

- **`auth.createApi()` return type**: The shape of the object returned by `authApi.onAuthChange(state => ...)` — specifically which field holds the username — should be confirmed against the installed package. The design assumes `state.username`; verify this matches the actual type definition.

---

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system — essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

### Property 1: Signed-in UI renders all required elements

*For any* authenticated auth state (where `isAuthenticated === true`), the rendered application UI SHALL contain the authenticated user's identity, a sign-out control, the bookmark creation form, and the bookmark list — and SHALL NOT contain the Authenticator component.

**Validates: Requirements 2.1, 2.2, 2.3**

---

### Property 2: Unauthenticated requests are rejected before any data operation

*For any* call to `createBookmark`, `listBookmarks`, or `deleteBookmark` made without a valid authenticated session, the system SHALL reject the request with an authorization error and SHALL NOT perform any read or write operation on the DistributedTable.

**Validates: Requirements 3.3, 4.3, 5.3**

---

### Property 3: Created bookmarks are stored under the authenticated user's partition

*For any* authenticated user who calls `createBookmark` with valid input, the stored bookmark record SHALL have `userId === user.username` as derived from `auth.requireAuth(context)`, and a subsequent call to `listBookmarks` by the same user SHALL return a list containing that bookmark with all fields matching the input values and the server-generated `bookmarkId` and `createdAt`.

**Validates: Requirements 3.4, 3.5, 3.6, 3.7**

---

### Property 4: Server generates unique bookmark identifiers

*For any* two separate calls to `createBookmark` (regardless of input content or user identity), the returned `bookmarkId` values SHALL be distinct.

**Validates: Requirements 3.5**

---

### Property 5: Invalid bookmark inputs are rejected

*For any* call to `createBookmark` with an input that fails Zod validation (e.g., a malformed URL, an empty title, an empty tag), the system SHALL reject the request with a validation error and SHALL NOT write any record to the DistributedTable.

**Validates: Requirements 3.8, 3.9**

---

### Property 6: Bookmark list is scoped exclusively to the authenticated user's partition

*For any* two distinct users A and B, if User A calls `listBookmarks` after User B has created one or more bookmarks, the result SHALL contain no records belonging to User B (i.e., no records with `userId === user_B.username`).

**Validates: Requirements 4.4, 4.5, 8.1, 8.2**

---

### Property 7: Delete uses composite key preventing cross-user deletion

*For any* authenticated user who calls `deleteBookmark({ bookmarkId })` where the bookmark `bookmarkId` was created by a different user, the system SHALL return a not-found error and SHALL NOT delete any record from the DistributedTable.

**Validates: Requirements 5.4, 5.5, 5.6, 8.3**

---

### Property 8: Deleting one bookmark leaves all other bookmarks intact

*For any* user with two or more bookmarks, deleting one specific bookmark (by its `bookmarkId`) SHALL result in a `listBookmarks` response that contains all previously existing bookmarks except the deleted one, with all their fields unchanged.

**Validates: Requirements 5.6**

---

### Property 9: Client-side form validation rejects invalid submissions

*For any* form submission where at least one field fails validation (url is not a valid URL, title is empty/whitespace-only, or tag is empty/whitespace-only), the system SHALL display a field-level error message and SHALL NOT invoke `createBookmark`.

**Validates: Requirements 6.2, 6.3, 6.4, 6.5**

---

### Property 10: Bookmark item rendering contains all required fields

*For any* `Bookmark` object, the rendered `BookmarkItem` component SHALL include the bookmark's title, url, tag, and createdAt values, and SHALL include a delete control.

**Validates: Requirements 7.2, 7.3**
