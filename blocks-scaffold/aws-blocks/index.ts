import { Scope, ApiNamespace } from '@aws-blocks/blocks';
import { AuthBasic } from '@aws-blocks/bb-auth-basic';
import { DistributedTable } from '@aws-blocks/bb-distributed-table';
import { z } from 'zod';

const scope = new Scope('bookmark-manager');

// ─── Auth ────────────────────────────────────────────────────────────────────
const auth = new AuthBasic(scope, 'auth', {
  passwordPolicy: { minLength: 8 },
  crossDomain: process.env.BLOCKS_SANDBOX === 'true',
});
export const authApi = auth.createApi();

// ─── Data Schema & Table ──────────────────────────────────────────────────────
const bookmarkSchema = z.object({
  userId: z.string(),
  bookmarkId: z.string(),
  url: z.string().url(),
  title: z.string().min(1),
  tag: z.string().min(1),
  createdAt: z.string().datetime(),
});

type Bookmark = z.infer<typeof bookmarkSchema>;

const bookmarks = new DistributedTable(scope, 'bookmarks', {
  schema: bookmarkSchema,
  key: { partitionKey: 'userId', sortKey: 'bookmarkId' },
});

// ─── API Namespace ───────────────────────────────────────────────────────────
export const api = new ApiNamespace(scope, 'api', (context) => ({
  async createBookmark(input: { url: string; title: string; tag: string }) {
    const user = await auth.requireAuth(context);
    const userId = user.username;
    const bookmarkId = crypto.randomUUID();
    const createdAt = new Date().toISOString();

    const bookmark: Bookmark = {
      userId,
      bookmarkId,
      url: input.url,
      title: input.title,
      tag: input.tag,
      createdAt,
    };

    await bookmarks.put(bookmark);
    return bookmark;
  },

  async listBookmarks(): Promise<Bookmark[]> {
    const user = await auth.requireAuth(context);
    const userId = user.username;

    const results: Bookmark[] = [];
    for await (const item of bookmarks.query({ where: { userId: { equals: userId } } })) {
      results.push(item);
    }
    return results;
  },

  async deleteBookmark(input: { bookmarkId: string }): Promise<void> {
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
