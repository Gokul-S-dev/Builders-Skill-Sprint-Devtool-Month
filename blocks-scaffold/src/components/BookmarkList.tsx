import { useEffect, useState, useCallback } from 'react';
import { api } from 'aws-blocks';
import { BookmarkItem } from './BookmarkItem';
import { ListState } from '../types';

interface BookmarkListProps {
  reloadTrigger: number;
  onDeleted: () => void;
}

export function BookmarkList({ reloadTrigger, onDeleted }: BookmarkListProps) {
  const [listState, setListState] = useState<ListState>({ status: 'idle', items: [] });

  const loadBookmarks = useCallback(async () => {
    setListState({ status: 'loading', items: [] });
    try {
      const items = await api.listBookmarks();
      setListState({ status: 'success', items });
    } catch (err: any) {
      setListState({ status: 'error', items: [], error: err.message || 'Failed to load bookmarks.' });
    }
  }, []);

  useEffect(() => {
    loadBookmarks();
  }, [loadBookmarks, reloadTrigger]);

  if (listState.status === 'loading') {
    return (
      <div className="bookmark-list-container">
        <div className="skeleton-item" />
        <div className="skeleton-item" />
        <div className="skeleton-item" />
      </div>
    );
  }

  if (listState.status === 'error') {
    return (
      <div className="list-error-state" id="list-error-state">
        <p>⚠️ {listState.error}</p>
        <button className="btn-retry" onClick={loadBookmarks}>
          Retry
        </button>
      </div>
    );
  }

  if (listState.status === 'success' && listState.items.length === 0) {
    return (
      <div className="list-empty-state" id="list-empty-state">
        <p>📂 No bookmarks yet. Add one to get started!</p>
      </div>
    );
  }

  return (
    <div className="bookmark-list-container" id="bookmark-list-container">
      {listState.items.map((bookmark) => (
        <BookmarkItem
          key={bookmark.bookmarkId}
          bookmark={bookmark}
          onDeleted={onDeleted}
        />
      ))}
    </div>
  );
}
