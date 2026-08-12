import { useState } from 'react';
import { api } from 'aws-blocks';
import { Bookmark } from '../types';

interface BookmarkItemProps {
  bookmark: Bookmark;
  onDeleted: () => void;
}

export function BookmarkItem({ bookmark, onDeleted }: BookmarkItemProps) {
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const handleDelete = async () => {
    setIsDeleting(true);
    setDeleteError(null);
    try {
      await api.deleteBookmark({ bookmarkId: bookmark.bookmarkId });
      onDeleted();
    } catch (err: any) {
      setIsDeleting(false);
      setDeleteError(err.message || 'Failed to delete the bookmark.');
    }
  };

  const formattedDate = new Date(bookmark.createdAt).toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });

  return (
    <div className="bookmark-item" id={`bookmark-item-${bookmark.bookmarkId}`}>
      <div className="bookmark-content">
        <div className="bookmark-title-row">
          <span className="bookmark-title" title={bookmark.title}>{bookmark.title}</span>
          <span className="bookmark-tag">{bookmark.tag}</span>
        </div>
        <a 
          href={bookmark.url} 
          target="_blank" 
          rel="noopener noreferrer" 
          className="bookmark-url-link"
          title={bookmark.url}
        >
          {bookmark.url}
        </a>
        <span className="bookmark-date">Added on {formattedDate}</span>
        {deleteError && (
          <span className="field-error" style={{ marginTop: '0.25rem' }}>
            ⚠️ {deleteError}
          </span>
        )}
      </div>
      <button 
        className="btn-delete" 
        onClick={handleDelete}
        disabled={isDeleting}
        title="Delete Bookmark"
        aria-label="Delete Bookmark"
      >
        {isDeleting ? '...' : '×'}
      </button>
    </div>
  );
}
