export interface Bookmark {
  userId: string;
  bookmarkId: string;
  url: string;
  title: string;
  tag: string;
  createdAt: string;
}

export type FormState = 'idle' | 'loading' | 'success' | 'error';

export interface ListState {
  status: 'idle' | 'loading' | 'success' | 'error';
  items: Bookmark[];
  error?: string;
}
