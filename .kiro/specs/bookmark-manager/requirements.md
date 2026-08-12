# Requirements Document

## Introduction

The Bookmark Manager is a private, per-user bookmark collection built on the AWS Blocks Level 1 platform. Authenticated users can sign up, sign in, sign out, create bookmarks, view their own bookmarks, and delete their own bookmarks. Each user's bookmark collection is fully isolated from every other user's collection. The system is implemented using the AWS Blocks primitives AuthBasic, DistributedTable, Scope, and ApiNamespace. The workspace is scaffolded from scratch with no pre-existing files.

## Glossary

- **System**: The Bookmark Manager application, comprising its backend API and React frontend.
- **AuthBasic**: The AWS Blocks authentication primitive that provides sign-up, sign-in, sign-out, and session management.
- **Authenticator**: The AWS Blocks React component rendered by AuthBasic that presents the sign-up/sign-in UI.
- **DistributedTable**: The AWS Blocks data primitive used to store and retrieve bookmark records, partitioned by userId and sorted by bookmarkId.
- **Scope**: The AWS Blocks primitive that defines the application's resource namespace and configuration boundary.
- **ApiNamespace**: The AWS Blocks primitive used to declare and expose typed backend API methods callable from the frontend.
- **User**: A person who has registered an account via AuthBasic and is uniquely identified by a server-derived userId.
- **AuthenticatedUser**: A User whose identity has been verified by a successful auth.requireAuth(context) call within an API method.
- **UserId**: A unique identifier assigned to a User by the authentication system; always derived server-side and never accepted from browser input.
- **BookmarkId**: A unique identifier for a single bookmark record; always generated server-side at creation time.
- **Bookmark**: A record containing userId, bookmarkId, url, title, tag, and createdAt fields stored in the DistributedTable.
- **CreatedAt**: An ISO 8601 timestamp generated server-side at the moment a Bookmark is created.
- **Tag**: A single non-empty string field on a Bookmark used for categorisation.
- **CreateBookmarkInput**: The client-supplied payload for bookmark creation containing url, title, and tag.
- **BookmarkList**: The ordered collection of Bookmarks belonging to the AuthenticatedUser, displayed in the frontend.
- **FormState**: The UI state of the bookmark creation form; one of idle, loading, success, or error.
- **Ownership**: The relationship between a Bookmark and the User whose UserId matches the Bookmark's userId partition key.

---

## Requirements

### Requirement 1 — User Authentication

**User Story:** As a visitor, I want to sign up and sign in to a personal account, so that my bookmarks are private and accessible only to me.

#### Acceptance Criteria

1. THE System SHALL use AuthBasic as the sole authentication mechanism for account creation and session management.
2. WHEN a visitor is not signed in, THE System SHALL render the Authenticator component and no other application UI.
3. WHEN a visitor submits valid credentials during sign-up, THE System SHALL create a new account and establish an authenticated session.
4. WHEN a visitor submits valid credentials during sign-in, THE System SHALL establish an authenticated session.
5. WHEN an AuthenticatedUser activates the sign-out control, THE System SHALL terminate the authenticated session and return the UI to the signed-out state.
6. IF AuthBasic returns an authentication error during sign-in or sign-up, THEN THE System SHALL display the error message provided by AuthBasic to the visitor.

---

### Requirement 2 — Authenticated Session UI

**User Story:** As an AuthenticatedUser, I want to see my identity and navigation controls immediately after signing in, so that I know I am in my own account.

#### Acceptance Criteria

1. WHILE a User is signed in, THE System SHALL display the authenticated User's identifying information (such as username or email) sourced from the AuthBasic session.
2. WHILE a User is signed in, THE System SHALL display a sign-out control.
3. WHILE a User is signed in, THE System SHALL display the bookmark creation form and the BookmarkList.
4. WHEN the authenticated session ends, THE System SHALL remove the bookmark creation form and BookmarkList from the UI and display only the Authenticator.

---

### Requirement 3 — Bookmark Creation API

**User Story:** As an AuthenticatedUser, I want to create a bookmark via a typed API method, so that my bookmarks are persisted securely on the server.

