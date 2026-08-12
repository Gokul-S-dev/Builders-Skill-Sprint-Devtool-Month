/**
 * End-to-end tests for Bookmark Manager API.
 *
 * Run:  npm run test:e2e
 */
import { test } from 'node:test';
import assert from 'node:assert';
import { spawn, type ChildProcess } from 'node:child_process';
import { setTimeout } from 'node:timers/promises';
import { installCookieJar, isServerRunning } from '@aws-blocks/blocks/utils';
import type { api as ApiType, authApi as AuthApiType } from 'aws-blocks';

// Install cookie jar before importing the API client
installCookieJar();

let server: ChildProcess | null = null;
let api: typeof ApiType;
let authApi: typeof AuthApiType;

// ─── Setup ───────────────────────────────────────────────────────────────────

test.before(async () => {
  // Use existing dev server if running, otherwise start one
  if (!await isServerRunning()) {
    const cmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';
    server = spawn(cmd, ['run', 'dev:server'], {
      cwd: process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe'],
      detached: true,
      env: { ...process.env, NODE_OPTIONS: '' },
      shell: true,
    });
    server.unref();
    await setTimeout(2000);
  }

  const mod = await import('aws-blocks');
  api = mod.api;
  authApi = mod.authApi;

  // Wait for server readiness
  for (let i = 0; i < 30; i++) {
    try {
      await authApi.getAuthState();
      return;
    } catch {
      await setTimeout(1000);
    }
  }
  throw new Error('Dev server did not become ready within 30s');
});

test.after(() => {
  if (server?.pid) {
    try { process.kill(-server.pid, 'SIGTERM'); } catch {}
  }
});

// ─── Auth Tests ───────────────────────────────────────────────────────────────

test('auth: starts signed out', async () => {
  const state = await authApi.getAuthState();
  assert.strictEqual(state.state, 'signedOut');
});

test('auth: sign up creates account and signs in', async () => {
  const state = await authApi.setAuthState({
    action: 'signUp',
    username: 'testuser@example.com',
    password: 'TestPass123!',
  });
  assert.strictEqual(state.state, 'signedIn');
  assert.strictEqual(state.user?.username, 'testuser@example.com');
});

test('auth: unauthenticated access is rejected', async () => {
  // Sign out first
  await authApi.setAuthState({ action: 'signOut' });

  await assert.rejects(
    () => api.listBookmarks(),
    (err: any) => err.message.includes('Authentication') || err.message.includes('Session') || err.message.includes('401'),
  );

  // Sign back in for remaining tests
  await authApi.setAuthState({
    action: 'signIn',
    username: 'testuser@example.com',
    password: 'TestPass123!',
  });
});

// ─── CRUD Tests ───────────────────────────────────────────────────────────────

let createdBookmarkId: string;

test('bookmarks: create bookmark with valid data', async () => {
  const bookmark = await api.createBookmark({
    url: 'https://example.com',
    title: 'Example site',
    tag: 'test-tag',
  });
  assert.strictEqual(bookmark.title, 'Example site');
  assert.strictEqual(bookmark.url, 'https://example.com');
  assert.strictEqual(bookmark.tag, 'test-tag');
  assert.ok(bookmark.bookmarkId);
  assert.ok(bookmark.createdAt);
  createdBookmarkId = bookmark.bookmarkId;
});

test('bookmarks: list only own bookmarks', async () => {
  const list = await api.listBookmarks();
  assert.ok(list.length >= 1);
  assert.ok(list.every(b => b.userId === 'testuser@example.com'));
  const found = list.find(b => b.bookmarkId === createdBookmarkId);
  assert.ok(found);
  assert.strictEqual(found?.title, 'Example site');
});

test('bookmarks: delete bookmark', async () => {
  await api.deleteBookmark({ bookmarkId: createdBookmarkId });
  const list = await api.listBookmarks();
  assert.ok(!list.some(b => b.bookmarkId === createdBookmarkId));
});

// ─── Security / Data Isolation Tests ──────────────────────────────────────────

test('security: cross-user isolation', async () => {
  // 1. Sign in as User A, create a bookmark, note its ID
  await authApi.setAuthState({ action: 'signOut' });
  await authApi.setAuthState({
    action: 'signUp',
    username: 'usera@example.com',
    password: 'Password123!',
  });

  const bookmarkA = await api.createBookmark({
    url: 'https://usera.com',
    title: 'User A site',
    tag: 'tag-a',
  });
  const bookmarkIdA = bookmarkA.bookmarkId;

  // 2. Sign out User A, sign in/up as User B
  await authApi.setAuthState({ action: 'signOut' });
  await authApi.setAuthState({
    action: 'signUp',
    username: 'userb@example.com',
    password: 'Password123!',
  });

  // 3. Assert User B cannot see User A's bookmark
  const listB = await api.listBookmarks();
  assert.ok(!listB.some(b => b.bookmarkId === bookmarkIdA));

  // 4. Assert User B cannot delete User A's bookmark (rejects with NotFoundError)
  await assert.rejects(
    () => api.deleteBookmark({ bookmarkId: bookmarkIdA }),
    (err: any) => err.name === 'NotFoundError' || err.message.includes('not found') || err.message.includes('NotFound'),
  );

  // 5. Sign out User B, sign back in as User A, assert bookmark A still exists
  await authApi.setAuthState({ action: 'signOut' });
  await authApi.setAuthState({
    action: 'signIn',
    username: 'usera@example.com',
    password: 'Password123!',
  });

  const listA = await api.listBookmarks();
  assert.ok(listA.some(b => b.bookmarkId === bookmarkIdA));

  // Cleanup
  await api.deleteBookmark({ bookmarkId: bookmarkIdA });
});
