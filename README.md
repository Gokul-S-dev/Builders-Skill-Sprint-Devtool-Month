# Bookmark Manager Workspace

Welcome to the **Bookmark Manager** project! This repository contains a full-stack, secure bookmark management application that uses **React** on the frontend and **AWS Blocks** for backend services, data persistence, and authentication.

---

## 📂 Repository Structure

The workspace is organized as follows:

| Path | Description |
| :--- | :--- |
| **[`blocks-scaffold/`](file:///d:/downloads/Builders-Skill-Sprint-Devtool-Month/blocks-scaffold)** | The main application directory containing the frontend React code and the backend API logic. |
| ├── **[`blocks-scaffold/src/`](file:///d:/downloads/Builders-Skill-Sprint-Devtool-Month/blocks-scaffold/src)** | Frontend components, styles, types, and the main React app. |
| ├── **[`blocks-scaffold/aws-blocks/`](file:///d:/downloads/Builders-Skill-Sprint-Devtool-Month/blocks-scaffold/aws-blocks)** | Backend API operations, user authentication settings, and DynamoDB data schema definitions. |
| └── **[`blocks-scaffold/test/e2e.test.ts`](file:///d:/downloads/Builders-Skill-Sprint-Devtool-Month/blocks-scaffold/test/e2e.test.ts)** | E2E integration tests validating authentication flow, bookmark CRUD, and cross-user data isolation. |

---

## ⚡ Quick Start

To run the application locally, navigate into the `blocks-scaffold` folder and follow these steps:

1. **Install Dependencies**:
   ```bash
   cd blocks-scaffold
   npm install
   ```

2. **Run Dev Server**:
   ```bash
   npm run dev
   ```
   Open **[http://localhost:3000](http://localhost:3000)** in your browser. This spins up the Vite frontend and a local AWS Blocks mock server (on a single origin for easy local cookie auth).

3. **Run End-to-End Tests**:
   ```bash
   npm run test:e2e
   ```

---

## 📖 Learn More

For complete details on application features, configurations, and deployment guidelines, please refer to the main **[`blocks-scaffold/README.md`](file:///d:/downloads/Builders-Skill-Sprint-Devtool-Month/blocks-scaffold/README.md)**.