#### Acceptance Criteria

1. THE System SHALL expose a `createBookmark` method via ApiNamespace that accepts a CreateBookmarkInput containing url, title, and tag.
2. WHEN `createBookmark` is invoked, THE System SHALL call auth.requireAuth(context) before executing any other logic.
3. IF auth.requireAuth(context) does not return a valid AuthenticatedUser identity, THEN THE System SHALL reject the request with an authorization error and perform no data operations.
4. WHEN `createBookmark` is invoked by an AuthenticatedUser, THE System SHALL derive the UserId exclusively from the value returned by auth.requireAuth(context).
5. WHEN `createBookmark` is invoked by an AuthenticatedUser, THE System SHALL generate a unique BookmarkId server-side.
6. WHEN `createBookmark` is invoked by an AuthenticatedUser, THE System SHALL generate a CreatedAt timestamp server-side.
7. WHEN `createBookmark` is invoked by an AuthenticatedUser, THE System SHALL store a Bookmark record in the DistributedTable using the AuthenticatedUser's UserId as the partition key and the generated BookmarkId as the sort key.
8. THE System SHALL validate the Bookmark data model using Zod before writing to the DistributedTable.
9. IF Zod validation of the Bookmark record fails, THEN THE System SHALL reject the request with a validation error and perform no write operation.

---

### Requirement 4 — Bookmark Listing API

**User Story:** As an AuthenticatedUser, I want to list only my own bookmarks via a typed API method, so that I never see another user's data.

#### Acceptance Criteria

1. THE System SHALL expose a `listBookmarks` method via ApiNamespace that accepts no client-supplied filtering parameters.
2. WHEN `listBookmarks` is invoked, THE System SHALL call auth.requireAuth(context) before executing any other logic.
3. IF auth.requireAuth(context) does not return a valid AuthenticatedUser identity, THEN THE System SHALL reject the request with an authorization error and return no data.
4. WHEN `listBookmarks` is invoked by an AuthenticatedUser, THE System SHALL query the DistributedTable using only the AuthenticatedUser's server-derived UserId as the partition key.
5. WHEN `listBookmarks` is invoked by an AuthenticatedUser, THE System SHALL return only Bookmark records whose userId matches the AuthenticatedUser's UserId.

---

### Requirement 5 — Bookmark Deletion API

**User Story:** As an AuthenticatedUser, I want to delete one of my own bookmarks via a typed API method, so that only I can remove my bookmarks.

#### Acceptance Criteria

1. THE System SHALL expose a `deleteBookmark` method via ApiNamespace that accepts a bookmarkId parameter.
2. WHEN `deleteBookmark` is invoked, THE System SHALL call auth.requireAuth(context) before executing any other logic.
3. IF auth.requireAuth(context) does not return a valid AuthenticatedUser identity, THEN THE System SHALL reject the request with an authorization error and perform no data operations.
4. WHEN `deleteBookmark` is invoked by an AuthenticatedUser, THE System SHALL construct the DistributedTable delete key using both the server-derived UserId and the supplied bookmarkId.
5. IF the Bookmark identified by the combined UserId and bookmarkId does not exist in the DistributedTable, THEN THE System SHALL return a not-found error without deleting any record.
6. WHEN a delete operation targeting a valid key is executed, THE System SHALL remove only the Bookmark whose partition key matches the AuthenticatedUser's UserId and whose sort key matches the supplied bookmarkId.

---

### Requirement 6 — Frontend Bookmark Creation Form

**User Story:** As an AuthenticatedUser, I want to create a bookmark through a validated form, so that only well-formed bookmarks are submitted to the API.

#### Acceptance Criteria

