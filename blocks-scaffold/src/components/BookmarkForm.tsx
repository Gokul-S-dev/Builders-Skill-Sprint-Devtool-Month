import { useState } from 'react';
import { api } from 'aws-blocks';
import { z } from 'zod';
import { FormState } from '../types';

interface BookmarkFormProps {
  onBookmarkCreated: () => void;
}

export function BookmarkForm({ onBookmarkCreated }: BookmarkFormProps) {
  const [url, setUrl] = useState('');
  const [title, setTitle] = useState('');
  const [tag, setTag] = useState('');
  
  const [formState, setFormState] = useState<FormState>('idle');
  const [formError, setFormError] = useState<string | null>(null);
  
  // Field validation errors
  const [fieldErrors, setFieldErrors] = useState<{ url?: string; title?: string; tag?: string }>({});

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormState('idle');
    setFormError(null);
    setFieldErrors({});

    const errors: { url?: string; title?: string; tag?: string } = {};

    // Validate URL
    const urlTrimmed = url.trim();
    try {
      z.string().url().parse(urlTrimmed);
    } catch {
      errors.url = 'Please enter a valid URL';
    }

    // Validate Title
    const titleTrimmed = title.trim();
    if (!titleTrimmed) {
      errors.title = 'Title is required';
    }

    // Validate Tag
    const tagTrimmed = tag.trim();
    if (!tagTrimmed) {
      errors.tag = 'Tag is required';
    }

    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      return;
    }

    setFormState('loading');
    try {
      await api.createBookmark({
        url: urlTrimmed,
        title: titleTrimmed,
        tag: tagTrimmed,
      });
      setFormState('success');
      setUrl('');
      setTitle('');
      setTag('');
      onBookmarkCreated();
    } catch (err: any) {
      setFormState('error');
      setFormError(err.message || 'An error occurred while creating the bookmark.');
    }
  };

  return (
    <div className="glass-card">
      <h3 className="card-title">Add Bookmark</h3>
      <form onSubmit={handleSubmit} noValidate>
        <div className="form-group">
          <label className="form-label" htmlFor="bookmark-url">URL</label>
          <input
            id="bookmark-url"
            type="url"
            className="form-input"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://example.com"
            disabled={formState === 'loading'}
          />
          {fieldErrors.url && <span className="field-error">{fieldErrors.url}</span>}
        </div>

        <div className="form-group">
          <label className="form-label" htmlFor="bookmark-title">Title</label>
          <input
            id="bookmark-title"
            type="text"
            className="form-input"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Example Website"
            disabled={formState === 'loading'}
          />
          {fieldErrors.title && <span className="field-error">{fieldErrors.title}</span>}
        </div>

        <div className="form-group">
          <label className="form-label" htmlFor="bookmark-tag">Tag</label>
          <input
            id="bookmark-tag"
            type="text"
            className="form-input"
            value={tag}
            onChange={(e) => setTag(e.target.value)}
            placeholder="work, learning, entertainment"
            disabled={formState === 'loading'}
          />
          {fieldErrors.tag && <span className="field-error">{fieldErrors.tag}</span>}
        </div>

        <button 
          id="btn-create-bookmark"
          type="submit" 
          className="btn-primary" 
          disabled={formState === 'loading'}
        >
          {formState === 'loading' ? 'Saving...' : 'Add Bookmark'}
        </button>
      </form>

      {formState === 'success' && (
        <div className="form-feedback success" id="form-feedback-success">
          ✨ Bookmark added successfully!
        </div>
      )}

      {formState === 'error' && formError && (
        <div className="form-feedback error" id="form-feedback-error">
          ⚠️ {formError}
        </div>
      )}
    </div>
  );
}
