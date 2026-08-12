# Bookmark Manager App (React & AWS Blocks)

A full-stack, secure, responsive Bookmark Manager web application built with Vite + React on the frontend, and AWS Blocks on the backend. It features user authentication, per-user data isolation, and simple tag-based categorizations.

## 🚀 Features

- **User Authentication (`AuthBasic`)**: Sign up, sign in, and sign out with JWT sessions.
- **Data Isolation**: All bookmarks are tied to the logged-in user via `userId`. Users can only view, create, and delete their own bookmarks.
- **Dynamic Bookmark Form**: Validate URLs using Zod and tag bookmarks dynamically.
- **Seamless Local Mocking**: AWS Blocks automatically mocks DynamoDB tables and Cognito pools locally so you can develop offline.
- **AWS Integration**: Deploy automatically to CloudFormation, DynamoDB, and Cognito on AWS.

---

## 🛠️ Getting Started

### 1. Start Local Development
```bash
npm run dev
```
Open **[http://localhost:3000](http://localhost:3000)**.
The development server serves the React frontend and the backend (`/aws-blocks/*`) from a single origin, allowing browser-navigation auth flows to work locally out of the box.

### 2. Run Integration Tests
```bash
npm run test:e2e
```
Runs comprehensive E2E integration tests against the local server using direct API client imports.

### 3. Deploy to AWS Sandbox
```bash
npm run sandbox
```
Deploys the backend API and database to a temporary AWS Sandbox stack and serves the frontend locally.

---

## 📁 Project Structure

| File / Folder Path | Component Type | Purpose |
| :--- | :--- | :--- |
| **[`aws-blocks/index.ts`](file:///d:/downloads/Builders-Skill-Sprint-Devtool-Month/blocks-scaffold/aws-blocks/index.ts)** | Backend | Defines authentication (`AuthBasic`), bookmark table schemas (`DistributedTable`), and JSON-RPC API operations (`createBookmark`, `listBookmarks`, `deleteBookmark`). |
| **[`src/App.tsx`](file:///d:/downloads/Builders-Skill-Sprint-Devtool-Month/blocks-scaffold/src/App.tsx)** | Frontend | React entry point, manages active user session state, and coordinates loading the dashboard. |
| **[`src/types.ts`](file:///d:/downloads/Builders-Skill-Sprint-Devtool-Month/blocks-scaffold/src/types.ts)** | Types | TypeScript interfaces for data structures (e.g. `Bookmark`) and state (e.g. `FormState`, `ListState`). |
| **[`src/components/`](file:///d:/downloads/Builders-Skill-Sprint-Devtool-Month/blocks-scaffold/src/components)** | Components | React UI components (form, items, list, user headers, authenticator). |
| **[`test/e2e.test.ts`](file:///d:/downloads/Builders-Skill-Sprint-Devtool-Month/blocks-scaffold/test/e2e.test.ts)** | Testing | End-to-end tests for account signup/signin, bookmark creation, retrieval, deletion, and cross-user data security. |

---

## 💾 Bookmark Schema

The bookmarks database stores elements matching the following structure:

```typescript
export interface Bookmark {
  userId: string;       // Owner's username / email
  bookmarkId: string;   // Unique UUID v4 for the bookmark
  url: string;          // Verified bookmark URL (e.g., https://example.com)
  title: string;        // Title of the bookmarked page
  tag: string;          // Category tag (e.g., "work", "learning")
  createdAt: string;    // ISO Date Time String (datetime)
}
```

---

## ⚙️ Commands Reference

| Command | Description |
| :--- | :--- |
| `npm run dev` | Spins up the backend mock server + React dev frontend on a single origin. |
| `npm run test:e2e` | Runs integration tests validating CRUD and Auth behaviors. |
| `npm run typecheck` | Validates TypeScript compilation across frontend and backend. |
| `npm run sandbox` | Deploys backend API resources directly to AWS, pointing the local frontend to them. |
| `npm run sandbox:destroy` | Tears down the sandbox resources from AWS. |
| `npm run deploy` | Bundles, compiles, and performs a full production deploy to AWS. |

---

## 🔒 Stack Naming & AWS Configuration

CloudFormation stack names are derived from the `stackId` parameter in `.blocks/config.json` (generated during initial scaffolding).
- **Production builds** are deployed under the stack name `<stackId>-prod`.
- **Sandbox builds** are deployed under the stack name `<stackId>-<username>-<random>` where the identifier is per-machine (stored in `.blocks-sandbox/sandbox-id.txt`). This allows multiple developers on a team to share a single AWS account without resource collision.

To customize stack naming, edit `stackId` in `.blocks/config.json` or customize `aws-blocks/index.cdk.ts`.

---

## 💡 Important Information for Agents

- Full AWS Building Block documentation is available at `node_modules/@aws-blocks/blocks/README.md`.
- **Do not** use local files, standard SQL databases, or local memory arrays for persistence. Use **Building Blocks** (`DistributedTable` / Cognito Auth) for all data persistence and cloud abstractions. They mock locally automatically and scale on AWS.
- All backend-to-frontend communication uses auto-generated JSON-RPC transport layers. Call the typed APIs directly via the `api` and `authApi` imports; do not query endpoints directly.