1. WHILE a User is signed in, THE System SHALL display a form with three fields: URL, Title, and Tag.
2. WHEN the User submits the creation form, THE System SHALL validate that the URL field contains a valid URL before invoking `createBookmark`.
3. WHEN the User submits the creation form, THE System SHALL validate that the Title field is non-empty before invoking `createBookmark`.
4. WHEN the User submits the creation form, THE System SHALL validate that the Tag field is non-empty before invoking `createBookmark`.
5. IF any form field fails client-side validation, THEN THE System SHALL display a field-level error message and not invoke `createBookmark`.
6. WHEN the creation form is submitted with valid field values, THE System SHALL set FormState to loading and invoke `createBookmark` using the typed aws-blocks API export.
7. WHEN `createBookmark` returns successfully, THE System SHALL set FormState to success, reset all form fields to empty, and refresh the BookmarkList.
8. IF `createBookmark` returns an error, THEN THE System SHALL set FormState to error and display the error message to the User.
9. THE System SHALL NOT use the browser fetch() API to call any backend method; all API calls MUST use the typed aws-blocks exports.

---

### Requirement 7 — Frontend Bookmark List

**User Story:** As an AuthenticatedUser, I want to see all my bookmarks displayed with their details and a delete control, so that I can manage my collection at a glance.

#### Acceptance Criteria

1. WHILE a User is signed in, THE System SHALL display the BookmarkList populated by invoking `listBookmarks` via the typed aws-blocks API export.
2. WHEN the BookmarkList is rendered, THE System SHALL display each Bookmark's title, url, tag, and createdAt fields.
3. WHEN the BookmarkList is rendered, THE System SHALL display a delete control alongside each Bookmark.
4. WHEN the User activates a delete control for a Bookmark, THE System SHALL invoke `deleteBookmark` with the corresponding bookmarkId using the typed aws-blocks API export.
5. WHEN `deleteBookmark` returns successfully, THE System SHALL refresh the BookmarkList to reflect the removal.
6. IF `deleteBookmark` returns an error, THEN THE System SHALL display the error message to the User without modifying the locally displayed BookmarkList.
7. THE System SHALL NOT use the browser fetch() API to call any backend method; all API calls MUST use the typed aws-blocks exports.

---

### Requirement 8 — Data Isolation and Security

**User Story:** As an AuthenticatedUser, I want certainty that another user cannot read or delete my bookmarks, so that my data remains private.

#### Acceptance Criteria

1. THE System SHALL derive the UserId used in every DistributedTable operation exclusively from the value returned by auth.requireAuth(context) within the executing API method.
2. THE System SHALL NOT accept a UserId as a client-supplied parameter in any API method.
3. WHEN `deleteBookmark` is invoked, THE System SHALL use the combination of the server-derived UserId and the supplied bookmarkId as the complete DistributedTable key, preventing deletion of Bookmarks owned by a different User.
4. THE System SHALL NOT rely on hiding UI controls (such as delete buttons) as an authorization mechanism; ownership enforcement MUST occur server-side on every mutating API call.
5. THE System SHALL NOT access the .bb-data/ directory directly; all data operations MUST use DistributedTable methods provided by the aws-blocks API.

---

### Requirement 9 — Data Persistence

**User Story:** As an AuthenticatedUser, I want my bookmarks to persist across browser refreshes and server restarts, so that I do not lose my data.

#### Acceptance Criteria

1. THE System SHALL store all Bookmark records in the DistributedTable, which provides durable storage that survives browser refresh.
2. WHEN the server process is restarted, THE System SHALL make all previously stored Bookmark records available via `listBookmarks` without requiring re-creation.
3. THE System SHALL NOT use localStorage, sessionStorage, SQLite, or custom data files to store Bookmark records.

---

### Requirement 10 — API Type Safety

**User Story:** As a developer, I want all API methods to be fully typed through aws-blocks exports, so that type errors are caught at compile time.

#### Acceptance Criteria

1. THE System SHALL declare all backend API methods — `createBookmark`, `listBookmarks`, and `deleteBookmark` — using ApiNamespace with explicit TypeScript input and output types.
2. THE System SHALL expose the typed API client to the frontend exclusively via aws-blocks typed exports.
3. THE System SHALL validate all Bookmark records against a Zod schema that enforces the presence and type of userId, bookmarkId, url, title, tag, and createdAt fields.
4. IF a value supplied to any API method does not conform to the declared TypeScript type, THEN THE System SHALL produce a compile-time type error.
